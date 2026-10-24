/* Life RPG — Rutinas (misiones recurrentes).
   Una rutina es una plantilla (tabla recurring_plans). Cada día que le toca se convierte en una planificación
   normal (planned_activities) con un id calculado de la familia de la rutina (series_id) y la fecha: así la PC
   y el celular nunca crean dos filas para el mismo día, aunque generen sin conexión.
   Una rutina no da XP ni Oro por existir: el progreso llega solo al completar cada misión, como siempre.

   Regla de fondo: una misión sin tocar la maneja la rutina; una misión que tocaste (recurrence_edited) es tuya
   y la rutina no la vuelve a cambiar. Lo completado y lo pasado nunca se modifican. */

/* ============ Reglas (puras: no guardan nada, se prueban en tests/rutinas.test.js) ============ */
const RT_WINDOW = 30;                                          // hoy y los 30 días siguientes
const RT_DAYS = [[1, "L", "Lunes"], [2, "M", "Martes"], [3, "X", "Miércoles"], [4, "J", "Jueves"], [5, "V", "Viernes"], [6, "S", "Sábado"], [7, "D", "Domingo"]];
const RT_PRESETS = [["all", "Todos", [1, 2, 3, 4, 5, 6, 7]], ["work", "Laborales", [1, 2, 3, 4, 5]], ["weekend", "Fin de semana", [6, 7]]];
/** Día de la semana de una fecha: 1 = lunes … 7 = domingo */
const isoDow = (k) => ((fromKey(k).getDay() + 6) % 7) + 1;
/** Id de la misión de una familia de rutinas en una fecha. Siempre el mismo, en cualquier dispositivo. */
const rtInstanceId = (series, date) => Store.toUUID("rutina:" + series + ":" + date);
const rtLive = (r) => !!r && !r.deleted_at;
const rtCovers = (r, k) => r.start_date <= k && (!r.end_date || r.end_date >= k);
/** Tramo que manda en una fecha: de los tramos vivos de la familia que cubren esa fecha, el que empezó más tarde.
    Si empatan, el más reciente (y si también empatan, el id mayor). Todos los dispositivos eligen el mismo. */
function rtWinner(segs, k) {
  let w = null;
  for (const r of segs) {
    if (!rtLive(r) || !rtCovers(r, k)) continue;
    if (!w || r.start_date > w.start_date || (r.start_date === w.start_date && (r.updated_at > w.updated_at || (r.updated_at === w.updated_at && r.id > w.id)))) w = r;
  }
  return w;
}
/** Familias de rutinas vivas: series_id → tramos */
function rtSeries(routines) {
  const m = new Map();
  for (const r of routines) if (rtLive(r)) { if (!m.has(r.series_id)) m.set(r.series_id, []); m.get(r.series_id).push(r); }
  return m;
}
const RT_FIELDS = ["date", "time", "title", "category", "planned_minutes", "intensity", "note", "reminder_minutes", "status", "moved_from", "deleted_at", "recurring_plan_id", "recurrence_date", "recurrence_edited"];
/** Cómo tiene que quedar la misión de un tramo en una fecha */
function rtExpected(seg, k) {
  return { date: k, time: seg.time || null, title: seg.title, category: seg.category, planned_minutes: seg.planned_minutes, intensity: seg.intensity, note: seg.note || "",
    reminder_minutes: seg.time && seg.reminder_minutes !== undefined ? seg.reminder_minutes : null, status: "planned", moved_from: null, deleted_at: null,
    recurring_plan_id: seg.id, recurrence_date: k, recurrence_edited: false };
}
/** Lista de filas, venga como Map (id → fila) o como lista */
const rtList = (x) => (x && typeof x.get === "function" && typeof x.values === "function" ? [...x.values()] : [...x]);
const rtSame = (a, b) => RT_FIELDS.every((f) => (a[f] ?? null) === (b[f] ?? null));

/** El generador. Recibe las rutinas, las planificaciones y la fecha de hoy, y devuelve las planificaciones que hay que
    escribir (crear, actualizar, revivir o quitar). Solo devuelve lo que cambió: una segunda pasada no escribe nada.
    opts: today, at (hora de la escritura), isDone(id) = tiene actividad real, hasFocus(id) = tiene sesión de enfoque. */
