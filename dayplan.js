/* Life RPG — Plan del Día: reglas (puras, sin pantalla; se prueban en tests/plan-dia.test.js).
   El plan es una vista calculada: lee planificaciones, rutinas, Objetivos y Boss y propone qué hacer hoy.
   No da XP, Oro ni progreso, no crea planificaciones solo y no reemplaza a planned_activities: lo único que se
   guarda es el plan aceptado (ids, minutos y ajustes del día) en daily_plans.
   Todo es determinístico: el mismo estado y la misma hora dan siempre el mismo plan. Sin IA ni servicios externos. */

/* ============ Pesos (todos acá) ============ */
const DAY_PLAN_WEIGHTS = {
  priority: { critical: 60, high: 25, normal: 0, low: -10 },
  timed: 40,                 // con hora hoy
  routine: 20,               // rutina de hoy
  today: 15,                 // manual de hoy, sin hora
  overdue: 15, overduePerDay: 3,   // atrasada: +15, menos 3 por día de atraso (nunca menos de 0)
  ahead: 5, aheadMin: 30,    // adelantar de mañana o pasado: entra solo si llega a 30 puntos
  due: [[0, 45], [1, 35], [2, 20], [5, 10]],   // fecha límite: vencida u hoy, mañana, en 2 días, en 3 a 5 días
  goalComplete: 25, goalNear: 15, goalBehind: 10, goalCap: 25, goalNearPct: 0.7, goalPace: 1.2,
  bossDefeat: 25, bossWeak: 15, bossCap: 25, bossWeakPct: 0.2,
  focus: 20,
  finanzas: 8,
  energy: { low: { low: 10, normal: 0, high: -25 }, normal: { low: 0, normal: 0, high: 0 }, high: { low: 0, normal: 0, high: 5 } },
};
const DP_MAX = 6;                   // misiones como máximo: entra en una pantalla de celular
const DP_AHEAD_DAYS = 2;            // adelantar: mañana o pasado mañana
const DP_LATE_DAYS = 7;             // atrasadas vigentes: las mismas de "Atrasadas" (últimos 7 días)
const DP_SUG_MAX = 2;
const DP_PRIO = ["low", "normal", "high", "critical"], DP_ENERGY = ["low", "normal", "high"], DP_MODES = ["fixed", "flexible"];
const DP_PRIO_NAME = { low: "Baja", normal: "Normal", high: "Alta", critical: "Crítica" };
const DP_ENERGY_NAME = { low: "Baja", normal: "Normal", high: "Alta" };
const DP_DEFAULT_PREFS = { enabled: true, minutes: 180, energy: "normal", focus: "auto", finanzas: true, maxOverdue: 2 };

/** Preferencias guardadas (profiles.day_plan_prefs). Lo que no sea válido vuelve al valor por defecto. */
function dpPrefs(x) {
  const o = x && typeof x === "object" && !Array.isArray(x) ? x : {}, d = DP_DEFAULT_PREFS;
  const min = Math.round(+o.minutes);
  return {
    enabled: typeof o.enabled === "boolean" ? o.enabled : d.enabled,
    minutes: min >= 15 && min <= 720 ? min : d.minutes,
    energy: DP_ENERGY.includes(o.energy) ? o.energy : d.energy,
    focus: o.focus === "auto" || (typeof o.focus === "string" && CAT[o.focus]) ? o.focus : d.focus,
    finanzas: typeof o.finanzas === "boolean" ? o.finanzas : d.finanzas,
    maxOverdue: Number.isInteger(o.maxOverdue) && o.maxOverdue >= 0 && o.maxOverdue <= 3 ? o.maxOverdue : d.maxOverdue,
  };
}
/** Id de la fila de daily_plans de una fecha. Siempre el mismo, en cualquier dispositivo. */
const dpId = (date) => Store.toUUID("dayplan:" + date);
const dpMin = (t) => (typeof t === "string" && /^\d{2}:\d{2}/.test(t) ? +t.slice(0, 2) * 60 + +t.slice(3, 5) : null);
const dpHHMM = (m) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
const dpDays = (a, b) => Math.round((fromKey(b) - fromKey(a)) / 864e5);
/** "3 h 15 min", "45 min", "2 h" */
const dpDur = (m) => { m = Math.max(0, Math.round(m)); const h = Math.floor(m / 60), r = m % 60; return h ? `${h} h${r ? ` ${r} min` : ""}` : `${r} min`; };
/** "mañana", "el domingo", "el 3 nov" */
function dpDayWord(today, k) {
  const n = dpDays(today, k);
  if (n === 0) return "hoy"; if (n === 1) return "mañana"; if (n === -1) return "ayer";
  return Math.abs(n) <= 6 ? "el " + fmtWeek(k) : "el " + fmtShort(k);
}

