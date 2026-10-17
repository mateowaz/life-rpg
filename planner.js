/* Life RPG — Planificador: actividades planificadas, Calendario, Agenda, panel de Hoy y del Dashboard.
   PLANIFICAR ≠ COMPLETAR. Una planificación no da XP, Oro, racha, daño al Boss ni avance de Objetivos.
   Completarla crea una actividad normal con EL MISMO id que la planificación: así una planificación
   produce como mucho una actividad, aunque se complete en dos dispositivos a la vez y sin conexión.
   "Completada" no se guarda: se deduce de que exista esa actividad. */

/* ============ Reglas ============ */
const PLAN_LABEL = { planned: "Planificada", today: "Hoy", overdue: "Atrasada", done: "Completada", skipped: "Omitida", cancelled: "Cancelada" };
const OVERDUE_DAYS = 7;                      // las atrasadas más viejas van a una sección plegada
const livePlans = () => [...state.plans.values()].filter((p) => !p.deleted_at);
/** Actividad real de una planificación (mismo id), si existe y no está borrada */
const planAct = (p) => { const r = p && state.rows.get(p.id); return r && !r.deleted_at ? r : null; };
function planState(p) {
  if (planAct(p)) return "done";                                       // la actividad real gana siempre
  if (p.status !== "planned") return p.status;
  const T = todayKey();
  return p.date < T ? "overdue" : p.date === T ? "today" : "planned";
}
const isOpenPlan = (st) => st === "planned" || st === "today" || st === "overdue";
const byTime = (a, b) => a.date.localeCompare(b.date) || (a.time || "99").localeCompare(b.time || "99") || a.created_at.localeCompare(b.created_at);
const plansOn = (k) => livePlans().filter((p) => p.date === k).sort(byTime);
/** Atrasadas: las de los últimos 7 días arriba; las más viejas, aparte */
function overdueLists() {
  const T = todayKey(), lim = addDays(T, -OVERDUE_DAYS);
  const all = livePlans().filter((p) => planState(p) === "overdue").sort((a, b) => b.date.localeCompare(a.date) || byTime(a, b));
  return { recent: all.filter((p) => p.date >= lim), older: all.filter((p) => p.date < lim) };
}
function dayName(k) {
  const T = todayKey();
  if (k === T) return "Hoy";
  if (k === addDays(T, 1)) return "Mañana";
  if (k === addDays(T, -1)) return "Ayer";
  return `${cap(fmtWeek(k))} ${fmtShort(k)}`;
}
function lateText(k) {
  const n = Math.round((fromKey(todayKey()) - fromKey(k)) / 864e5);
  return n === 1 ? "Planeada para ayer" : `Planeada para el ${fmtShort(k)} · hace ${n} días`;
}

/* ============ Fila de una planificación ============ */
function planRow(p, { compact = false } = {}) {
  const st = planState(p), act = planAct(p), fs = planFocusSecs(p.id), open = isOpenPlan(st);
  const fm = Math.floor(fs / 60);
  const meta = [`<em>${CAT[p.category].name}</em>`, `<span class="num">${p.planned_minutes} min</span>`, `<span>${DIFF[p.intensity].name}</span>`];
  if (act) meta.push(`<span class="num">Real ${act.minutes} min</span>`);
  else if (fm || fActiveFor(p.id)) meta.push(`<span class="num p-focus">${fm} / ${p.planned_minutes} min enfocados</span>`);
  if (p.moved_from && p.moved_from !== p.date && !compact) meta.push(`<span>Movida desde el ${fmtShort(p.moved_from)}</span>`);
  if (p.note && !compact) meta.push(`<span>· ${esc(p.note)}</span>`);
  let acts = "";
  if (state.confirmPlan === p.id) acts = `<span class="confirm">¿Eliminar esta planificación?${act ? " La actividad real queda." : ""} <button class="btn sm danger" data-pdel="${p.id}">Sí</button><button class="btn sm ghost" data-pnodel>No</button></span>`;
  else if (st === "overdue") acts = `<button class="btn sm primary" data-pdone="${p.id}">Completar ahora</button><button class="btn sm" data-pmove="${p.id}">Reprogramar</button><button class="btn sm ghost" data-pskip="${p.id}">Omitir</button>${moreBtn(p)}`;
  else if (open) acts = `<button class="btn sm" data-pstart="${p.id}">${ico("play")} ${fActiveFor(p.id) ? "Ver enfoque" : "Iniciar enfoque"}</button><button class="btn sm primary" data-pdone="${p.id}">Completar</button>${moreBtn(p)}`;
  const side = acts ? "" : moreBtn(p);
  const menu = state.planMenu === p.id && state.confirmPlan !== p.id ? `<div class="plan-menu">${planMenu(p, st)}</div>` : "";
  return `<div class="plan pst-${st}"><div class="act c-${p.category}"><div class="cat-ico">${st === "done" ? ico("check") : ico(p.category)}</div>
    <div style="min-width:0"><div class="act-t">${p.time ? `<span class="ptime num">${p.time}</span>` : ""}${esc(p.title)}</div>
    <div class="act-m">${meta.join("")}</div>${st === "overdue" ? `<div class="p-late">⚠ ${lateText(p.date)}</div>` : ""}</div>
    <div class="act-r"><span class="pstate pst-${st}">${PLAN_LABEL[st]}</span>${side}</div></div>
    ${acts ? `<div class="plan-acts">${acts}</div>` : ""}${menu}</div>`;
}
const moreBtn = (p) => `<button class="icon-btn" data-pmenu="${p.id}" aria-label="Más acciones" aria-expanded="${state.planMenu === p.id}">${ico("more")}</button>`;
function planMenu(p, st) {
  const b = [];
  if (isOpenPlan(st)) b.push(`<button class="btn sm ghost" data-pedit="${p.id}">${ico("edit")} Editar</button>`, `<button class="btn sm ghost" data-pmove="${p.id}">Reprogramar</button>`);
  b.push(`<button class="btn sm ghost" data-pdup="${p.id}">Duplicar</button>`);
  if (isOpenPlan(st)) b.push(`<button class="btn sm ghost" data-pskip="${p.id}">Omitir</button>`, `<button class="btn sm ghost" data-pcancel="${p.id}">Cancelar plan</button>`);
  if (st === "skipped" || st === "cancelled") b.push(`<button class="btn sm ghost" data-preplan="${p.id}">Volver a planificar</button>`);
  b.push(`<button class="btn sm ghost danger" data-paskdel="${p.id}">${ico("trash")} Eliminar</button>`);
  return b.join("");
}
function planList(list, emptyText) {
  return list.length ? `<div class="plans">${list.map((p) => planRow(p)).join("")}</div>` : `<div class="goal-h"><span>${emptyText}</span></div>`;
}
/** Atrasadas de más de 7 días: plegadas, se abren a mano */
function olderBlock(older) {
  if (!older.length) return "";
  return `<div class="old-late"><button class="old-late-h" data-poldtoggle aria-expanded="${!!state.oldOpen}">${ico(state.oldOpen ? "down" : "right")}<span>Atrasadas anteriores (${older.length})</span></button>
    ${state.oldOpen ? `<div class="plans">${older.map((p) => planRow(p)).join("")}</div>` : ""}</div>`;
}