function routineRows(routines, plans, { today, at, isDone = () => false, hasFocus = () => false, days = RT_WINDOW }) {
  routines = [...routines];
  const byId = new Map(routines.map((r) => [r.id, r]));
  const series = rtSeries(routines);
  const planMap = new Map(rtList(plans).map((p) => [p.id, p]));
  const out = new Map(), end = addDays(today, days);
  // Sin tocar, sin completar y de hoy en adelante: la maneja la rutina
  const owned = (p) => !p.recurrence_edited && !isDone(p.id) && p.date >= today && p.date === p.recurrence_date;
  // 1. Cada día de la ventana que le toca a cada familia: crear, o poner igual que la rutina
  for (const [sid, segs] of series) {
    for (let k = today; k <= end; k = addDays(k, 1)) {
      const w = rtWinner(segs, k);
      if (!w || !w.active || !w.weekdays.includes(isoDow(k))) continue;
      const id = rtInstanceId(sid, k), ex = planMap.get(id), want = rtExpected(w, k);
      if (!ex) out.set(id, { id, ...want, created_at: at, updated_at: at });
      else if (ex.recurring_plan_id && owned(ex) && !rtSame(ex, want)) out.set(id, { ...ex, ...want, updated_at: at });
    }
  }
  // 2. Misiones ya creadas (también las de más allá de la ventana): actualizar o quitar las que la rutina ya no toca
  for (const p of planMap.values()) {
    if (!p.recurring_plan_id || out.has(p.id) || !owned(p)) continue;
    const seg = byId.get(p.recurring_plan_id);
    if (!rtLive(seg)) continue;                                  // rutina eliminada, o que todavía no llegó a este dispositivo
    const k = p.recurrence_date, sid = seg.series_id;
    if (p.id !== rtInstanceId(sid, k)) continue;
    const w = rtWinner(series.get(sid) || [], k);
    if (w ? !w.active : !seg.active) continue;                   // pausada: queda como la dejaste
    if (w && w.weekdays.includes(isoDow(k))) {
      const want = rtExpected(w, k);
      if (!rtSame(p, want)) out.set(p.id, { ...p, ...want, updated_at: at });
    } else if (!p.deleted_at && !hasFocus(p.id)) out.set(p.id, { ...p, deleted_at: at, updated_at: at });
  }
  return [...out.values()];
}

/** Datos de una rutina que salen del formulario (o de otra rutina, al duplicar) */
// Versión 8: prioridad, energía y duración flexible (solo las usa el Plan del Día; el generador no las copia a las misiones)
const RT_DATA = ["title", "description", "category", "weekdays", "start_date", "end_date", "time", "planned_minutes", "intensity", "note", "reminder_minutes", "priority", "energy_required", "duration_mode", "minimum_minutes"];
const RT_DEF = { description: "", note: "", priority: "normal", energy_required: "normal", duration_mode: "fixed" };
const rtData = (r) => Object.fromEntries(RT_DATA.map((k) => [k, k === "weekdays" ? [...r.weekdays] : r[k] ?? RT_DEF[k] ?? null]));
/** Rutina nueva: id nuevo y familia nueva (series_id = id) */
function rtCreate(fields, { id, at }) {
  return { ...rtData(fields), id, series_id: id, active: true, created_at: at, updated_at: at, deleted_at: null };
}
/** Duplicar: una rutina independiente, con id y series_id nuevos. Nunca hereda la familia de la original. */
function rtDuplicate(seg, { id, at, today, end = seg.end_date }) {
  const start = seg.start_date > today ? seg.start_date : today;
  return rtCreate({ ...rtData(seg), start_date: start, end_date: end && end >= start ? end : null }, { id, at });
}
/** "Esta y las siguientes" desde la fecha D: el tramo actual termina el día anterior y uno nuevo, de la misma familia,
    empieza en D con los datos nuevos. Los tramos de esa familia que empezaban después de D quedan reemplazados.
    Las misiones sin tocar desde D conservan su id y su recurrence_date; el generador las pasa al tramo nuevo. */
function rtSplit(seg, D, fields, { id, at, routines = [] }) {
  const later = [...routines].filter((r) => rtLive(r) && r.series_id === seg.series_id && r.id !== seg.id && r.start_date > D).map((r) => ({ ...r, deleted_at: at, updated_at: at }));
  if (seg.start_date >= D) return [{ ...seg, ...rtData(fields), start_date: seg.start_date, updated_at: at }, ...later];
  const next = { ...rtData(fields), id, series_id: seg.series_id, start_date: D, active: seg.active, created_at: at, updated_at: at, deleted_at: null };
  return [{ ...seg, end_date: addDays(D, -1), updated_at: at }, next, ...later];
}
/** Tramos de una familia que todavía cuentan (no terminaron antes de hoy) */
const rtOpenSegs = (routines, sid, today) => [...routines].filter((r) => rtLive(r) && r.series_id === sid && (!r.end_date || r.end_date >= today));
/** Misiones de una familia de hoy en adelante, sin tocar, sin completar y sin sesión de enfoque */
function rtFutureOwned(plans, segIds, { today, isDone = () => false, hasFocus = () => false }) {
  const ids = new Set(segIds);
  return rtList(plans).filter((p) => p.recurring_plan_id && ids.has(p.recurring_plan_id) && !p.deleted_at
    && !p.recurrence_edited && p.date >= today && !isDone(p.id) && !hasFocus(p.id));
}
/** Pausar: "remove" quita las misiones sin tocar (se deshace al reactivar), "skip" las deja omitidas a la vista, "keep" no toca nada */
function rtPausePlanRows(plans, segIds, mode, opts) {
  if (mode === "keep") return [];
  const list = rtFutureOwned(plans, segIds, opts);
  if (mode === "skip") return list.filter((p) => p.status === "planned").map((p) => ({ ...p, status: "skipped", updated_at: opts.at }));
  return list.map((p) => ({ ...p, deleted_at: opts.at, updated_at: opts.at }));
}
/** Eliminar la rutina con "Sí": se quitan sus planificaciones de hoy en adelante sin completar y sin sesión de enfoque.
    Nunca toca actividades reales, el Historial, XP, Oro ni sesiones de enfoque. */
