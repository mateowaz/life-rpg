/* Life RPG — pantallas de Oro, Tienda (Recompensas, Wishlist, Historial), Objetivos mensuales y Cofres.
   Usa el estado y las ayudas de app.js; las reglas están en economy.js. */

/* ============ Ayudas ============ */
let dlg = null;
function openDlg(d) { dlg = d; renderModal(); }
function closeDlg() { dlg = null; renderModal(); render(); }
const E = () => state.eco;
const goldNow = () => goldState(state.eco);
const signedIn = () => Sync.info.signedIn;
const coinIco = (cls = "") => `<svg class="coin ${cls}" aria-hidden="true"><use href="#i-coin"/></svg>`;
const goldAmt = (n, sign = false) => `<span class="gold-amt ${n < 0 ? "neg" : ""}">${coinIco()}<b class="num">${sign && n > 0 ? "+" : ""}${n < 0 ? "−" + nf(-n) : nf(n)}</b></span>`;
const rIco = (icon) => `<svg aria-hidden="true"><use href="#r-${SHOP_ICONS.includes(icon) ? icon : "gift"}"/></svg>`;
const rarityChip = (r) => `<span class="rar r-${r}">${RARITY[r] ? RARITY[r].name : ""}</span>`;
const live = (m) => [...m.values()].filter((x) => !x.deleted_at);
const curMonth = () => { const t = todayKey(); return { y: +t.slice(0, 4), m: +t.slice(5, 7) }; };
const monthName = (y, m) => new Date(y, m - 1, 1).toLocaleDateString("es", { month: "long", year: "numeric" });

function goldToast(d) {
  if (!d) return;
  toast(`${coinIco()}<b>${d > 0 ? "+" : "−"}${nf(Math.abs(d))} Oro</b>`, "gold");
  requestAnimationFrame(() => document.querySelectorAll("[data-gold]").forEach((el) => { el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); }));
}
function goldLossNote(a) {
  if (!state.eco.coins.size) return "";
  const n = goldForXP(a.xp), b = goldNow().balance;
  return ` <span class="gold-t">−${n} Oro${b - n < 0 ? ", tu saldo quedará en rojo" : ""}</span>`;
}

/** Cofre dibujado: madera oscura con herrajes dorados */
function chestSVG(status) {
  const open = status === "opened" || status === "opening" || status === "anim";
  return `<svg class="chest ${status}" viewBox="0 0 64 60" aria-hidden="true">
    ${open ? `<ellipse class="chest-glow" cx="32" cy="27" rx="22" ry="7" fill="#f1d79d"/>` : ""}
    <path d="M8 27h48v24a4 4 0 01-4 4H12a4 4 0 01-4-4z" fill="#33251a" stroke="#a8884a" stroke-width="1.4"/>
    <path d="M8 36h48" stroke="#a8884a" stroke-width="1" opacity=".55"/>
    <g class="chest-lid">${open
      ? `<path d="M11 25L15 7a3 3 0 013-2.4h28A3 3 0 0149 7l4 18z" fill="#45321f" stroke="#a8884a" stroke-width="1.4"/><path d="M22 4.6l-3 20.4M42 4.6l3 20.4" stroke="url(#g-gold)" stroke-width="3"/>`
      : `<path d="M8 27v-7a13 13 0 0113-13h22a13 13 0 0113 13v7z" fill="#45321f" stroke="#a8884a" stroke-width="1.4"/><path d="M21 7v20M43 7v20" stroke="url(#g-gold)" stroke-width="3"/>`}</g>
    <path d="M21 27v28M43 27v28" stroke="url(#g-gold)" stroke-width="3"/>
    ${open ? "" : `<rect x="27.5" y="23" width="9" height="11" rx="1.6" fill="url(#g-gold)"/><circle cx="32" cy="27.6" r="1.4" fill="#33251a"/><path d="M32 28.5v2.6" stroke="#33251a" stroke-width="1.2"/>`}
  </svg>`;
}

/* ============ Dashboard ============ */
function goldStat() {
  const b = goldNow().balance;
  return `<div class="stat gold-stat ${b < 0 ? "neg" : ""}">${coinIco()}<div><b class="num" data-gold>${b < 0 ? "−" + nf(-b) : nf(b)}</b><span>${b < 0 ? "Oro · saldo en rojo" : "Oro"}</span></div></div>`;
}
function dashChest(s) {
  if (state.demo) return "";
  const list = chestList(s.G.level, E()), av = list.filter((c) => c.status === "available");
  if (av.length) {
    const c = av[0];
    return `<section class="panel chest-panel ready"><div class="panel-h"><h2>${av.length > 1 ? `${av.length} cofres disponibles` : "Cofre disponible"}</h2><span class="chip gold num">Nivel ${c.level}</span></div>
    <div class="chest-row">${chestSVG("available")}<div><b class="disp">${c.name}</b><span>${goldAmt(c.gold, true)}</span></div></div>
    <button class="btn gold chest-btn" data-chest="${c.level}">Abrir cofre</button></section>`;
  }
  const next = list.find((c) => c.status === "locked");
  if (!next) return "";
  const pct = Math.min(s.xp / totalXPFor(next.level), 1);
  return `<section class="panel chest-panel"><div class="panel-h"><h2>Próximo cofre</h2><span class="chip num">Nivel ${next.level}</span></div>
    <div class="chest-row">${chestSVG("locked")}<div><b class="disp">${next.name}</b><span>${goldAmt(next.gold, true)}</span></div></div>
    <div class="xpbar thin"><i style="width:${pct * 100}%"></i></div><div class="goal-h"><span class="num">Faltan ${nf(Math.max(totalXPFor(next.level) - s.xp, 0))} XP</span></div></section>`;
}
function dashSaving() {
  if (state.demo) return "";
  const it = live(E().items).find((i) => i.item_type === "wishlist" && i.is_primary_goal && i.active);
  if (!it) return `<section class="panel"><div class="panel-h"><h2>Ahorrando para</h2></div><div class="goal-h"><span>Fija un deseo de tu Wishlist para ver cuánto te falta.</span></div><button class="link" style="margin-top:10px" data-shopgo="wishlist">Elegir algo para ahorrar</button></section>`;
  return `<section class="panel"><div class="panel-h"><h2>Ahorrando para</h2>${rarityChip(it.rarity)}</div>${savingBody(it)}</section>`;
}
function savingBody(it) {
  const b = goldNow().balance, pct = Math.max(0, Math.min(b / it.price, 1)), miss = it.price - Math.max(b, 0);
  return `<div class="wish-head r-${it.rarity}"><div class="r-frame sm">${rIco(it.icon)}</div><div><b>${esc(it.name)}</b><span class="num">${nf(Math.max(b, 0))} / ${nf(it.price)} Oro</span></div></div>
  <div class="xpbar thin goldbar"><i style="width:${pct * 100}%"></i></div>
  <div class="goal-h"><span class="num">${miss > 0 ? `Te faltan ${nf(miss)} Oro` : "Ya te alcanza"}</span><span class="num">${Math.floor(pct * 100)} %</span></div>`;
}
function dashMonthGoals() {
  if (state.demo) return "";
  const { y, m } = curMonth();
  const gs = live(E().goals).filter((g) => g.year === y && g.month === m).map((g) => { const v = goalProgress(g, state.days); return { g, v, st: goalStatus(g, v, E()) }; });
  const done = gs.filter((x) => x.st !== "active").length;
  const top = gs.filter((x) => x.st === "active").sort((a, b) => b.v / b.g.target_value - a.v / a.g.target_value).slice(0, 3);
  const ready = gs.filter((x) => x.st === "completed");
  return `<section class="panel"><div class="panel-h"><h2>Objetivos del mes</h2>${gs.length ? `<span class="chip num">${done} / ${gs.length} completados</span>` : ""}</div>
  ${!gs.length ? `<div class="goal-h"><span>Todavía no tienes objetivos para ${monthName(y, m).split(" ")[0]}.</span></div>` : ""}
  ${ready.length ? `<div class="mini-goal ready"><b>${esc(ready[0].g.title)}</b><span class="chip gold">Completado</span><button class="btn sm gold" data-claim="${ready[0].g.id}">Reclamar +${nf(ready[0].g.coin_reward)} Oro</button></div>` : ""}
  ${top.map(({ g, v }) => `<div class="mini-goal"><div class="goal-h"><b>${esc(g.title)}</b><span class="num">${goalNumbers(g, v)}</span></div><div class="xpbar thin"><i style="width:${Math.min(v / g.target_value, 1) * 100}%"></i></div></div>`).join("")}
  <button class="link" style="margin-top:12px" data-go="objetivos">${gs.length ? "Ver objetivos" : "Crear objetivo"}</button></section>`;
}

