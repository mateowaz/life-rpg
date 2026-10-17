/* ============ Datos de ejemplo ============ */
function makeDemo(){
  const T=todayKey(), days={};
  const pool={curso:["Módulo de JavaScript","Clase de inglés","Proyecto final"],fisico:["Entrenamiento de fuerza","Correr 5 km","Yoga"],cuidado:["Meditación","Dormir 8 horas","Skincare y estiramientos"],lectura:["El nombre del viento","Artículo de diseño","Hábitos atómicos"]};
  let seed=7;const rnd=()=>(seed=(seed*9301+49297)%233280)/233280;
  for(let i=21;i>=0;i--){
    const k=addDays(T,-i); if(i===9||i===15) continue;
    const acts=[];
    for(const c of CATS){ if(i===0 && (c.id==="lectura")) continue; if(rnd()<.62||i<3){const min=[20,30,45,60][Math.floor(rnd()*4)],diff=1+Math.floor(rnd()*3);acts.push({id:uid(),cat:c.id,title:pool[c.id][Math.floor(rnd()*3)],min,diff,xp:actXP(min,diff),ts:Date.now()})}}
    if(acts.length) days[k]={activities:acts};
  }
  return days;
}

/* ============ Estado y guardado ============ */
const state={days:{},rows:new Map(),profile:{name:"",motto:"",updated_at:null},demo:false,ready:false,mode:"local",route:"dashboard",histMonth:null,histSel:null,todayView:null,confirmDel:null};
// Fila guardada (mismos campos que Supabase) → actividad que usan las vistas y game.js
function rowToAct(r){return {id:r.id,cat:r.category,title:r.title,min:r.minutes,diff:r.intensity,xp:actXP(r.minutes,r.intensity),note:r.note||"",ts:Date.parse(r.created_at)||0}}
function rebuildDays(){
  const days={};
  for(const r of state.rows.values()){ if(r.deleted_at) continue; (days[r.date]||(days[r.date]={activities:[]})).activities.push(rowToAct(r)) }
  for(const k in days) days[k].activities.sort((x,y)=>x.ts-y.ts);
  state.days=days;
}
const App=window.App={
  /** Vuelve a leer todo de la copia local (después de sincronizar o cerrar sesión) */
  async reload(){
    try{const rows=await Store.allRows();state.rows=new Map(rows.map(r=>[r.id,r]));state.profile=await Store.getProfile()}catch(e){}
    rebuildDays(); render();
  }
};
async function boot(){
  const ok=await Store.init();
  state.mode=ok?"device":"memory";
  await App.reload();
  state.ready=true; render();
  if(navigator.storage&&navigator.storage.persist) navigator.storage.persist().catch(()=>{});
  Sync.onChange(onSyncChange);
  Sync.init().catch(()=>{});
}
const nowISO=()=>Sync.now();
/** Guarda filas cambiadas: memoria → dispositivo → cola de sincronización */
function commitRows(rows){
  for(const r of rows) state.rows.set(r.id,r);
  rebuildDays();
  Store.putRows(rows).then(()=>Sync.changed()).catch(()=>toast("No se pudo guardar en este dispositivo."));
}
let profTimer;
function saveProfile(){
  clearTimeout(profTimer);
  profTimer=setTimeout(()=>{state.profile.updated_at=nowISO();Store.saveProfile(state.profile).then(()=>Sync.changed()).catch(()=>{})},500);
}

/* ============ Acciones ============ */
function addActivity(k,a){
  const before=compute();
  if(state.demo){state.demo=false}
  const at=nowISO();
  commitRows([{id:Store.newId(),date:k,category:a.cat,title:a.title,minutes:a.min,intensity:a.diff,note:a.note||"",created_at:at,updated_at:at,deleted_at:null}]);
  const after=compute();
  toast(`<b>+${a.xp} XP</b> · ${CAT[a.cat].name}`);
  if(after.perDay[k]?.full && !before.perDay[k]?.full) toast(`<b>Día completo</b> · +${FULL_DAY_BONUS} XP de bonus`);
  if(after.G.level>before.G.level) toast(`<b>¡Nivel ${after.G.level}!</b> ${after.rank.name!==before.rank.name?"Nuevo rango: "+after.rank.name:""}`,"lvl");
  for(const id in after.unlocked) if(!before.unlocked[id]) toast(`Logro desbloqueado: <b>${ACH.find(x=>x.id===id).name}</b>`,"lvl");
  render();
}
function editActivity(id,k,a){
  const old=state.rows.get(id); if(!old) return;
  const before=compute();
  commitRows([{...old,date:k,category:a.cat,title:a.title,minutes:a.min,intensity:a.diff,note:a.note||"",updated_at:nowISO()}]);
  const after=compute();
  toast(`Actividad actualizada · <b>${a.xp} XP</b>`);
  for(const x in after.unlocked) if(!before.unlocked[x]) toast(`Logro desbloqueado: <b>${ACH.find(y=>y.id===x).name}</b>`,"lvl");
  render();
}
function delActivity(k,id){
  const old=state.rows.get(id); if(!old) return;
  const at=nowISO();
  state.confirmDel=null;
  commitRows([{...old,deleted_at:at,updated_at:at}]);
  render();
}