function rtDeletePlanRows(plans, segIds, { today, at, isDone = () => false, hasFocus = () => false }) {
  const ids = new Set(segIds);
  return rtList(plans).filter((p) => p.recurring_plan_id && ids.has(p.recurring_plan_id) && !p.deleted_at
    && p.date >= today && !isDone(p.id) && !hasFocus(p.id)).map((p) => ({ ...p, deleted_at: at, updated_at: at }));
}
/** Atrasadas (decisión 2): una misión de rutina deja de verse en Atrasadas cuando llega la siguiente misión de su familia */
function rtLatestArrived(plans, routinesById, today) {
  const m = new Map();
  for (const q of plans) {
    if (!q.recurring_plan_id || q.deleted_at || q.recurrence_date > today) continue;
    const seg = routinesById.get(q.recurring_plan_id), sid = seg ? seg.series_id : q.recurring_plan_id;
    if (!m.has(sid) || m.get(sid) < q.recurrence_date) m.set(sid, q.recurrence_date);
  }
  return m;
}
function rtSupersededFn(plans, routinesById, today) {
  const latest = rtLatestArrived(plans, routinesById, today);
  return (p) => {
    if (!p.recurring_plan_id) return false;
    const seg = routinesById.get(p.recurring_plan_id), sid = seg ? seg.series_id : p.recurring_plan_id;
    return (latest.get(sid) || "") > p.recurrence_date;
  };
}
/** Texto de los días: "Todos los días", "Laborales", "Fin de semana" o "L · X · V" */
function rtDaysText(w) {
  const s = [...w].sort((a, b) => a - b).join("");
  if (s === "1234567") return "Todos los días";
  if (s === "12345") return "Laborales";
  if (s === "67") return "Fin de semana";
  return [...w].sort((a, b) => a - b).map((d) => RT_DAYS[d - 1][1]).join(" · ");
}

/* ============ En la app ============ */
const liveRoutines = () => [...state.routines.values()].filter(rtLive);
const rtById = () => state.routines;
const rtHasFocus = (id) => [...state.focus.values()].some((f) => !f.deleted_at && f.planned_activity_id === id);
const rtIsDone = (id) => !!planAct({ id });
const rtOpts = () => ({ today: todayKey(), at: nowISO(), isDone: rtIsDone, hasFocus: rtHasFocus });
/** Crea y acomoda las misiones de las rutinas. Corre al abrir, después de sincronizar, al cambiar una rutina y al cambiar el día. */
function ensureRoutines() {
  if (!state.routines || !state.routines.size) return 0;
  const rows = routineRows(state.routines.values(), state.plans, rtOpts());
  if (rows.length) putPlans(rows);
  return rows.length;
}
function putRoutines(rows) {
  for (const r of rows) state.routines.set(r.id, r);
  Store.put("routines", rows).then(() => Sync.changed()).catch(() => toast("No se pudo guardar en este dispositivo."));
  if (!ensureRoutines()) render();
}
/** Tramo que se muestra en la tarjeta de una familia: el de hoy, si no el próximo, si no el último */
function rtCurrent(segs, T) {
  const w = rtWinner(segs, T); if (w) return w;
  const up = segs.filter((r) => r.start_date > T).sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
  return up || [...segs].sort((a, b) => b.start_date.localeCompare(a.start_date))[0];
}
/** Tramo de una misión de rutina (null si la rutina no está en este dispositivo o se eliminó) */
const rtSegOf = (p) => { const s = p && p.recurring_plan_id && state.routines.get(p.recurring_plan_id); return rtLive(s) ? s : null; };
const rtIco = (p) => (p && p.recurring_plan_id ? `<span class="rt-ico" title="De una rutina" aria-label="De una rutina">${ico("repeat")}</span>` : "");