/** Prioridad, energía y duración de una planificación. Una misión de rutina sin valor propio hereda el de su rutina. */
function dpAttrs(p, routines) {
  const seg = p.recurring_plan_id && routines && routines.get ? routines.get(p.recurring_plan_id) : null;
  const r = seg && !seg.deleted_at ? seg : null;
  const pick = (k, list, d) => (list.includes(p[k]) ? p[k] : r && list.includes(r[k]) ? r[k] : d);
  const own = DP_MODES.includes(p.duration_mode), src = own ? p : r && DP_MODES.includes(r.duration_mode) ? r : null;
  let mode = src ? src.duration_mode : "fixed", min = src && Number.isInteger(+src.minimum_minutes) && +src.minimum_minutes >= 1 ? Math.round(+src.minimum_minutes) : null;
  if (mode === "flexible" && !min) mode = "fixed";
  if (min) min = Math.min(min, p.planned_minutes);          // el servidor no los compara: la app usa siempre el menor
  return { priority: pick("priority", DP_PRIO, "normal"), energy: pick("energy_required", DP_ENERGY, "normal"), mode, min: mode === "flexible" ? min : null };
}

/* ============ Candidatas ============ */
/** Planificaciones que pueden entrar al plan de hoy, con su origen. Descarta lo hecho, omitido, cancelado,
    eliminado, las misiones sin tocar de una rutina pausada y lo que sacaste hoy. */
function dpCandidates(I) {
  const T = I.today, plans = [...I.plans].filter((p) => p && !p.deleted_at), removed = new Set(I.removed || []);
  const gone = rtSupersededFn(plans, I.routines || new Map(), T);
  const out = [];
  for (const p of plans) {
    if (p.status !== "planned" || I.isDone(p.id) || removed.has(p.id)) continue;
    const seg = p.recurring_plan_id && I.routines ? I.routines.get(p.recurring_plan_id) : null;
    if (seg && !seg.deleted_at && seg.active === false && !p.recurrence_edited) continue;   // rutina pausada
    const n = dpDays(p.date, T);   // días de atraso (negativo = futuro)
    let kind;
    if (n === 0) kind = p.recurring_plan_id ? "routine" : "today";
    else if (n > 0 && n <= DP_LATE_DAYS && !gone(p)) kind = "overdue";
    else if (n < 0 && -n <= DP_AHEAD_DAYS && !p.recurring_plan_id && !p.time) kind = "ahead";
    else continue;
    const at = n === 0 ? dpMin(p.time) : null;
    const timed = at !== null && at + p.planned_minutes > I.now;          // una hora que ya pasó entera pierde el ancla
    out.push({ p, id: p.id, kind, late: n > 0 ? n : 0, at: timed ? at : null, passedAt: at !== null && !timed ? at : null, attrs: dpAttrs(p, I.routines) });
  }
  return out;
}