/* ============ UI helpers ============ */
const ico=(id,cls="")=>`<svg class="${cls}"><use href="#i-${id}"/></svg>`;
function medal(got,size=42){
  return `<svg viewBox="0 0 42 42" width="${size}" height="${size}"><path d="M21 2l16 8v10c0 10-7 17-16 20C12 37 5 30 5 20V10z" fill="${got?"url(#g-gold)":"#2b2439"}"/><path d="M21 7l11 5.5v7.5c0 7-5 12-11 14.5C15 32 10 27 10 20v-7.5z" fill="${got?"#1d1606":"#16121f"}"/><path d="M21 12l2.6 5.4 5.9.8-4.3 4.1 1 5.8L21 25.3 15.8 28l1-5.8-4.3-4.1 5.9-.8z" fill="${got?"#dcbc78":"#3a3150"}"/></svg>`;
}
function crest(pct){
  const R=52,C=2*Math.PI*R;
  return `<svg viewBox="0 0 120 120"><defs><linearGradient id="ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b9a2ff"/><stop offset="1" stop-color="#dcbc78"/></linearGradient></defs>
  <circle cx="60" cy="60" r="${R}" fill="#0c0a12" stroke="#2b2439" stroke-width="6"/>
  <circle cx="60" cy="60" r="${R}" fill="none" stroke="url(#ring)" stroke-width="6" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C*(1-pct)}" transform="rotate(-90 60 60)"/>
  <circle cx="60" cy="60" r="42" fill="none" stroke="#3a3150" stroke-dasharray="2 4"/></svg>`;
}
function toast(html,cls=""){
  const t=document.createElement("div");t.className="toast "+cls;t.innerHTML=html;
  document.getElementById("toasts").appendChild(t);setTimeout(()=>t.remove(),3800);
}
function actRow(k,a){
  const del = state.confirmDel===a.id
    ? `<span class="confirm">¿Eliminar? <button class="btn sm danger" data-del="${k}|${a.id}">Sí</button><button class="btn sm ghost" data-nodel>No</button></span>`
    : `<button class="icon-btn edit" data-edit="${a.id}" aria-label="Editar actividad">${ico("edit")}</button><button class="icon-btn" data-askdel="${a.id}" aria-label="Eliminar actividad">${ico("trash")}</button>`;
  return `<div class="act c-${a.cat}"><div class="cat-ico">${ico(a.cat)}</div>
    <div style="min-width:0"><div class="act-t">${esc(a.title)}</div>
    <div class="act-m"><em>${CAT[a.cat].name}</em><span>${a.min} min</span><span>${DIFF[a.diff].name}</span>${a.note?`<span>· ${esc(a.note)}</span>`:""}</div></div>
    <div class="act-r"><span class="xp num">+${a.xp} XP</span>${state.demo?"":del}</div></div>`;
}
function dayList(k,s,{compact=false}={}){
  const d=dataDays()[k], acts=d?d.activities:[], pd=s.perDay[k];
  if(!acts.length) return `<div class="empty">${ico("scroll")}<div>${k===todayKey()?"Todavía no registraste nada hoy.":"No hay actividades este día."}</div><button class="btn primary" data-add="${k}">${ico("plus")} Agregar actividad</button></div>`;
  const sum = compact?"":`<div class="day-sum"><span class="chip"><b class="num">${nf(pd.xp)} XP</b></span><span class="chip num">${pd.count} actividades</span><span class="chip num">${pd.min} min</span>${pd.full?`<span class="chip gold">Día completo +${FULL_DAY_BONUS}</span>`:""}</div>`;
  const ach = (!compact && pd.ach.length)?`<div class="ach-list" style="margin-top:14px">${pd.ach.map(id=>{const a=ACH.find(x=>x.id===id);return `<div class="ach"><div class="medal">${medal(true)}</div><div><b>${a.name}</b><span>Logro desbloqueado este día</span></div></div>`}).join("")}</div>`:"";
  return sum+`<div class="acts">${acts.map(a=>actRow(k,a)).join("")}</div>`+ach;
}
function goals(s){
  let html="";
  if(s.next){const need=totalXPFor(s.next.lv)-s.xp;const from=totalXPFor(s.rank.lv);const pct=(s.xp-from)/(totalXPFor(s.next.lv)-from);
    html+=`<div class="goal"><div class="goal-h"><span>Próximo rango</span><span class="num">Nivel ${s.next.lv}</span></div><b class="disp" style="font-size:17px">${s.next.name}</b><div class="xpbar thin"><i style="width:${pct*100}%"></i></div><div class="goal-h"><span class="num">Faltan ${nf(need)} XP</span></div></div>`}
  const locked=ACH.filter(a=>!s.unlocked[a.id]).map(a=>({a,p:Math.min(a.m(s)/a.t,1)})).sort((x,y)=>y.p-x.p).slice(0,2);
  for(const {a,p} of locked) html+=`<div class="goal"><div class="goal-h"><span>Próximo logro</span><span class="num">${nf(Math.min(a.m(s),a.t))} / ${nf(a.t)}</span></div><b>${a.name}</b><span style="font-size:13px;color:var(--muted)">${a.desc}</span><div class="xpbar thin"><i style="width:${p*100}%"></i></div></div>`;
  return html;
}
function totalXPFor(lv){let t=0;for(let L=1;L<lv;L++)t+=needG(L);return t}

/* ============ Vistas ============ */
const NAV=[["dashboard","Dashboard","dash"],["hoy","Hoy","hoy"],["historial","Historial","hist"],["logros","Logros","logros"],["estadisticas","Estadísticas","stats"],["perfil","Perfil","perfil"]];
function header(title,sub,btn=true){
  return `<div class="mob-head"><svg class="brand-mark" viewBox="0 0 40 40"><path d="M20 2l15 7v11c0 9-6.5 15.5-15 18C11.5 35.5 5 29 5 20V9z" fill="none" stroke="url(#g-gold)" stroke-width="2"/><path d="M20 9l3 7h7l-5.5 4.5 2 7.5L20 23.5 13.5 28l2-7.5L10 16h7z" fill="url(#g-vio)"/></svg><b>LIFE RPG</b></div>
  <div class="top"><div><h1>${title}</h1>${sub?`<p>${sub}</p>`:""}</div>${btn?`<button class="btn primary" data-add="${todayKey()}">${ico("plus")} Agregar actividad</button>`:""}</div>`+
  (state.demo?`<div class="demo"><span><b>Datos de ejemplo.</b> Así se verá tu progreso. Agrega tu primera actividad y empieza tu propia aventura desde cero.</span><button class="btn gold sm" data-add="${todayKey()}">Empezar</button></div>`:"");
}