/* ---- Pestaña Rutinas ---- */
function vRoutinesTab() {
  const T = todayKey(), fam = [...rtSeries(liveRoutines())].map(([sid, segs]) => {
    const cur = rtCurrent(segs, T), ended = segs.every((r) => r.end_date && r.end_date < T);
    return { sid, segs, cur, ended, paused: !ended && !cur.active };
  }).sort((a, b) => (a.paused || a.ended) - (b.paused || b.ended) || a.ended - b.ended || (a.cur.time || "99").localeCompare(b.cur.time || "99") || a.cur.title.localeCompare(b.cur.title));
  const head = `<div class="panel-h"><div><h2>Misiones recurrentes</h2><span class="muted-s">Cada día que toca aparece en Hoy y en tu Agenda. Completar cada día da XP como siempre.</span></div><button class="btn sm primary" data-rtnew>${ico("plus").replace("<svg", "<svg width='14' height='14'")} Nueva rutina</button></div>`;
  if (!fam.length) return `<section class="panel">${head}<div class="empty">${ico("repeat")}<div>Todavía no tienes rutinas. Crea una para lo que repites cada semana: el gym, tu curso, leer.</div><button class="btn primary" data-rtnew>${ico("plus")} Crear tu primera rutina</button></div></section>`;
  return `<section class="panel">${head}<div class="rt-list">${fam.map(rtCard).join("")}</div></section>`;
}
function rtCard({ sid, segs, cur, ended, paused }) {
  const T = todayKey(), r = cur, st = ended ? "Terminada" : paused ? "Pausada" : "Activa";
  const next = segs.filter((s) => s.start_date > T && s.start_date > r.start_date).sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
  const l1 = [rtDaysText(r.weekdays), r.time ? `<span class="num">${r.time}</span>` : "Sin hora", `<span class="num">${r.planned_minutes} min</span>`];
  const l2 = [`<em>${CAT[r.category].name}</em>`, DIFF[r.intensity].name];
  if (r.time && r.reminder_minutes != null) l2.push(`<span class="p-rem">${ico("bell")}${remText(r.reminder_minutes)}</span>`);
  const dates = [];
  if (r.start_date > T) dates.push(`Empieza el ${fmtShort(r.start_date)}`);
  if (r.end_date) dates.push(`${r.end_date < T ? "Terminó" : "Termina"} el ${fmtShort(r.end_date)}`);
  if (next) dates.push(`Cambia desde el ${fmtShort(next.start_date)}`);
  const open = state.rtMenu === sid;
  let menu = "";
  if (state.rtConfirm === sid) menu = "";
  else if (open) menu = `<div class="plan-menu">${paused ? `<button class="btn sm ghost" data-rtedit="${r.id}">${ico("edit")} Editar</button>` : ended ? "" : `<button class="btn sm ghost" data-rtpause="${sid}">${ico("pause")} Pausar</button>`}<button class="btn sm ghost" data-rtdup="${r.id}">Duplicar</button><button class="btn sm ghost danger" data-rtdel="${sid}">${ico("trash")} Eliminar</button></div>`;
  return `<div class="rt-card c-${r.category}${paused || ended ? " off" : ""}"><div class="rt-top"><div class="cat-ico">${ico(r.category)}</div>
    <div class="rt-main"><div class="act-t">${esc(r.title)}</div><div class="act-m">${l1.join("<span>·</span>")}</div><div class="act-m">${l2.join("<span>·</span>")}</div>
    ${r.description ? `<div class="act-m rt-desc">${esc(r.description)}</div>` : ""}${dates.length ? `<div class="act-m">${dates.join(" · ")}</div>` : ""}</div>
    <span class="pstate ${paused || ended ? "" : "pst-today"}">${st}</span></div>
    <div class="plan-acts rt-acts">${paused ? `<button class="btn sm primary" data-rtresume="${sid}">${ico("play")} Reactivar</button>` : ended ? "" : `<button class="btn sm" data-rtedit="${r.id}">${ico("edit")} Editar</button>`}<button class="icon-btn" data-rtmenu="${sid}" aria-label="Más acciones" aria-expanded="${open}">${ico("more")}</button></div>${menu}</div>`;
}