/* ============ Puntos ============ */
/** Cuánto aportaría una misión a un objetivo o Boss del tipo dado: minutos, XP (fórmula de siempre) o 1 actividad */
function dpGain(type, cat, minutes, intensity) {
  if (type === "minutes" || type === "cat_minutes") return minutes;
  if (type === "xp" || type === "cat_xp") return actXP(minutes, intensity, cat);
  if (type === "activities" || type === "cat_activities") return 1;
  return 0;
}
const dpGoalTypes = ["minutes", "cat_minutes", "xp", "cat_xp", "activities", "cat_activities"];
const dpRelates = (g, cat) => dpGoalTypes.includes(g.goal_type) && (!g.category || g.category === cat);
/** Puntos de objetivo para una misión de esa categoría y minutos: el mejor objetivo, con tope */
function dpGoalPts(goals, cat, minutes, intensity, today) {
  const W = DAY_PLAN_WEIGHTS, dim = new Date(+today.slice(0, 4), +today.slice(5, 7), 0).getDate(), left = dim - +today.slice(8, 10) + 1;
  let best = null;
  for (const g of goals || []) {
    if (!dpRelates(g, cat) || !(g.target > 0) || g.progress >= g.target) continue;
    const rest = g.target - g.progress, c = dpGain(g.goal_type, cat, minutes, intensity);
    let pts = 0, text = "";
    if (c >= rest) { pts = W.goalComplete; text = `Completa el objetivo «${g.title}»`; }
    else {
      if (g.progress / g.target >= W.goalNearPct) { pts += W.goalNear; text = `Objetivo «${g.title}» cerca de completarse`; }
      if (rest / left > (g.target / dim) * W.goalPace) { pts += W.goalBehind; text = text || `Ayuda al objetivo «${g.title}»`; }
    }
    pts = Math.min(pts, W.goalCap);
    if (pts > 0 && (!best || pts > best.pts || (pts === best.pts && g.id < best.goal.id))) best = { pts, text, goal: g };
  }
  return best;
}
function dpBossPts(boss, cat, minutes, intensity) {
  const W = DAY_PLAN_WEIGHTS;
  if (!boss || !dpRelates(boss, cat) || !(boss.left > 0)) return null;
  const c = dpGain(boss.goal_type, cat, minutes, intensity);
  if (c >= boss.left) return { pts: W.bossDefeat, text: "⚔ Podría derrotar al Boss", defeat: true };
  if (boss.hp > 0 && boss.left / boss.hp < W.bossWeakPct) return { pts: W.bossWeak, text: "Daña al Boss, que está casi derrotado", defeat: false };
  return null;
}
/** Suma de factores de una candidata. Cada factor deja su razón en palabras. */
function dpScore(c, I) {
  const W = DAY_PLAN_WEIGHTS, p = c.p, a = c.attrs, f = [], T = I.today, S = I.settings || {}, P = I.prefs || DP_DEFAULT_PREFS;
  const add = (k, pts, text) => f.push({ k, pts, text });
  if (W.priority[a.priority]) add("priority", W.priority[a.priority], a.priority === "critical" ? "Prioridad Crítica" : a.priority === "high" ? "Prioridad Alta" : "Prioridad Baja");
  if (c.at !== null) add("origin", W.timed, `${c.kind === "routine" ? "Rutina de hoy · " : "Tiene hora: "}${p.time.slice(0, 5)}`);
  else if (c.kind === "routine") add("origin", W.routine, c.passedAt !== null ? `Rutina de hoy · era a las ${dpHHMM(c.passedAt)}` : "Rutina de hoy");
  else if (c.kind === "today") add("origin", W.today, c.passedAt !== null ? `Era a las ${dpHHMM(c.passedAt)}` : "Planificada para hoy");
  else if (c.kind === "overdue") add("origin", Math.max(0, W.overdue - W.overduePerDay * c.late), `Pendiente desde ${dpDayWord(T, p.date)}`);
  else if (c.kind === "ahead") add("origin", W.ahead, `Planificada para ${dpDayWord(T, p.date)}`);
  if (p.due_date && /^\d{4}-\d{2}-\d{2}$/.test(p.due_date)) {
    const d = dpDays(T, p.due_date), step = W.due.find(([lim]) => d <= lim);
    if (step) add("due", step[1], d < 0 ? `Venció ${dpDayWord(T, p.due_date)}` : d === 0 ? "Vence hoy" : `Vence ${dpDayWord(T, p.due_date)}`);
  }
  const goal = dpGoalPts(I.goals, p.category, c.dur, p.intensity, T);
  if (goal) add("goal", goal.pts, goal.text);
  const boss = dpBossPts(I.boss, p.category, c.dur, p.intensity);
  if (boss) add("boss", boss.pts, boss.text);
  const fk = S.focus || { kind: "auto" };
  if ((fk.kind === "category" && fk.ref === p.category)
    || (fk.kind === "goal" && (I.goals || []).some((g) => g.id === fk.ref && dpRelates(g, p.category)))
    || (fk.kind === "boss" && I.boss && dpRelates(I.boss, p.category))) add("focus", W.focus, "Tu foco de hoy");
  if (p.category === "finanzas" && P.finanzas !== false) add("finanzas", W.finanzas, "Finanzas es tu categoría prioritaria");
  const e = W.energy[S.energy || "normal"][a.energy] || 0;
  if (e) add("energy", e, e > 0 ? (a.energy === "low" ? "Tranquila, va con tu energía" : "Va con tu energía") : "Pide más energía de la que tenés hoy");
  return { score: f.reduce((t, x) => t + x.pts, 0), factors: f, defeat: !!(boss && boss.defeat), goalId: goal ? goal.goal.id : null };
}
/** Las razones que se muestran: las que más sumaron, sin números */
const dpReasons = (factors, n = 3) => factors.map((x, i) => ({ ...x, i })).filter((x) => x.pts >= 0 && x.text).sort((a, b) => b.pts - a.pts || a.i - b.i).slice(0, n).map((x) => x.text);
/** Orden fijo: Crítica primero, después puntos, hora, fecha, creación e id */
function dpCmp(a, b) {
  return (b.attrs.priority === "critical") - (a.attrs.priority === "critical") || b.score - a.score
    || (a.at ?? 9999) - (b.at ?? 9999) || a.p.date.localeCompare(b.p.date) || String(a.p.created_at).localeCompare(String(b.p.created_at)) || a.id.localeCompare(b.id);
}

