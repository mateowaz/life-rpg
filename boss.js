/* Life RPG — Boss mensual: reglas, pantalla Boss, panel del Dashboard y ventanas.
   El daño no se guarda: se calcula con las actividades del mes del Boss (la misma cuenta que hace
   Supabase en claim_boss). La recompensa la confirma el servidor, una sola vez. */

/* ============ Reglas ============ */
const BOSS_WEAK = 0.2;            // "Casi derrotado": le queda menos del 20 % de HP
const BOSS_REWARD = 250;          // recompensa por defecto
const BOSS_TYPES = {
  xp: { name: "XP total del mes", unit: "XP", cat: false, hp: 3000 },
  minutes: { name: "Minutos totales", unit: "min", cat: false, hp: 1200 },
  activities: { name: "Cantidad de actividades", unit: "actividades", cat: false, hp: 30 },
  cat_xp: { name: "XP de una categoría", unit: "XP", cat: true, hp: 1000 },
  cat_minutes: { name: "Minutos de una categoría", unit: "min", cat: true, hp: 600 },
  cat_activities: { name: "Actividades de una categoría", unit: "actividades", cat: true, hp: 12 },
  manual: { name: "Progreso manual", unit: "puntos", cat: false, hp: 10 },
};
const BOSS_THEMES = {
  dragon: { name: "Dragón", boss: "Dragón de la Procrastinación" },
  knight: { name: "Caballero oscuro", boss: "Caballero de la Duda" },
  golem: { name: "Gólem", boss: "Gólem de la Pereza" },
  demon: { name: "Demonio", boss: "Demonio del Caos" },
  beast: { name: "Bestia", boss: "Bestia del Sedentarismo" },
  wizard: { name: "Hechicero", boss: "Hechicero de la Distracción" },
  guardian: { name: "Guardián", boss: "Guardián del Estancamiento" },
  shadow: { name: "Sombra", boss: "Sombra del Cansancio" },
};
const BOSS_LABEL = { active: "Activo", weak: "Casi derrotado", defeated: "Derrotado", claimed: "Recompensa reclamada", claiming: "Recompensa reclamada", failed: "No derrotado", upcoming: "Próximo" };
const ym = (y, m) => y * 12 + m;

/** Daño = lo mismo que el progreso de un objetivo del mismo tipo, con las actividades del mes */
function bossDamage(b, days) {
  return goalProgress({ goal_type: b.boss_type, category: b.category, year: b.year, month: b.month, manual_progress: b.manual_progress }, days);
}
/** active | weak | defeated | claiming | claimed | failed (mes terminado) | upcoming (mes futuro) */
function bossStatus(b, dmg, eco) {
  if (b.claimed_at) return "claimed";
  if (eco.ops.some((o) => o.kind === "boss" && o.boss_id === b.id)) return "claiming";
  if (dmg >= b.target_hp) return "defeated";
  const c = curMonth(), k = ym(b.year, b.month), now = ym(c.y, c.m);
  if (k < now) return "failed";
  if (k > now) return "upcoming";
  return (b.target_hp - dmg) / b.target_hp < BOSS_WEAK ? "weak" : "active";
}
const isWon = (st) => st === "defeated" || st === "claimed" || st === "claiming";
const isPaid = (st) => st === "claimed" || st === "claiming";
const liveBosses = () => [...state.eco.bosses.values()].filter((b) => !b.deleted_at);
/** El Boss de un mes. Si quedaron dos (dos dispositivos sin conexión), el mismo criterio que el servidor. */
function bossFor(y, m) {
  const rank = (b) => { const st = bossStatus(b, bossDamage(b, state.days), state.eco); return isPaid(st) ? 3 : st === "defeated" ? 2 : 1; };
  return liveBosses().filter((b) => b.year === y && b.month === m)
    .sort((a, b) => rank(b) - rank(a) || Date.parse(b.updated_at) - Date.parse(a.updated_at))[0] || null;
}
function bossInfo(b) {
  const dmg = bossDamage(b, state.days), st = bossStatus(b, dmg, state.eco);
  return { b, dmg, st, hp: b.target_hp, left: Math.max(0, b.target_hp - dmg) };
}
/** Golpes del mes: cada actividad que cuenta, y el bonus de día completo en el tipo XP total */
function bossHits(b, days) {
  const pre = monthKey(b.year, b.month) + "-", out = [];
  if (b.boss_type === "manual") return out;
  for (const k of Object.keys(days)) {
    if (!k.startsWith(pre)) continue;
    const acts = days[k].activities;
    for (const a of acts) {
      if (b.category && a.cat !== b.category) continue;
      out.push({ k, ts: a.ts, title: a.title, cat: a.cat, v: b.boss_type.endsWith("xp") ? a.xp : b.boss_type.endsWith("minutes") ? a.min : 1 });
    }
    if (b.boss_type === "xp" && isFullDay(acts))
      out.push({ k, ts: Math.max(...acts.map((a) => a.ts)) + 1, title: "Día completo", cat: null, v: FULL_DAY_BONUS });
  }
  return out.sort((x, y) => y.k.localeCompare(x.k) || y.ts - x.ts);
}
function bossDaysLeft(b) {
  const c = curMonth(); if (ym(b.year, b.month) !== ym(c.y, c.m)) return null;
  return new Date(c.y, c.m, 0).getDate() - +todayKey().slice(8) + 1;
}
const bossTypeText = (b) => BOSS_TYPES[b.boss_type].name + (b.category ? ` · ${CAT[b.category].name}` : "");
/** Oro ganado con Bosses: confirmado por el servidor + reclamos que esperan confirmación */
function bossGold() {
  let n = 0;
  for (const c of state.eco.coins.values()) if (c.source === "boss" && !c.deleted_at) n += c.amount;
  for (const o of state.eco.ops) if (o.kind === "boss") { const b = state.eco.bosses.get(o.boss_id); if (!(b && b.claimed_at)) n += o.amount; }
  return n;
}