/* ---- Formulario de rutina ---- */
/** mode: new | edit (toda la rutina) | split (esta y las siguientes, desde from) | dup */
function openRoutineEditor({ mode = "new", seg = null, from = null } = {}) {
  const T = todayKey(), base = seg || { title: "", category: "curso", weekdays: [1, 2, 3, 4, 5, 6, 7], time: null, planned_minutes: 30, intensity: 2, note: "", description: "",
    start_date: T, end_date: null, reminder_minutes: Notify.defaultReminder() };
  const rem = base.reminder_minutes ?? null;
  const start = mode === "split" ? from : mode === "dup" ? (base.start_date > T ? base.start_date : T) : base.start_date;
  // Al duplicar, la fecha de fin es la de la rutina completa (la del último tramo), no la de un corte de "Esta y las siguientes"
  const lastEnd = mode === "dup" && seg ? [...rtSeries(liveRoutines()).get(seg.series_id) || [seg]].sort((x, y) => y.start_date.localeCompare(x.start_date))[0].end_date : base.end_date;
  const end = lastEnd && lastEnd >= start ? lastEnd : null;
  dlg = { type: "rtForm", mode, segId: seg ? seg.id : null, from, err: "", f: { title: base.title, cat: base.category, days: [...base.weekdays], time: base.time || "", min: base.planned_minutes, diff: base.intensity,
    rem: rem === null ? "" : String(rem), remCustom: rem !== null && !Notify.REM.some(([v]) => v === String(rem)), start, endOn: !!end, end: end || "", desc: base.description || "", note: base.note || "",
    more: !!(end || base.description || base.note || start > T),
    prio: base.priority ?? null, energy: base.energy_required ?? null, mode: base.duration_mode ?? null, minm: base.minimum_minutes ?? "",
    dpOpen: !!((base.priority && base.priority !== "normal") || (base.energy_required && base.energy_required !== "normal") || base.duration_mode === "flexible") } };
  renderModal(); setTimeout(() => document.getElementById("rtTitle")?.focus(), 30);
}
function readRoutineForm() {
  const g = (i) => document.getElementById(i); if (!g("rtTitle") || !dlg) return;
  const f = dlg.f; f.title = g("rtTitle").value; f.time = g("rtTime").value; f.min = g("rtMin").value;
  if (g("rtRem")) { f.remCustom = g("rtRem").value === "custom"; if (!f.remCustom) f.rem = g("rtRem").value; else if (g("rtRemC")) f.rem = g("rtRemC").value; }
  if (g("rtStart")) f.start = g("rtStart").value;
  if (g("rtEndOn")) f.endOn = g("rtEndOn").value === "date";
  if (g("rtEnd")) f.end = g("rtEnd").value;
  if (g("rtDesc")) f.desc = g("rtDesc").value;
  if (g("rtNote")) f.note = g("rtNote").value;
  if (g("rtMinM")) f.minm = g("rtMinM").value;
}
function routineForm() {
  const f = dlg.f, T = todayKey(), seg = dlg.segId ? state.routines.get(dlg.segId) : null;
  const startLocked = dlg.mode === "split" || (dlg.mode === "edit" && seg && seg.start_date < T);
  const title = { new: "Nueva rutina", dup: "Duplicar rutina", edit: "Editar toda la rutina", split: "Editar esta y las siguientes" }[dlg.mode];
  const sub = dlg.mode === "split" ? `Los cambios valen desde el ${fmtLong(dlg.from)}. Los días anteriores no cambian.` : dlg.mode === "edit" ? "Cambia las misiones futuras que no tocaste. Las pasadas, las completadas y las que editaste no cambian." : "";
  const opts = Notify.REM.concat([["custom", "Personalizado"]]), sel = f.remCustom ? "custom" : f.rem;
  return `<form class="modal" id="rtForm" role="dialog" aria-modal="true" aria-labelledby="rtH">
  <div><div class="eyebrow">Rutina · no da XP hasta completar cada día</div><h2 id="rtH">${title}</h2>${sub ? `<p class="muted-s" style="margin:6px 0 0">${sub}</p>` : ""}</div>
  <div class="field"><label for="rtTitle">Nombre</label><input class="inp" id="rtTitle" maxlength="80" placeholder="Ej.: Curso de Data" value="${esc(f.title)}"></div>
  <div class="field"><label>Categoría</label><div class="seg cat5">${CATS.map((c) => `<button type="button" class="c-${c.id}" data-rtcat="${c.id}" aria-pressed="${f.cat === c.id}">${ico(c.id)}${c.name}</button>`).join("")}</div></div>
  <div class="field"><label>Repetir</label><div class="rt-presets">${RT_PRESETS.map(([id, l, d]) => `<button type="button" class="btn sm ${rtDaysText(f.days) === rtDaysText(d) && f.days.length === d.length ? "on" : "ghost"}" data-rtpreset="${id}">${l}</button>`).join("")}</div>
    <div class="rt-days" role="group" aria-label="Días de la semana">${RT_DAYS.map(([d, s, n]) => `<button type="button" data-rtday="${d}" aria-pressed="${f.days.includes(d)}" aria-label="${n}">${s}</button>`).join("")}</div></div>
  <div class="row2"><div class="field"><label for="rtTime">Hora (opcional)</label><input class="inp num" id="rtTime" type="time" value="${esc(f.time)}"></div>
  <div class="field"><label for="rtRem">Recordatorio</label><div class="rem-row"><select class="inp" id="rtRem" ${f.time ? "" : "disabled"}>${opts.map(([v, l]) => `<option value="${v}" ${sel === v ? "selected" : ""}>${l}</option>`).join("")}</select>
    ${f.remCustom ? `<input class="inp num" id="rtRemC" type="number" min="1" max="1440" step="1" value="${esc(f.rem || "")}" aria-label="Minutos antes"><span class="muted-s">min antes</span>` : ""}</div>
    <small class="muted-s" id="rtRemHint" ${f.time ? "hidden" : ""}>Solo con hora.</small></div></div>
  <div class="row2"><div class="field"><label for="rtMin">Duración (min)</label><input class="inp num" id="rtMin" type="number" min="1" max="240" step="1" value="${esc(f.min)}"></div>
  <div class="field"><label>Intensidad</label><div class="seg three">${[1, 2, 3].map((d) => `<button type="button" data-rtdiff="${d}" aria-pressed="${+f.diff === d}">${DIFF[d].name}</button>`).join("")}</div></div></div>
  <button type="button" class="old-late-h rt-more" data-rtmore aria-expanded="${f.more}">${ico(f.more ? "down" : "right")}<span>Más opciones</span></button>
  ${f.more ? `<div class="rt-more-body"><div class="row2"><div class="field"><label for="rtStart">Empieza</label>${startLocked ? `<div class="inp static">${fmtLong(f.start)}</div>` : `<input class="inp" id="rtStart" type="date" min="${T}" value="${f.start}">`}</div>
    <div class="field"><label for="rtEndOn">Termina</label><select class="inp" id="rtEndOn"><option value="never" ${f.endOn ? "" : "selected"}>Sin fecha de fin</option><option value="date" ${f.endOn ? "selected" : ""}>En una fecha</option></select>
    ${f.endOn ? `<input class="inp" id="rtEnd" type="date" min="${f.start > T ? f.start : T}" value="${esc(f.end)}" aria-label="Fecha de fin">` : ""}</div></div>
    <div class="field"><label for="rtDesc">Descripción (opcional)</label><input class="inp" id="rtDesc" maxlength="160" placeholder="Solo se ve en Rutinas" value="${esc(f.desc)}"></div>
    <div class="field"><label for="rtNote">Nota (opcional)</label><input class="inp" id="rtNote" maxlength="120" placeholder="Se copia a cada día" value="${esc(f.note)}"></div></div>` : ""}
  ${dpFormFields(f, null, { prefix: "rt", due: false })}
  ${dlg.err ? `<div class="err">${dlg.err}</div>` : ""}
  <div class="modal-f"><button type="button" class="btn ghost" data-dlg-close>Cancelar</button><button type="submit" class="btn primary">Guardar rutina</button></div></form>`;
}
function saveRoutine() {
  readRoutineForm();
  const f = dlg.f, T = todayKey(), title = f.title.trim(), min = Math.round(+f.min), seg = dlg.segId ? state.routines.get(dlg.segId) : null;
  const fail = (m) => { dlg.err = m; renderModal(); };
  if (!title) return fail("Escribe el nombre de la rutina.");
  if (!f.days.length) return fail("Elige al menos un día.");
  if (!(min >= 1 && min <= 240)) return fail("La duración tiene que estar entre 1 y 240 minutos.");
  if (f.time && !/^\d{2}:\d{2}$/.test(f.time)) return fail("La hora no es válida.");
  const rem = f.rem === "" || f.rem === null ? null : Math.round(+f.rem);
  if (f.time && rem !== null && !(rem >= (f.remCustom ? 1 : 0) && rem <= 1440)) return fail("El recordatorio va de 1 a 1440 minutos antes.");
  const dp = dpFormRead(f, min, { due: false, routine: true }); if (dp.err) return fail(dp.err);
  const startLocked = dlg.mode === "split" || (dlg.mode === "edit" && seg && seg.start_date < T);
  const start = startLocked ? (dlg.mode === "split" ? dlg.from : seg.start_date) : f.start;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start || "") || isNaN(fromKey(start))) return fail("Elige la fecha de inicio.");
  if (!startLocked && start < T && !(seg && start === seg.start_date)) return fail("La rutina puede empezar hoy o más adelante.");
  if (f.endOn && (!/^\d{4}-\d{2}-\d{2}$/.test(f.end || "") || f.end < start || f.end < T)) return fail("La fecha de fin tiene que ser desde el inicio y no antes de hoy.");
  const fields = { title: title.slice(0, 80), description: f.desc.trim().slice(0, 160), category: f.cat, weekdays: [...f.days].sort((a, b) => a - b), start_date: start, end_date: f.endOn ? f.end : null,
    time: f.time || null, planned_minutes: min, intensity: +f.diff, note: f.note.trim().slice(0, 120), reminder_minutes: f.time ? rem : null, ...dp.cols };
  const at = nowISO(), mode = dlg.mode;
  dlg = null; renderModal();
  if (mode === "edit" && seg) putRoutines([{ ...seg, ...fields, updated_at: at }]);
  else if (mode === "split" && seg) putRoutines(rtSplit(seg, start, fields, { id: Store.newId(), at, routines: state.routines.values() }));
  else putRoutines([rtCreate(fields, { id: Store.newId(), at })]);
  toast(mode === "new" || mode === "dup" ? `Rutina creada: <b>${esc(fields.title)}</b>. Sus misiones ya están en tu Agenda.` : "Rutina actualizada.");
}

