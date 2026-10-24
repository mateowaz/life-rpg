/* Life RPG — Plan del Día: la sección de Hoy, sus hojas (Bottom Sheets) y las preferencias de Perfil.
   Diseñado para celular: una sola columna, botones de 44 px o más, hojas desde abajo y nada detrás de la barra inferior.
   Las reglas están en dayplan.js. Iniciar enfoque y Completar son los del Planificador (data-pstart y openPlanComplete):
   el plan no da XP ni marca nada por sí mismo. */

/* ============ Datos ============ */
const dpOn = () => dpPrefs(state.profile.day_plan_prefs).enabled;
const dpRow = (k) => { const r = state.dayplans && state.dayplans.get(dpId(k)); return r && !r.deleted_at ? r : null; };
const dpAccepted = (k) => { const r = dpRow(k); return r && r.accepted_at ? r : null; };
const dpNowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const dpIsDone = (id) => !!planAct({ id });
const dpActMin = (id) => planAct({ id })?.minutes || 0;
const dpDebug = () => /[?&]debug=plan\b/.test(location.hash) || /[?&]debug=plan\b/.test(location.search);
/** Objetivos del mes y Boss, como señales: el progreso sale siempre de las actividades (goalProgress / bossInfo) */
function dpSignals() {
  const c = curMonth(), goals = [];
  for (const g of state.eco.goals.values()) {
    if (g.deleted_at || g.year !== c.y || g.month !== c.m || g.claimed_at) continue;
    const v = goalProgress(g, state.days);
    goals.push({ id: g.id, title: g.title, goal_type: g.goal_type, category: g.category || null, target: g.target_value, progress: v, label: `${g.title}: ${goalNumbers(g, v)}` });
  }
  let boss = null;
  const b = bossFor(c.y, c.m);
  if (b && b.boss_type !== "manual") { const i = bossInfo(b); if (i.st === "active" || i.st === "weak") boss = { id: b.id, name: b.name, goal_type: b.boss_type, category: b.category || null, left: i.left, hp: i.hp }; }
  return { goals, boss };
}
function dpInput(settings, extra = {}) {
  const s = dpSignals();
  return { today: todayKey(), now: dpNowMin(), plans: state.plans.values(), routines: state.routines, isDone: dpIsDone, goals: s.goals, boss: s.boss,
    settings, prefs: dpPrefs(state.profile.day_plan_prefs), ...extra };
}
/** Ajustes del día: los del plan guardado, o los de la propuesta, o los habituales de Perfil */
function dpSettings() {
  if (state.dpSet && state.dpSet.date === todayKey()) return state.dpSet;
  const P = dpPrefs(state.profile.day_plan_prefs), r = dpRow(todayKey());
  const focus = r ? { kind: r.focus_kind, ref: r.focus_ref } : P.focus === "auto" ? { kind: "auto" } : { kind: "category", ref: P.focus };
  state.dpSet = { date: todayKey(), minutes: r ? r.available_minutes : P.minutes, energy: r ? r.energy : P.energy, focus };
  return state.dpSet;
}
const dpFocusName = (f) => {
  if (!f || f.kind === "auto") return "";
  if (f.kind === "category" && CAT[f.ref]) return CAT[f.ref].name;
  if (f.kind === "goal") { const g = state.eco.goals.get(f.ref); return g ? g.title : ""; }
  if (f.kind === "boss") return "Boss";
  return "";
};
const dpSumText = (S, label = "disponibles") => `${dpDur(S.minutes)} ${label} · Energía ${DP_ENERGY_NAME[S.energy].toLowerCase()}${dpFocusName(S.focus) ? ` · Foco: ${esc(dpFocusName(S.focus))}` : ""}`;
function putDayPlans(rows) {
  for (const r of rows) state.dayplans.set(r.id, r);
  Store.put("dayplans", rows).then(() => Sync.changed()).catch(() => toast("No se pudo guardar en este dispositivo."));
  render();
}

/* ============ Propuesta ============ */
/** Calcula (o recalcula) la propuesta en memoria. Nada se guarda hasta tocar Aceptar plan. */
function dpPropose({ reorg = false } = {}) {
  const T = todayKey(), S = dpSettings(), acc = dpAccepted(T), old = state.dp && state.dp.date === T ? state.dp : null;
  const removed = [...new Set([...(acc ? acc.removed : []), ...(old ? old.removed : [])])];
  const keepDone = acc ? dpProgress(acc, state.plans, dpIsDone, dpActMin).done.map((x) => ({ id: x.id, m: x.m })) : [];
  const forced = old ? old.forced.filter((id) => !removed.includes(id)) : [], overrides = old ? old.overrides : {};
  const res = buildDayPlan(dpInput(S, { removed, forced, overrides }));
  state.dp = { date: T, removed, forced, overrides, keepDone, reorg: reorg || (old && old.reorg) || false, res, list: res.items.map((x) => ({ id: x.id, m: x.m })), sugOff: old ? old.sugOff : [] };
  render();
}
/** Sigue abierta: existe, no se borró, está planificada y todavía no tiene actividad (la propuesta puede quedar vieja si se completa algo mientras tanto) */
const dpOpenItem = (x) => { const p = state.plans.get(x.id); return !!p && !p.deleted_at && p.status === "planned" && !dpIsDone(p.id); };
const dpCur = () => (state.dp && state.dp.date === todayKey() ? state.dp : null);
/** La lista que se está mirando o ajustando: la propuesta o el plan aceptado */
function dpList() {
  const d = dpCur(); if (d) return d.list;
  const r = dpAccepted(todayKey()); return r ? r.items : [];
}
function dpSetList(list, removedAdd) {
  const d = dpCur();
  if (d) { d.list = list; if (removedAdd) d.removed = [...new Set([...d.removed, removedAdd])]; render(); if (dlg && dlg.type === "dpAdjust") renderModal(); return; }
  const r = dpAccepted(todayKey()); if (!r) return;
  putDayPlans([{ ...r, items: list.slice(0, 30), removed: removedAdd ? [...new Set([...r.removed, removedAdd])].slice(0, 100) : r.removed, updated_at: nowISO() }]);
  if (dlg && dlg.type === "dpAdjust") renderModal();
}
/** Razones de una misión con los datos de ahora (también para el plan aceptado) */
function dpExplain(id) {
  const d = dpCur(); if (d && d.res.byId.get(id)) return d.res.byId.get(id);
  const res = buildDayPlan(dpInput(dpSettings(), { removed: [], forced: [id] }));
  return res.byId.get(id) || null;
}