/* ============ Dibujos: emblemas propios, línea dorada fina ============ */
const EMBLEM = {
  dragon: `<path d="M60 64C46 44 28 38 12 42c9 3 13 9 14 17 6-4 13-5 20-2"/><path d="M60 64c14-20 32-26 48-22-9 3-13 9-14 17-6-4-13-5-20-2"/><path d="M50 52l10-7 10 7-2 20-8 14-8-14z"/><path d="M52 50l-7-15M68 50l7-15"/><path d="M54 60l4 2M66 60l-4 2"/><path d="M57 79l3 4 3-4"/>`,
  knight: `<path d="M38 44q22-30 44 0v32q-22 18-44 0z"/><path d="M44 58h32M60 58v26"/><path d="M48 66v8M72 66v8"/><path d="M60 28c8-12 22-14 30-8-8 0-12 4-14 10"/>`,
  golem: `<path d="M46 26h28v24H46z"/><path d="M34 56h52v34H34z"/><path d="M24 58h8v28h-8zM88 58h8v28h-8z"/><path d="M42 90v8h12v-8M66 90v8h12v-8"/><path d="M54 36h.1M66 36h.1" stroke-width="4"/><path d="M52 64l6 8-4 6 6 8M74 62l-4 10"/>`,
  demon: `<path d="M44 46c-12-8-14-22-8-32 2 14 9 22 16 26"/><path d="M76 46c12-8 14-22 8-32-2 14-9 22-16 26"/><path d="M42 46q18-10 36 0l-4 28q-14 16-28 0z"/><path d="M48 56l8 4M72 56l-8 4"/><path d="M52 72l3 6 3-5 4 5 3-6 3 6"/>`,
  beast: `<path d="M38 28l14 20h16l14-20 2 32-24 32-24-32z"/><path d="M48 60l6 2M72 60l-6 2"/><path d="M56 74h8l-4 5z"/><path d="M60 79v6M44 72l-10 2M76 72l10 2"/>`,
  wizard: `<path d="M40 62L60 16l20 46z"/><path d="M30 64q30 12 60 0"/><path d="M50 72q10 22 20 0"/><path d="M54 70h.1M66 70h.1" stroke-width="4"/><path d="M92 36v64"/><circle cx="92" cy="30" r="6"/><path d="M58 30l4 4M64 24l-2 6"/>`,
  guardian: `<path d="M60 18l28 10v30c0 20-14 34-28 42-14-8-28-22-28-42V28z"/><path d="M60 30v54"/><path d="M50 44h20"/><path d="M56 84l4 6 4-6"/><path d="M40 34v24c0 12 8 22 20 30"/>`,
  shadow: `<path d="M60 18c-22 4-30 28-28 54l8 24h40l8-24c2-26-6-50-28-54z"/><path d="M48 50q12-10 24 0l-2 22q-10 8-20 0z"/><path d="M54 58h.1M66 58h.1" stroke-width="4"/><path d="M44 96l4-14M76 96l-4-14M60 96V84"/>`,
};
function bossEmblem(theme, st = "active", cls = "") {
  const t = EMBLEM[theme] ? theme : "dragon", down = isWon(st);
  return `<svg class="emblem ${cls} ${down ? "down" : ""} ${st === "weak" ? "weak" : ""}" viewBox="0 0 120 120" aria-hidden="true">
    <circle cx="60" cy="60" r="56" fill="#0c0a12" stroke="#3a3150"/><circle class="em-halo" cx="60" cy="60" r="48" fill="none" stroke="rgba(155,123,255,.35)" stroke-dasharray="2 5"/>
    <g class="em-art" fill="none" stroke="url(#g-gold)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${EMBLEM[t]}</g>
    ${down ? `<path class="em-crack" d="M34 22l14 22-8 10 16 14-6 12 14 18" fill="none" stroke="#f1d79d" stroke-width="2.2" stroke-linecap="round"/>` : ""}
  </svg>`;
}