/* ---- Editar una misión de rutina: ¿qué querés modificar? ---- */
function openRoutineScope(planId) {
  const p = state.plans.get(planId);
  if (!p || !rtSegOf(p)) { openPlanEditor(null, planId); return; }
  dlg = { type: "rtScope", id: planId }; renderModal();
}
function routineScopeDlg() {
  const p = state.plans.get(dlg.id); if (!p) { dlg = null; return ""; }
  const o = (v, t, d) => `<button type="button" class="sheet-row" data-rtscope="${v}"><span class="sr-t"><b>${t}</b><small>${d}</small></span>${ico("right", "chev")}</button>`;
  return `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="rsH"><div><div class="eyebrow">${rtIco(p)} Misión de rutina</div><h2 id="rsH">¿Qué quieres modificar?</h2><span class="muted-s">${esc(p.title)} · ${fmtLong(p.date)}</span></div>
  <div class="rt-scope">${o("one", "Solo esta", "Cambia solo este día. El resto de la rutina sigue igual.")}${o("next", "Esta y las siguientes", "Desde este día en adelante, con los datos nuevos.")}${o("all", "Toda la rutina", "Cambia las misiones futuras que no tocaste.")}</div>
  <div class="modal-f"><button type="button" class="btn ghost" data-dlg-close>Cancelar</button></div></div>`;
}
/** Tramo que se abre al elegir "Esta y las siguientes" o "Toda la rutina" desde una misión: siempre el de la misión */
function routineScopeTarget(p) { return rtSegOf(p); }
function chooseScope(v) {
  const p = state.plans.get(dlg.id), seg = routineScopeTarget(p); dlg = null;
  if (!p || !seg) { renderModal(); return; }
  if (v === "one") openPlanEditor(null, p.id);
  else if (v === "next") { const T = todayKey(); openRoutineEditor({ mode: "split", seg, from: p.recurrence_date > T ? p.recurrence_date : T }); }
  else openRoutineEditor({ mode: "edit", seg });
}