/* ============ Horario ============ */
/** Ubica la lista en la línea del día: las de hora en su hora; las demás, en orden, en el primer hueco donde entran
    enteras, desde start y antes de medianoche. Devuelve null si alguna no entra. */
function dpSchedule(list, start) {
  const busy = list.filter((x) => x.at !== null).map((x) => ({ id: x.id, s: x.at, e: x.at + x.dur })).sort((a, b) => a.s - b.s);
  const placed = new Map(busy.map((b) => [b.id, b]));
  for (const x of list) {
    if (x.at !== null) continue;
    let t = start;
    for (const b of busy) { if (t + x.dur <= b.s) break; if (b.e > t) t = b.e; }
    if (t + x.dur > 1440) return null;
    const b = { id: x.id, s: t, e: t + x.dur };
    busy.push(b); busy.sort((p, q) => p.s - q.s || p.e - q.e); placed.set(x.id, b);
  }
  return placed;
}
const dpOverlap = (a, b) => a.at < b.at + b.dur && b.at < a.at + a.dur;

/* ============ El plan ============ */
/** Arma la propuesta.
    I: { today, now (minutos desde medianoche), plans, routines (Map), isDone(id), goals, boss, settings {minutes, energy, focus},
         prefs, removed (ids que sacaste hoy), forced (ids que agregaste a mano: entran primero, aunque no alcance el tiempo),
         overrides ({id: minutos} de flexibles reducidas a mano) } */
function buildDayPlan(I) {
  const W = DAY_PLAN_WEIGHTS, P = I.prefs || DP_DEFAULT_PREFS, S = I.settings || {}, budget0 = Math.max(0, Math.round(+S.minutes || 0));
  const forced = new Set(I.forced || []), ov = I.overrides || {};
  const start = Math.min(1440, Math.ceil(I.now / 5) * 5);
  const all = dpCandidates(I).map((c) => {
    const o = Math.round(+ov[c.id]), flex = c.attrs.mode === "flexible" && c.at === null;
    c.dur = flex && o >= c.attrs.min && o <= c.p.planned_minutes ? o : c.p.planned_minutes;
    c.flex = flex;
    Object.assign(c, dpScore(c, I));
    return c;
  }).sort(dpCmp);
  const byId = new Map(all.map((c) => [c.id, c]));
  // Atrasadas: como máximo las de más puntos (preferencia, 2 por defecto). Adelantadas: 1, al final y solo con 30 puntos.
  const lateKeep = new Set(all.filter((c) => c.kind === "overdue").slice(0, P.maxOverdue ?? 2).map((c) => c.id));
  const ahead = all.filter((c) => c.kind === "ahead" && c.score >= W.aheadMin).slice(0, 1);
  const pool = all.filter((c) => (c.kind !== "overdue" || lateKeep.has(c.id) || forced.has(c.id)) && c.kind !== "ahead");
  const seq = [...pool.filter((c) => forced.has(c.id)), ...pool.filter((c) => !forced.has(c.id)), ...ahead.filter((c) => !forced.has(c.id))];
  for (const c of all) if (c.kind === "ahead" && forced.has(c.id) && !seq.includes(c)) seq.unshift(c);
  const chosen = [], out = new Map(), critOut = [];
  let budget = budget0;
  const fits = (list) => dpSchedule(list, start);
  for (const c of seq) {
    const f = forced.has(c.id);
    if (!f && chosen.length >= DP_MAX) { out.set(c.id, "Tu plan ya tiene 6 misiones"); continue; }
    if (!f && c.dur > budget) { if (!(c.flex && c.attrs.min <= budget)) { out.set(c.id, "No entra en tu tiempo"); if (c.attrs.priority === "critical") critOut.push(c.id); } continue; }
    const clash = c.at !== null && chosen.find((x) => x.at !== null && dpOverlap(x, c));
    if (clash) { out.set(c.id, `Se superpone con ${clash.p.title} a las ${dpHHMM(clash.at)}`); continue; }
    if (!fits([...chosen, c])) { if (!c.flex) out.set(c.id, "No entra antes de medianoche"); continue; }
    chosen.push(c); budget -= c.dur;
  }
  // Flexibles que quedaron afuera: reducidas hasta su mínimo, si sobra tiempo
  for (const c of seq) {
    if (chosen.includes(c) || out.has(c.id)) continue;
    if (!c.flex || chosen.length >= DP_MAX || budget < c.attrs.min) { out.set(c.id, chosen.length >= DP_MAX ? "Tu plan ya tiene 6 misiones" : "No entra en tu tiempo"); continue; }
    const m = Math.max(c.attrs.min, Math.min(c.dur, Math.floor(budget / 5) * 5, budget));
    const r = { ...c, dur: m, reduced: m < c.p.planned_minutes };
    if (fits([...chosen, r])) { chosen.push(r); byId.set(c.id, r); budget -= m; } else out.set(c.id, "No entra en tu tiempo");
  }
  const placed = fits(chosen) || new Map();
  const items = chosen.map((c, i) => ({ c, i, b: placed.get(c.id) || { s: start, e: start + c.dur } }))
    .sort((x, y) => x.b.s - y.b.s || x.i - y.i)
    .map(({ c, b }) => ({ id: c.id, m: c.dur, kind: c.kind, start: b.s, end: b.e, timed: c.at !== null, reduced: !!c.reduced, defeat: c.defeat, reasons: dpReasons(c.factors) }));
  const total = items.reduce((t, x) => t + x.m, 0);
  return { items, total, free: Math.max(0, budget0 - total), budget: budget0, start,
    out: all.filter((c) => !chosen.some((x) => x.id === c.id)).map((c) => ({ id: c.id, why: out.get(c.id) || (c.kind === "overdue" ? "Otras atrasadas tienen más prioridad" : c.kind === "ahead" ? "Es de otro día" : "No entra en tu tiempo") })),
    critOut, suggestions: dpSuggestions(I, items, byId, budget0 - total), byId };
}