/* ============ Pantalla Boss ============ */
function vBoss(s) {
  const tab = state.bossTab || "current";
  return header("Boss", "Un rival por mes. Le haces daño con tus actividades de ese mes.", false) + `
  <div class="shop-top"><div class="tabs boss-tabs" role="tablist">${[["current", "Actual"], ["history", "Historial"]].map(([id, l]) => `<button role="tab" aria-selected="${tab === id}" data-bosstab="${id}">${l}</button>`).join("")}</div></div>
  ${tab === "history" ? bossHistory() : bossCurrent()}`;
}
function bossCurrent() {
  const c = curMonth(), b = bossFor(c.y, c.m);
  let h = b ? bossCard(bossInfo(b)) : `<section class="panel"><div class="empty">${bossEmblem("shadow", "active", "ghost")}<div>Todavía no hay Boss para ${monthName(c.y, c.m).split(" ")[0]}. Crea uno y derrótalo con tus actividades del mes.</div>${state.demo ? "" : `<button class="btn primary" data-bossnew="${c.y}-${pad(c.m)}">${ico("plus")} Crear Boss</button>`}</div></section>`;
  // Recompensas de meses pasados que esperan ser reclamadas
  const waiting = liveBosses().filter((x) => x !== b && ym(x.year, x.month) < ym(c.y, c.m)).map(bossInfo).filter((i) => i.st === "defeated");
  if (waiting.length) h += `<section class="panel boss-wait"><div class="panel-h"><h2>Recompensas pendientes</h2></div>${waiting.map((i) => `<div class="boss-row">${bossEmblem(i.b.theme, i.st, "xs")}<div class="boss-row-m"><b>${esc(i.b.name)}</b><span>${cap(monthName(i.b.year, i.b.month))}</span></div><button class="btn sm gold" data-bossclaim="${i.b.id}">Reclamar${i.b.coin_reward ? ` +${nf(i.b.coin_reward)} Oro` : ""}</button></div>`).join("")}</section>`;
  // Próximos meses
  const next = liveBosses().filter((x) => ym(x.year, x.month) > ym(c.y, c.m)).sort((x, y) => ym(x.year, x.month) - ym(y.year, y.month));
  const n = new Date(c.y, c.m, 1), nk = `${n.getFullYear()}-${pad(n.getMonth() + 1)}`;
  if (!state.demo) h += `<section class="panel"><div class="panel-h"><h2>Próximos Bosses</h2>${next.some((x) => x.year === n.getFullYear() && x.month === n.getMonth() + 1) ? "" : `<button class="btn sm" data-bossnew="${nk}">${ico("plus")} Boss de ${monthName(n.getFullYear(), n.getMonth() + 1).split(" ")[0]}</button>`}</div>
    ${next.length ? next.map((x) => `<div class="boss-row">${bossEmblem(x.theme, "upcoming", "xs")}<div class="boss-row-m"><b>${esc(x.name)}</b><span>${cap(monthName(x.year, x.month))} · ${bossTypeText(x)} · ${nf(x.target_hp)} HP</span></div><span class="act-r">${bossTools(x, "upcoming")}</span></div>`).join("")
      : `<div class="goal-h"><span>Puedes preparar el Boss del mes que viene desde ahora.</span></div>`}</section>`;
  return h;
}
function bossTools(b, st) {
  if (state.demo || isPaid(st)) return "";
  if (state.confirmBoss === b.id) return `<span class="confirm">¿Eliminar? <button class="btn sm danger" data-bossdel="${b.id}">Sí</button><button class="btn sm ghost" data-bossnodel>No</button></span>`;
  return `<button class="icon-btn edit" data-bossedit="${b.id}" aria-label="Editar Boss">${ico("edit")}</button>${st === "defeated" ? "" : `<button class="icon-btn" data-bossaskdel="${b.id}" aria-label="Eliminar Boss">${ico("trash")}</button>`}`;
}
function hpBar(i, cls = "") {
  return `<div class="hpbar ${cls}" role="progressbar" aria-label="HP restante" aria-valuemin="0" aria-valuemax="${i.hp}" aria-valuenow="${i.left}"><i style="width:${i.left / i.hp * 100}%"></i></div>`;
}
function bossCard(i) {
  const { b, st } = i, left = bossDaysLeft(b), T = todayKey();
  const hits = bossHits(b, state.days), today = hits.filter((x) => x.k === T).reduce((t, x) => t + x.v, 0);
  const bossTitle = b.title_reward ? `<b>${esc(b.title_reward)}</b>` : `<span class="muted-s">Sin título</span>`;
  let action = "";
  if (st === "defeated") action = `<div class="boss-done">Boss derrotado</div><button class="btn gold claim-btn" data-bossclaim="${b.id}">Reclamar recompensa${b.coin_reward ? ` · +${nf(b.coin_reward)} Oro` : ""}</button>`;
  else if (isPaid(st)) action = `<div class="goal-foot"><span class="seal">${st === "claiming" && signedIn() ? "Recompensa reclamada · por confirmar" : "Recompensa reclamada"}</span>${goldAmt(b.coin_reward, true)}</div>`;
  const manual = b.boss_type === "manual" && (st === "active" || st === "weak" || st === "defeated") && !state.demo
    ? `<div class="manual"><button class="btn sm" data-bossmanual="${b.id}|-1" ${i.dmg <= 0 ? "disabled" : ""} aria-label="Restar uno">−</button><button class="btn sm" data-bossmanual="${b.id}|1" aria-label="Sumar uno">+</button><span>Progreso manual</span></div>` : "";
  return `<section class="panel boss-card st-${st}">
    <div class="panel-h"><div class="eyebrow">Boss de ${monthName(b.year, b.month)}</div><span class="act-r">${bossTools(b, st)}</span></div>
    <div class="boss-hero">${bossEmblem(b.theme, st, "lg")}
    <div class="boss-main"><h2 class="boss-name disp">${esc(b.name)}</h2>${b.description ? `<p class="boss-desc">“${esc(b.description)}”</p>` : ""}
      <div class="boss-meta"><span class="bstate st-${st}">${BOSS_LABEL[st]}</span><span>${bossTypeText(b)}</span>${left ? `<span class="num">${left === 1 ? "Último día" : `Quedan ${left} días`}</span>` : ""}</div>
      ${st === "weak" ? `<div class="boss-weak">¡El Boss está debilitado!</div>` : ""}
      ${hpBar(i)}<div class="goal-h"><span class="num"><b>${nf(i.left)}</b> / ${nf(i.hp)} HP</span><span class="num">${Math.floor(Math.min(i.dmg / i.hp, 1) * 100)} % de daño</span></div>
      <div class="boss-grid"><div><span>Daño realizado</span><b class="num">${nf(i.dmg)} ${BOSS_TYPES[b.boss_type].unit}</b></div><div><span>Recompensa</span>${goldAmt(b.coin_reward, true)}</div>
      <div><span>Hoy le hiciste</span><b class="num">${b.boss_type === "manual" || ym(b.year, b.month) !== ym(curMonth().y, curMonth().m) ? "—" : today ? "+" + nf(today) : "0"}</b></div><div><span>Título</span>${bossTitle}</div></div>
      ${manual}${action}</div></div></section>
    ${b.boss_type === "manual" ? "" : `<section class="panel"><div class="panel-h"><h2>Últimos golpes</h2><span class="chip num">${hits.length} ${hits.length === 1 ? "golpe" : "golpes"}</span></div>
    ${hits.length ? `<div class="hits">${hits.slice(0, 8).map((x) => `<div class="hit"><span class="hdate num">${fmtShort(x.k)}</span><b>${esc(x.title)}</b>${x.cat ? `<span class="cat-tag c-${x.cat}">${ico(x.cat)}${CAT[x.cat].name}</span>` : `<span class="chip gold">Bonus</span>`}<span class="hit-v num">−${nf(x.v)}</span></div>`).join("")}</div>`
      : `<div class="empty" style="padding:10px">Cada actividad de ${monthName(b.year, b.month).split(" ")[0]} que cuente para este Boss le quita HP.</div>`}</section>`}`;
}
function bossHistory() {
  const all = liveBosses().map(bossInfo).sort((x, y) => ym(y.b.year, y.b.month) - ym(x.b.year, x.b.month));
  const won = all.filter((i) => isWon(i.st)), lost = all.filter((i) => i.st === "failed");
  const pct = won.length + lost.length ? Math.round(won.length / (won.length + lost.length) * 100) + " %" : "—";
  const best = won.slice().sort((x, y) => y.dmg / y.hp - x.dmg / x.hp)[0];
  const sum = `<div class="kpis boss-kpis"><div class="kpi"><b class="num">${won.length}</b><span>Bosses derrotados</span></div><div class="kpi"><b class="num">${lost.length}</b><span>Bosses no derrotados</span></div>
    <div class="kpi"><b class="num">${pct}</b><span>Victorias</span></div><div class="kpi"><b class="num">${nf(bossGold())}</b><span>Oro ganado por Bosses</span></div>
    <div class="kpi"><b>${best ? cap(monthName(best.b.year, best.b.month)) : "—"}</b><span>${best ? `Mejor mes · ${nf(best.dmg / best.hp * 100)} % del HP` : "Mejor mes"}</span></div></div>`;
  if (!all.length) return sum + `<section class="panel"><div class="empty">${ico("scroll")}<div>Todavía no enfrentaste ningún Boss.</div></div></section>`;
  return sum + `<section class="panel"><div class="panel-h"><h2>Todos los Bosses</h2></div><div class="hist">${all.map((i) => `<div class="boss-row">
    ${bossEmblem(i.b.theme, i.st, "xs")}<div class="boss-row-m"><b>${esc(i.b.name)}</b><span>${cap(monthName(i.b.year, i.b.month))} · ${bossTypeText(i.b)}</span></div>
    <div class="boss-row-r"><span class="bstate st-${i.st}">${BOSS_LABEL[i.st]}${i.st === "claiming" && signedIn() ? " · por confirmar" : ""}</span><span class="num muted-s">${nf(Math.min(i.dmg, i.hp))} / ${nf(i.hp)} ${BOSS_TYPES[i.b.boss_type].unit}</span>
    ${i.st === "defeated" ? `<button class="btn sm gold" data-bossclaim="${i.b.id}">Reclamar</button>` : ""}</div></div>`).join("")}</div></section>`;
}