/* ============ Aceptar ============ */
function dpAccept() {
  const d = dpCur(); if (!d) return;
  const ahead = dpAheadIds(d.list.filter(dpOpenItem), state.plans, todayKey());
  if (!ahead.length) { dpFinishAccept({}); return; }   // sin adelantadas: se acepta directo, sin otra pregunta
  dlg = { type: "dpAhead", ids: ahead, i: 0, choices: {} }; renderModal();
}
function dpAheadChoice(v) {
  if (!dlg || dlg.type !== "dpAhead") return;
  dlg.choices[dlg.ids[dlg.i]] = v; dlg.i++;
  if (dlg.i < dlg.ids.length) { renderModal(); return; }
  const ch = dlg.choices; dlg = null; renderModal();
  dpFinishAccept(ch);
}
function dpFinishAccept(choices) {
  const d = dpCur(); if (!d) return;
  const T = todayKey(), at = nowISO(), S = dpSettings();
  const { planRows, row } = dpAcceptRows(d.list.filter(dpOpenItem), { today: T, at, plans: state.plans, settings: S, removed: d.removed, prev: dpRow(T), choices, done: d.keepDone });
  if (planRows.length) putPlans(planRows);                      // Mover a hoy: el mismo Reprogramar del Planificador
  state.dp = null;
  const prog = dpProgress(row, state.plans, dpIsDone, dpActMin);
  state.dpReady = { n: prog.pending.length, m: prog.pending.reduce((t, x) => t + x.m, 0), until: Date.now() + 3000 };
  putDayPlans([row]);
  setTimeout(() => { if (state.dpReady && Date.now() >= state.dpReady.until) { state.dpReady = null; if (state.route === "hoy") render(); } }, 3100);
}

