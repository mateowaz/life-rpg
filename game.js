/* Life RPG — reglas del juego y cálculo de progreso.
   No guarda nada: todo (XP, niveles, rangos, rachas, logros) se recalcula desde los días. */
/* ============ Reglas del juego ============ */
const CATS = [
  {id:"curso",   name:"Curso",   hint:"Estudio, clases, proyectos"},
  {id:"fisico",  name:"Físico",  hint:"Entreno, deporte, caminatas"},
  {id:"cuidado", name:"Cuidado", hint:"Sueño, meditación, salud"},
  {id:"lectura", name:"Lectura", hint:"Libros, artículos"}
];
const CAT = Object.fromEntries(CATS.map(c=>[c.id,c]));
const DIFF = {1:{name:"Ligera",mult:1},2:{name:"Normal",mult:1.5},3:{name:"Intensa",mult:2}};
const FULL_DAY_BONUS = 50;
const actXP = (min,diff)=>Math.round((10+Math.min(Math.max(+min||0,0),240))*DIFF[diff].mult);
// XP para pasar del nivel L al L+1
const needG = L=>120+40*(L-1);
const needC = L=>60+20*(L-1);
function levelOf(xp,need){let L=1,rest=xp;while(rest>=need(L)){rest-=need(L);L++}return{level:L,into:rest,need:need(L),pct:rest/need(L)}}
const RANKS=[
  {lv:1,name:"Aprendiz"},{lv:5,name:"Iniciado"},{lv:10,name:"Aventurero"},{lv:15,name:"Veterano"},
  {lv:20,name:"Campeón"},{lv:30,name:"Maestro"},{lv:40,name:"Gran Maestro"},{lv:50,name:"Leyenda"}
];
const rankOf = lv=>{let r=RANKS[0];for(const k of RANKS) if(lv>=k.lv) r=k;return r};
const nextRank = lv=>RANKS.find(k=>k.lv>lv)||null;
const ACH=[
  {id:"primer-paso",name:"Primer paso",desc:"Registra tu primera actividad",t:1,m:s=>s.total},
  {id:"dia-completo",name:"Día completo",desc:"Trabaja las 4 categorías en un mismo día",t:1,m:s=>s.fullDays},
  {id:"equilibrista",name:"Equilibrista",desc:"Consigue 7 días completos",t:7,m:s=>s.fullDays},
  {id:"racha-3",name:"Encendido",desc:"Mantén una racha de 3 días",t:3,m:s=>s.bestStreak},
  {id:"racha-7",name:"Semana de hierro",desc:"Mantén una racha de 7 días",t:7,m:s=>s.bestStreak},
  {id:"racha-30",name:"Voluntad inquebrantable",desc:"Mantén una racha de 30 días",t:30,m:s=>s.bestStreak},
  {id:"curso-10",name:"Estudioso",desc:"10 actividades de Curso",t:10,m:s=>s.cnt.curso},
  {id:"fisico-10",name:"Forjado en acero",desc:"10 actividades de Físico",t:10,m:s=>s.cnt.fisico},
  {id:"cuidado-10",name:"Guardián de sí",desc:"10 actividades de Cuidado",t:10,m:s=>s.cnt.cuidado},
  {id:"lectura-10",name:"Devorador de páginas",desc:"10 actividades de Lectura",t:10,m:s=>s.cnt.lectura},
  {id:"maraton",name:"Maratón",desc:"Suma 180 minutos en un solo día",t:180,m:s=>s.maxDayMin},
  {id:"xp-1000",name:"Mil de experiencia",desc:"Acumula 1.000 XP",t:1000,m:s=>s.xp},
  {id:"nivel-10",name:"Rango Aventurero",desc:"Alcanza el nivel 10",t:10,m:s=>s.level},
  {id:"constancia",name:"Constancia",desc:"30 días con actividad",t:30,m:s=>s.activeDays},
  {id:"maestria",name:"Maestría equilibrada",desc:"Las 4 categorías en nivel 5",t:5,m:s=>Math.min(...CATS.map(c=>s.catLv[c.id]))},
  {id:"xp-10000",name:"Diez mil",desc:"Acumula 10.000 XP",t:10000,m:s=>s.xp}
];

/* ============ Fechas ============ */
const pad=n=>String(n).padStart(2,"0");
const keyOf=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const fromKey=k=>{const[y,m,d]=k.split("-").map(Number);return new Date(y,m-1,d)};
const addDays=(k,n)=>{const d=fromKey(k);d.setDate(d.getDate()+n);return keyOf(d)};
const todayKey=()=>keyOf(new Date());
const fmtLong=k=>fromKey(k).toLocaleDateString("es",{day:"numeric",month:"long",year:"numeric"});
const fmtWeek=k=>fromKey(k).toLocaleDateString("es",{weekday:"long"});
const fmtShort=k=>fromKey(k).toLocaleDateString("es",{day:"numeric",month:"short"});
const cap=s=>s.charAt(0).toUpperCase()+s.slice(1);
const nf=n=>Math.round(n).toLocaleString("es");
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uid=()=>Math.random().toString(36).slice(2,10)+Date.now().toString(36);

/* ============ Motor: recalcula todo desde los días ============ */
function dataDays(){ if(state.demo) return state.demoDays; return state.days }
function compute(){
  const days=dataDays(), keys=Object.keys(days).filter(k=>days[k].activities.length).sort();
  const s={total:0,xp:0,cnt:{curso:0,fisico:0,cuidado:0,lectura:0},catXP:{curso:0,fisico:0,cuidado:0,lectura:0},catMin:{curso:0,fisico:0,cuidado:0,lectura:0},fullDays:0,bestStreak:0,activeDays:0,maxDayMin:0,level:1,catLv:{},minutes:0};
  const unlocked={}, perDay={}; let run=0, prev=null;
  for(const k of keys){
    const acts=days[k].activities; const cats=new Set(); let dxp=0,dmin=0;
    for(const a of acts){s.total++;s.cnt[a.cat]++;s.catXP[a.cat]+=a.xp;s.catMin[a.cat]+=a.min;dxp+=a.xp;dmin+=a.min;cats.add(a.cat)}
    const full=cats.size===4; if(full){s.fullDays++;dxp+=FULL_DAY_BONUS}
    s.xp+=dxp; s.minutes+=dmin; s.activeDays++; s.maxDayMin=Math.max(s.maxDayMin,dmin);
    run=(prev&&addDays(prev,1)===k)?run+1:1; prev=k; s.bestStreak=Math.max(s.bestStreak,run);
    s.level=levelOf(s.xp,needG).level; for(const c of CATS) s.catLv[c.id]=levelOf(s.catXP[c.id],needC).level;
    const got=[]; for(const a of ACH){ if(!unlocked[a.id] && a.m(s)>=a.t){unlocked[a.id]=k;got.push(a.id)} }
    perDay[k]={xp:dxp,min:dmin,cats:[...cats],full,count:acts.length,ach:got};
  }
  for(const c of CATS) s.catLv[c.id]=s.catLv[c.id]||1;
  // racha actual: cuenta hacia atrás desde hoy (o desde ayer si hoy aún no hay nada)
  const T=todayKey(); let cur=0, k=perDay[T]?T:addDays(T,-1); while(perDay[k]){cur++;k=addDays(k,-1)}
  s.curStreak=cur; s.perDay=perDay; s.unlocked=unlocked; s.keys=keys;
  s.G=levelOf(s.xp,needG); s.rank=rankOf(s.G.level); s.next=nextRank(s.G.level);
  return s;
}