/* ============ Dashboard ============ */
function dashBoss() {
  if (state.demo) return "";
  const c = curMonth(), b = bossFor(c.y, c.m);
  if (!b) return `<section class="panel boss-panel"><div class="panel-h"><h2>Boss del mes</h2></div><div class="goal-h"><span>Todavía no hay Boss este mes.</span></div><button class="link" style="margin-top:10px" data-bossnew="${c.y}-${pad(c.m)}">Crear Boss</button></section>`;
  const i = bossInfo(b), left = bossDaysLeft(b);
  let foot = `<button class="btn sm" data-go="boss">Ver Boss</button>`;
  if (i.st === "defeated") foot = `<button class="btn sm gold" data-bossclaim="${b.id}">Reclamar${b.coin_reward ? ` +${nf(b.coin_reward)} Oro` : ""}</button>`;
  return `<section class="panel boss-panel st-${i.st}"><div class="panel-h"><h2>Boss del mes</h2><span class="chip num">${cap(monthName(c.y, c.m).split(" ")[0])}${left ? ` · ${left} ${left === 1 ? "día" : "días"}` : ""}</span></div>
    <div class="boss-row">${bossEmblem(b.theme, i.st, "sm")}<div class="boss-row-m"><b>${esc(b.name)}</b><span>${bossTypeText(b)}</span></div></div>
    ${i.st === "weak" ? `<div class="boss-weak">¡El Boss está debilitado!</div>` : ""}${i.st === "defeated" ? `<div class="boss-done">Boss derrotado</div>` : ""}
    ${hpBar(i, "thin")}<div class="goal-h"><span class="num">${nf(i.left)} / ${nf(i.hp)} HP</span><span class="num">Daño ${nf(i.dmg)}</span></div>
    <div class="boss-foot"><span>Recompensa ${goldAmt(b.coin_reward, true)}</span>${isPaid(i.st) ? `<span class="seal">Reclamada</span>` : foot}</div></section>`;
}