/** Sugerencias: un objetivo o el Boss que sumaría 15 puntos o más y no tiene ninguna misión de su categoría en el plan.
    Nunca entran solas: se crean solo si tocás "Agregar al plan". */
function dpSuggestions(I, items, byId, free) {
  if (free < 15) return [];
  const cats = new Set(items.map((x) => byId.get(x.id)?.p.category)), out = [];
  const mins = (type, rest) => (type === "cat_minutes" ? Math.max(15, Math.min(60, Math.round(rest / 15) * 15)) : 45);
  for (const g of I.goals || []) {
    if (!g.category || !dpRelates(g, g.category) || g.progress >= g.target || cats.has(g.category)) continue;
    const m = Math.min(mins(g.goal_type, g.target - g.progress), Math.floor(free / 15) * 15);
    const best = dpGoalPts([g], g.category, m, 2, I.today);
    if (best && best.pts >= 15) out.push({ key: "goal:" + g.id, category: g.category, minutes: m, pts: best.pts, title: `Dedicar ${m} min a ${CAT[g.category].name}`, why: g.label || g.title });
  }
  const b = I.boss;
  if (b && b.category && dpRelates(b, b.category) && b.left > 0 && !cats.has(b.category)) {
    const m = Math.min(mins(b.goal_type, b.left), Math.floor(free / 15) * 15), bp = dpBossPts(b, b.category, m, 2);
    if (bp) out.push({ key: "boss:" + b.id, category: b.category, minutes: m, pts: bp.pts, title: `Dedicar ${m} min a ${CAT[b.category].name}`, why: bp.defeat ? `Podría derrotar a ${b.name}` : `${b.name} está casi derrotado` });
  }
  const seen = new Set();
  return out.sort((a, b) => b.pts - a.pts || a.key.localeCompare(b.key)).filter((s) => !seen.has(s.category) && seen.add(s.category)).slice(0, DP_SUG_MAX);
}

/* ============ Aceptar ============ */
/** Misiones adelantadas de una lista (de mañana o pasado): antes de aceptar se pregunta qué hacer con cada una */
const dpAheadIds = (list, plans, today) => list.filter((x) => { const p = plans.get(x.id); return p && !p.deleted_at && p.date > today; }).map((x) => x.id);
/** Lo que se escribe al aceptar. choices: {id: "move" | "keep"} para las adelantadas.
    "move" usa la misma reprogramación del Planificador (planMoveRow: cambia la fecha y conserva moved_from).
    "keep" la saca del plan sin tocar la planificación. Nada da XP ni marca nada como completado. */