/* ============ Objetivos ============ */
function vObjetivos(s) {
  const c = curMonth(), [y, m] = state.goalMonth ? state.goalMonth.split("-").map(Number) : [c.y, c.m];
  const past = y * 12 + m < c.y * 12 + c.m;
  const shift = (n) => { const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
  const gs = live(E().goals).filter((g) => g.year === y && g.month === m)
    .map((g) => { const v = goalProgress(g, state.days); return { g, v, st: goalStatus(g, v, E()) }; })
    .sort((a, b) => a.g.created_at.localeCompare(b.g.created_at));
  const done = gs.filter((x) => x.st !== "active").length;
  const canNew = !past && !state.demo;
  return header("Objetivos", "Metas para el mes. El progreso se calcula solo con tus actividades.", false) + `
  <div class="top" style="align-items:center"><div class="cal-h"><button class="btn sm" data-gmonth="${shift(-1)}" aria-label="Mes anterior">${ico("left").replace("<svg", "<svg width='16' height='16'")}</button>
  <h2 class="disp goal-title">Objetivos de ${monthName(y, m)}</h2><button class="btn sm" data-gmonth="${shift(1)}" aria-label="Mes siguiente">${ico("right").replace("<svg", "<svg width='16' height='16'")}</button></div>
  <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">${gs.length ? `<span class="chip num">${done} / ${gs.length} completados</span>` : ""}${canNew ? `<button class="btn primary sm" data-goal-new="${y}-${pad(m)}">${ico("plus")} Nuevo objetivo</button>` : ""}</div></div>
  ${gs.length ? `<div class="goal-grid">${gs.map(goalCard).join("")}</div>` :
    `<section class="panel"><div class="empty">${ico("target")}<div>${past ? "No hubo objetivos este mes." : "Todavía no hay objetivos para este mes."}</div>${canNew ? `<button class="btn primary" data-goal-new="${y}-${pad(m)}">${ico("plus")} Crear objetivo</button>` : ""}</div></section>`}`;
}
function goalCard({ g, v, st }) {
  const pct = Math.min(v / g.target_value, 1), cat = g.category ? CAT[g.category] : null;
  const confirm = state.confirmGoal === g.id;
  let foot;
  if (st === "claimed") foot = `<div class="goal-foot"><span class="seal">Reclamado</span>${goldAmt(g.coin_reward, true)}</div>`;
  else if (st === "claiming") foot = `<div class="goal-foot"><span class="seal">${signedIn() ? "Reclamado · por confirmar" : "Reclamado"}</span>${goldAmt(g.coin_reward, true)}</div>`;
  else if (st === "completed") foot = `<div class="goal-done">Objetivo completado</div>${g.coin_reward ? `<button class="btn gold claim-btn" data-claim="${g.id}">Reclamar +${nf(g.coin_reward)} Oro</button>` : ""}`;
  else foot = `<div class="goal-foot"><span>Recompensa</span>${goldAmt(g.coin_reward, true)}</div>`;
  const tools = st === "claimed" || st === "claiming" || state.demo ? "" : confirm
    ? `<span class="confirm">¿Eliminar? <button class="btn sm danger" data-goal-del="${g.id}">Sí</button><button class="btn sm ghost" data-goal-nodel>No</button></span>`
    : `<button class="icon-btn edit" data-goal-edit="${g.id}" aria-label="Editar objetivo">${ico("edit")}</button><button class="icon-btn" data-goal-askdel="${g.id}" aria-label="Eliminar objetivo">${ico("trash")}</button>`;
  return `<section class="goal-card ${cat ? "c-" + g.category : ""} ${st}">
    <div class="goal-top">${cat ? `<span class="cat-tag">${ico(g.category)}${cat.name}</span>` : `<span class="cat-tag plain">${GOAL_TYPES[g.goal_type].name}</span>`}<span class="act-r">${tools}</span></div>
    <b class="goal-name">${esc(g.title)}</b>${g.description ? `<span class="goal-desc">${esc(g.description)}</span>` : ""}
    <div class="goal-h"><span class="num">${goalNumbers(g, v)}</span><span class="num">${Math.floor(pct * 100)} %</span></div>
    <div class="xpbar ${st !== "active" ? "goldbar" : ""}"><i style="width:${pct * 100}%"></i></div>
    ${g.goal_type === "manual" && st === "active" ? `<div class="manual"><button class="btn sm" data-manual="${g.id}|-1" ${v <= 0 ? "disabled" : ""} aria-label="Restar uno">−</button><button class="btn sm" data-manual="${g.id}|1" aria-label="Sumar uno">+</button><span>Progreso manual</span></div>` : ""}
    ${foot}</section>`;
}
function suggestTitle(t, cat, n) {
  n = Math.round(+n) || 0; const C = cat && CAT[cat] ? CAT[cat].name : "";
  switch (t) {
    case "activities": return `Completar ${n} actividades`;
    case "xp": return `Conseguir ${nf(n)} XP`;
    case "minutes": return n >= 120 && n % 60 === 0 ? `Invertir ${n / 60} horas` : `Invertir ${n} minutos`;
    case "cat_activities": return cat === "fisico" ? `Entrenar ${n} veces` : `${n} actividades de ${C}`;
    case "cat_xp": return `${nf(n)} XP en ${C}`;
    case "cat_minutes": return cat === "lectura" ? `Leer ${n} minutos` : n >= 120 && n % 60 === 0 ? `Completar ${n / 60} horas de ${C}` : `${n} minutos de ${C}`;
    case "streak": return `Racha de ${n} días`;
  }
  return "";
}
function openGoalEditor(month, id) {
  const g = id ? E().goals.get(id) : null;
  const [y, m] = g ? [g.year, g.month] : month.split("-").map(Number);
  dlg = { type: "goal", id, f: g ? { goal_type: g.goal_type, category: g.category, target: g.target_value, title: g.title, description: g.description, reward: g.coin_reward, y, m, autoTitle: false }
    : { goal_type: "cat_activities", category: "fisico", target: 12, title: "Entrenar 12 veces", description: "", reward: 50, y, m, autoTitle: true }, err: "" };
  renderModal(); setTimeout(() => document.getElementById("gTarget")?.focus(), 30);
}
function readGoalForm() {
  const f = dlg.f, g = (i) => document.getElementById(i);
  if (!g("gTarget")) return;
  f.target = g("gTarget").value; f.description = g("gDesc").value; f.reward = g("gReward").value;
  const t = g("gTitle").value; if (t !== f.title) { f.title = t; f.autoTitle = false; }
  if (f.autoTitle) f.title = suggestTitle(f.goal_type, f.category, f.target);
}
function goalForm() {
  const f = dlg.f, T = GOAL_TYPES[f.goal_type];
  return `<form class="modal" id="goalForm" role="dialog" aria-modal="true" aria-labelledby="gH">
  <div><div class="eyebrow">${cap(monthName(f.y, f.m))}</div><h2 id="gH">${dlg.id ? "Editar objetivo" : "Nuevo objetivo"}</h2></div>
  <div class="field"><label>Atajos</label><div class="presets">${GOAL_PRESETS.map((p) => `<button type="button" class="chip" data-gpreset="${p.id}">${p.label}</button>`).join("")}</div></div>
  <div class="field"><label for="gType">Tipo</label><select class="inp" id="gType">${Object.entries(GOAL_TYPES).map(([k, v]) => `<option value="${k}" ${k === f.goal_type ? "selected" : ""}>${v.name}</option>`).join("")}</select></div>
  ${T.cat ? `<div class="field"><label>Categoría</label><div class="seg">${CATS.map((c) => `<button type="button" class="c-${c.id}" data-gcat="${c.id}" aria-pressed="${f.category === c.id}">${ico(c.id)}${c.name}</button>`).join("")}</div></div>` : ""}
  <div class="row2"><div class="field"><label for="gTarget">Meta${T.unit ? ` (${T.unit})` : ""}</label><input class="inp num" id="gTarget" type="number" min="1" max="1000000" step="1" value="${esc(f.target)}"></div>
  <div class="field"><label for="gReward">Recompensa (Oro)</label><input class="inp num" id="gReward" type="number" min="0" max="10000" step="1" value="${esc(f.reward)}"></div></div>
  <div class="field"><label for="gTitle">Título</label><input class="inp" id="gTitle" maxlength="60" placeholder="Ej.: Terminar el módulo 3" value="${esc(f.title)}"></div>
  <div class="field"><label for="gDesc">Descripción (opcional)</label><input class="inp" id="gDesc" maxlength="120" value="${esc(f.description)}"></div>
  ${f.goal_type === "manual" ? `<small style="color:var(--muted);font-size:12.5px">Este tipo es el único que cargas a mano, con los botones + y −.</small>` : `<small style="color:var(--muted);font-size:12.5px">El progreso se calcula solo con las actividades del mes.</small>`}
  ${dlg.err ? `<div class="err">${dlg.err}</div>` : ""}
  <div class="modal-f"><button type="button" class="btn ghost" data-dlg-close>Cancelar</button><button type="submit" class="btn primary">${dlg.id ? "Guardar cambios" : "Crear objetivo"}</button></div></form>`;
}
function saveGoal() {
  readGoalForm();
  const f = dlg.f, target = Math.round(+f.target), reward = Math.round(+f.reward), title = f.title.trim();
  if (!(target >= 1 && target <= 1000000)) { dlg.err = "La meta tiene que ser un número mayor que 0."; renderModal(); return; }
  if (!(reward >= 0 && reward <= 10000)) { dlg.err = "La recompensa va de 0 a 10.000 Oro."; renderModal(); return; }
  if (!title) { dlg.err = "Escribe un título."; renderModal(); return; }
  const at = nowISO(), old = dlg.id ? E().goals.get(dlg.id) : null;
  const row = { ...(old || { id: Store.newId(), year: f.y, month: f.m, manual_progress: 0, completed_at: null, claimed_at: null, created_at: at, deleted_at: null }),
    title: title.slice(0, 60), description: f.description.trim().slice(0, 120), goal_type: f.goal_type, category: GOAL_TYPES[f.goal_type].cat ? f.category || "curso" : null,
    target_value: target, coin_reward: reward, updated_at: at };
  dlg = null; renderModal();
  putGoals([row]); toast(old ? "Objetivo actualizado." : "Objetivo creado.");
}
function putGoals(rows) {
  for (const r of rows) E().goals.set(r.id, r);
  Store.put("goals", rows).then(() => Sync.changed()).catch(() => toast("No se pudo guardar en este dispositivo."));
  syncEconomy(true); render();
}
function claimGoal(id) {
  const g = E().goals.get(id); if (!g || g.claimed_at || g.deleted_at) return;
  if (E().ops.some((o) => o.kind === "claim" && o.goal_id === id)) return;           // doble toque
  if (goalProgress(g, state.days) < g.target_value) return;
  const op = { key: "claim:" + id, kind: "claim", goal_id: id, amount: g.coin_reward, title: g.title, at: nowISO(), seq: Date.now() };
  E().ops.push(op);
  Store.putOp(op).then(() => Sync.changed(300)).catch(() => {});
  if (dlg && dlg.type === "goalDone") dlg = null;
  renderModal(); goldToast(g.coin_reward); render();
}

/* ============ Cofres ============ */
function openChest(level) {
  const s = compute(), c = chestList(s.G.level, E()).find((x) => x.level === level);
  if (!c || c.status !== "available") return;                                          // doble toque o ya abierto
  const op = { key: "chest:" + level, kind: "chest", level, gold: c.gold, name: c.name, at: nowISO(), seq: Date.now() };
  E().ops.push(op);
  Store.putOp(op).then(() => Sync.changed(300)).catch(() => {});
  openDlg({ type: "chest", level }); goldToast(c.gold); render();
}

/* ============ Tienda ============ */
function vTienda(s) {
  const b = goldNow().balance, tab = state.shopTab;
  const tabs = [["rewards", "Recompensas"], ["wishlist", "Wishlist"], ["history", "Historial"]];
  let body;
  if (tab === "wishlist") body = shopWishlist(b);
  else if (tab === "history") body = shopHistory();
  else body = shopRewards(b);
  return header("Tienda", "Canjea tu Oro por recompensas que tú eliges.", false) + `
  <div class="shop-top"><div class="tabs" role="tablist">${tabs.map(([id, l]) => `<button role="tab" aria-selected="${tab === id}" data-shoptab="${id}">${l}</button>`).join("")}</div>
  <div class="shop-bal ${b < 0 ? "neg" : ""}">${coinIco()}<b class="num" data-gold>${b < 0 ? "−" + nf(-b) : nf(b)}</b><span>Oro</span></div></div>
  ${b < 0 ? `<div class="demo neg-banner"><span>Tu saldo quedó en rojo por una corrección de actividades. La tienda se desbloquea cuando vuelvas a 0.</span></div>` : ""}
  ${body}`;
}
function buyBtn(it, b) {
  if (!it.active) return "";
  if (b < 0 || b < it.price) return `<span class="miss num">Faltan ${nf(it.price - Math.max(b, 0))}</span>`;
  return `<button class="btn sm gold" data-buy="${it.id}">Comprar</button>`;
}
function itemTools(it) {
  if (state.confirmItem === it.id) return `<span class="confirm">¿Eliminar? <button class="btn sm danger" data-item-del="${it.id}">Sí</button><button class="btn sm ghost" data-item-nodel>No</button></span>`;
  return `<button class="icon-btn edit" data-item-edit="${it.id}" aria-label="Editar">${ico("edit")}</button>
    <button class="icon-btn edit" data-item-toggle="${it.id}" aria-label="${it.active ? "Desactivar" : "Activar"}" title="${it.active ? "Desactivar" : "Activar"}">${ico(it.active ? "pause" : "play")}</button>
    <button class="icon-btn" data-item-askdel="${it.id}" aria-label="Eliminar">${ico("trash")}</button>`;
}
function shopRewards(b) {
  const all = live(E().items).filter((i) => i.item_type === "reward").sort((x, y) => x.price - y.price || x.name.localeCompare(y.name));
  const on = all.filter((i) => i.active), off = all.filter((i) => !i.active);
  const card = (it) => `<article class="rcard r-${it.rarity} ${it.active ? "" : "off"}">
    <div class="rcard-tools">${itemTools(it)}</div>
    <div class="r-frame">${rIco(it.icon)}</div>
    <b class="rname">${esc(it.name)}</b>${it.description ? `<span class="rdesc">${esc(it.description)}</span>` : ""}
    <div class="rmeta">${rarityChip(it.rarity)}${it.category ? `<span>${esc(it.category)}</span>` : ""}</div>
    <div class="rfoot">${goldAmt(it.price)}${buyBtn(it, b)}</div></article>`;
  return `<div class="top" style="align-items:center"><span style="color:var(--muted);font-size:14px">${on.length ? `${on.length} recompensa${on.length === 1 ? "" : "s"}` : ""}</span><button class="btn primary sm" data-item-new="reward">${ico("plus")} Nueva recompensa</button></div>
  ${on.length ? `<div class="rgrid">${on.map(card).join("")}</div>` : `<section class="panel"><div class="empty">${ico("shop")}<div>Tu tienda está vacía. Crea recompensas que te motiven: una película, una salida, un día de descanso.</div><button class="btn primary" data-item-new="reward">${ico("plus")} Crear recompensa</button></div></section>`}
  ${off.length ? `<details class="off-list"><summary>Inactivas (${off.length})</summary><div class="rgrid">${off.map(card).join("")}</div></details>` : ""}`;
}
function shopWishlist(b) {
  const all = live(E().items).filter((i) => i.item_type === "wishlist");
  const on = all.filter((i) => i.active).sort((x, y) => (y.is_primary_goal - x.is_primary_goal) || x.price - y.price), off = all.filter((i) => !i.active);
  const card = (it) => {
    const pct = Math.max(0, Math.min(b / it.price, 1)), miss = it.price - Math.max(b, 0);
    return `<article class="wcard r-${it.rarity} ${it.is_primary_goal ? "primary" : ""} ${it.active ? "" : "off"}">
    ${it.is_primary_goal ? `<div class="eyebrow gold-eye">Objetivo principal</div>` : ""}
    <div class="wrow"><div class="r-frame">${rIco(it.icon)}</div>
    <div class="wmain"><div class="wtitle"><b class="rname">${esc(it.name)}</b>${rarityChip(it.rarity)}</div>${it.description ? `<span class="rdesc">${esc(it.description)}</span>` : ""}
    ${it.active ? `<div class="xpbar thin goldbar"><i style="width:${pct * 100}%"></i></div><div class="goal-h"><span class="num">${miss > 0 ? `Te faltan ${nf(miss)} Oro` : "Ya te alcanza"}</span><span class="num">${Math.floor(pct * 100)} %</span></div>` : `<span class="rdesc">Conseguido o desactivado</span>`}</div>
    <div class="wprice">${goldAmt(it.price)}</div></div>
    <div class="wactions">${it.active && b >= it.price ? buyBtn(it, b) : ""}${it.active && !it.is_primary_goal ? `<button class="btn sm" data-primary="${it.id}">Fijar como objetivo</button>` : ""}<span class="act-r" style="margin-left:auto">${itemTools(it)}</span></div></article>`;
  };
  return `<div class="top" style="align-items:center"><span style="color:var(--muted);font-size:14px">Cosas grandes para las que ahorras. El Oro no se reserva: sigue disponible.</span><button class="btn primary sm" data-item-new="wishlist">${ico("plus")} Nuevo deseo</button></div>
  ${on.length ? `<div class="wlist">${on.map(card).join("")}</div>` : `<section class="panel"><div class="empty">${ico("star")}<div>Agrega algo grande para lo que quieras ahorrar y fíjalo como objetivo principal.</div><button class="btn primary" data-item-new="wishlist">${ico("plus")} Crear deseo</button></div></section>`}
  ${off.length ? `<details class="off-list"><summary>Conseguidos o inactivos (${off.length})</summary><div class="wlist">${off.map(card).join("")}</div></details>` : ""}`;
}
function shopHistory() {
  const ps = [...E().purchases.values()].sort((a, b) => b.purchased_at.localeCompare(a.purchased_at));
  if (!ps.length) return `<section class="panel"><div class="empty">${ico("scroll")}<div>Todavía no compraste recompensas.</div></div></section>`;
  const why = { balance: "No alcanzaba el Oro", inactive: "Estaba desactivada", deleted: "Estaba eliminada", not_found: "No se encontró" };
  const { y, m } = curMonth(), pre = `${y}-${pad(m)}`;
  const monthSpent = ps.filter((p) => p.status !== "rejected" && p.purchased_at.slice(0, 7) === pre).reduce((t, p) => t + p.price, 0);
  return `<section class="panel"><div class="panel-h"><h2>Historial de recompensas</h2><span class="chip num">${nf(monthSpent)} Oro este mes</span></div><div class="hist">
  ${ps.map((p) => `<div class="hrow r-${p.item_rarity} ${p.status}"><span class="hdate num">${fmtShort(keyOf(new Date(p.purchased_at)))} ${new Date(p.purchased_at).getFullYear()}</span>
    <div class="r-frame xs">${rIco(p.item_icon)}</div><div class="hname"><b>${esc(p.item_name)}</b>${rarityChip(p.item_rarity)}${p.status === "pending" && signedIn() ? `<span class="chip">Por confirmar</span>` : ""}${p.status === "rejected" ? `<span class="hwhy">${why[p.reason] || "Rechazada"} · no se cobró</span>` : ""}</div>
    <span class="hprice num">−${nf(p.price)}</span></div>`).join("")}</div></section>`;
}
function openItemEditor(type, id) {
  const it = id ? E().items.get(id) : null;
  dlg = { type: "item", id, f: it ? { ...it } : { item_type: type, name: "", description: "", price: type === "wishlist" ? 500 : 50, icon: type === "wishlist" ? "star" : "gift", rarity: type === "wishlist" ? "legendary" : "common", category: "", active: true }, err: "" };
  renderModal(); setTimeout(() => document.getElementById("iName")?.focus(), 30);
}
function readItemForm() {
  const f = dlg.f, g = (i) => document.getElementById(i);
  if (!g("iName")) return;
  f.name = g("iName").value; f.description = g("iDesc").value; f.price = g("iPrice").value; f.category = g("iCat").value; f.active = g("iActive").checked;
}
function itemForm() {
  const f = dlg.f;
  return `<form class="modal" id="itemForm" role="dialog" aria-modal="true" aria-labelledby="iH">
  <div><div class="eyebrow">${f.item_type === "wishlist" ? "Wishlist" : "Tienda"}</div><h2 id="iH">${dlg.id ? "Editar" : f.item_type === "wishlist" ? "Nuevo deseo" : "Nueva recompensa"}</h2></div>
  <div class="field"><label>Tipo</label><div class="seg two">${[["reward", "Recompensa"], ["wishlist", "Wishlist"]].map(([k, l]) => `<button type="button" data-itype="${k}" aria-pressed="${f.item_type === k}">${l}</button>`).join("")}</div></div>
  <div class="field"><label for="iName">Nombre</label><input class="inp" id="iName" maxlength="40" placeholder="${f.item_type === "wishlist" ? "Ej.: Auriculares nuevos" : "Ej.: Noche de película"}" value="${esc(f.name)}"></div>
  <div class="field"><label for="iDesc">Descripción (opcional)</label><input class="inp" id="iDesc" maxlength="120" value="${esc(f.description || "")}"></div>
  <div class="field"><label>Ícono</label><div class="icon-pick">${SHOP_ICONS.map((k) => `<button type="button" data-iicon="${k}" aria-pressed="${f.icon === k}" title="${SHOP_ICON_NAMES[k]}" aria-label="${SHOP_ICON_NAMES[k]}">${rIco(k)}</button>`).join("")}</div></div>
  <div class="field"><label>Rareza</label><div class="seg five">${Object.entries(RARITY).map(([k, r]) => `<button type="button" class="r-${k}" data-irar="${k}" aria-pressed="${f.rarity === k}">${r.name}<small>${r.hint}</small></button>`).join("")}</div><small style="color:var(--muted);font-size:12px">Los rangos de precio son una sugerencia: elige el precio que quieras.</small></div>
  <div class="row2"><div class="field"><label for="iPrice">Precio (Oro)</label><input class="inp num" id="iPrice" type="number" min="1" max="1000000" step="1" value="${esc(f.price)}"></div>
  <div class="field"><label for="iCat">Categoría (opcional)</label><input class="inp" id="iCat" maxlength="30" placeholder="Ej.: Ocio" value="${esc(f.category || "")}"></div></div>
  <label class="check"><input type="checkbox" id="iActive" ${f.active ? "checked" : ""}> Activa (se puede comprar)</label>
  ${dlg.err ? `<div class="err">${dlg.err}</div>` : ""}
  <div class="modal-f"><button type="button" class="btn ghost" data-dlg-close>Cancelar</button><button type="submit" class="btn primary">${dlg.id ? "Guardar cambios" : "Crear"}</button></div></form>`;
}
function saveItem() {
  readItemForm();
  const f = dlg.f, price = Math.round(+f.price), name = f.name.trim();
  if (!name) { dlg.err = "Escribe un nombre."; renderModal(); return; }
  if (!(price >= 1 && price <= 1000000)) { dlg.err = "El precio tiene que ser un número mayor que 0."; renderModal(); return; }
  const at = nowISO(), old = dlg.id ? E().items.get(dlg.id) : null;
  const row = { ...(old || { id: Store.newId(), is_primary_goal: false, created_at: at, deleted_at: null }),
    item_type: f.item_type, name: name.slice(0, 40), description: (f.description || "").trim().slice(0, 120), price, icon: f.icon, rarity: f.rarity,
    category: (f.category || "").trim().slice(0, 30) || null, active: !!f.active, updated_at: at };
  if (row.item_type !== "wishlist" || !row.active) row.is_primary_goal = false;
  dlg = null; renderModal();
  const rows = [row];
  // el primer deseo activo queda como objetivo principal
  if (!old && row.item_type === "wishlist" && row.active && !live(E().items).some((i) => i.is_primary_goal)) row.is_primary_goal = true;
  state.shopTab = row.item_type === "wishlist" ? "wishlist" : "rewards";
  putItems(rows); toast(old ? "Guardado." : row.item_type === "wishlist" ? "Deseo agregado a tu Wishlist." : "Recompensa creada.");
}
function putItems(rows) {
  for (const r of rows) E().items.set(r.id, r);
  Store.put("items", rows).then(() => Sync.changed()).catch(() => toast("No se pudo guardar en este dispositivo."));
  render();
}
function setPrimary(id) {
  const at = nowISO(), rows = [];
  for (const i of live(E().items)) if (i.is_primary_goal && i.id !== id) rows.push({ ...i, is_primary_goal: false, updated_at: at });
  const it = E().items.get(id); if (!it) return;
  rows.push({ ...it, is_primary_goal: true, active: true, updated_at: at });
  putItems(rows); toast(`Ahorrando para <b>${esc(it.name)}</b>`);
}
function toggleItem(id) {
  const it = E().items.get(id); if (!it) return;
  putItems([{ ...it, active: !it.active, is_primary_goal: it.active ? false : it.is_primary_goal, updated_at: nowISO() }]);
}
function deleteItem(id) {
  const it = E().items.get(id); if (!it) return;
  state.confirmItem = null; const at = nowISO();
  putItems([{ ...it, deleted_at: at, is_primary_goal: false, updated_at: at }]);
}
function askBuy(id) {
  const it = E().items.get(id), b = goldNow().balance;
  if (!it || !it.active || it.deleted_at) return;
  if (b < 0) { toast("Tu saldo está en rojo: la tienda se desbloquea al volver a 0."); return; }
  if (b < it.price) { toast(`Te faltan <b>${nf(it.price - b)} Oro</b>.`); return; }
  openDlg({ type: "buy", id });
}
function doBuy() {
  if (!dlg || dlg.type !== "buy" || dlg.busy) return;                                // doble clic
  dlg.busy = true;
  const it = E().items.get(dlg.id), b = goldNow().balance;
  if (!it || !it.active || it.deleted_at || b < it.price || b < 0) { dlg = null; renderModal(); render(); return; }
  const at = nowISO(), id = Store.newId();
  const p = { id, item_id: it.id, item_type: it.item_type, item_name: it.name, item_icon: it.icon, item_rarity: it.rarity, price: it.price, status: "pending", reason: null, purchased_at: at, updated_at: at };
  const op = { key: "buy:" + id, kind: "buy", id, item_id: it.id, price: it.price, name: it.name, at, seq: Date.now() };
  E().purchases.set(id, p); E().ops.push(op);
  Promise.all([Store.put("purchases", [p], { pending: false }), Store.putOp(op)]).then(() => Sync.changed(300)).catch(() => toast("No se pudo guardar la compra en este dispositivo."));
  if (it.item_type === "wishlist") putItems([{ ...it, active: false, is_primary_goal: false, updated_at: at }]);   // deseo cumplido
  openDlg({ type: "reward", id }); goldToast(-it.price); render();
}

/* ============ Ventanas ============ */
function dlgHTML() {
  const d = dlg; let inner = "";
  if (d.type === "item") inner = itemForm();
  else if (d.type === "goal") inner = goalForm();
  else if (d.type === "buy") {
    const it = E().items.get(d.id), b = goldNow().balance;
    inner = `<div class="modal center r-${it.rarity}" role="dialog" aria-modal="true" aria-labelledby="bH"><div class="r-frame lg">${rIco(it.icon)}</div>
    <h2 id="bH">¿Canjear ${esc(it.name)}?</h2><div class="buy-sum"><span>Precio</span>${goldAmt(it.price)}<span>Saldo después</span>${goldAmt(b - it.price)}</div>
    <div class="modal-f"><button type="button" class="btn ghost" data-dlg-close>Cancelar</button><button type="button" class="btn gold" id="buyYes" ${d.busy ? "disabled" : ""}>Canjear</button></div></div>`;
  } else if (d.type === "reward") {
    const p = E().purchases.get(d.id);
    inner = `<div class="modal center unlock r-${p.item_rarity}" role="dialog" aria-modal="true" aria-labelledby="rH"><div class="eyebrow gold-eye">Recompensa desbloqueada</div>
    <div class="r-frame lg glow">${rIco(p.item_icon)}</div><h2 id="rH">${esc(p.item_name)}</h2>${rarityChip(p.item_rarity)}<div class="big-gold neg">−${nf(p.price)} Oro</div>
    ${signedIn() ? `<small class="muted-s">Se confirma con tu cuenta al sincronizar.</small>` : ""}
    <div class="modal-f" style="justify-content:center"><button type="button" class="btn gold" data-dlg-close>Disfrutar</button></div></div>`;
  } else if (d.type === "chest") {
    const c = CHESTS.find((x) => x.level === d.level);
    inner = `<div class="modal center unlock" role="dialog" aria-modal="true" aria-labelledby="cH"><div class="eyebrow gold-eye">Cofre desbloqueado</div>
    <div class="chest-big">${chestSVG("anim")}</div><h2 id="cH">${c.name}</h2><span class="muted-s">Nivel ${c.level}</span><div class="big-gold">+${nf(c.gold)} Oro</div>
    ${signedIn() && !navigator.onLine ? `<small class="muted-s">Por confirmar: se confirma al volver la conexión.</small>` : ""}
    <div class="modal-f" style="justify-content:center"><button type="button" class="btn gold" data-dlg-close>Guardar en el tesoro</button></div></div>`;
  } else if (d.type === "goalDone") {
    const g = E().goals.get(d.id); if (!g) return "";
    inner = `<div class="modal center unlock" role="dialog" aria-modal="true" aria-labelledby="oH"><div class="eyebrow gold-eye">Objetivo completado</div>
    <div class="seal-big">${ico("target")}</div><h2 id="oH">${esc(g.title)}</h2>
    <div class="modal-f" style="justify-content:center">${g.coin_reward ? `<button type="button" class="btn ghost" data-dlg-close>Después</button><button type="button" class="btn gold" data-claim="${g.id}">Reclamar +${nf(g.coin_reward)} Oro</button>` : `<button type="button" class="btn gold" data-dlg-close>Genial</button>`}</div></div>`;
  } else inner = extraDlg(d);   // Boss y Perfil (boss.js, personaje.js)
  if (!inner) return "";
  return `<div class="scrim" id="dlgScrim">${inner}</div>`;
}

/* ============ Perfil y Estadísticas ============ */
function treasurePanel(s) {
  if (state.demo) return "";
  const g = goldNow(), bought = [...E().purchases.values()].filter((p) => p.status !== "rejected").length;
  const goalsDone = live(E().goals).filter((x) => x.claimed_at || E().ops.some((o) => o.kind === "claim" && o.goal_id === x.id)).length;
  const chests = chestList(s.G.level, E()).filter((c) => c.status === "opened" || c.status === "opening").length;
  return `<section class="panel"><div class="panel-h"><h2>Tesoro</h2>${goldAmt(g.balance)}</div>
  <div class="tstats"><div><b class="num">${nf(g.earned)}</b><span>Oro ganado en total</span></div><div><b class="num">${nf(g.spent)}</b><span>Oro gastado</span></div>
  <div><b class="num ${g.balance < 0 ? "neg" : ""}">${g.balance < 0 ? "−" + nf(-g.balance) : nf(g.balance)}</b><span>Saldo actual</span></div><div><b class="num">${bought}</b><span>Recompensas compradas</span></div>
  <div><b class="num">${goalsDone}</b><span>Objetivos completados</span></div><div><b class="num">${chests} / ${CHESTS.length}</b><span>Cofres abiertos</span></div></div>
  <table class="rules" style="margin-top:14px"><tr><th>Cómo se gana Oro</th><th>Oro</th></tr>
  <tr><td>Cada actividad</td><td class="num">XP ÷ 10 (mínimo 1)</td></tr><tr><td>Día completo</td><td class="num">+${GOLD_FULL_DAY}</td></tr>
  <tr><td>Racha de 7, 14, 21… días</td><td class="num">+${GOLD_STREAK}</td></tr><tr><td>Objetivo mensual</td><td>Su recompensa, al reclamarlo</td></tr>
  <tr><td>Cofres por nivel</td><td class="num">${CHESTS.map((c) => c.level).join(", ")}</td></tr></table></section>`;
}
function goldStats() {
  if (state.demo) return "";
  const T = todayKey(), months = [...Array(6)].map((_, i) => { const d = new Date(+T.slice(0, 4), +T.slice(5, 7) - 6 + i, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; });
  const inM = months.map(() => 0), outM = months.map(() => 0);
  for (const c of E().coins.values()) { if (c.deleted_at) continue; const i = months.indexOf(c.created_at.slice(0, 7)); if (i < 0) continue; if (c.amount > 0) inM[i] += c.amount; else outM[i] -= c.amount; }
  const top = Math.max(50, ...inM, ...outM), W = 720, H = 200, L = 40, B = 24, gw = (W - L - 8) / 6, bw = Math.min(28, gw / 3);
  let bars = "", grid = "";
  months.forEach((m, i) => {
    const x = L + i * gw + gw / 2, h1 = inM[i] / top * (H - B - 12), h2 = outM[i] / top * (H - B - 12);
    bars += `<rect x="${x - bw - 2}" y="${H - B - h1}" width="${bw}" height="${h1}" rx="2" fill="var(--gold)"><title>${nf(inM[i])} Oro ganado</title></rect><rect x="${x + 2}" y="${H - B - h2}" width="${bw}" height="${h2}" rx="2" fill="var(--violet)"><title>${nf(outM[i])} Oro gastado</title></rect>`;
    bars += `<text x="${x}" y="${H - 6}" text-anchor="middle">${new Date(+m.slice(0, 4), +m.slice(5) - 1, 1).toLocaleDateString("es", { month: "short" })}</text>`;
  });
  for (let g = 0; g <= 4; g++) { const v = Math.round(top / 4 * g), y = H - B - v / top * (H - B - 12); grid += `<line x1="${L}" x2="${W}" y1="${y}" y2="${y}" stroke="var(--line)"/><text x="${L - 6}" y="${y + 4}" text-anchor="end">${v}</text>`; }
  const gDone = months.map((m) => live(E().goals).filter((g) => `${g.year}-${pad(g.month)}` === m && (g.claimed_at || goalProgress(g, state.days) >= g.target_value)).length), maxG = Math.max(1, ...gDone);
  const cnt = new Map(); for (const p of E().purchases.values()) if (p.status !== "rejected") cnt.set(p.item_name, (cnt.get(p.item_name) || 0) + 1);
  const best = [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5), maxB = Math.max(1, ...best.map((x) => x[1]));
  const mLabel = (m) => cap(new Date(+m.slice(0, 4), +m.slice(5) - 1, 1).toLocaleDateString("es", { month: "long" }));
  return `<section class="panel"><div class="panel-h"><h2>Oro por mes</h2><div class="legend" style="margin:0"><span><i style="background:var(--gold)"></i>Ganado</span><span><i style="background:var(--violet)"></i>Gastado</span></div></div>
  <div style="overflow-x:auto"><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Oro ganado y gastado por mes, últimos 6 meses">${grid}${bars}</svg></div></section>
  <div class="grid2"><section class="panel"><div class="panel-h"><h2>Objetivos completados por mes</h2></div><div class="hbars">${months.map((m, i) => `<div class="hbar"><span>${mLabel(m)}</span><div class="track"><i style="width:${gDone[i] / maxG * 100}%;background:var(--gold)"></i></div><span class="v num">${gDone[i]}</span></div>`).join("")}</div></section>
  <section class="panel"><div class="panel-h"><h2>Recompensas más compradas</h2></div>${best.length ? `<div class="hbars">${best.map(([n, c]) => `<div class="hbar wide"><span>${esc(n)}</span><div class="track"><i style="width:${c / maxB * 100}%;background:var(--violet)"></i></div><span class="v num">${c} ${c === 1 ? "vez" : "veces"}</span></div>`).join("")}</div>` : `<div class="empty" style="padding:10px">Todavía no compraste recompensas.</div>`}</section></div>`;
}

/* ============ Mantener el Oro y los objetivos al día ============ */
/** Recalcula el Oro derivado y el estado completado de los objetivos. Solo escribe lo que cambió. */
function syncEconomy(celebrate) {
  if (!state.ready) return;
  const at = nowISO(), Eco = E();
  const coins = reconcileGold(derivedGold(state.days), [...Eco.coins.values()], at);
  if (coins.length) {
    for (const r of coins) Eco.coins.set(r.id, r);
    Store.put("coins", coins).then(() => Sync.changed()).catch(() => {});
  }
  const goals = []; let done = null;
  for (const g of Eco.goals.values()) {
    if (g.deleted_at || g.claimed_at) continue;
    const v = goalProgress(g, state.days), claiming = Eco.ops.some((o) => o.kind === "claim" && o.goal_id === g.id);
    if (v >= g.target_value && !g.completed_at) { goals.push({ ...g, completed_at: at, updated_at: at }); done = done || g; }
    else if (v < g.target_value && g.completed_at && !claiming) goals.push({ ...g, completed_at: null, updated_at: at });
  }
  if (goals.length) {
    for (const g of goals) Eco.goals.set(g.id, g);
    Store.put("goals", goals).then(() => Sync.changed()).catch(() => {});
  }
  if (celebrate && done && !dlg && !form) openDlg({ type: "goalDone", id: done.id });
}
function onSyncNotice(n) {
  const name = n.op && n.op.name ? `<b>${esc(n.op.name)}</b>` : "la recompensa";
  if (n.type === "buy_rejected") {
    const r = { balance: `No alcanzaba el Oro para ${name}; se devolvieron ${nf(n.op.price)} Oro.`, inactive: `${name} estaba desactivada en otro dispositivo; no se cobró.`, deleted: `${name} estaba eliminada en otro dispositivo; no se cobró.` };
    toast(r[n.reason] || `La compra de ${name} no se confirmó; no se cobró.`, "lvl");
  } else if (n.type === "buy_failed") toast(`No se encontró ${name} en tu cuenta; no se cobró.`, "lvl");
  else if (n.type === "chest_failed") toast(`Tu cuenta todavía no llega al nivel ${n.op.level}: el cofre se cerró de nuevo.`, "lvl");
  else if (n.type === "claim_failed") toast(`No se pudo reclamar <b>${esc(n.op.title || "el objetivo")}</b>: todavía no figura completado en tu cuenta.`, "lvl");
}

/* ============ Eventos ============ */
document.addEventListener("click", (e) => {
  const t = e.target.closest("button,summary"); if (!t || !t.dataset) return;
  const D = t.dataset;
  if (D.dlgClose !== undefined) { closeDlg(); return; }
  if (D.shoptab) { state.shopTab = D.shoptab; state.confirmItem = null; render(); return; }
  if (D.shopgo) { state.shopTab = D.shopgo; go("tienda"); return; }
  if (D.itemNew) { openItemEditor(D.itemNew); return; }
  if (D.itemEdit) { openItemEditor(null, D.itemEdit); return; }
  if (D.itemToggle) { toggleItem(D.itemToggle); return; }
  if (D.itemAskdel) { state.confirmItem = D.itemAskdel; render(); return; }
  if (D.itemNodel !== undefined) { state.confirmItem = null; render(); return; }
  if (D.itemDel) { deleteItem(D.itemDel); return; }
  if (D.primary) { setPrimary(D.primary); return; }
  if (D.buy) { askBuy(D.buy); return; }
  if (t.id === "buyYes") { doBuy(); return; }
  if (D.chest) { t.disabled = true; openChest(+D.chest); return; }
  if (D.claim) { t.disabled = true; claimGoal(D.claim); return; }
  if (D.gmonth) { state.goalMonth = D.gmonth; state.confirmGoal = null; render(); return; }
  if (D.goalNew) { openGoalEditor(D.goalNew); return; }
  if (D.goalEdit) { openGoalEditor(null, D.goalEdit); return; }
  if (D.goalAskdel) { state.confirmGoal = D.goalAskdel; render(); return; }
  if (D.goalNodel !== undefined) { state.confirmGoal = null; render(); return; }
  if (D.goalDel) { const g = E().goals.get(D.goalDel); state.confirmGoal = null; if (g) { const at = nowISO(); putGoals([{ ...g, deleted_at: at, updated_at: at }]); } return; }
  if (D.manual) {
    const [id, n] = D.manual.split("|"), g = E().goals.get(id);
    if (g && !g.claimed_at) putGoals([{ ...g, manual_progress: Math.max(0, (g.manual_progress || 0) + +n), updated_at: nowISO() }]);
    return;
  }
  if (dlg && dlg.type === "item") {
    if (D.itype) { readItemForm(); dlg.f.item_type = D.itype; renderModal(); return; }
    if (D.iicon) { readItemForm(); dlg.f.icon = D.iicon; renderModal(); return; }
    if (D.irar) { readItemForm(); dlg.f.rarity = D.irar; renderModal(); return; }
  }
  if (dlg && dlg.type === "goal") {
    if (D.gcat) { readGoalForm(); dlg.f.category = D.gcat; if (dlg.f.autoTitle) dlg.f.title = suggestTitle(dlg.f.goal_type, dlg.f.category, dlg.f.target); renderModal(); return; }
    if (D.gpreset) {
      readGoalForm(); const p = GOAL_PRESETS.find((x) => x.id === D.gpreset);
      Object.assign(dlg.f, { goal_type: p.goal_type, category: p.category, autoTitle: true }); dlg.f.title = suggestTitle(p.goal_type, p.category, dlg.f.target); renderModal(); return;
    }
  }
});
document.addEventListener("change", (e) => {
  if (e.target.id === "gType" && dlg && dlg.type === "goal") {
    readGoalForm(); const f = dlg.f; f.goal_type = e.target.value;
    if (GOAL_TYPES[f.goal_type].cat && !f.category) f.category = "curso";
    if (f.goal_type === "manual" && f.autoTitle) { f.title = ""; f.autoTitle = false; }
    if (f.autoTitle) f.title = suggestTitle(f.goal_type, f.category, f.target);
    renderModal();
  }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "gTarget" && dlg && dlg.type === "goal" && dlg.f.autoTitle) {
    dlg.f.target = e.target.value; const t = document.getElementById("gTitle");
    if (t) { dlg.f.title = suggestTitle(dlg.f.goal_type, dlg.f.category, dlg.f.target); t.value = dlg.f.title; }
  }
});
document.addEventListener("submit", (e) => {
  if (e.target.id === "itemForm") { e.preventDefault(); saveItem(); }
  if (e.target.id === "goalForm") { e.preventDefault(); saveGoal(); }
});