function vDashboard(s){
  const T=todayKey(), pd=s.perDay[T];
  const name=state.profile.name?esc(state.profile.name):"Aventurero";
  const recent=Object.entries(s.unlocked).sort((a,b)=>b[1].localeCompare(a[1])).slice(0,4);
  return header(`Hoy <span>—</span> ${fmtLong(T)}`,`${cap(fmtWeek(T))}. Bienvenido de vuelta, ${name}.`)+`
  <section class="panel hero">
    <div class="crest">${crest(s.G.pct)}<div class="lv"><small>Nivel</small><b class="num">${s.G.level}</b></div></div>
    <div class="hero-mid">
      <div class="eyebrow">Rango actual</div>
      <div class="rank-name">${s.rank.name}</div>
      <div class="rank-line"><span class="chip gold">${ico("crown").replace("<svg","<svg width='12' height='12'")} ${nf(s.xp)} XP total</span>${pd?`<span class="chip num">+${nf(pd.xp)} XP hoy</span>`:`<span class="chip">Sin XP hoy aún</span>`}</div>
      <div class="xpbar" role="progressbar" aria-valuemin="0" aria-valuemax="${s.G.need}" aria-valuenow="${s.G.into}"><i style="width:${s.G.pct*100}%"></i></div>
      <div class="xp-meta num"><span><b>${nf(s.G.into)}</b> / ${nf(s.G.need)} XP</span><span>Faltan ${nf(s.G.need-s.G.into)} XP para nivel ${s.G.level+1}</span></div>
    </div>
    <div class="streaks">
      <div class="stat"><svg class="flame"><use href="#i-flame"/></svg><div><b class="num">${s.curStreak} ${s.curStreak===1?"día":"días"}</b><span>Racha actual</span></div></div>
      <div class="stat"><svg class="trophy"><use href="#i-crown"/></svg><div><b class="num">${s.bestStreak} ${s.bestStreak===1?"día":"días"}</b><span>Mejor racha</span></div></div>
    </div>
  </section>
  <section class="cats">${CATS.map(c=>{const L=levelOf(s.catXP[c.id],needC);const today=(dataDays()[T]?.activities||[]).filter(a=>a.cat===c.id).reduce((t,a)=>t+a.xp,0);
    return `<button class="cat c-${c.id}" data-add="${T}" data-cat="${c.id}" aria-label="Agregar actividad de ${c.name}"><div class="cat-top"><div class="cat-ico">${ico(c.id)}</div><h3>${c.name}</h3><span class="lvl num">Nv ${L.level}</span></div>
    <div class="xpbar thin"><i style="width:${L.pct*100}%"></i></div>
    <div class="cat-foot num"><span>${nf(L.into)} / ${nf(L.need)} XP</span><span>${today?`<b>+${today}</b> hoy`:"— hoy"}</span></div></button>`}).join("")}</section>
  <div class="grid2">
    <section class="panel"><div class="panel-h"><h2>Actividades de hoy</h2><button class="link" data-go="hoy">Ver día</button></div>${dayList(T,s)}</section>
    <div class="col">
      <section class="panel"><div class="panel-h"><h2>Próximos objetivos</h2></div>${goals(s)}</section>
      <section class="panel"><div class="panel-h"><h2>Logros recientes</h2><button class="link" data-go="logros">Ver todos</button></div>
      ${recent.length?`<div class="ach-list">${recent.map(([id,k])=>{const a=ACH.find(x=>x.id===id);return `<div class="ach"><div class="medal">${medal(true)}</div><div><b>${a.name}</b><span>${fmtShort(k)} · ${a.desc}</span></div></div>`}).join("")}</div>`:`<div class="empty" style="padding:10px">Tu primer logro llega con tu primera actividad.</div>`}
      </section>
    </div>
  </div>`;
}

function vHoy(s){
  const T=todayKey(); const k=state.todayView||T; const isT=k===T;
  return header(isT?`Hoy <span>—</span> ${fmtLong(k)}`:`${cap(fmtWeek(k))} <span>—</span> ${fmtLong(k)}`,isT?"Registra lo que hiciste hoy. Todo queda guardado con esta fecha.":"Estás viendo un día anterior. Puedes agregar algo que olvidaste registrar.",false)+`
  <div class="top" style="align-items:center"><div class="cal-h"><button class="btn sm" data-dayshift="-1" aria-label="Día anterior">${ico("left").replace("<svg","<svg width='16' height='16'")}</button><button class="btn sm" data-dayshift="1" ${isT?"disabled":""} aria-label="Día siguiente">${ico("right").replace("<svg","<svg width='16' height='16'")}</button>${isT?"":`<button class="btn sm ghost" data-dayshift="0">Volver a hoy</button>`}</div>
  <button class="btn primary" style="display:inline-flex" data-add="${k}">${ico("plus")} Agregar actividad</button></div>
  <div class="grid2"><section class="panel"><div class="panel-h"><h2>Registro del día</h2></div>${dayList(k,s)}</section>
  <section class="panel"><div class="panel-h"><h2>Categorías del día</h2></div><div class="hbars">${CATS.map(c=>{const acts=(dataDays()[k]?.activities||[]).filter(a=>a.cat===c.id);const xp=acts.reduce((t,a)=>t+a.xp,0);return `<div class="hbar"><span>${c.name}</span><div class="track"><i style="width:${Math.min(xp/150,1)*100}%;background:var(--c-${c.id})"></i></div><span class="v num">${xp?`+${xp} XP`:"—"}</span></div>`}).join("")}</div>
  <p style="color:var(--muted);font-size:13px;margin:16px 0 0">Completa las 4 categorías en un día para ganar <b style="color:var(--gold)">+${FULL_DAY_BONUS} XP</b> de bonus.</p></section></div>`;
}

function vHistorial(s){
  const T=todayKey(); const m=state.histMonth||T.slice(0,7); const sel=state.histSel||T;
  const [y,mo]=m.split("-").map(Number); const first=new Date(y,mo-1,1); const startDow=(first.getDay()+6)%7; const dim=new Date(y,mo,0).getDate();
  const maxXP=Math.max(150,...Object.values(s.perDay).map(p=>p.xp));
  let cells=["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"].map(d=>`<div class="dow">${d}</div>`).join("");
  for(let i=0;i<startDow;i++) cells+=`<div class="cday out"></div>`;
  for(let d=1;d<=dim;d++){const k=`${y}-${pad(mo)}-${pad(d)}`;const p=s.perDay[k];const fut=k>T;
    const a=p?Math.min(.08+p.xp/maxXP*.4,.5):0;
    cells+=`<button class="cday ${k===T?"today":""} ${k===sel?"sel":""} ${fut?"future":""}" data-sel="${k}" ${fut?"disabled":""} style="${p?`background:rgba(155,123,255,${a})`:""}" aria-label="${fmtLong(k)}${p?`, ${p.xp} XP`:""}"><span class="d num">${d}</span>${p?`<span class="x num">${p.xp} XP</span><span class="dots">${p.cats.map(c=>`<i style="background:var(--c-${c})"></i>`).join("")}</span>`:""}</button>`}
  const monthName=first.toLocaleDateString("es",{month:"long",year:"numeric"});
  const mk=(n)=>{const d=new Date(y,mo-1+n,1);return `${d.getFullYear()}-${pad(d.getMonth()+1)}`};
  const mXP=Object.entries(s.perDay).filter(([k])=>k.startsWith(m)).reduce((t,[,p])=>t+p.xp,0), mDays=Object.keys(s.perDay).filter(k=>k.startsWith(m)).length;
  return header("Historial","Elige un día del calendario para ver qué hiciste, cuánta XP ganaste y qué logros desbloqueaste.",false)+`
  <div class="grid2"><section class="panel"><div class="panel-h"><div class="cal-h"><button class="btn sm" data-month="${mk(-1)}" aria-label="Mes anterior">${ico("left").replace("<svg","<svg width='16' height='16'")}</button><h2>${monthName}</h2><button class="btn sm" data-month="${mk(1)}" ${mk(1)>T.slice(0,7)?"disabled":""} aria-label="Mes siguiente">${ico("right").replace("<svg","<svg width='16' height='16'")}</button></div><span class="chip num">${nf(mXP)} XP · ${mDays} días</span></div>
  <div class="cal">${cells}</div>
  <div class="legend">${CATS.map(c=>`<span><i style="background:var(--c-${c.id})"></i>${c.name}</span>`).join("")}<span>Más violeta = más XP</span></div></section>
  <section class="panel"><div class="panel-h"><div><div class="eyebrow">${cap(fmtWeek(sel))}</div><h2 style="margin-top:2px">${fmtLong(sel)}</h2></div>${state.demo?"":`<button class="btn sm" data-add="${sel}">${ico("plus").replace("<svg","<svg width='14' height='14'")} Agregar</button>`}</div>${dayList(sel,s)}</section></div>`;
}