/* ============ Sección de Hoy ============ */
function dpSection() {
  if (!state.ready || !dpOn()) return "";
  const T = todayKey(), d = dpCur(), acc = dpAccepted(T);
  const y = dpYesterday();
  if (d) return y + dpProposalView(d);
  if (acc) return y + dpAcceptedView(acc);
  return y + dpSetupView();
}
/** Plan de ayer sin cerrar: aparece una vez, chico */
function dpYesterday() {
  const k = addDays(todayKey(), -1), r = dpAccepted(k); if (!r || r.closed_at) return "";
  const pr = dpProgress(r, state.plans, dpIsDone, dpActMin); if (!pr.count) return "";
  return `<div class="dp-yday"><span>Plan de ayer: <b class="num">${pr.done.length} / ${pr.count}</b> completadas</span>
  <span class="dp-yday-b">${pr.pending.length ? `<button class="btn sm ghost" data-dpmove="${pr.pending[0].id}">Mover pendiente</button>` : ""}<button class="btn sm ghost" data-dpclose="${k}">Cerrar</button></span></div>`;
}
function dpSetupView() {
  const T = todayKey(), S = dpSettings(), first = ![...state.dayplans.values()].some((r) => !r.deleted_at && r.accepted_at);
  if (state.dpHide === T) return `<div class="dp-mini"><span>${ico("plan")} Plan del día</span><button class="btn sm" data-dpgen>Crear plan</button></div>`;
  return `<section class="panel dp dp-setup" aria-labelledby="dpH"><div class="dp-h"><span class="eyebrow" id="dpH">Plan del día</span>
    <button class="icon-btn" data-dphide aria-label="Ocultar por hoy">${ico("x")}</button></div>
    ${first ? `<p class="dp-q"><b>¿Querés que Life RPG organice tu día?</b><span>Decime cuánto tiempo tenés y te propone qué hacer.</span></p>` : ""}
    <button class="dp-sum" data-dpset="gen"><span>${dpSumText(S)}</span><em>Cambiar</em></button>
    <button class="btn primary dp-main" data-dpgen>${first ? "Crear plan" : "Generar plan"}</button></section>`;
}
function dpRowHTML(x, { done = false, why = true } = {}) {
  const p = state.plans.get(x.id); if (!p) return "";
  const T = todayKey(), a = dpAttrs(p, state.routines), c = dpCur()?.res.byId.get(x.id);
  const meta = [];
  if (p.date === T && p.time) meta.push(`<span class="num">${p.time.slice(0, 5)}</span>`);
  meta.push(CAT[p.category].name);
  if (x.m < p.planned_minutes && a.mode === "flexible") meta.push(`de ${p.planned_minutes} min`);
  const ahead = p.date > T, late = p.date < T;
  return `<li><button class="dp-row c-${p.category}${done ? " is-done" : ""}" ${why ? `data-dpwhy="${p.id}"` : "disabled"}>
    <span class="dp-ico">${done ? ico("check") : ico(p.category)}</span>
    <span class="dp-t"><b>${rtIco(p)}${esc(p.title)}</b><small>${meta.join(" · ")}</small>
    ${ahead ? `<span class="dp-tag">Adelantada</span><small class="dp-orig">Planeada originalmente para ${dpDayWord(T, p.date)}</small>` : ""}
    ${late ? `<small class="dp-orig">Pendiente desde ${dpDayWord(T, p.date)}</small>` : ""}
    ${c && c.defeat && !done ? `<small class="dp-boss">⚔ Esta misión podría derrotar al Boss</small>` : ""}</span>
    <span class="dp-m num">${done ? `${dpActMin(p.id)} min` : `${x.m} min`}</span></button></li>`;
}
function dpProposalView(d) {
  const S = dpSettings(), list = d.list.filter(dpOpenItem), total = list.reduce((t, x) => t + x.m, 0), free = Math.max(0, S.minutes - total);
  const crit = d.res.critOut.filter((id) => !list.some((x) => x.id === id)).map((id) => state.plans.get(id)).filter(Boolean);
  const sugs = d.res.suggestions.filter((s) => !d.sugOff.includes(s.key));
  const head = `<div class="dp-h"><span class="eyebrow">${d.reorg ? "Reorganizar resto del día" : "Plan del día"} · propuesta</span><button class="icon-btn" data-dpdiscard aria-label="Descartar propuesta">${ico("x")}</button></div>
    <button class="dp-sum" data-dpset="${d.reorg ? "reorg" : "regen"}"><span>${dpSumText(S, d.reorg ? "restantes" : "disponibles")}</span><em>Cambiar</em></button>`;
  const done = d.keepDone.length ? `<p class="dp-note">${d.keepDone.length} ya completada${d.keepDone.length === 1 ? "" : "s"}: quedan igual.</p>` : "";
  if (!list.length && !sugs.length) return `<section class="panel dp dp-prop">${head}${done}
    <div class="dp-empty"><b>No hay nada pendiente para ${d.reorg ? "el resto del día" : "hoy"}.</b><span>Tenés el tiempo libre. Si querés, planificá algo y volvé a generar.</span>
    <button class="btn" data-pnew="${todayKey()}">${ico("plus")} Planificar</button></div></section>`;
  return `<section class="panel dp dp-prop">${head}
    <div class="dp-total"><b class="num">${list.length} ${list.length === 1 ? "misión recomendada" : "misiones recomendadas"} · ${dpDur(total)}</b>${free ? `<span class="num">Tiempo libre: ${dpDur(free)}</span>` : ""}</div>
    ${done}
    ${crit.map((p) => `<div class="dp-crit"><span><b>${esc(p.title)}</b> (${p.planned_minutes} min) es Crítica y no entra en tu tiempo.</span><button class="btn sm" data-dpforce="${p.id}">Agregarla igual</button></div>`).join("")}
    ${list.length ? `<ol class="dp-list">${list.map((x) => dpRowHTML(x)).join("")}</ol>` : ""}
    ${sugs.map((s) => `<div class="dp-sug c-${s.category}"><span class="dp-tag sug">Sugerencia</span><b>${esc(s.title)}</b><small>${esc(s.why)}</small>
      <div class="dp-sug-b"><button class="btn sm ghost" data-dpsugoff="${s.key}">No, gracias</button><button class="btn sm" data-dpsug="${s.key}">${ico("plus")} Agregar al plan</button></div></div>`).join("")}
    <div class="dp-actions"><button class="btn primary dp-main" data-dpaccept ${list.length ? "" : "disabled"}>Aceptar plan</button><button class="btn" data-dpadjust>Ajustar</button></div></section>`;
}
function dpAcceptedView(r) {
  const T = todayKey(), now = dpNowMin(), pr = dpProgress(r, state.plans, dpIsDone, dpActMin);
  if (r.closed_at) return `<div class="dp-mini"><span>${ico("check")} Plan del día cerrado · <b class="num">${pr.done.length} / ${pr.count}</b></span></div>`;
  const ready = state.dpReady && Date.now() < state.dpReady.until ? `<div class="dp-ready" role="status"><b>Plan listo</b><span class="num">${state.dpReady.n} ${state.dpReady.n === 1 ? "misión" : "misiones"} · ${dpDur(state.dpReady.m)}</span></div>` : "";
  const end = pr.count && (!pr.pending.length || now >= 21 * 60);
  if (end) return `<section class="panel dp dp-end">${ready}<div class="dp-h"><span class="eyebrow">Plan del día</span></div>
    <b class="dp-big num">${pr.done.length} / ${pr.count} completadas</b>
    <div class="dp-kv"><span>Planeado</span><b class="num">${dpDur(pr.planned)}</b><span>Real</span><b class="num">${dpDur(pr.real)}</b></div>
    ${pr.pending.length ? `<p class="dp-note">Quedó pendiente: ${pr.pending.map((x) => esc(x.p.title)).join(", ")}</p><ol class="dp-list">${pr.pending.map((x) => dpRowHTML(x)).join("")}</ol>` : `<p class="dp-note">Hiciste todo lo que planeaste.</p>`}
    <div class="dp-actions"><button class="btn primary dp-main" data-dpclose="${T}">Cerrar día</button>${pr.pending.length ? `<button class="btn" data-dpmove="${pr.pending[0].id}">Mover pendiente</button>` : ""}</div></section>`;
  if (!pr.count) return `<section class="panel dp">${ready}<div class="dp-h"><span class="eyebrow">Plan del día</span></div><div class="dp-empty"><b>Tu plan quedó vacío.</b><span>Las misiones se completaron en otro lado o ya no están.</span><button class="btn" data-dpgen>Generar de nuevo</button></div></section>`;
  // AHORA: la que tiene enfoque en curso; si no, la primera pendiente
  const run = pr.pending.find((x) => fActiveFor(x.id)), now1 = run || pr.pending[0], rest = pr.pending.filter((x) => x !== now1);
  const p = now1.p, t = p.date === T ? dpMin(p.time) : null, soon = t !== null && t > now + 15 && !run;
  const behind = dpBehind(pr, now), sig = `${pr.done.length}|${pr.real}|${Math.floor(now / 30)}`;
  const left = Math.max(0, r.available_minutes - pr.real);
  const nudge = behind && state.dpNudgeOff !== sig ? `<div class="dp-nudge"><span>Quedan ${dpDur(left)} disponibles. ¿Reorganizar el resto?</span>
    <span class="dp-nudge-b"><button class="btn sm ghost" data-dpnudgeoff="${sig}">Ahora no</button><button class="btn sm" data-dpset="reorg">Reorganizar</button></span></div>` : "";
  const fm = Math.floor(planFocusSecs(p.id) / 60);
  return `${ready}<section class="dp-now c-${p.category}" aria-labelledby="dpNowH">
    <div class="dp-now-e" id="dpNowH">${soon ? `Próxima · <span class="num">${p.time.slice(0, 5)}</span>` : "Ahora"}</div>
    <button class="dp-now-main" data-dpwhy="${p.id}"><span class="dp-now-c">${ico(p.category)}${CAT[p.category].name}${p.date < T ? ` · pendiente desde ${dpDayWord(T, p.date)}` : ""}</span>
    <b class="dp-now-t">${rtIco(p)}${esc(p.title)}</b><span class="dp-now-m num">${now1.m} min${run ? ` · ${fm} enfocados` : ""}</span></button>
    <div class="dp-now-b"><button class="btn primary" data-pstart="${p.id}">${ico("play")} ${run ? "Ver enfoque" : "Iniciar enfoque"}</button><button class="btn" data-dpdone="${p.id}">Completar</button></div></section>
    <section class="panel dp dp-acc">${nudge}
    ${rest.length ? `<div class="dp-sub">Sigue</div><ol class="dp-list dp-next">${rest.map((x) => dpRowHTML(x)).join("")}</ol>` : `<p class="dp-note">Es la última misión de tu plan.</p>`}
    ${pr.done.length ? `<button class="old-late-h dp-donet" data-dpdonet aria-expanded="${!!state.dpDoneOpen}">${ico(state.dpDoneOpen ? "down" : "right")}<span>Hecho (${pr.done.length})</span></button>
      ${state.dpDoneOpen ? `<ol class="dp-list">${pr.done.map((x) => dpRowHTML(x, { done: true, why: false })).join("")}</ol>` : ""}` : ""}
    <div class="dp-actions two"><button class="btn" data-dpadjust>Ajustar</button><button class="btn" data-dpset="reorg">Reorganizar</button></div></section>`;
}
/** Misiones de hoy: con un plan aceptado queda plegada (para no ver lo mismo dos veces). Con el plan apagado, igual que siempre. */
function dpMissions() {
  const acc = dpOn() && dpAccepted(todayKey()) && !dpAccepted(todayKey()).closed_at;
  if (!acc) return planTodayPanel();
  const n = plansOn(todayKey()).length;
  return `<section class="panel dp-fold"><button class="old-late-h" data-dpmissions aria-expanded="${!!state.dpMisOpen}">${ico(state.dpMisOpen ? "down" : "right")}<span>Todas las misiones de hoy${n ? ` (${n})` : ""}</span></button></section>
  ${state.dpMisOpen ? planTodayPanel() : ""}`;
}