/* ============ Pantalla Planificador ============ */
const isNarrow = () => matchMedia("(max-width:820px)").matches;
function vPlanner(s) {
  const tab = state.planTab || (isNarrow() ? "agenda" : "calendar");
  const T = todayKey(), sel = state.planSel && state.planSel >= T ? state.planSel : T;
  return header("Planificador", "Lo que piensas hacer. Planificar no da XP: el progreso llega cuando completas la actividad.", false) + `
  <div class="shop-top"><div class="tabs" role="tablist">${[["calendar", "Calendario"], ["agenda", "Agenda"], ["focus", "Enfoque"]].map(([id, l]) => `<button role="tab" aria-selected="${tab === id}" data-ptab="${id}">${l}</button>`).join("")}</div>
  <div class="plan-top-btns"><button class="btn" data-fnew>${ico("focus")} Enfoque</button><button class="btn primary" data-pnew="${tab === "calendar" ? sel : T}">${ico("plus")} Planificar</button></div></div>
  ${tab === "agenda" ? planAgenda() : tab === "focus" ? vFocusTab() : planCalendar()}`;
}
function planCalendar() {
  const T = todayKey(), m = state.planMonth || T.slice(0, 7), sel = state.planSel || T;
  const [y, mo] = m.split("-").map(Number), first = new Date(y, mo - 1, 1), startDow = (first.getDay() + 6) % 7, dim = new Date(y, mo, 0).getDate();
  const byDay = {}; for (const p of livePlans()) (byDay[p.date] || (byDay[p.date] = [])).push(p);
  let cells = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((d) => `<div class="dow">${d}</div>`).join("");
  for (let i = 0; i < startDow; i++) cells += `<div class="cday out"></div>`;
  for (let d = 1; d <= dim; d++) {
    const k = `${y}-${pad(mo)}-${pad(d)}`, list = (byDay[k] || []).filter((p) => p.status !== "cancelled" || planAct(p));
    const sts = list.map(planState), done = list.length && sts.every((x) => x === "done" || x === "skipped") && sts.includes("done"), late = sts.includes("overdue");
    const n = list.filter((p) => isOpenPlan(planState(p))).length;
    cells += `<button class="cday plan-day ${k === T ? "today" : ""} ${k === sel ? "sel" : ""} ${k < T ? "past" : ""} ${late ? "late" : ""}" data-psel="${k}" aria-label="${fmtLong(k)}${list.length ? `, ${list.length} planificadas` : ""}">
      <span class="d num">${d}${done ? `<i class="pd-ok">${ico("check")}</i>` : ""}</span>${n ? `<span class="x num pn">${n} plan${n === 1 ? "" : "es"}</span>` : ""}
      ${list.length ? `<span class="dots">${list.map((p) => `<i style="background:var(--c-${p.category})${planState(p) === "done" || p.status !== "planned" ? ";opacity:.35" : ""}"></i>`).join("")}</span>` : ""}</button>`;
  }
  const mk = (n) => { const x = new Date(y, mo - 1 + n, 1); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}`; };
  const monthName = first.toLocaleDateString("es", { month: "long", year: "numeric" });
  const list = plansOn(sel);
  return `<div class="grid2 plan-grid"><section class="panel"><div class="panel-h"><div class="cal-h"><button class="btn sm" data-pmonth="${mk(-1)}" aria-label="Mes anterior">${ico("left").replace("<svg", "<svg width='16' height='16'")}</button><h2>${monthName}</h2><button class="btn sm" data-pmonth="${mk(1)}" aria-label="Mes siguiente">${ico("right").replace("<svg", "<svg width='16' height='16'")}</button></div>${m !== T.slice(0, 7) ? `<button class="btn sm ghost" data-pmonth="${T.slice(0, 7)}">Hoy</button>` : ""}</div>
  <div class="cal">${cells}</div>
  <div class="legend">${CATS.map((c) => `<span><i style="background:var(--c-${c.id})"></i>${c.name}</span>`).join("")}<span>Historial = qué hiciste · Planificador = qué piensas hacer</span></div></section>
  <section class="panel"><div class="panel-h"><div><div class="eyebrow">${dayName(sel)}</div><h2 style="margin-top:2px">${fmtLong(sel)}</h2></div>${sel >= T ? `<button class="btn sm" data-pnew="${sel}">${ico("plus").replace("<svg", "<svg width='14' height='14'")} Planificar</button>` : ""}</div>
  ${list.length ? `<div class="plans">${list.map((p) => planRow(p)).join("")}</div>` : `<div class="empty">${ico("plan")}<div>${sel >= T ? "Nada planificado este día." : "No hubo nada planificado este día."}</div>${sel >= T ? `<button class="btn primary" data-pnew="${sel}">${ico("plus")} Planificar este día</button>` : ""}</div>`}</section></div>`;
}
function planAgenda() {
  const T = todayKey(), n = state.agendaDays || 14, { recent, older } = overdueLists();
  let h = "";
  if (recent.length || older.length) h += `<section class="panel late-panel"><div class="panel-h"><h2>⚠ Atrasadas</h2><span class="chip num">${recent.length + older.length}</span></div>
    ${recent.length ? `<div class="plans">${recent.map((p) => planRow(p)).join("")}</div>` : ""}${olderBlock(older)}</section>`;
  const days = [];
  for (let i = 0; i < n; i++) { const k = addDays(T, i), list = plansOn(k); if (list.length) days.push([k, list]); }
  const later = livePlans().filter((p) => p.date >= addDays(T, n) && isOpenPlan(planState(p))).length;
  h += `<section class="panel agenda">${days.length ? days.map(([k, list]) => `<div class="ag-day"><div class="ag-h"><span class="eyebrow">${k === T ? "Hoy" : k === addDays(T, 1) ? "Mañana" : cap(fmtWeek(k)) + " " + fromKey(k).getDate()}</span><span class="muted-s">${fmtLong(k)}</span><button class="link" data-pnew="${k}">+ Planificar</button></div><div class="plans">${list.map((p) => planRow(p)).join("")}</div></div>`).join("")
    : `<div class="empty">${ico("plan")}<div>No tienes nada planificado para los próximos ${n} días.</div><button class="btn primary" data-pnew="${T}">${ico("plus")} Planificar</button></div>`}
    ${later ? `<div style="margin-top:14px;text-align:center"><button class="btn sm" data-pmore>Ver ${Math.min(14, later)} días más · hay ${later} planificación${later === 1 ? "" : "es"} después</button></div>` : ""}</section>`;
  return h;
}

/* ============ Hoy, Dashboard, Historial ============ */
function planTodayPanel() {
  const T = todayKey(), list = plansOn(T), { recent, older } = overdueLists();
  const empty = !list.length && !recent.length && !older.length;
  return `<section class="panel plan-today"><div class="panel-h"><h2>Planificado para hoy</h2><button class="link" data-go="planificador">Ver planificación</button></div>
    ${recent.length ? `<div class="plans">${recent.map((p) => planRow(p, { compact: true })).join("")}</div>` : ""}
    ${list.length ? `<div class="plans">${list.map((p) => planRow(p, { compact: true })).join("")}</div>` : ""}
    ${olderBlock(older)}
    ${empty ? `<div class="goal-h"><span>Nada planificado para hoy.</span><span><button class="link" data-pnew="${T}">+ Planificar</button></span></div>` : ""}</section>`;
}
function dashPlans() {
  const T = todayKey(), late = overdueLists(), nLate = late.recent.length + late.older.length;
  const next = livePlans().filter((p) => p.date >= T && isOpenPlan(planState(p))).sort(byTime).slice(0, 3);
  return `<section class="panel next-panel"><div class="panel-h"><h2>Próximas misiones</h2>${nLate ? `<span class="pstate pst-overdue">${nLate} atrasada${nLate === 1 ? "" : "s"}</span>` : ""}</div>
    ${next.length ? `<div class="nexts">${next.map((p) => `<div class="next c-${p.category}"><span class="next-w num">${p.date === T ? "Hoy" : p.date === addDays(T, 1) ? "Mañana" : cap(fmtWeek(p.date)).slice(0, 3) + " " + fromKey(p.date).getDate()}${p.time ? " · " + p.time : ""}</span><span class="next-t">${ico(p.category)}<b>${esc(p.title)}</b></span></div>`).join("")}</div>`
      : `<div class="goal-h"><span>Nada planificado todavía.</span></div>`}
    <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm" data-go="planificador">Ver planificación</button>${next.length ? "" : `<button class="btn sm ghost" data-pnew="${T}">${ico("plus")} Planificar</button>`}</div></section>`;
}
/** Historial: sección secundaria con la planificación de ese día. XP y estadísticas siguen viniendo solo de las actividades. */
function planHistSection(k) {
  const list = plansOn(k); if (!list.length) return "";
  return `<div class="plan-hist"><div class="eyebrow">Planificación de ese día</div>${list.map((p) => {
    const st = planState(p), a = planAct(p);
    const mark = { done: "✓", skipped: "—", cancelled: "✕", overdue: "⚠", today: "·", planned: "·" }[st];
    const txt = st === "done" ? `planeada ${p.planned_minutes} min · real ${a.minutes} min` : st === "skipped" ? "omitida" : st === "cancelled" ? "cancelada" : st === "overdue" ? `atrasada · planeada ${p.planned_minutes} min` : `planificada · ${p.planned_minutes} min`;
    return `<div class="ph-row pst-${st}"><span class="ph-m">${mark}</span><b>${esc(p.title)}</b><span class="muted-s">${txt}</span></div>`;
  }).join("")}</div>`;
}