function vLogros(s){
  const got=ACH.filter(a=>s.unlocked[a.id]).length;
  return header("Logros",`${got} de ${ACH.length} desbloqueados.`,false)+`<div class="xpbar"><i style="width:${got/ACH.length*100}%"></i></div>
  <div class="ach-grid">${ACH.map(a=>{const k=s.unlocked[a.id];const v=Math.min(a.m(s),a.t);return `<div class="ach-card ${k?"got":"locked"}"><div class="row"><div class="medal">${medal(!!k)}</div><div><b>${a.name}</b><br><small>${a.desc}</small></div></div>
  ${k?`<small style="color:var(--gold)">Desbloqueado el ${fmtLong(k)}</small>`:`<div class="xpbar thin"><i style="width:${v/a.t*100}%"></i></div><small class="num">${nf(v)} / ${nf(a.t)}</small>`}</div>`}).join("")}</div>`;
}

function vStats(s){
  const T=todayKey(); const N=30; const days=[...Array(N)].map((_,i)=>addDays(T,i-N+1));
  const per=days.map(k=>{const acts=dataDays()[k]?.activities||[];const o={};CATS.forEach(c=>o[c.id]=acts.filter(a=>a.cat===c.id).reduce((t,a)=>t+a.xp,0));o.bonus=s.perDay[k]?.full?FULL_DAY_BONUS:0;return o});
  const tot=per.map(o=>CATS.reduce((t,c)=>t+o[c.id],0)+o.bonus); const max=Math.max(100,...tot); const top=Math.ceil(max/100)*100;
  const W=720,H=220,L=36,B=24,bw=(W-L-8)/N;
  let bars="";per.forEach((o,i)=>{let y=H-B;for(const c of [...CATS.map(c=>c.id),"bonus"]){const v=o[c];if(!v)continue;const h=v/top*(H-B-10);y-=h;bars+=`<rect x="${L+i*bw+2}" y="${y}" width="${bw-4}" height="${h}" rx="2" fill="${c==="bonus"?"var(--gold)":`var(--c-${c})`}"/>`}});
  let grid="";for(let g=0;g<=4;g++){const v=top/4*g,y=H-B-v/top*(H-B-10);grid+=`<line x1="${L}" x2="${W}" y1="${y}" y2="${y}" stroke="var(--line)"/><text x="${L-6}" y="${y+4}" text-anchor="end">${v}</text>`}
  const xl=[0,7,14,21,29].map(i=>`<text x="${L+i*bw+bw/2}" y="${H-6}" text-anchor="middle">${fmtShort(days[i])}</text>`).join("");
  const maxC=Math.max(1,...CATS.map(c=>s.catXP[c.id]));
  const wd=[0,0,0,0,0,0,0];for(const k in s.perDay){wd[(fromKey(k).getDay()+6)%7]+=s.perDay[k].xp}const maxW=Math.max(1,...wd);
  return header("Estadísticas","Tu progreso en números.",false)+`
  <div class="kpis"><div class="kpi"><b class="num">${nf(s.xp)}</b><span>XP total</span></div><div class="kpi"><b class="num">${nf(s.total)}</b><span>Actividades</span></div><div class="kpi"><b class="num">${nf(s.minutes/60)} h</b><span>Tiempo invertido</span></div><div class="kpi"><b class="num">${s.activeDays?nf(s.xp/s.activeDays):0}</b><span>XP por día activo</span></div></div>
  <section class="panel"><div class="panel-h"><h2>XP de los últimos 30 días</h2><div class="legend" style="margin:0">${CATS.map(c=>`<span><i style="background:var(--c-${c.id})"></i>${c.name}</span>`).join("")}<span><i style="background:var(--gold)"></i>Bonus</span></div></div>
  <div style="overflow-x:auto"><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="XP diaria de los últimos 30 días">${grid}${bars}${xl}</svg></div></section>
  <div class="grid2"><section class="panel"><div class="panel-h"><h2>XP por categoría</h2></div><div class="hbars">${CATS.map(c=>`<div class="hbar"><span>${c.name}</span><div class="track"><i style="width:${s.catXP[c.id]/maxC*100}%;background:var(--c-${c.id})"></i></div><span class="v num">${nf(s.catXP[c.id])} XP</span></div>`).join("")}</div>
  <div class="hbars" style="margin-top:18px">${CATS.map(c=>`<div class="hbar"><span style="color:var(--muted)">${c.name}</span><span class="num" style="color:var(--muted);font-size:12.5px">${s.cnt[c.id]} actividades · ${nf(s.catMin[c.id]/60)} h</span><span class="v num">Nv ${s.catLv[c.id]}</span></div>`).join("")}</div></section>
  <section class="panel"><div class="panel-h"><h2>Por día de la semana</h2></div><div class="hbars">${["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"].map((d,i)=>`<div class="hbar"><span>${d}</span><div class="track"><i style="width:${wd[i]/maxW*100}%;background:var(--violet)"></i></div><span class="v num">${nf(wd[i])} XP</span></div>`).join("")}</div></section></div>`;
}