/* ============ Hojas (Bottom Sheets) ============ */
const dpSheet = (id, title, body, foot = "") => `<div class="modal dp-sheet" role="dialog" aria-modal="true" aria-labelledby="${id}"><div class="sheet-grab" aria-hidden="true"></div>
  <div class="dp-sheet-h"><h2 id="${id}">${title}</h2><button type="button" class="icon-btn" data-dlg-close aria-label="Cerrar">${ico("x")}</button></div>
  <div class="dp-sheet-b">${body}</div>${foot ? `<div class="dp-sheet-f">${foot}</div>` : ""}</div>`;
function dayPlanDlg(d) {
  if (d.type === "dpSet") return dpSetSheet(d);
  if (d.type === "dpWhy") return dpWhySheet(d);
  if (d.type === "dpAdjust") return dpAdjustSheet(d);
  if (d.type === "dpAhead") return dpAheadSheet(d);
  return "";
}
const DP_TIMES = [30, 60, 90, 120, 180, 240];
/** Tiempo, energía y foco. mode: gen (generar), regen (regenerar la propuesta) o reorg (reorganizar el resto del día) */
function dpOpenSet(mode) {
  const S = dpSettings(), T = todayKey();
  let min = S.minutes;
  if (mode === "reorg") { const r = dpAccepted(T); if (r) { const pr = dpProgress(r, state.plans, dpIsDone, dpActMin); min = Math.max(15, Math.round(Math.max(0, r.available_minutes - pr.real) / 15) * 15); } }
  dlg = { type: "dpSet", mode, f: { minutes: min, custom: !DP_TIMES.includes(min), energy: S.energy, focus: S.focus.kind === "auto" ? "auto" : `${S.focus.kind}:${S.focus.ref || ""}` }, err: "" };
  renderModal();
}
function dpSetSheet(d) {
  const f = d.f, c = curMonth(), title = d.mode === "reorg" ? "Reorganizar resto del día" : "Configurar el día";
  const goals = live(state.eco.goals).filter((g) => g.year === c.y && g.month === c.m && !g.claimed_at && GOAL_TYPES[g.goal_type] && g.goal_type !== "manual" && g.goal_type !== "streak");
  const boss = dpSignals().boss;
  const opts = [["auto", "Automático"], ...CATS.map((x) => [`category:${x.id}`, x.name]), ...goals.map((g) => [`goal:${g.id}`, `Objetivo: ${g.title}`]), ...(boss ? [["boss:", `Boss: ${boss.name}`]] : [])];
  const body = `<div class="field"><label>${d.mode === "reorg" ? "Tiempo restante" : "Tiempo disponible hoy"}</label>
    <div class="dp-chips">${DP_TIMES.map((m) => `<button type="button" data-dpmin="${m}" aria-pressed="${!f.custom && f.minutes === m}">${dpDur(m).replace(" min", "m").replace(" h", "h").replace("h 30m", "h 30")}</button>`).join("")}<button type="button" data-dpmin="custom" aria-pressed="${f.custom}">Otro</button></div>
    ${f.custom ? `<div class="dp-custom"><input class="inp num" id="dpMinC" type="number" inputmode="numeric" min="15" max="720" step="5" value="${esc(f.minutes)}" aria-label="Minutos"><span class="muted-s">minutos</span></div>` : ""}</div>
  <div class="field"><label>Energía</label><div class="seg three">${DP_ENERGY.map((e) => `<button type="button" data-dpen="${e}" aria-pressed="${f.energy === e}">${DP_ENERGY_NAME[e]}</button>`).join("")}</div></div>
  <div class="field"><label for="dpFocus">Foco principal (opcional)</label><select class="inp" id="dpFocus">${opts.map(([v, l]) => `<option value="${esc(v)}" ${f.focus === v || (v === "boss:" && f.focus.startsWith("boss")) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>
  ${d.err ? `<div class="err">${d.err}</div>` : ""}`;
  const btn = d.mode === "reorg" ? "Reorganizar" : d.mode === "regen" ? "Regenerar" : "Generar plan";
  return dpSheet("dpSetH", title, body, `<button type="button" class="btn primary dp-main" data-dpsetgo>${btn}</button>`);
}
function dpReadSet() { const d = dlg; if (!d || d.type !== "dpSet") return; const c = document.getElementById("dpMinC"); if (c && d.f.custom) d.f.minutes = c.value; const s = document.getElementById("dpFocus"); if (s) d.f.focus = s.value; }
function dpSetGo() {
  dpReadSet(); const d = dlg, f = d.f, min = Math.round(+f.minutes);
  if (!(min >= 15 && min <= 720)) { d.err = "El tiempo va de 15 a 720 minutos."; renderModal(); return; }
  const [kind, ref] = f.focus === "auto" ? ["auto", null] : f.focus.split(":");
  state.dpSet = { date: todayKey(), minutes: min, energy: f.energy, focus: kind === "auto" ? { kind: "auto" } : { kind, ref: ref || null } };
  const mode = d.mode; dlg = null; renderModal();
  if (mode === "regen" && dpCur()) { dpPropose(); return; }
  dpPropose({ reorg: mode === "reorg" });
}
function dpWhySheet(d) {
  const p = state.plans.get(d.id); if (!p || p.deleted_at) { dlg = null; return ""; }
  const c = dpExplain(p.id), done = dpIsDone(p.id), open = p.status === "planned" && !done, T = todayKey();
  const reasons = done ? ["Ya está completada"] : c ? dpReasons(c.factors) : ["Ya no es una misión pendiente de hoy"];
  const dbg = dpDebug() && c ? `<div class="dp-dbg num">score ${c.score}: ${c.factors.map((x) => `${x.k} ${x.pts > 0 ? "+" : ""}${x.pts}`).join(" · ")}</div>` : "";
  const a = dpAttrs(p, state.routines), meta = [CAT[p.category].name, `${p.planned_minutes} min`];
  if (p.time) meta.unshift(p.time.slice(0, 5)); if (p.date !== T) meta.push(cap(dpDayWord(T, p.date)));
  if (a.priority !== "normal") meta.push(`Prioridad ${DP_PRIO_NAME[a.priority]}`);
  const body = `<div class="dp-why-top c-${p.category}"><span class="dp-ico">${ico(p.category)}</span><div><b>${rtIco(p)}${esc(p.title)}</b><small>${meta.join(" · ")}</small></div></div>
    <div class="dp-sub">¿Por qué está en mi plan?</div><ul class="dp-reasons">${reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>${dbg}`;
  const foot = open ? `<button type="button" class="btn primary" data-pstart="${p.id}">${ico("play")} ${fActiveFor(p.id) ? "Ver enfoque" : "Iniciar enfoque"}</button><button type="button" class="btn" data-dpdone="${p.id}">Completar</button>` : "";
  return dpSheet("dpWhyH", "Misión", body, foot);
}
function dpAdjustSheet() {
  const list = dpList(), T = todayKey(), d = dpCur(), acc = dpAccepted(T);
  const doneIds = new Set(list.filter((x) => dpIsDone(x.id)).map((x) => x.id));
  const rows = list.map((x, i) => {
    const p = state.plans.get(x.id); if (!p || p.deleted_at) return "";
    const a = dpAttrs(p, state.routines), done = doneIds.has(x.id), flex = a.mode === "flexible" && !(p.date === T && p.time);
    return `<li class="dp-adj c-${p.category}${done ? " is-done" : ""}"><div class="dp-adj-t"><b>${esc(p.title)}</b><small class="num">${done ? "Completada" : `${x.m} min${flex ? ` · flexible (mín. ${a.min})` : ""}`}</small></div>
      ${done ? "" : `<div class="dp-adj-b">${flex ? `<button type="button" class="icon-btn" data-dpmm="${x.id}" aria-label="Menos minutos" ${x.m <= a.min ? "disabled" : ""}>−</button><button type="button" class="icon-btn" data-dpmp="${x.id}" aria-label="Más minutos" ${x.m >= p.planned_minutes ? "disabled" : ""}>+</button>` : ""}
      <button type="button" class="icon-btn" data-dpup="${i}" aria-label="Subir" ${i === 0 ? "disabled" : ""}>${ico("up")}</button><button type="button" class="icon-btn" data-dpdown="${i}" aria-label="Bajar" ${i === list.length - 1 ? "disabled" : ""}>${ico("down")}</button>
      <button type="button" class="icon-btn" data-dprm="${x.id}" aria-label="Sacar de hoy">${ico("x")}</button></div>`}</li>`;
  }).join("");
  // Para agregar: lo que no entró (de hoy, atrasadas y próximos días). El orden es el de los puntos.
  const res = d ? d.res : buildDayPlan(dpInput(dpSettings(), { removed: acc ? acc.removed : [] }));
  const inList = new Set(list.map((x) => x.id)), removed = d ? d.removed : acc ? acc.removed : [];
  const extra = res.out.filter((o) => !inList.has(o.id) && state.plans.get(o.id)).slice(0, 8);
  const gone = removed.filter((id) => !inList.has(id)).map((id) => state.plans.get(id)).filter((p) => p && !p.deleted_at && p.status === "planned" && !dpIsDone(p.id));
  const addRow = (p, attr) => `<li class="dp-add"><span class="dp-adj-t"><b>${esc(p.title)}</b><small>${CAT[p.category].name} · ${p.planned_minutes} min${p.date !== T ? ` · ${dpDayWord(T, p.date)}` : ""}</small></span><button type="button" class="btn sm" ${attr}="${p.id}">${ico("plus")} Agregar</button></li>`;
  const body = `${rows ? `<ol class="dp-adjl">${rows}</ol>` : `<p class="dp-note">El plan está vacío.</p>`}
    <button type="button" class="old-late-h" data-dpaddt aria-expanded="${!!state.dpAddOpen}">${ico(state.dpAddOpen ? "down" : "right")}<span>Agregar otra misión</span></button>
    ${state.dpAddOpen ? `<ul class="dp-addl">${extra.map((o) => addRow(state.plans.get(o.id), "data-dpadd")).join("")}${gone.map((p) => addRow(p, "data-dpback")).join("")}</ul>
      ${!extra.length && !gone.length ? `<p class="dp-note">No hay otras misiones pendientes.</p>` : ""}<button type="button" class="btn sm ghost" data-dpnewplan>${ico("plus")} Nueva planificación</button>` : ""}
    <p class="dp-note">Reordenar o sacar una misión solo cambia el plan de hoy: la rutina y la planificación quedan igual.</p>`;
  return dpSheet("dpAdjH", "Ajustar plan", body, `<button type="button" class="btn" data-dpset="${d ? (d.reorg ? "reorg" : "regen") : "regen"}">Tiempo, energía y foco</button><button type="button" class="btn primary" data-dlg-close>Listo</button>`);
}
function dpAheadSheet(d) {
  const p = state.plans.get(d.ids[d.i]); if (!p) { dpAheadChoice("keep"); return ""; }
  const body = `<div class="dp-why-top c-${p.category}"><span class="dp-ico">${ico(p.category)}</span><div><span class="dp-tag">Adelantada</span><b>${esc(p.title)}</b><small>${CAT[p.category].name} · ${p.planned_minutes} min · planeada originalmente para ${dpDayWord(todayKey(), p.date)}</small></div></div>
    <p class="dp-note">Si la movés, se reprograma para hoy como en el Planificador y recuerda su fecha original. Si la dejás, sigue en su fecha y sale de este plan.</p>`;
  return dpSheet("dpAhH", "¿Mover esta actividad a hoy?", body, `<button type="button" class="btn primary dp-main" data-dpahead="move">Mover a hoy</button><button type="button" class="btn" data-dpahead="keep">Dejar para su fecha</button>`);
}

/* ============ Campos en Planificador y Rutinas ============ */
/** Prioridad, energía y duración (y fecha límite en planificaciones), plegados en "Plan del Día (opcional)".
    En una misión de rutina, lo que no elegís se hereda de la rutina. */
function dpFormFields(f, p, { prefix, due }) {
  const inh = p ? dpAttrs({ ...p, priority: null, energy_required: null, duration_mode: null }, state.routines) : { priority: "normal", energy: "normal", mode: "fixed", min: null };
  const prio = f.prio || inh.priority, en = f.energy || inh.energy, mode = f.mode || inh.mode;
  const sum = [`Prioridad ${DP_PRIO_NAME[prio].toLowerCase()}`, `energía ${DP_ENERGY_NAME[en].toLowerCase()}`, mode === "flexible" ? "flexible" : "duración fija"];
  if (due && f.due) sum.push(`vence ${fmtShort(f.due)}`);
  const head = `<button type="button" class="old-late-h dp-fhead" data-dpfopen aria-expanded="${!!f.dpOpen}">${ico(f.dpOpen ? "down" : "right")}<span>Plan del Día (opcional)</span><small>${sum.join(" · ")}</small></button>`;
  if (!f.dpOpen) return head;
  const minVal = f.minm !== "" && f.minm != null ? f.minm : inh.min || "";
  return `${head}<div class="dp-fbody">
    <div class="field"><label>Prioridad</label><div class="seg four">${DP_PRIO.map((v) => `<button type="button" data-dpfprio="${v}" aria-pressed="${prio === v}">${DP_PRIO_NAME[v]}</button>`).join("")}</div>
    ${prio === "critical" ? `<small class="muted-s">Para lo realmente importante: casi siempre entra en el plan.</small>` : ""}</div>
    <div class="field"><label>Energía que pide</label><div class="seg three">${DP_ENERGY.map((v) => `<button type="button" data-dpfen="${v}" aria-pressed="${en === v}">${DP_ENERGY_NAME[v]}</button>`).join("")}</div></div>
    <div class="field"><label>Duración</label><div class="seg two">${[["fixed", "Fija"], ["flexible", "Flexible"]].map(([v, l]) => `<button type="button" data-dpfmode="${v}" aria-pressed="${mode === v}">${l}</button>`).join("")}</div>
    ${mode === "flexible" ? `<div class="dp-custom"><label class="muted-s" for="${prefix}MinM">Mínimo</label><input class="inp num" id="${prefix}MinM" type="number" inputmode="numeric" min="1" max="240" step="1" value="${esc(minVal)}"><span class="muted-s">min</span></div>
      <small class="muted-s">Si queda poco tiempo, el plan puede proponerla más corta, nunca menos que el mínimo.</small>` : ""}</div>
    ${due ? `<div class="field"><label for="plDue">Fecha límite (opcional)</label><input class="inp" id="plDue" type="date" value="${esc(f.due || "")}"></div>` : ""}
    ${p && p.recurring_plan_id ? `<small class="muted-s">Lo que no cambies se toma de la rutina.</small>` : ""}</div>`;
}
/** Lee los campos del formulario. Planificaciones: lo que no se tocó queda vacío (hereda). Rutinas: siempre un valor. */
function dpFormRead(f, planned, { due, routine = false }) {
  const mode = f.mode || (routine ? "fixed" : null);
  let min = null;
  if (mode === "flexible") {
    min = Math.round(+f.minm);
    if (!(min >= 1 && min <= planned)) return { err: `El mínimo de una actividad flexible va de 1 a ${planned} minutos.` };
  }
  const cols = { priority: f.prio || (routine ? "normal" : null), energy_required: f.energy || (routine ? "normal" : null), duration_mode: mode, minimum_minutes: min };
  if (due) {
    if (f.due && !/^\d{4}-\d{2}-\d{2}$/.test(f.due)) return { err: "La fecha límite no es válida." };
    cols.due_date = f.due || null;
  }
  return { cols };
}
function dpFormClick(D, read) {
  const f = dlg && dlg.f; if (!f) return false;
  if (D.dpfopen !== undefined) { read(); f.dpOpen = !f.dpOpen; renderModal(); return true; }
  if (D.dpfprio) { read(); f.prio = D.dpfprio; renderModal(); return true; }
  if (D.dpfen) { read(); f.energy = D.dpfen; renderModal(); return true; }
  if (D.dpfmode) { read(); f.mode = D.dpfmode; renderModal(); return true; }
  return false;
}

/* ============ Perfil ============ */
function dpPrefsPanel() {
  const P = dpPrefs(state.profile.day_plan_prefs), tog = (k, label, on) => `<label class="ntog"><span>${label}</span><input type="checkbox" data-dppref="${k}" ${on ? "checked" : ""}></label>`;
  const sel = (k, label, opts, v) => `<div class="field"><label for="dpp-${k}">${label}</label><select class="inp" id="dpp-${k}" data-dppref="${k}">${opts.map(([o, l]) => `<option value="${o}" ${String(v) === String(o) ? "selected" : ""}>${l}</option>`).join("")}</select></div>`;
  return `<section class="panel"><div class="panel-h"><h2>Plan del Día</h2></div>
  <div class="nlist">${tog("enabled", "Plan del Día automático", P.enabled)}${tog("finanzas", "Preferir Finanzas ligeramente", P.finanzas)}</div>
  <p class="muted-s" style="margin:8px 0 12px">Apagado, Hoy queda exactamente como antes y no se borra nada. El plan nunca da ni quita XP, Oro ni rachas.</p>
  <div class="dp-prefs">${sel("minutes", "Tiempo habitual disponible", [30, 60, 90, 120, 180, 240, 300, 360].map((m) => [m, dpDur(m)]), P.minutes)}
  ${sel("energy", "Energía por defecto", DP_ENERGY.map((e) => [e, DP_ENERGY_NAME[e]]), P.energy)}
  ${sel("focus", "Foco por defecto", [["auto", "Automático"], ...CATS.map((c) => [c.id, c.name])], P.focus)}
  ${sel("maxOverdue", "Máximo de atrasadas sugeridas", [0, 1, 2, 3].map((n) => [n, String(n)]), P.maxOverdue)}</div></section>`;
}
function dpSetPref(k, v) {
  const P = dpPrefs(state.profile.day_plan_prefs);
  P[k] = k === "minutes" || k === "maxOverdue" ? +v : v;
  state.profile.day_plan_prefs = P; state.dpSet = null;
  saveProfile(); render();
}

/* ============ Respaldo (versión 8) ============ */
function dayPlanExport() { return { daily_plans: [...state.dayplans.values()].filter((r) => !r.deleted_at).sort((a, b) => a.date.localeCompare(b.date)) }; }
function importDayPlans(P, mode, at) {
  const list = P.dayplans || [], rows = [];
  for (const r of list) { const l = state.dayplans.get(r.id); if (mode === "replace" || !l || Date.parse(r.updated_at) > Date.parse(l.updated_at)) rows.push(mode === "replace" ? { ...r, updated_at: at } : r); }
  if (rows.length) { for (const r of rows) state.dayplans.set(r.id, r); Store.put("dayplans", rows).catch(() => {}); Sync.changed(300); }
  return rows.length;
}

/* ============ Eventos ============ */
function dpMove(list, i, j) { const l = [...list]; if (j < 0 || j >= l.length) return l; [l[i], l[j]] = [l[j], l[i]]; return l; }
function dpStep(id, delta) {
  const list = dpList().map((x) => ({ ...x })), x = list.find((y) => y.id === id), p = state.plans.get(id); if (!x || !p) return;
  const a = dpAttrs(p, state.routines); if (a.mode !== "flexible") return;
  x.m = Math.max(a.min, Math.min(p.planned_minutes, x.m + delta));
  const d = dpCur(); if (d) d.overrides = { ...d.overrides, [id]: x.m };
  dpSetList(list);
}
function dpAdd(id) {
  const p = state.plans.get(id); if (!p) return;
  const list = dpList().filter((x) => x.id !== id).concat([{ id, m: p.planned_minutes }]);
  const d = dpCur();
  if (d) { d.removed = d.removed.filter((x) => x !== id); d.forced = [...new Set([...d.forced, id])]; dpSetList(list); return; }
  const r = dpAccepted(todayKey()); if (!r) return;
  putDayPlans([{ ...r, items: list.slice(0, 30), removed: r.removed.filter((x) => x !== id), updated_at: nowISO() }]);
  if (dlg && dlg.type === "dpAdjust") renderModal();
}
/** Sugerencia → el editor del Planificador ya completado. Solo se crea si guardás. */
function dpAddSuggestion(key) {
  const d = dpCur(); if (!d) return;
  const s = d.res.suggestions.find((x) => x.key === key); if (!s) return;
  openPlanEditor(todayKey());
  if (!dlg || dlg.type !== "planForm") return;
  const id = Store.newId();
  Object.assign(dlg.f, { title: s.title.slice(0, 80), cat: s.category, min: s.minutes, diff: 2 });
  dlg.newId = id; d.forced = [...new Set([...d.forced, id])]; d.sugOff = [...new Set([...d.sugOff, key])];
  renderModal();
}
function dpNewPlan() {
  const d = dpCur(), id = Store.newId();
  openPlanEditor(todayKey());
  if (!dlg || dlg.type !== "planForm") return;
  dlg.newId = id;
  if (d) d.forced = [...new Set([...d.forced, id])];
  else state.dpAddAfter = id;     // plan aceptado: se agrega cuando se guarde
}
function dpClose(k) {
  const r = dpAccepted(k); if (!r) return;
  const at = nowISO(); putDayPlans([{ ...r, closed_at: at, updated_at: at }]);
  toast(k === todayKey() ? "Día cerrado. Mañana es otro día." : "Plan de ayer cerrado.");
}
document.addEventListener("click", (e) => {
  const t = e.target.closest("button"); if (!t || !t.dataset) return;
  const D = t.dataset;
  if (D.dpgen !== undefined) { state.dpHide = null; dpPropose(); return; }
  if (D.dphide !== undefined) { state.dpHide = todayKey(); Store.setMeta("dpHide", state.dpHide).catch(() => {}); render(); return; }
  if (D.dpset) { dpOpenSet(D.dpset); return; }
  if (D.dpsetgo !== undefined && dlg && dlg.type === "dpSet") { dpSetGo(); return; }
  if (D.dpmin && dlg && dlg.type === "dpSet") { dpReadSet(); if (D.dpmin === "custom") dlg.f.custom = true; else { dlg.f.custom = false; dlg.f.minutes = +D.dpmin; } renderModal(); if (dlg.f.custom) document.getElementById("dpMinC")?.focus(); return; }
  if (D.dpen && dlg && dlg.type === "dpSet") { dpReadSet(); dlg.f.energy = D.dpen; renderModal(); return; }
  if (D.dpdiscard !== undefined) { state.dp = null; render(); return; }
  if (D.dpaccept !== undefined) { dpAccept(); return; }
  if (D.dpahead && dlg && dlg.type === "dpAhead") { dpAheadChoice(D.dpahead); return; }
  if (D.dpadjust !== undefined) { state.dpAddOpen = false; dlg = { type: "dpAdjust" }; renderModal(); return; }
  if (D.dpwhy) { dlg = { type: "dpWhy", id: D.dpwhy }; renderModal(); return; }
  if (D.dpdone) {   // Completar de siempre; una flexible reducida llega con los minutos del plan
    const x = dpList().find((y) => y.id === D.dpdone), p = state.plans.get(D.dpdone);
    if (dlg) { dlg = null; renderModal(); }
    openPlanComplete(D.dpdone, x && p && x.m < p.planned_minutes && planFocusSecs(p.id) < 60 ? x.m : undefined); return;
  }
  if (D.dpup !== undefined) { dpSetList(dpMove(dpList(), +D.dpup, +D.dpup - 1)); return; }
  if (D.dpdown !== undefined) { dpSetList(dpMove(dpList(), +D.dpdown, +D.dpdown + 1)); return; }
  if (D.dprm) { const d = dpCur(); if (d) d.forced = d.forced.filter((x) => x !== D.dprm); dpSetList(dpList().filter((x) => x.id !== D.dprm), D.dprm); return; }
  if (D.dpmm) { dpStep(D.dpmm, -5); return; }
  if (D.dpmp) { dpStep(D.dpmp, 5); return; }
  if (D.dpaddt !== undefined) { state.dpAddOpen = !state.dpAddOpen; renderModal(); return; }
  if (D.dpadd) { dpAdd(D.dpadd); return; }
  if (D.dpback) { dpAdd(D.dpback); return; }
  if (D.dpnewplan !== undefined) { dpNewPlan(); return; }
  if (D.dpforce) { const d = dpCur(); if (d) { d.forced = [...new Set([...d.forced, D.dpforce])]; dpPropose(); } return; }
  if (D.dpsug) { dpAddSuggestion(D.dpsug); return; }
  if (D.dpsugoff) { const d = dpCur(); if (d) { d.sugOff = [...new Set([...d.sugOff, D.dpsugoff])]; render(); } return; }
  if (D.dpclose) { dpClose(D.dpclose); return; }
  if (D.dpmove) { openPlanMove(D.dpmove); return; }
  if (D.dpnudgeoff) { state.dpNudgeOff = D.dpnudgeoff; render(); return; }
  if (D.dpdonet !== undefined) { state.dpDoneOpen = !state.dpDoneOpen; render(); return; }
  if (D.dpmissions !== undefined) { state.dpMisOpen = !state.dpMisOpen; render(); return; }
});
document.addEventListener("change", (e) => {
  const k = e.target.dataset && e.target.dataset.dppref; if (!k) return;
  dpSetPref(k, e.target.type === "checkbox" ? e.target.checked : e.target.value);
});
/** Después de guardar una planificación nueva desde el plan: la propuesta se recalcula (y la incluye); un plan aceptado la suma al final */
function dpAfterPlansChange() {
  const T = todayKey();
  if (state.dpAddAfter && state.plans.get(state.dpAddAfter)) {
    const id = state.dpAddAfter; state.dpAddAfter = null;
    const r = dpAccepted(T);
    if (r && !r.items.some((x) => x.id === id)) putDayPlans([{ ...r, items: [...r.items, { id, m: state.plans.get(id).planned_minutes }].slice(0, 30), updated_at: nowISO() }]);
  }
  const d = dpCur();
  if (d && d.forced.some((id) => state.plans.get(id) && !d.list.some((x) => x.id === id) && !d.removed.includes(id))) dpPropose();
}

/* AHORA cambia con la hora (Próxima → Ahora, "¿Reorganizar?"): se redibuja cada minuto, solo en Hoy y sin interrumpir lo que estás haciendo */
setInterval(() => {
  if (document.visibilityState !== "visible" || state.route !== "hoy" || dlg || !state.ready || !dpOn()) return;
  const a = document.activeElement; if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
  if (dpAccepted(todayKey())) render();
}, 60000);