/* ============ Estadísticas ============ */
function planStats() {
  const T = todayKey(), range = state.statsRange || "week";
  const from = range === "week" ? addDays(T, -((fromKey(T).getDay() + 6) % 7)) : T.slice(0, 8) + "01";
  const to = range === "week" ? addDays(from, 6) : `${T.slice(0, 7)}-${pad(new Date(+T.slice(0, 4), +T.slice(5, 7), 0).getDate())}`;
  const inR = (k) => k >= from && k <= to;
  const ses = liveFocus().filter((f) => f.status === "finished" && inR(keyOf(new Date(f.started_at))));
  const focusS = unionSecs(ses.flatMap((f) => f.segments));
  const plans = livePlans().filter((p) => inR(p.date) && p.status !== "cancelled");
  const planned = plans.reduce((t, p) => t + p.planned_minutes, 0), done = plans.reduce((t, p) => t + (planAct(p)?.minutes || 0), 0);
  const hm = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`);
  return `<section class="panel"><div class="panel-h"><h2>Enfoque y planificación</h2><div class="tabs sm" role="tablist">${[["week", "Esta semana"], ["month", "Este mes"]].map(([id, l]) => `<button role="tab" aria-selected="${range === id}" data-srange="${id}">${l}</button>`).join("")}</div></div>
  <div class="kpis plan-kpis"><div class="kpi"><b class="num">${hm(Math.round(focusS / 60))}</b><span>Tiempo de enfoque</span></div><div class="kpi"><b class="num">${ses.length}</b><span>Sesiones de enfoque</span></div>
  <div class="kpi"><b class="num">${ses.length ? hm(Math.round(focusS / 60 / ses.length)) : "—"}</b><span>Promedio por sesión</span></div>
  <div class="kpi"><b class="num">${hm(planned)}</b><span>Planificado</span></div><div class="kpi"><b class="num">${hm(done)}</b><span>Realizado de lo planificado</span></div>
  <div class="kpi"><b class="num">${planned ? Math.round(done / planned * 100) + " %" : "—"}</b><span>Cumplimiento</span></div></div>
  <p class="muted-s" style="margin:12px 0 0">Solo información: no planificar o no cumplir nunca quita XP. Las canceladas no cuentan; las omitidas cuentan como planificadas.</p></section>`;
}

/* ============ Crear, editar, reprogramar, duplicar ============ */
function openPlanEditor(date, id, copyOf) {
  const p = id ? state.plans.get(id) : copyOf ? state.plans.get(copyOf) : null, T = todayKey();
  const base = p || { title: "", category: "curso", planned_minutes: 60, intensity: 2, note: "", time: null, date: date && date >= T ? date : T };
  dlg = { type: "planForm", id: id || null, f: { title: base.title, cat: base.category, min: base.planned_minutes, diff: base.intensity, note: base.note || "", time: base.time || "",
    date: copyOf ? (base.date >= T ? base.date : T) : base.date }, origDate: p && id ? p.date : null, err: "" };
  renderModal(); setTimeout(() => document.getElementById("plTitle")?.focus(), 30);
}
function readPlanForm() {
  const g = (i) => document.getElementById(i); if (!g("plTitle") || !dlg) return;
  const f = dlg.f; f.title = g("plTitle").value; f.min = g("plMin").value; f.date = g("plDate").value; f.time = g("plTime").value; f.note = g("plNote").value;
}
function planForm() {
  const f = dlg.f, T = todayKey();
  return `<form class="modal" id="planForm" role="dialog" aria-modal="true" aria-labelledby="plH">
  <div><div class="eyebrow">Planificador · no da XP hasta completarla</div><h2 id="plH">${dlg.id ? "Editar planificación" : "Nueva planificación"}</h2></div>
  <div class="field"><label>Categoría</label><div class="seg">${CATS.map((c) => `<button type="button" class="c-${c.id}" data-plcat="${c.id}" aria-pressed="${f.cat === c.id}">${ico(c.id)}${c.name}</button>`).join("")}</div></div>
  <div class="field"><label for="plTitle">¿Qué piensas hacer?</label><input class="inp" id="plTitle" maxlength="80" placeholder="Ej.: Matemática, capítulo 3" value="${esc(f.title)}"></div>
  <div class="row2"><div class="field"><label for="plDate">Fecha</label><input class="inp" id="plDate" type="date" min="${dlg.origDate && dlg.origDate < T ? dlg.origDate : T}" value="${f.date}"></div>
  <div class="field"><label for="plTime">Hora (opcional)</label><input class="inp num" id="plTime" type="time" value="${esc(f.time)}"></div></div>
  <div class="row2"><div class="field"><label for="plMin">Duración estimada (min)</label><input class="inp num" id="plMin" type="number" min="1" max="240" step="1" value="${esc(f.min)}"></div>
  <div class="field"><label>Intensidad</label><div class="seg three">${[1, 2, 3].map((d) => `<button type="button" data-pldiff="${d}" aria-pressed="${+f.diff === d}">${DIFF[d].name}</button>`).join("")}</div></div></div>
  <div class="field"><label for="plNote">Nota (opcional)</label><input class="inp" id="plNote" maxlength="120" placeholder="Algo que quieras recordar" value="${esc(f.note)}"></div>
  ${dlg.err ? `<div class="err">${dlg.err}</div>` : ""}
  <div class="modal-f"><button type="button" class="btn ghost" data-dlg-close>Cancelar</button><button type="submit" class="btn primary">${dlg.id ? "Guardar cambios" : "Planificar"}</button></div></form>`;
}
function savePlan() {
  readPlanForm();
  const f = dlg.f, T = todayKey(), min = Math.round(+f.min), title = f.title.trim();
  if (!title) { dlg.err = "Escribe qué piensas hacer."; renderModal(); return; }
  if (!(min >= 1 && min <= 240)) { dlg.err = "La duración tiene que estar entre 1 y 240 minutos."; renderModal(); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date || "")) { dlg.err = "Elige una fecha."; renderModal(); return; }
  if (f.date < T && f.date !== dlg.origDate) { dlg.err = "Solo puedes planificar para hoy o días futuros."; renderModal(); return; }
  if (f.time && !/^\d{2}:\d{2}$/.test(f.time)) { dlg.err = "La hora no es válida."; renderModal(); return; }
  const at = nowISO(), old = dlg.id ? state.plans.get(dlg.id) : null;
  const row = { ...(old || { id: Store.newId(), status: "planned", moved_from: null, created_at: at, deleted_at: null }),
    date: f.date, time: f.time || null, title: title.slice(0, 80), category: f.cat, planned_minutes: min, intensity: +f.diff, note: f.note.trim().slice(0, 120), updated_at: at };
  if (old && old.date !== f.date) row.moved_from = old.moved_from || old.date;
  dlg = null; renderModal();
  putPlans([row]);
  toast(old ? "Planificación actualizada." : `Planificada para ${dayName(row.date).toLowerCase()}: <b>${esc(row.title)}</b>`);
}
function openPlanMove(id) {
  const p = state.plans.get(id); if (!p) return; const T = todayKey();
  dlg = { type: "planMove", id, date: p.date < T ? T : addDays(p.date, 1), time: p.time || "", err: "" }; renderModal();
}
function planMoveForm() {
  const p = state.plans.get(dlg.id); if (!p || p.deleted_at) { dlg = null; return ""; }
  return `<form class="modal" id="planMoveForm" role="dialog" aria-modal="true" aria-labelledby="pmH"><div><div class="eyebrow">Reprogramar · no crea una actividad</div><h2 id="pmH">${esc(p.title)}</h2></div>
  <span class="muted-s">Ahora: ${fmtLong(p.date)}${p.time ? " · " + p.time : ""}</span>
  <div class="row2"><div class="field"><label for="pmDate">Nueva fecha</label><input class="inp" id="pmDate" type="date" min="${todayKey()}" value="${dlg.date}"></div>
  <div class="field"><label for="pmTime">Hora (opcional)</label><input class="inp num" id="pmTime" type="time" value="${esc(dlg.time)}"></div></div>
  <div class="seg-quick">${[["Hoy", 0], ["Mañana", 1], ["En una semana", 7]].map(([l, n]) => `<button type="button" class="btn sm ghost" data-pmq="${addDays(todayKey(), n)}">${l}</button>`).join("")}</div>
  ${dlg.err ? `<div class="err">${dlg.err}</div>` : ""}
  <div class="modal-f"><button type="button" class="btn ghost" data-dlg-close>Cancelar</button><button type="submit" class="btn primary">Reprogramar</button></div></form>`;
}
function savePlanMove() {
  const p = state.plans.get(dlg.id), d = document.getElementById("pmDate").value, t = document.getElementById("pmTime").value;
  if (!p) { dlg = null; renderModal(); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d < todayKey()) { dlg.err = "Elige hoy o un día futuro."; dlg.date = d; dlg.time = t; renderModal(); return; }
  dlg = null; renderModal();
  putPlans([{ ...p, date: d, time: t || null, status: "planned", moved_from: d !== p.date ? p.moved_from || p.date : p.moved_from, updated_at: nowISO() }]);
  toast(`Reprogramada para ${dayName(d).toLowerCase()}.`);
}
function setPlanStatus(id, status) {
  const p = state.plans.get(id); if (!p || planAct(p)) { render(); return; }
  state.planMenu = null;
  putPlans([{ ...p, status, updated_at: nowISO() }]);
  toast({ skipped: "Marcada como omitida. Tu racha y tu XP no cambian.", cancelled: "Planificación cancelada.", planned: "Vuelve a estar planificada." }[status]);
}
function deletePlan(id) {
  const p = state.plans.get(id); state.confirmPlan = null; state.planMenu = null;
  if (!p) return;
  if (fActiveFor(id)) { toast("Primero finaliza la sesión de enfoque de esta planificación."); render(); return; }
  const at = nowISO(); putPlans([{ ...p, deleted_at: at, updated_at: at }]);
}
function putPlans(rows) {
  for (const r of rows) state.plans.set(r.id, r);
  Store.put("plans", rows).then(() => Sync.changed()).catch(() => toast("No se pudo guardar en este dispositivo."));
  render();
}

/* ============ Completar ============ */
function openPlanComplete(id, minutes) {
  const p = state.plans.get(id); if (!p || p.deleted_at) return;
  if (planAct(p)) { toast("Esta planificación ya está completada."); return; }
  const fm = Math.round(planFocusSecs(id) / 60), T = todayKey();
  dlg = { type: "planComplete", id, f: { min: minutes || (fm >= 1 ? Math.min(fm, 240) : p.planned_minutes), diff: p.intensity, note: p.note || "", date: T }, fm, err: "" };
  renderModal(); setTimeout(() => document.getElementById("pcMin")?.focus(), 30);
}
function readPlanComplete() { const g = (i) => document.getElementById(i); if (!g("pcMin") || !dlg) return; dlg.f.min = g("pcMin").value; dlg.f.note = g("pcNote").value; }
function planCompleteForm() {
  const p = state.plans.get(dlg.id); if (!p || p.deleted_at) { dlg = null; return ""; }
  const f = dlg.f, T = todayKey(), min = Math.round(+f.min) || 0, running = fActiveFor(p.id);
  return `<form class="modal" id="planCompleteForm" role="dialog" aria-modal="true" aria-labelledby="pcH">
  <div><div class="eyebrow">Completar actividad</div><h2 id="pcH">${esc(p.title)}</h2></div>
  <div class="buy-sum pc-sum"><span>Categoría</span><b class="c-${p.category}" style="color:var(--c)">${CAT[p.category].name}</b><span>Duración planeada</span><b class="num">${p.planned_minutes} min</b>${dlg.fm ? `<span>Tiempo enfocado</span><b class="num">${dlg.fm} min</b>` : ""}</div>
  ${running ? `<div class="demo"><span>Hay una sesión de enfoque en curso: se finaliza al completar.</span></div>` : ""}
  ${dlg.fm > 240 ? `<div class="demo"><span>Enfocaste ${dlg.fm} min. Una actividad tiene como máximo 240 min.</span></div>` : ""}
  <div class="row2"><div class="field"><label for="pcMin">Minutos reales</label><input class="inp num" id="pcMin" type="number" min="1" max="240" step="1" value="${esc(f.min)}"></div>
  <div class="field"><label>Fecha real</label>${p.date < T ? `<div class="seg two">${[[T, "Hoy"], [p.date, fmtShort(p.date)]].map(([k, l]) => `<button type="button" data-pcdate="${k}" aria-pressed="${f.date === k}">${l}</button>`).join("")}</div>` : `<div class="inp static">Hoy</div>`}</div></div>
  <div class="field"><label>Intensidad real</label><div class="seg three">${[1, 2, 3].map((d) => `<button type="button" data-pcdiff="${d}" aria-pressed="${+f.diff === d}">${DIFF[d].name}<small>×${String(DIFF[d].mult).replace(".", ",")}</small></button>`).join("")}</div></div>
  <div class="field"><label for="pcNote">Nota (opcional)</label><input class="inp" id="pcNote" maxlength="120" value="${esc(f.note)}"></div>
  <div class="preview"><span>Ganarás</span><b class="num" id="pcXP">+${min >= 1 && min <= 240 ? actXP(min, +f.diff) : 0} XP</b></div>
  ${dlg.err ? `<div class="err">${dlg.err}</div>` : ""}
  <div class="modal-f"><button type="button" class="btn ghost" data-dlg-close>Cancelar</button><button type="submit" class="btn primary">Completar</button></div></form>`;
}
/** Crea la actividad real con el mismo id que la planificación. Las reglas de XP, Oro, racha, Boss y Objetivos son las de siempre. */
function completePlan() {
  readPlanComplete();
  const p = state.plans.get(dlg.id), f = dlg.f, min = Math.round(+f.min), T = todayKey();
  if (!p) { dlg = null; renderModal(); return; }
  if (!(min >= 1 && min <= 240)) { dlg.err = "Los minutos tienen que estar entre 1 y 240."; renderModal(); return; }
  const date = f.date && f.date <= T ? f.date : T;
  dlg = null; renderModal();
  if (planAct(p)) { toast("Esta planificación ya está completada."); render(); return; }   // doble toque
  focusFinishPlan(p.id);                                                                 // cierra la sesión en curso, si hay
  state.planMenu = null;
  addActivity(date, { cat: p.category, title: p.title, min, diff: +f.diff, xp: actXP(min, +f.diff), note: f.note.trim().slice(0, 120) }, p.id);
}

/* ============ Respaldo (versión 5) ============ */
function planExport() {
  return { planned_activities: livePlans().sort(byTime), focus_sessions: liveFocus().sort((a, b) => a.started_at.localeCompare(b.started_at)) };
}
function parsePlans(j) {
  const arr = (x) => (Array.isArray(x) ? x : []), plans = [], focus = []; let skipped = 0;
  const day = /^\d{4}-\d{2}-\d{2}$/;
  for (const r of arr(j.planned_activities)) {
    const min = Math.round(+(r && r.planned_minutes)), diff = +(r && r.intensity);
    if (!r || !UUIDre.test(r.id) || !day.test(r.date) || isNaN(fromKey(r.date)) || typeof r.title !== "string" || !r.title.trim() || !CAT[r.category] || !(min >= 1 && min <= 240) || !DIFF[diff]) { skipped++; continue; }
    const c = isoOr(r.created_at, nowISO());
    plans.push({ id: r.id.toLowerCase(), date: r.date, time: typeof r.time === "string" && /^\d{2}:\d{2}/.test(r.time) ? r.time.slice(0, 5) : null, title: r.title.trim().slice(0, 80), category: r.category,
      planned_minutes: min, intensity: diff, note: typeof r.note === "string" ? r.note.trim().slice(0, 120) : "", status: ["planned", "skipped", "cancelled"].includes(r.status) ? r.status : "planned",
      moved_from: typeof r.moved_from === "string" && day.test(r.moved_from) ? r.moved_from : null, created_at: c, updated_at: isoOr(r.updated_at, c), deleted_at: null });
  }
  for (const r of arr(j.focus_sessions)) {
    if (!r || !UUIDre.test(r.id) || (r.planned_activity_id && !UUIDre.test(r.planned_activity_id)) || typeof r.title !== "string" || !r.title.trim() || !CAT[r.category]
      || !["free", "pomodoro"].includes(r.mode) || !["running", "paused", "finished", "discarded"].includes(r.status) || isNaN(Date.parse(r.started_at))) { skipped++; continue; }
    const segs = cleanSegs(arr(r.segments));
    const c = isoOr(r.created_at, isoOr(r.started_at, nowISO()));
    focus.push({ id: r.id.toLowerCase(), planned_activity_id: r.planned_activity_id ? r.planned_activity_id.toLowerCase() : null, device_id: typeof r.device_id === "string" && r.device_id ? r.device_id.slice(0, 64) : "respaldo",
      title: r.title.trim().slice(0, 80), category: r.category, mode: r.mode, status: r.status, started_at: isoOr(r.started_at, c), segment_started_at: isoOr(r.segment_started_at, null), segments: segs,
      focus_seconds: Math.round(segSecs(segs)), pomodoro: r.mode === "pomodoro" ? pomoClean(r.pomodoro) : null, ended_at: isoOr(r.ended_at, null), created_at: c, updated_at: isoOr(r.updated_at, c), deleted_at: null });
  }
  return { plans, focus, skipped };
}
/** Un respaldo nunca completa una planificación (eso lo hace su actividad, que tiene el mismo id) ni revive una sesión terminada. */
function importPlans(P, mode, at) {
  const res = { plans: 0, focus: 0 };
  const inPlans = new Set(P.plans.map((p) => p.id)), plans = [];
  if (mode === "replace") for (const p of livePlans()) if (!inPlans.has(p.id) && !fActiveFor(p.id)) plans.push({ ...p, deleted_at: at, updated_at: at });
  for (const r of P.plans) { const l = state.plans.get(r.id); if (mode === "replace" || !l || Date.parse(r.updated_at) > Date.parse(l.updated_at)) { plans.push(mode === "replace" ? { ...r, updated_at: at } : r); res.plans++; } }
  if (plans.length) { for (const r of plans) state.plans.set(r.id, r); Store.put("plans", plans).catch(() => {}); }
  const inF = new Set(P.focus.map((f) => f.id)), focus = [];
  if (mode === "replace") for (const f of liveFocus()) if (!inF.has(f.id) && !fActive(f)) focus.push({ ...f, deleted_at: at, updated_at: at });
  for (const r of P.focus) {
    const l = state.focus.get(r.id);
    if (l && !l.deleted_at && (fEnded(l) || fActive(l))) continue;           // terminada: congelada; en curso: la maneja este dispositivo
    if (!(mode === "replace" || !l || Date.parse(r.updated_at) > Date.parse(l.updated_at))) continue;
    let row = { ...r, updated_at: mode === "replace" || !fEnded(r) ? at : r.updated_at };
    if (!fEnded(r)) {                                                          // una sesión "en curso" de un respaldo termina donde terminó su último tramo
      const end = row.segments.length ? row.segments[row.segments.length - 1][1] : row.started_at;
      row = { ...row, status: "finished", segment_started_at: null, ended_at: end, pomodoro: row.pomodoro ? { ...row.pomodoro, ends_at: null } : null };
    }
    focus.push(row); res.focus++;
  }
  if (focus.length) { for (const r of focus) state.focus.set(r.id, r); Store.put("focus", focus).catch(() => {}); }
  if (plans.length || focus.length) Sync.changed(300);
  return res;
}

/* ============ Ventanas y eventos ============ */
function planDlg(d) {
  if (d.type === "planForm") return planForm();
  if (d.type === "planMove") return planMoveForm();
  if (d.type === "planComplete") return planCompleteForm();
  return "";
}
document.addEventListener("click", (e) => {
  const t = e.target.closest("button"); if (!t || !t.dataset) return;
  const D = t.dataset;
  if (D.ptab) { state.planTab = D.ptab; state.planMenu = null; state.confirmPlan = null; render(); return; }
  if (D.pnew !== undefined) { openPlanEditor(D.pnew); return; }
  if (D.psel) { state.planSel = D.psel; state.planMenu = null; render(); return; }
  if (D.pmonth) { state.planMonth = D.pmonth; render(); return; }
  if (D.pmenu) { state.planMenu = state.planMenu === D.pmenu ? null : D.pmenu; state.confirmPlan = null; render(); return; }
  if (D.pedit) { state.planMenu = null; openPlanEditor(null, D.pedit); return; }
  if (D.pdup) { state.planMenu = null; openPlanEditor(null, null, D.pdup); return; }
  if (D.pmove) { state.planMenu = null; openPlanMove(D.pmove); return; }
  if (D.pskip) { setPlanStatus(D.pskip, "skipped"); return; }
  if (D.pcancel) { setPlanStatus(D.pcancel, "cancelled"); return; }
  if (D.preplan) { setPlanStatus(D.preplan, "planned"); return; }
  if (D.paskdel) { state.confirmPlan = D.paskdel; render(); return; }
  if (D.pnodel !== undefined) { state.confirmPlan = null; render(); return; }
  if (D.pdel) { deletePlan(D.pdel); return; }
  if (D.pdone) { openPlanComplete(D.pdone); return; }
  if (D.pstart) { focusStartFor(D.pstart); return; }
  if (D.poldtoggle !== undefined) { state.oldOpen = !state.oldOpen; render(); return; }
  if (D.pmore !== undefined) { state.agendaDays = (state.agendaDays || 14) + 14; render(); return; }
  if (D.srange) { state.statsRange = D.srange; render(); return; }
  if (dlg && dlg.type === "planForm") {
    if (D.plcat) { readPlanForm(); dlg.f.cat = D.plcat; renderModal(); return; }
    if (D.pldiff) { readPlanForm(); dlg.f.diff = +D.pldiff; renderModal(); return; }
  }
  if (dlg && dlg.type === "planMove" && D.pmq) { const i = document.getElementById("pmDate"); if (i) i.value = D.pmq; return; }
  if (dlg && dlg.type === "planComplete") {
    if (D.pcdiff) { readPlanComplete(); dlg.f.diff = +D.pcdiff; renderModal(); return; }
    if (D.pcdate) { readPlanComplete(); dlg.f.date = D.pcdate; renderModal(); return; }
  }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "pcMin" && dlg && dlg.type === "planComplete") {
    const m = Math.round(+e.target.value), x = document.getElementById("pcXP");
    if (x) x.textContent = `+${m >= 1 && m <= 240 ? actXP(m, +dlg.f.diff) : 0} XP`;
  }
});
document.addEventListener("submit", (e) => {
  if (e.target.id === "planForm") { e.preventDefault(); savePlan(); }
  else if (e.target.id === "planMoveForm") { e.preventDefault(); savePlanMove(); }
  else if (e.target.id === "planCompleteForm") { e.preventDefault(); completePlan(); }
});