/* ---- Pausar, reactivar, duplicar, eliminar ---- */
function openRoutinePause(sid) { state.rtMenu = null; dlg = { type: "rtPause", sid, choice: "remove" }; renderModal(); }
function routinePauseDlg() {
  const segs = rtOpenSegs(state.routines.values(), dlg.sid, todayKey()); if (!segs.length) { dlg = null; return ""; }
  const r = rtCurrent(segs, todayKey()), o = (v, t, d) => `<label class="rt-opt"><input type="radio" name="rtp" value="${v}" ${dlg.choice === v ? "checked" : ""}><span><b>${t}</b><small>${d}</small></span></label>`;
  return `<form class="modal" id="rtPauseForm" role="dialog" aria-modal="true" aria-labelledby="rpH"><div><div class="eyebrow">Pausar rutina</div><h2 id="rpH">${esc(r.title)}</h2><span class="muted-s">Mientras está pausada no se crean misiones nuevas. Lo completado nunca se toca.</span></div>
  <div class="field"><label>¿Qué hacemos con las misiones futuras que ya están creadas?</label>
  ${o("remove", "Quitar las que no tocaste (recomendado)", "Vuelven solas al reactivar. Las que editaste o reprogramaste se quedan.")}${o("keep", "Mantenerlas", "Quedan como están.")}${o("skip", "Omitirlas", "Quedan como omitidas, a la vista.")}</div>
  <div class="modal-f"><button type="button" class="btn ghost" data-dlg-close>Cancelar</button><button type="submit" class="btn primary">${ico("pause")} Pausar</button></div></form>`;
}
function pauseRoutine() {
  const choice = document.querySelector("input[name=rtp]:checked")?.value || "remove", sid = dlg.sid; dlg = null; renderModal();
  const o = rtOpts(), segs = rtOpenSegs(state.routines.values(), sid, o.today); if (!segs.length) return;
  const plans = rtPausePlanRows(state.plans, segs.map((r) => r.id), choice, o);
  for (const r of plans) state.plans.set(r.id, r);
  if (plans.length) Store.put("plans", plans).catch(() => {});
  putRoutines(segs.map((r) => ({ ...r, active: false, updated_at: o.at })));
  toast("Rutina pausada. Tu racha y tu XP no cambian.");
}
function resumeRoutine(sid) {
  state.rtMenu = null;
  const at = nowISO(), segs = rtOpenSegs(state.routines.values(), sid, todayKey()); if (!segs.length) return;
  putRoutines(segs.map((r) => ({ ...r, active: true, updated_at: at })));
  toast("Rutina reactivada desde hoy.");
}
function openRoutineDelete(sid) { state.rtMenu = null; dlg = { type: "rtDelete", sid }; renderModal(); }
function routineDeleteDlg() {
  const segs = liveRoutines().filter((r) => r.series_id === dlg.sid); if (!segs.length) { dlg = null; return ""; }
  const r = rtCurrent(segs, todayKey());
  return `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="rdH"><div><div class="eyebrow">Eliminar rutina · ${esc(r.title)}</div><h2 id="rdH">¿Eliminar las planificaciones futuras de esta rutina?</h2>
  <span class="muted-s">Las actividades que ya completaste, tu Historial, XP, Oro y sesiones de enfoque no cambian.</span></div>
  <div class="modal-f rt-del-btns"><button type="button" class="btn ghost" data-dlg-close>Cancelar</button><button type="button" class="btn" data-rtdelgo="no">No, dejarlas sueltas</button><button type="button" class="btn danger" data-rtdelgo="yes">Sí, eliminarlas</button></div></div>`;
}
function deleteRoutine(withPlans) {
  const sid = dlg.sid; dlg = null; renderModal();
  const o = rtOpts(), segs = liveRoutines().filter((r) => r.series_id === sid); if (!segs.length) return;
  const plans = withPlans ? rtDeletePlanRows(state.plans, segs.map((r) => r.id), o) : [];
  for (const r of plans) state.plans.set(r.id, r);
  if (plans.length) Store.put("plans", plans).catch(() => {});
  putRoutines(segs.map((r) => ({ ...r, deleted_at: o.at, updated_at: o.at })));
  toast(withPlans ? "Rutina eliminada junto con sus misiones futuras." : "Rutina eliminada. Sus misiones futuras quedan como planificaciones sueltas.");
}

/* ---- Estadísticas (decisión 5): solo información ---- */
function routineStats(from, to) {
  const T = todayKey(), active = [...rtSeries(liveRoutines()).values()].filter((segs) => { const c = rtCurrent(segs, T); return c.active && !(segs.every((r) => r.end_date && r.end_date < T)); }).length;
  const list = livePlans().filter((p) => p.recurring_plan_id && p.date >= from && p.date <= to && p.status !== "cancelled" && !(p.status === "skipped" && !p.recurrence_edited));
  const done = list.filter((p) => planAct(p)).length;
  return { active, total: list.length, done };
}