function vPerfil(s){
  return header("Perfil","Tu personaje y las reglas del juego.",false)+`
  <div class="grid2"><div class="col">
  <section class="panel"><div class="panel-h"><h2>Personaje</h2><span class="chip gold">Nivel ${s.G.level} · ${s.rank.name}</span></div>
  <div style="display:flex;flex-direction:column;gap:14px"><div class="field"><label for="pName">Nombre</label><input class="inp" id="pName" maxlength="40" placeholder="Cómo quieres que te llame la app" value="${esc(state.profile.name||"")}"></div>
  <div class="field"><label for="pMotto">Lema</label><input class="inp" id="pMotto" maxlength="80" placeholder="Ej.: Un poco cada día" value="${esc(state.profile.motto||"")}"></div>
  <div class="hbars">${CATS.map(c=>{const L=levelOf(s.catXP[c.id],needC);return `<div class="hbar"><span>${c.name}</span><div class="track"><i style="width:${L.pct*100}%;background:var(--c-${c.id})"></i></div><span class="v num">Nv ${L.level}</span></div>`}).join("")}</div></div></section>
  <section class="panel"><div class="panel-h"><h2>Cómo se gana XP</h2></div>
  <table class="rules"><tr><th>Regla</th><th>XP</th></tr>
  <tr><td>Cada actividad</td><td class="num">(10 + minutos) × intensidad</td></tr>
  <tr><td>Intensidad</td><td class="num">Ligera ×1 · Normal ×1,5 · Intensa ×2</td></tr>
  <tr><td>Día completo (las 4 categorías)</td><td class="num">+${FULL_DAY_BONUS}</td></tr>
  <tr><td>Nivel global siguiente</td><td class="num">120 XP, +40 por nivel</td></tr>
  <tr><td>Nivel de categoría siguiente</td><td class="num">60 XP, +20 por nivel</td></tr>
  <tr><td>Racha</td><td>Días seguidos con al menos 1 actividad</td></tr></table>
  <p style="color:var(--muted);font-size:13px;margin:12px 0 0">Ejemplo: 30 minutos de entrenamiento normal = (10 + 30) × 1,5 = 60 XP. Máximo 240 minutos por actividad.</p></section>
  </div><div class="col">
  <section class="panel"><div class="panel-h"><h2>Rangos</h2></div><div class="ladder">${RANKS.map(r=>`<div class="rung ${r.name===s.rank.name?"cur":(r.lv<s.G.level?"done":"")}"><b>${r.name}</b><span class="num">Nivel ${r.lv} · ${nf(totalXPFor(r.lv))} XP</span></div>`).join("")}</div></section>
  ${accountPanel()}
  <section class="panel"><div class="panel-h"><h2>Datos y respaldo</h2></div><p style="color:var(--muted);font-size:13.5px;margin:0 0 12px">${state.mode==="device"?"Tu progreso se guarda en este dispositivo y funciona sin internet.":"Este navegador no permite guardar datos (¿modo incógnito?). Lo que registres se perderá al cerrar."} Exporta una copia de seguridad cada tanto, aunque tengas la sincronización activa.</p>
  <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn sm" id="expBtn" ${Object.keys(state.days).length?"":"disabled"}>Exportar datos</button><button class="btn sm" id="impBtn">Importar datos</button><input type="file" id="impFile" accept=".json,application/json" hidden>${installBtn()}</div>${installHint()}
  ${backupPanel()}
  <div style="border-top:1px solid var(--line);margin-top:16px;padding-top:14px">${state.confirmReset?`<div class="confirm" style="flex-wrap:wrap">Se borrarán todas tus actividades${Sync.info.signedIn?" en todos tus dispositivos":""}. ¿Seguro? <button class="btn sm danger" id="resetYes">Sí, borrar todo</button><button class="btn sm ghost" id="resetNo">Cancelar</button></div>`:`<button class="btn sm danger" id="resetAsk" ${Object.keys(state.days).length?"":"disabled"}>Borrar todo el progreso</button>`}</div></section>
  </div></div>`;
}

/* ============ Modal agregar ============ */
let form=null;
function openAdd(k,cat){
  if(state.demo){state.demo=false;}
  form={date:k||todayKey(),cat:cat||"curso",title:"",min:30,diff:2,note:"",err:""}; renderModal();
  setTimeout(()=>document.getElementById("fTitle")?.focus(),30);
}
function openEdit(id){
  const r=state.rows.get(id); if(!r) return;
  form={editId:id,date:r.date,cat:r.category,title:r.title,min:r.minutes,diff:r.intensity,note:r.note||"",err:""}; renderModal();
  setTimeout(()=>document.getElementById("fTitle")?.focus(),30);
}
function renderModal(){
  const root=document.getElementById("modalRoot"); if(!form){root.innerHTML="";return}
  const xp=actXP(form.min,form.diff);
  root.innerHTML=`<div class="scrim" id="scrim"><form class="modal" id="addForm" role="dialog" aria-modal="true" aria-labelledby="mTitle">
  <div><div class="eyebrow">${form.date===todayKey()?"Hoy":cap(fmtWeek(form.date))} · ${fmtLong(form.date)}</div><h2 id="mTitle">${form.editId?"Editar actividad":"Nueva actividad"}</h2></div>
  <div class="field"><label>Categoría</label><div class="seg">${CATS.map(c=>`<button type="button" class="c-${c.id}" data-fcat="${c.id}" aria-pressed="${form.cat===c.id}">${ico(c.id)}${c.name}</button>`).join("")}</div><small style="color:var(--muted);font-size:12px">${CAT[form.cat].hint}</small></div>
  <div class="field"><label for="fTitle">¿Qué hiciste?</label><input class="inp" id="fTitle" maxlength="80" placeholder="Ej.: Clase 4 del curso de React" value="${esc(form.title)}"></div>
  <div class="row2"><div class="field"><label for="fMin">Minutos</label><input class="inp num" id="fMin" type="number" min="1" max="240" step="1" value="${form.min}"></div>
  <div class="field"><label for="fDate">Fecha</label><input class="inp" id="fDate" type="date" max="${todayKey()}" value="${form.date}"></div></div>
  <div class="field"><label>Intensidad</label><div class="seg three">${[1,2,3].map(d=>`<button type="button" data-fdiff="${d}" aria-pressed="${form.diff===d}">${DIFF[d].name}<small>×${String(DIFF[d].mult).replace(".",",")}</small></button>`).join("")}</div></div>
  <div class="field"><label for="fNote">Nota (opcional)</label><input class="inp" id="fNote" maxlength="120" placeholder="Algo que quieras recordar" value="${esc(form.note)}"></div>
  <div class="preview"><span>${form.editId?"Vale":"Ganarás"}</span><b class="num" id="fXP">+${xp} XP</b></div>
  ${form.err?`<div class="err">${form.err}</div>`:""}
  <div class="modal-f"><button type="button" class="btn ghost" id="fCancel">Cancelar</button><button type="submit" class="btn primary">${form.editId?"Guardar cambios":"Guardar actividad"}</button></div></form></div>`;
}
function readForm(){const g=id=>document.getElementById(id);if(!g("fTitle"))return;form.title=g("fTitle").value;form.min=g("fMin").value;form.date=g("fDate").value||todayKey();form.note=g("fNote").value}

document.addEventListener("input",e=>{
  if(form&&e.target.closest("#addForm")){readForm();const x=document.getElementById("fXP");if(x)x.textContent=`+${actXP(form.min,form.diff)} XP`}
  if(e.target.id==="pName"||e.target.id==="pMotto"){state.profile.name=document.getElementById("pName").value.trim();state.profile.motto=document.getElementById("pMotto").value.trim();saveProfile()}
});
document.addEventListener("submit",e=>{
  if(e.target.id!=="addForm")return; e.preventDefault(); readForm();
  const min=Math.round(+form.min);
  if(!form.title.trim()){form.err="Escribe qué actividad hiciste.";renderModal();document.getElementById("fTitle").focus();return}
  if(!(min>=1&&min<=240)){form.err="Los minutos tienen que estar entre 1 y 240.";renderModal();return}
  if(form.date>todayKey()){form.err="No puedes registrar días futuros.";renderModal();return}
  const a={cat:form.cat,title:form.title.trim(),min,diff:form.diff,xp:actXP(min,form.diff),note:form.note.trim()};
  const k=form.date, editId=form.editId; form=null; renderModal();
  if(editId) editActivity(editId,k,a); else addActivity(k,a);
});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&form){form=null;renderModal()}});