/* ============ Crear y editar ============ */
function bossMonths(from) {
  const c = curMonth(), out = [];
  for (let n = 0; n < 13; n++) { const d = new Date(c.y, c.m - 1 + n, 1); out.push({ y: d.getFullYear(), m: d.getMonth() + 1 }); }
  if (from && !out.some((x) => x.y === from.y && x.m === from.m)) out.unshift(from);
  return out;
}
function openBossEditor(month, id) {
  const b = id ? state.eco.bosses.get(id) : null;
  if (b) {
    const st = bossInfo(b).st;
    if (isPaid(st)) return;
    dlg = { type: "bossForm", id, st, f: { name: b.name, description: b.description, y: b.year, m: b.month, boss_type: b.boss_type, category: b.category, hp: b.target_hp, reward: b.coin_reward, title: b.title_reward || "", theme: b.theme, autoName: false }, err: "" };
  } else {
    const [y, m] = month.split("-").map(Number);
    dlg = { type: "bossForm", id: null, st: "active", f: { name: BOSS_THEMES.dragon.boss, description: "", y, m, boss_type: "xp", category: null, hp: BOSS_TYPES.xp.hp, reward: BOSS_REWARD, title: "", theme: "dragon", autoName: true }, err: "" };
  }
  renderModal(); setTimeout(() => document.getElementById("bName")?.focus(), 30);
}
/** Al quedar derrotado o con el mes terminado, los campos de juego no se editan (en el servidor tampoco, si está derrotado) */
const bossGameLocked = (st) => st === "defeated" || st === "failed";
function readBossForm() {
  const f = dlg.f, g = (i) => document.getElementById(i);
  if (!g("bName")) return;
  const n = g("bName").value; if (n !== f.name) { f.name = n; f.autoName = false; }
  f.description = g("bDesc").value; f.title = g("bTitle").value;
  if (!bossGameLocked(dlg.st)) { const [y, m] = g("bMonth").value.split("-").map(Number); f.y = y; f.m = m; f.hp = g("bHp").value; f.reward = g("bReward").value; }
}
function bossForm() {
  const f = dlg.f, T = BOSS_TYPES[f.boss_type], lock = bossGameLocked(dlg.st), dis = lock ? "disabled" : "";
  return `<form class="modal" id="bossForm" role="dialog" aria-modal="true" aria-labelledby="bH">
  <div><div class="eyebrow">Boss mensual</div><h2 id="bH">${dlg.id ? "Editar Boss" : "Nuevo Boss"}</h2></div>
  ${lock ? `<div class="demo"><span>${dlg.st === "defeated" ? "Este Boss ya está derrotado: puedes cambiar el nombre, la descripción y el tema. Lo demás queda fijo hasta reclamarlo." : "El mes de este Boss ya terminó: puedes cambiar el nombre, la descripción y el tema."}</span></div>` : ""}
  <div class="field"><label>Tema</label><div class="theme-pick">${Object.entries(BOSS_THEMES).map(([k, t]) => `<button type="button" data-btheme="${k}" aria-pressed="${f.theme === k}" title="${t.name}">${bossEmblem(k, "active", "xs")}<small>${t.name}</small></button>`).join("")}</div></div>
  <div class="field"><label for="bName">Nombre</label><input class="inp" id="bName" maxlength="60" value="${esc(f.name)}"></div>
  <div class="field"><label for="bDesc">Descripción (opcional)</label><input class="inp" id="bDesc" maxlength="160" placeholder="Ej.: Se alimenta de cada “mañana lo hago”" value="${esc(f.description)}"></div>
  <div class="row2"><div class="field"><label for="bMonth">Mes</label><select class="inp" id="bMonth" ${dis}>${bossMonths({ y: f.y, m: f.m }).map((x) => `<option value="${x.y}-${x.m}" ${x.y === f.y && x.m === f.m ? "selected" : ""}>${cap(monthName(x.y, x.m))}</option>`).join("")}</select></div>
  <div class="field"><label for="bType">Tipo de daño</label><select class="inp" id="bType" ${dis}>${Object.entries(BOSS_TYPES).map(([k, v]) => `<option value="${k}" ${k === f.boss_type ? "selected" : ""}>${v.name}</option>`).join("")}</select></div></div>
  ${T.cat ? `<div class="field"><label>Categoría</label><div class="seg cat5">${CATS.map((c) => `<button type="button" class="c-${c.id}" data-bcat="${c.id}" aria-pressed="${f.category === c.id}" ${dis}>${ico(c.id)}${c.name}</button>`).join("")}</div></div>` : ""}
  <div class="row2"><div class="field"><label for="bHp">HP (${T.unit})</label><input class="inp num" id="bHp" type="number" min="1" max="1000000" step="1" value="${esc(f.hp)}" ${dis}></div>
  <div class="field"><label for="bReward">Recompensa (Oro)</label><input class="inp num" id="bReward" type="number" min="0" max="10000" step="1" value="${esc(f.reward)}" ${dis}></div></div>
  <div class="field"><label for="bTitle">Título de recompensa (opcional)</label><input class="inp" id="bTitle" maxlength="40" placeholder="Ej.: Cazador de Dragones" value="${esc(f.title)}" ${dis}></div>
  <small style="color:var(--muted);font-size:12.5px">${f.boss_type === "manual" ? "El daño lo cargas tú con los botones + y −." : "Cada actividad del mes que cuente le quita HP. El daño se calcula solo."}</small>
  ${dlg.err ? `<div class="err">${dlg.err}</div>` : ""}
  <div class="modal-f"><button type="button" class="btn ghost" data-dlg-close>Cancelar</button><button type="submit" class="btn primary">${dlg.id ? "Guardar cambios" : "Crear Boss"}</button></div></form>`;
}
function saveBoss() {
  readBossForm();
  const f = dlg.f, lock = bossGameLocked(dlg.st), name = f.name.trim(), hp = Math.round(+f.hp), reward = Math.round(+f.reward);
  const old = dlg.id ? state.eco.bosses.get(dlg.id) : null, c = curMonth();
  if (!name) { dlg.err = "Escribe un nombre para el Boss."; renderModal(); return; }
  if (!lock) {
    if (!(hp >= 1 && hp <= 1000000)) { dlg.err = "Los HP tienen que ser un número mayor que 0."; renderModal(); return; }
    if (!(reward >= 0 && reward <= 10000)) { dlg.err = "La recompensa va de 0 a 10.000 Oro."; renderModal(); return; }
    if (ym(f.y, f.m) < ym(c.y, c.m)) { dlg.err = "Solo puedes crear Bosses para este mes o para meses futuros."; renderModal(); return; }
    const other = bossFor(f.y, f.m);
    if (other && other.id !== dlg.id) { dlg.err = `Ya hay un Boss para ${monthName(f.y, f.m)}: ${esc(other.name)}.`; renderModal(); return; }
  }
  const at = nowISO();
  const row = { ...(old || { id: Store.newId(), manual_progress: 0, claimed_at: null, created_at: at, deleted_at: null }),
    name: name.slice(0, 60), description: f.description.trim().slice(0, 160), theme: f.theme, updated_at: at };
  if (!lock) Object.assign(row, { year: f.y, month: f.m, boss_type: f.boss_type, category: BOSS_TYPES[f.boss_type].cat ? f.category || "curso" : null,
    target_hp: hp, coin_reward: reward, title_reward: f.title.trim().slice(0, 40) || null });
  dlg = null; renderModal();
  putBosses([row]); toast(old ? "Boss actualizado." : `Boss creado: <b>${esc(row.name)}</b>`);
}
function putBosses(rows) {
  for (const r of rows) state.eco.bosses.set(r.id, r);
  Store.put("bosses", rows).then(() => Sync.changed()).catch(() => toast("No se pudo guardar en este dispositivo."));
  render();
}
function deleteBoss(id) {
  const b = state.eco.bosses.get(id); state.confirmBoss = null;
  if (!b) return;
  const st = bossInfo(b).st;
  if (isWon(st)) { render(); return; }                       // derrotado o reclamado: no se borra
  const at = nowISO(); putBosses([{ ...b, deleted_at: at, updated_at: at }]);
}