function dpAcceptRows(list, { today, at, plans, settings, removed = [], prev = null, choices = {}, done = [] }) {
  const planRows = [], keep = new Set();
  for (const id of dpAheadIds(list, plans, today)) {
    if (choices[id] === "move") planRows.push(planMoveRow(plans.get(id), today, null, at));
    else keep.add(id);
  }
  const seen = new Set(), items = [];
  for (const x of [...done, ...list]) { if (keep.has(x.id) || seen.has(x.id)) continue; seen.add(x.id); items.push({ id: x.id, m: Math.max(1, Math.min(240, Math.round(+x.m) || 1)) }); }
  const fk = (settings && settings.focus) || { kind: "auto" };
  const row = { id: dpId(today), date: today, available_minutes: Math.max(0, Math.min(1440, Math.round(+settings.minutes) || 0)), energy: DP_ENERGY.includes(settings.energy) ? settings.energy : "normal",
    focus_kind: ["auto", "category", "goal", "boss"].includes(fk.kind) ? fk.kind : "auto", focus_ref: fk.kind === "category" || fk.kind === "goal" ? String(fk.ref || "").slice(0, 64) || null : null,
    items: items.slice(0, 30), removed: [...new Set([...removed, ...keep])].slice(0, 100), accepted_at: at, closed_at: null,
    created_at: prev && prev.created_at ? prev.created_at : at, updated_at: at, deleted_at: null };
  return { planRows, row };
}

/* ============ Plan aceptado ============ */
/** Estado de las misiones de un plan guardado: hechas, pendientes y las que ya no están (eliminadas, omitidas, canceladas) */
function dpProgress(row, plans, isDone, actMin) {
  const done = [], pending = [];
  for (const x of row && Array.isArray(row.items) ? row.items : []) {
    const p = plans.get(x.id); if (!p || p.deleted_at) continue;
    if (isDone(p.id)) done.push({ ...x, p, real: actMin(p.id) });
    else if (p.status === "planned") pending.push({ ...x, p });
  }
  const planned = [...done, ...pending].reduce((t, x) => t + x.m, 0);
  return { done, pending, planned, real: done.reduce((t, x) => t + (x.real || 0), 0), count: done.length + pending.length };
}
/** "Si me atraso": las hechas tardaron 15 min o más de lo previsto, o una con hora pasó hace 30 min sin hacerse */
function dpBehind(prog, now) {
  if (!prog.pending.length) return false;
  const over = prog.done.reduce((t, x) => t + (x.real || 0) - x.m, 0) >= 15;
  const late = prog.pending.some((x) => { const t = dpMin(x.p.time); return t !== null && x.p.date && t + 30 < now; });
  return over || late;
}
/** Respaldo: filas de daily_plans válidas */
function dpParseRows(arr) {
  const out = []; let skipped = 0; const day = /^\d{4}-\d{2}-\d{2}$/, U = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const r of Array.isArray(arr) ? arr : []) {
    if (!r || !day.test(r.date) || !Array.isArray(r.items)) { skipped++; continue; }
    const items = r.items.filter((x) => x && U.test(x.id) && Number.isFinite(+x.m)).slice(0, 30).map((x) => ({ id: x.id.toLowerCase(), m: Math.max(1, Math.min(240, Math.round(+x.m))) }));
    const iso = (v) => (v && !isNaN(Date.parse(v)) ? new Date(v).toISOString() : null), at = iso(r.updated_at) || new Date().toISOString();
    out.push({ id: dpId(r.date), date: r.date, available_minutes: Math.max(0, Math.min(1440, Math.round(+r.available_minutes) || 0)), energy: DP_ENERGY.includes(r.energy) ? r.energy : "normal",
      focus_kind: ["auto", "category", "goal", "boss"].includes(r.focus_kind) ? r.focus_kind : "auto", focus_ref: typeof r.focus_ref === "string" ? r.focus_ref.slice(0, 64) : null,
      items, removed: (Array.isArray(r.removed) ? r.removed : []).filter((x) => U.test(x)).slice(0, 100).map((x) => x.toLowerCase()),
      accepted_at: iso(r.accepted_at), closed_at: iso(r.closed_at), created_at: iso(r.created_at) || at, updated_at: at, deleted_at: null });
  }
  return { rows: out, skipped };
}