document.addEventListener("click",e=>{
  if(e.target.id==="scrim"){form=null;renderModal();return}
  const t=e.target.closest("button,a,[data-sel]"); if(!t) return;
  if(t.id==="fCancel"){form=null;renderModal();return}
  if(t.dataset.fcat){readForm();form.cat=t.dataset.fcat;renderModal();return}
  if(t.dataset.fdiff){readForm();form.diff=+t.dataset.fdiff;renderModal();return}
  if(t.dataset.add!==undefined){openAdd(t.dataset.add,t.dataset.cat);render();return}
  if(t.dataset.go){go(t.dataset.go);return}
  if(t.dataset.edit){openEdit(t.dataset.edit);return}
  if(t.dataset.askdel){state.confirmDel=t.dataset.askdel;render();return}
  if(t.dataset.nodel!==undefined){state.confirmDel=null;render();return}
  if(t.dataset.del){const[k,id]=t.dataset.del.split("|");delActivity(k,id);return}
  if(t.dataset.sel){state.histSel=t.dataset.sel;render();return}
  if(t.dataset.month){state.histMonth=t.dataset.month;render();return}
  if(t.dataset.dayshift!==undefined){const n=+t.dataset.dayshift;state.todayView=n===0?null:addDays(state.todayView||todayKey(),n);if(state.todayView>=todayKey())state.todayView=null;render();return}
  if(t.id==="resetAsk"){state.confirmReset=true;render();return}
  if(t.id==="resetNo"){state.confirmReset=false;render();return}
  if(t.id==="resetYes"){const at=nowISO();commitRows([...state.rows.values()].filter(r=>!r.deleted_at).map(r=>({...r,deleted_at:at,updated_at:at})));state.confirmReset=false;toast("Progreso borrado.");render();return}
});
document.getElementById("fab").addEventListener("click",()=>openAdd(state.route==="historial"?state.histSel||todayKey():state.route==="hoy"?state.todayView||todayKey():todayKey()));