/* ============ Reclamar ============ */
function claimBoss(id) {
  const b = state.eco.bosses.get(id); if (!b || b.claimed_at || b.deleted_at) return;
  if (state.eco.ops.some((o) => o.kind === "boss" && o.boss_id === id)) return;          // doble toque
  if (bossDamage(b, state.days) < b.target_hp) return;
  const op = { key: "boss:" + id, kind: "boss", boss_id: id, amount: b.coin_reward, name: b.name, title: b.title_reward || "", at: nowISO(), seq: Date.now() };
  state.eco.ops.push(op);
  Store.putOp(op).then(() => Sync.changed(300)).catch(() => {});
  dlg = { type: "bossClaimed", id }; renderModal(); goldToast(b.coin_reward); render();
}
/** La animación "Boss derrotado" se muestra una vez por Boss, cuando lo ves derrotado por primera vez */
function bossAfterRender() {
  if (!state.ready || state.demo || dlg || form) return;
  const seen = state.bossSeen || (state.bossSeen = new Set());
  // solo el Boss que vale para cada mes (si dos dispositivos crearon uno, el otro queda archivado al sincronizar)
  const months = new Set(liveBosses().map((b) => ym(b.year, b.month)));
  for (const k of months) {
    const b = bossFor(Math.floor((k - 1) / 12), ((k - 1) % 12) + 1);
    if (!b) continue;
    if (seen.has(b.id)) continue;
    const i = bossInfo(b);
    if (i.st === "defeated") {
      seen.add(b.id); Store.setMeta("bossSeen", [...seen]).catch(() => {});
      openDlg({ type: "bossDown", id: b.id }); return;
    }
    if (isPaid(i.st)) { seen.add(b.id); Store.setMeta("bossSeen", [...seen]).catch(() => {}); }
  }
}
function bossDlgHTML(d) {
  const b = state.eco.bosses.get(d.id);
  if (!b || b.deleted_at) { dlg = null; return ""; }                   // el Boss se archivó al sincronizar
  if (d.type === "bossDown") return `<div class="modal center unlock boss-down" role="dialog" aria-modal="true" aria-labelledby="bdH"><div class="eyebrow gold-eye">Boss derrotado</div>
    <div class="boss-down-art">${bossEmblem(b.theme, "defeated", "anim")}</div><h2 id="bdH" class="disp">${esc(b.name)}</h2>
    <div class="buy-sum"><span>Oro</span>${goldAmt(b.coin_reward, true)}${b.title_reward ? `<span>Título</span><b>${esc(b.title_reward)}</b>` : ""}</div>
    <div class="modal-f" style="justify-content:center"><button type="button" class="btn ghost" data-dlg-close>Después</button><button type="button" class="btn gold" data-bossclaim="${b.id}">Reclamar recompensa</button></div></div>`;
  if (d.type === "bossClaimed") return `<div class="modal center unlock" role="dialog" aria-modal="true" aria-labelledby="bcH"><div class="eyebrow gold-eye">Recompensa reclamada</div>
    <div class="boss-down-art">${bossEmblem(b.theme, "claimed")}</div><h2 id="bcH" class="disp">${esc(b.name)}</h2>${b.coin_reward ? `<div class="big-gold">+${nf(b.coin_reward)} Oro</div>` : ""}
    ${b.title_reward ? `<span class="muted-s">Título desbloqueado: <b style="color:var(--gold)">${esc(b.title_reward)}</b></span>` : ""}
    ${signedIn() ? `<small class="muted-s">Se confirma con tu cuenta al sincronizar.</small>` : ""}
    <div class="modal-f" style="justify-content:center">${b.title_reward ? `<button type="button" class="btn" data-equip="boss:${b.id}">Equipar título</button>` : ""}<button type="button" class="btn gold" data-dlg-close>Guardar en el tesoro</button></div></div>`;
  return "";
}