/* ---- Respaldo (versión 7) ---- */
function routineExport() { return { recurring_plans: liveRoutines().sort((a, b) => a.created_at.localeCompare(b.created_at)) }; }
function parseRoutines(j) {
  const out = []; let skipped = 0; const day = /^\d{4}-\d{2}-\d{2}$/;
  for (const r of Array.isArray(j.recurring_plans) ? j.recurring_plans : []) {
    const min = Math.round(+(r && r.planned_minutes)), diff = +(r && r.intensity);
    const wd = r && Array.isArray(r.weekdays) ? [...new Set(r.weekdays.map(Number))] : [];
    if (!r || !UUIDre.test(r.id) || (r.series_id && !UUIDre.test(r.series_id)) || typeof r.title !== "string" || !r.title.trim() || !CAT[r.category] || !(min >= 1 && min <= 240) || !DIFF[diff]
      || !wd.length || !wd.every((d) => Number.isInteger(d) && d >= 1 && d <= 7) || !day.test(r.start_date) || isNaN(fromKey(r.start_date))
      || (r.end_date != null && (!day.test(r.end_date) || r.end_date < r.start_date))) { skipped++; continue; }
    const time = typeof r.time === "string" && /^\d{2}:\d{2}/.test(r.time) ? r.time.slice(0, 5) : null, c = isoOr(r.created_at, nowISO());
    out.push({ id: r.id.toLowerCase(), series_id: (r.series_id || r.id).toLowerCase(), title: r.title.trim().slice(0, 80), description: typeof r.description === "string" ? r.description.trim().slice(0, 160) : "",
      category: r.category, weekdays: wd.sort((a, b) => a - b), start_date: r.start_date, end_date: r.end_date || null, time, planned_minutes: min, intensity: diff,
      note: typeof r.note === "string" ? r.note.trim().slice(0, 120) : "", reminder_minutes: time && Number.isInteger(r.reminder_minutes) && r.reminder_minutes >= 0 && r.reminder_minutes <= 1440 ? r.reminder_minutes : null,
      active: r.active !== false, ...dpColsOf(r, false), created_at: c, updated_at: isoOr(r.updated_at, c), deleted_at: null });   // respaldo versión 8
  }
  return { routines: out, skipped };
}
/** Combinar: gana la versión más reciente (una rutina que eliminaste después del respaldo no revive). Reemplazar: queda lo del archivo. */
function importRoutines(P, mode, at) {
  const list = P.routines || [], inFile = new Set(list.map((r) => r.id)), rows = [];
  if (mode === "replace") for (const r of liveRoutines()) if (!inFile.has(r.id)) rows.push({ ...r, deleted_at: at, updated_at: at });
  let n = 0;
  for (const r of list) { const l = state.routines.get(r.id); if (mode === "replace" || !l || Date.parse(r.updated_at) > Date.parse(l.updated_at)) { rows.push(mode === "replace" ? { ...r, updated_at: at } : r); n++; } }
  if (rows.length) { for (const r of rows) state.routines.set(r.id, r); Store.put("routines", rows).catch(() => {}); Sync.changed(300); }
  return n;
}

/* ---- Ventanas y eventos ---- */
function routineDlg(d) {
  if (d.type === "rtForm") return routineForm();
  if (d.type === "rtScope") return routineScopeDlg();
  if (d.type === "rtPause") return routinePauseDlg();
  if (d.type === "rtDelete") return routineDeleteDlg();
  return "";
}
document.addEventListener("click", (e) => {
  const t = e.target.closest("button"); if (!t || !t.dataset) return;
  const D = t.dataset;
  if (D.rtnew !== undefined) { openRoutineEditor(); return; }
  if (D.rtedit) { state.rtMenu = null; const r = state.routines.get(D.rtedit); if (r) openRoutineEditor({ mode: "edit", seg: r }); return; }
  if (D.rtdup) { state.rtMenu = null; const r = state.routines.get(D.rtdup); if (r) openRoutineEditor({ mode: "dup", seg: r }); return; }
  if (D.rtmenu) { state.rtMenu = state.rtMenu === D.rtmenu ? null : D.rtmenu; render(); return; }
  if (D.rtpause) { openRoutinePause(D.rtpause); return; }
  if (D.rtresume) { resumeRoutine(D.rtresume); return; }
  if (D.rtdel) { openRoutineDelete(D.rtdel); return; }
  if (D.rtdelgo && dlg && dlg.type === "rtDelete") { deleteRoutine(D.rtdelgo === "yes"); return; }
  if (D.rtscope && dlg && dlg.type === "rtScope") { chooseScope(D.rtscope); return; }
  if (dlg && dlg.type === "rtForm") {
    if (dpFormClick(D, readRoutineForm)) return;
    if (D.rtcat) { readRoutineForm(); dlg.f.cat = D.rtcat; renderModal(); return; }
    if (D.rtdiff) { readRoutineForm(); dlg.f.diff = +D.rtdiff; renderModal(); return; }
    if (D.rtday) { readRoutineForm(); const d = +D.rtday, s = new Set(dlg.f.days); s.has(d) ? s.delete(d) : s.add(d); dlg.f.days = [...s].sort((a, b) => a - b); renderModal(); document.querySelector(`[data-rtday="${d}"]`)?.focus(); return; }
    if (D.rtpreset) { readRoutineForm(); dlg.f.days = [...RT_PRESETS.find(([id]) => id === D.rtpreset)[2]]; renderModal(); return; }
    if (D.rtmore !== undefined) { readRoutineForm(); dlg.f.more = !dlg.f.more; renderModal(); return; }
  }
});
document.addEventListener("change", (e) => {
  if (!dlg || dlg.type !== "rtForm") return;
  if (e.target.id === "rtRem") { readRoutineForm(); if (dlg.f.remCustom && !(+dlg.f.rem >= 1)) dlg.f.rem = "15"; renderModal(); document.getElementById(dlg.f.remCustom ? "rtRemC" : "rtRem")?.focus(); }
  if (e.target.id === "rtEndOn") { readRoutineForm(); renderModal(); document.getElementById(dlg.f.endOn ? "rtEnd" : "rtEndOn")?.focus(); }
  if (e.target.id === "rtStart") readRoutineForm();
});
document.addEventListener("input", (e) => {
  if (e.target.id === "rtTime" && dlg && dlg.type === "rtForm") {   // sin hora no hay recordatorio
    const r = document.getElementById("rtRem"), h = document.getElementById("rtRemHint");
    if (r) r.disabled = !e.target.value; if (h) h.hidden = !!e.target.value;
  }
});
document.addEventListener("submit", (e) => {
  if (e.target.id === "rtForm") { e.preventDefault(); saveRoutine(); }
  else if (e.target.id === "rtPauseForm") { e.preventDefault(); pauseRoutine(); }
});