/* ============ Copia de seguridad ============ */
const bk={pending:null,err:"",copyText:"",replaceAsk:false};
function backupPanel(){
  let h="";
  if(bk.err) h+=`<div class="err" style="margin-top:12px">${esc(bk.err)}</div>`;
  if(bk.copyText) h+=`<div class="field" style="margin-top:14px"><label for="expText">Copia tus datos</label><small style="color:var(--muted);font-size:12.5px">No se pudo descargar el archivo. Copia este texto y guárdalo en un archivo .json.</small><textarea class="inp num" id="expText" rows="5" readonly style="font-size:12px;resize:vertical">${esc(bk.copyText)}</textarea><div style="display:flex;gap:8px"><button class="btn sm" id="expCopy">Copiar</button><button class="btn sm ghost" id="expClose">Cerrar</button></div></div>`;
  const P=bk.pending;
  if(P){
    const cur=Object.keys(state.days).length;
    h+=`<div class="goal" style="margin-top:14px"><div class="goal-h"><span>Archivo a importar</span><span class="num">${P.dayCount} días · ${P.actCount} actividades</span></div>
    <b>${P.first?`Del ${fmtLong(P.first)} al ${fmtLong(P.last)}`:"Sin actividades"}</b>
    <span style="font-size:13px;color:var(--muted)">${P.profile.name?`Personaje: ${esc(P.profile.name)}. `:""}${P.skipped?`Se omitirán ${P.skipped} registros inválidos. `:""}${cur?`Ahora tienes ${cur} días guardados. <b style="color:var(--fg)">Combinar</b> suma lo del archivo sin borrar nada. <b style="color:var(--fg)">Reemplazar</b> deja solo lo del archivo.`:"No tienes datos guardados, así que se cargará todo el archivo."}</span>
    ${bk.replaceAsk?`<div class="confirm" style="flex-wrap:wrap;margin-top:4px">Se borrarán tus ${cur} días actuales y quedará solo el archivo. ¿Seguro? <button class="btn sm danger" id="impReplaceYes">Sí, reemplazar</button><button class="btn sm ghost" id="impReplaceNo">Volver</button></div>`
    :`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px"><button class="btn sm primary" id="impMerge">${cur?"Combinar":"Importar"}</button>${cur?`<button class="btn sm danger" id="impReplace">Reemplazar todo</button>`:""}<button class="btn sm ghost" id="impCancel">Cancelar</button></div>`}</div>`;
  }
  return h;
}
function exportJSON(){
  const rows=[...state.rows.values()].filter(r=>!r.deleted_at).sort((x,y)=>x.date.localeCompare(y.date)||x.created_at.localeCompare(y.created_at));
  // "days" repite lo mismo en el formato viejo, para que también lo lea la versión de Claude
  const days={}; for(const k in state.days) days[k]={activities:state.days[k].activities.map(a=>({id:a.id,cat:a.cat,title:a.title,min:a.min,diff:a.diff,note:a.note,ts:a.ts}))};
  return JSON.stringify({app:"life-rpg",version:2,exportedAt:new Date().toISOString(),profile:{name:state.profile.name||"",motto:state.profile.motto||"",updated_at:state.profile.updated_at},activities:rows,days},null,2);
}
async function doExport(){
  bk.err="";bk.copyText="";
  const text=exportJSON(), name=`life-rpg-respaldo-${todayKey()}.json`;
  const file=new Blob([text],{type:"application/json"});
  // En celular, el menú de compartir permite guardarlo en Archivos o Drive
  try{
    const f=new File([file],name,{type:"application/json"});
    if(matchMedia("(pointer:coarse)").matches&&navigator.canShare&&navigator.canShare({files:[f]})){await navigator.share({files:[f],title:"Respaldo Life RPG"});toast("Respaldo exportado.");return}
  }catch(e){ if(e&&e.name==="AbortError"){toast("Exportación cancelada.");return} }
  try{const url=URL.createObjectURL(file);const a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);toast("Respaldo exportado.")}
  catch(e){bk.copyText=text;render()}
}
function validRow(r){
  const min=Math.round(+r.minutes), diff=+r.intensity;
  return r&&CAT[r.category]&&min>=1&&min<=240&&DIFF[diff]&&typeof r.title==="string"&&r.title.trim()&&/^\d{4}-\d{2}-\d{2}$/.test(r.date)&&!isNaN(fromKey(r.date))&&r.date<=todayKey();
}
function parseBackup(text){
  let j; try{j=JSON.parse(text)}catch(e){throw "El archivo no es un JSON válido."}
  if(!j||typeof j!=="object"||(!Array.isArray(j.activities)&&(!j.days||typeof j.days!=="object"))) throw "Este archivo no es un respaldo de Life RPG.";
  const rows=[]; let skipped=0;
  if(Array.isArray(j.activities)){ // versión 2
    for(const r of j.activities){
      if(!r||!validRow(r)){skipped++;continue}
      rows.push(Store.clean({...r,title:r.title.trim().slice(0,80),minutes:Math.round(+r.minutes),note:typeof r.note==="string"?r.note.trim().slice(0,120):"",created_at:r.created_at||nowISO(),updated_at:r.updated_at||r.created_at||nowISO(),deleted_at:r.deleted_at||null}));
    }
  } else { // versión 1: un registro por día
    for(const k of Object.keys(j.days)){
      const list=Array.isArray(j.days[k]&&j.days[k].activities)?j.days[k].activities:[];
      for(const a of list){
        const r=a&&Store.legacyToRow(k,{...a,title:typeof a.title==="string"?a.title.trim():""});
        if(!r||!validRow(r)){skipped++;continue}
        rows.push(r);
      }
    }
  }
  const live=rows.filter(r=>!r.deleted_at), ks=[...new Set(live.map(r=>r.date))].sort();
  const pr=j.profile||{};
  return {rows,dayCount:ks.length,actCount:live.length,skipped,first:ks[0],last:ks[ks.length-1],profile:{name:typeof pr.name==="string"?pr.name.slice(0,40):"",motto:typeof pr.motto==="string"?pr.motto.slice(0,80):"",updated_at:pr.updated_at||null}};
}
function applyImport(mode){
  const P=bk.pending; if(!P) return;
  const before=compute(), at=nowISO(), out=[], inFile=new Set(P.rows.map(r=>r.id));
  if(mode==="replace"){
    // Lo que no está en el archivo se borra; lo del archivo queda tal cual, marcado como cambio nuevo
    for(const r of state.rows.values()) if(!r.deleted_at&&!inFile.has(r.id)) out.push({...r,deleted_at:at,updated_at:at});
    for(const r of P.rows) if(!r.deleted_at) out.push({...r,updated_at:at});
  } else {
    // Combinar: solo suma lo que falta o lo que es más reciente que lo que ya hay
    for(const r of P.rows){ const l=state.rows.get(r.id); if(!l||Date.parse(r.updated_at)>Date.parse(l.updated_at)) out.push(r) }
  }
  if(out.length) commitRows(out);
  let profChanged=false;
  if(mode==="replace"||!state.profile.name){ if(P.profile.name){state.profile.name=P.profile.name;profChanged=true} }
  if(mode==="replace"||!state.profile.motto){ if(P.profile.motto){state.profile.motto=P.profile.motto;profChanged=true} }
  if(profChanged) saveProfile();
  bk.pending=null; bk.replaceAsk=false; bk.err="";
  const after=compute();
  toast(`Importación lista: <b>${after.activeDays} días</b> · nivel ${after.G.level}`);
  for(const id in after.unlocked) if(!before.unlocked[id]) {toast(`Logros actualizados según tu historial.`);break}
  render();
}
document.addEventListener("change",e=>{
  if(e.target.id!=="impFile"||!e.target.files||!e.target.files[0]) return;
  const f=e.target.files[0]; e.target.value="";
  if(f.size>20*1024*1024){bk.err="El archivo es demasiado grande para ser un respaldo.";render();return}
  const r=new FileReader();
  r.onload=()=>{try{const P=parseBackup(String(r.result));if(!P.actCount) throw "El archivo no tiene actividades para importar.";bk.pending=P;bk.err="";bk.replaceAsk=false}catch(err){bk.pending=null;bk.err=typeof err==="string"?err:"No se pudo leer el archivo."}render()};
  r.onerror=()=>{bk.err="No se pudo leer el archivo.";render()};
  r.readAsText(f);
});
document.addEventListener("click",e=>{
  const t=e.target.closest("button"); if(!t) return;
  switch(t.id){
    case "expBtn": doExport(); break;
    case "impBtn": bk.copyText="";document.getElementById("impFile")?.click(); break;
    case "impMerge": applyImport("merge"); break;
    case "impReplace": bk.replaceAsk=true; render(); break;
    case "impReplaceNo": bk.replaceAsk=false; render(); break;
    case "impReplaceYes": applyImport("replace"); break;
    case "impCancel": bk.pending=null; bk.replaceAsk=false; render(); break;
    case "expClose": bk.copyText=""; render(); break;
    case "expCopy": { const ta=document.getElementById("expText"); navigator.clipboard?.writeText(bk.copyText).then(()=>toast("Copiado."),()=>{ta.focus();ta.select()}) ?? (ta.focus(),ta.select()); break; }
  }
});
/* ============ Cuenta y sincronización ============ */
const acc={email:"",pass:"",err:"",busy:false,outAsk:false};
function accountPanel(){
  const I=Sync.info;
  if(!I.enabled) return "";
  let body;
  if(!I.signedIn){
    body=`<p style="color:var(--muted);font-size:13.5px;margin:0 0 14px">Inicia sesión con la misma cuenta en tu PC y en tu celular para ver el mismo progreso en ambos. Sin cuenta, la app sigue funcionando solo en este dispositivo.</p>
    <form id="accForm" style="display:flex;flex-direction:column;gap:12px" autocomplete="on">
      <div class="field"><label for="accEmail">Email</label><input class="inp" id="accEmail" type="email" autocomplete="email" inputmode="email" value="${esc(acc.email)}" placeholder="tu@email.com"></div>
      <div class="field"><label for="accPass">Contraseña</label><input class="inp" id="accPass" type="password" autocomplete="current-password" minlength="8" placeholder="Mínimo 8 caracteres"></div>
      ${acc.err?`<div class="err">${esc(acc.err)}</div>`:""}
      <div style="display:flex;gap:10px;flex-wrap:wrap"><button type="submit" class="btn sm primary" id="accIn" ${acc.busy?"disabled":""}>Iniciar sesión</button><button type="button" class="btn sm" id="accUp" ${acc.busy?"disabled":""}>Crear cuenta</button></div>
    </form>`;
  } else if(I.status==="confirm"){
    body=`<p style="font-size:14px;margin:0 0 6px">Conectado como <b>${esc(I.email)}</b>.</p>
    <div class="goal"><b>Tienes ${I.uploadCount} actividades en este dispositivo</b><span style="font-size:13px;color:var(--muted)">Se sumarán a tu cuenta sin borrar nada de lo que ya tenga. Después verás lo mismo en todos tus dispositivos.</span>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px"><button class="btn sm primary" id="accUpload">Subir a mi cuenta</button><button class="btn sm ghost" id="accCancel">Cancelar y cerrar sesión</button></div></div>`;
  } else {
    const last=I.lastSync?new Date(I.lastSync).toLocaleTimeString("es",{hour:"2-digit",minute:"2-digit"}):"";
    body=`<p style="font-size:14px;margin:0 0 10px">Conectado como <b>${esc(I.email)}</b>.</p>
    <div class="goal"><div class="goal-h"><span>Estado</span><span class="num" id="accLast">${last?"Última vez: "+last:""}</span></div><b id="accStatus">${esc(Sync.label())}</b>
    <span style="font-size:13px;color:var(--muted)">Los cambios se guardan primero aquí y se suben solos cuando hay conexión.</span></div>
    ${acc.outAsk?`<div class="confirm" style="flex-wrap:wrap;margin-top:12px">${I.pending?`Hay <b style="color:var(--bad)">${I.pending} cambios sin subir</b> que se perderán. `:""}Se borrarán los datos de este dispositivo (siguen en tu cuenta). ¿Cerrar sesión? <button class="btn sm danger" id="accOutYes">Sí, cerrar sesión</button><button class="btn sm ghost" id="accOutNo">Cancelar</button></div>`
    :`<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px"><button class="btn sm" id="accSync">Sincronizar ahora</button><button class="btn sm ghost" id="accOut">Cerrar sesión</button></div>`}`;
  }
  return `<section class="panel"><div class="panel-h"><h2>Cuenta y sincronización</h2></div>${body}</section>`;
}
let lastAuthKey="";
function onSyncChange(){
  const I=Sync.info, key=`${I.signedIn}|${I.status==="confirm"}|${I.linked}`;
  const pill=document.getElementById("savePill");
  if(pill){pill.className="save-pill"+(state.mode==="device"&&I.status!=="error"?" ok":"");pill.lastElementChild.textContent=Sync.label()}
  const st=document.getElementById("accStatus"); if(st) st.textContent=Sync.label();
  const ls=document.getElementById("accLast"); if(ls&&I.lastSync) ls.textContent="Última vez: "+new Date(I.lastSync).toLocaleTimeString("es",{hour:"2-digit",minute:"2-digit"});
  if(key!==lastAuthKey){lastAuthKey=key;if(state.ready&&state.route==="perfil"&&!document.activeElement?.closest?.("#accForm"))render()}
}
async function accSubmit(mode){
  const email=(document.getElementById("accEmail")?.value||"").trim(), pass=document.getElementById("accPass")?.value||"";
  acc.email=email;
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){acc.err="Escribe un email válido.";render();return}
  if(pass.length<8){acc.err="La contraseña necesita al menos 8 caracteres.";render();return}
  acc.err="";acc.busy=true;render();
  try{ if(mode==="up") await Sync.signUp(email,pass); else await Sync.signIn(email,pass); toast(mode==="up"?"Cuenta creada.":"Sesión iniciada."); }
  catch(e){ acc.err=typeof e==="string"?e:"No se pudo iniciar sesión." }
  acc.busy=false; render();
}
document.addEventListener("input",e=>{ if(e.target.id==="accEmail") acc.email=e.target.value; });
document.addEventListener("submit",e=>{ if(e.target.id==="accForm"){e.preventDefault();accSubmit("in")} });
document.addEventListener("click",async e=>{
  const t=e.target.closest("button"); if(!t) return;
  switch(t.id){
    case "accUp": accSubmit("up"); break;
    case "accUpload": await Sync.confirmUpload(); toast("Subiendo tus actividades…"); render(); break;
    case "accCancel": await Sync.signOut(); render(); break;
    case "accSync": Sync.run(); break;
    case "accOut": acc.outAsk=true; render(); break;
    case "accOutNo": acc.outAsk=false; render(); break;
    case "accOutYes": acc.outAsk=false; await Sync.signOut(); toast("Sesión cerrada."); render(); break;
  }
});