/* ============ Respaldo (versión 4) ============ */
function bossExport() {
  return liveBosses().map((b) => { const o = !b.claimed_at && state.eco.ops.find((x) => x.kind === "boss" && x.boss_id === b.id); return o ? { ...b, claimed_at: o.at } : b; })
    .sort((a, b) => ym(a.year, a.month) - ym(b.year, b.month));
}
function parseBosses(j) {
  const out = []; let skipped = 0;
  for (const r of Array.isArray(j.monthly_bosses) ? j.monthly_bosses : []) {
    const T = r && BOSS_TYPES[r.boss_type], hp = Math.round(+(r && r.target_hp)), y = +(r && r.year), m = +(r && r.month), rw = Math.round(+(r && r.coin_reward) || 0);
    if (!T || !UUIDre.test(r.id) || !(hp >= 1 && hp <= 1000000) || !(y >= 2000 && y <= 2100) || !(m >= 1 && m <= 12) || typeof r.name !== "string" || !r.name.trim() || (T.cat && !CAT[r.category]) || !(rw >= 0 && rw <= 10000)) { skipped++; continue; }
    const c = isoOr(r.created_at, nowISO());
    out.push({ id: r.id.toLowerCase(), year: y, month: m, name: r.name.trim().slice(0, 60), description: typeof r.description === "string" ? r.description.trim().slice(0, 160) : "",
      boss_type: r.boss_type, category: T.cat ? r.category : null, target_hp: hp, manual_progress: Math.max(0, Math.round(+r.manual_progress || 0)), coin_reward: rw,
      title_reward: typeof r.title_reward === "string" && r.title_reward.trim() ? r.title_reward.trim().slice(0, 40) : null, theme: BOSS_THEMES[r.theme] ? r.theme : "dragon",
      claimed_at: isoOr(r.claimed_at, null), created_at: c, updated_at: isoOr(r.updated_at, c), deleted_at: null });
  }
  return { bosses: out, skipped };
}
/** Un respaldo nunca copia claimed_at ni Oro: un Boss reclamado en el archivo pide claim_boss, que paga una sola vez */
function importBosses(P, mode, at) {
  const Eco = state.eco, res = { bosses: 0, claims: 0 };
  const locked = (b) => isWon(bossInfo(b).st);                        // derrotado o reclamado: no se toca
  const rows = [], inFile = new Set(P.bosses.map((b) => b.id));
  if (mode === "replace") for (const b of liveBosses()) if (!inFile.has(b.id) && !locked(b)) rows.push({ ...b, deleted_at: at, updated_at: at });
  const after = new Map(Eco.bosses); for (const r of rows) after.set(r.id, r);
  const busy = (r) => [...after.values()].some((b) => !b.deleted_at && b.id !== r.id && b.year === r.year && b.month === r.month);
  const wantClaim = [];
  for (const r of P.bosses) {
    const l = Eco.bosses.get(r.id), isLocked = l && !l.deleted_at && locked(l);
    if (r.claimed_at && !(l && (l.claimed_at || Eco.ops.some((o) => o.kind === "boss" && o.boss_id === r.id)))) wantClaim.push(r);
    if (isLocked || busy(r)) continue;                                  // un solo Boss por mes
    if (mode === "replace" || !l || Date.parse(r.updated_at) > Date.parse(l.updated_at)) {
      const row = { ...r, claimed_at: l ? l.claimed_at : null, updated_at: mode === "replace" ? at : r.updated_at };
      rows.push(row); after.set(row.id, row); res.bosses++;
    }
  }
  if (rows.length) { for (const r of rows) Eco.bosses.set(r.id, r); Store.put("bosses", rows).catch(() => {}); }
  let seq = Date.now();
  for (const r of wantClaim) {
    const b = Eco.bosses.get(r.id);
    if (b && !b.deleted_at && !b.claimed_at && bossDamage(b, state.days) >= b.target_hp) {
      const op = { key: "boss:" + b.id, kind: "boss", boss_id: b.id, amount: b.coin_reward, name: b.name, title: b.title_reward || "", at: r.claimed_at, seq: seq++ };
      Eco.ops.push(op); Store.putOp(op).catch(() => {}); res.claims++;
    }
  }
  return res;
}

/* ============ Eventos ============ */
Sync.onNotice((n) => {
  if (n.type === "boss_failed") toast(`No se pudo reclamar <b>${esc(n.op.name || "el Boss")}</b>: en tu cuenta todavía no figura derrotado. No se sumó Oro.`, "lvl");
});
document.addEventListener("click", (e) => {
  const t = e.target.closest("button"); if (!t || !t.dataset) return;
  const D = t.dataset;
  if (D.bosstab) { state.bossTab = D.bosstab; state.confirmBoss = null; render(); return; }
  if (D.bossnew) { openBossEditor(D.bossnew); return; }
  if (D.bossedit) { openBossEditor(null, D.bossedit); return; }
  if (D.bossaskdel) { state.confirmBoss = D.bossaskdel; render(); return; }
  if (D.bossnodel !== undefined) { state.confirmBoss = null; render(); return; }
  if (D.bossdel) { deleteBoss(D.bossdel); return; }
  if (D.bossclaim) { t.disabled = true; claimBoss(D.bossclaim); return; }
  if (D.bossmanual) {
    const [id, n] = D.bossmanual.split("|"), b = state.eco.bosses.get(id);
    if (b && !b.claimed_at && !state.eco.ops.some((o) => o.kind === "boss" && o.boss_id === id)) putBosses([{ ...b, manual_progress: Math.max(0, (b.manual_progress || 0) + +n), updated_at: nowISO() }]);
    return;
  }
  if (dlg && dlg.type === "bossForm") {
    if (D.btheme) {
      readBossForm(); const f = dlg.f;
      if (f.autoName || !f.name.trim()) { f.name = BOSS_THEMES[D.btheme].boss; f.autoName = true; }
      f.theme = D.btheme; renderModal(); return;
    }
    if (D.bcat && !bossGameLocked(dlg.st)) { readBossForm(); dlg.f.category = D.bcat; renderModal(); return; }
  }
});
document.addEventListener("change", (e) => {
  if (e.target.id === "bType" && dlg && dlg.type === "bossForm") {
    readBossForm(); const f = dlg.f, prev = BOSS_TYPES[f.boss_type];
    if (+f.hp === prev.hp) f.hp = BOSS_TYPES[e.target.value].hp;          // HP sugerido si no lo cambiaste
    f.boss_type = e.target.value;
    if (BOSS_TYPES[f.boss_type].cat && !f.category) f.category = "curso";
    renderModal();
  }
});
document.addEventListener("submit", (e) => { if (e.target.id === "bossForm") { e.preventDefault(); saveBoss(); } });