/* ============ Instalación ============ */
let installEvt=null;
addEventListener("beforeinstallprompt",e=>{e.preventDefault();installEvt=e;render()});
addEventListener("appinstalled",()=>{installEvt=null;toast("Life RPG quedó instalada.");render()});
const isStandalone=()=>matchMedia("(display-mode: standalone)").matches||navigator.standalone===true;
const isIOS=()=>/iphone|ipad|ipod/i.test(navigator.userAgent);
function installBtn(){return installEvt&&!isStandalone()?`<button class="btn sm gold" id="installBtn">Instalar app</button>`:""}
function installHint(){return isIOS()&&!isStandalone()?`<p style="color:var(--muted);font-size:12.5px;margin:12px 0 0">Para instalarla en iPhone: en Safari toca Compartir y luego "Agregar a inicio".</p>`:""}
document.addEventListener("click",async e=>{if(e.target.closest("#installBtn")&&installEvt){installEvt.prompt();try{await installEvt.userChoice}catch(_){}installEvt=null;render()}});
if("serviceWorker" in navigator) addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));

/* ============ Router y render ============ */
function go(r){state.route=r;state.confirmDel=null;state.confirmReset=false;try{history.replaceState(null,"","#"+r)}catch(e){}render();window.scrollTo(0,0)}
function render(){
  if(!Object.keys(state.days).length && !form){ if(!state.demoDays) state.demoDays=makeDemo(); state.demo=true } else state.demo=false;
  const s=compute();
  document.getElementById("nav").innerHTML=NAV.map(([id,label,icon])=>`<a href="#${id}" data-go="${id}" class="${state.route===id?"on":""}" ${state.route===id?'aria-current="page"':""}>${ico(icon)}<span>${label}</span></a>`).join("");
  const v={dashboard:vDashboard,hoy:vHoy,historial:vHistorial,logros:vLogros,estadisticas:vStats,perfil:vPerfil}[state.route]||vDashboard;
  const keepFocus=document.activeElement&&document.activeElement.id; const caret=document.activeElement?.selectionStart;
  document.getElementById("view").innerHTML=v(s);
  if(keepFocus&&(keepFocus==="pName"||keepFocus==="pMotto"||keepFocus==="accEmail")){const el=document.getElementById(keepFocus);if(el){el.focus();try{el.setSelectionRange(caret,caret)}catch(e){}}}
  const pill=document.getElementById("savePill");pill.className="save-pill"+(state.mode==="device"&&Sync.info.status!=="error"?" ok":"");pill.lastElementChild.textContent=state.mode==="device"?(Sync.info.signedIn?Sync.label():(navigator.onLine?"Guardado en este dispositivo":"Sin conexión · guardado aquí")):"Sin guardado disponible";
  document.getElementById("sideDate").textContent=cap(fromKey(todayKey()).toLocaleDateString("es",{weekday:"long",day:"numeric",month:"long"}));
}
document.getElementById("nav").addEventListener("click",e=>{const a=e.target.closest("a[data-go]");if(a){e.preventDefault();go(a.dataset.go)}});
const h=(location.hash||"").slice(1); if(NAV.some(n=>n[0]===h)) state.route=h;
render(); boot();
addEventListener("online",render); addEventListener("offline",render);
// cambia de día a medianoche sin recargar
let lastDay=todayKey(); setInterval(()=>{if(todayKey()!==lastDay){lastDay=todayKey();render()}},60000);