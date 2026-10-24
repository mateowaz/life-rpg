/* Plan del Día (dayplan.js): las mismas funciones que usa la app, sin pantalla.
   Hoy de prueba: lunes 26/10/2026, 9:00. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadRules } = require("./load.js");

const R = loadRules();
const fn = (n) => R.get(n);
const buildDayPlan = fn("buildDayPlan"), dpCandidates = fn("dpCandidates"), dpAcceptRows = fn("dpAcceptRows"), dpAheadIds = fn("dpAheadIds");
const dpProgress = fn("dpProgress"), dpBehind = fn("dpBehind"), dpPrefs = fn("dpPrefs"), dpAttrs = fn("dpAttrs"), dpId = fn("dpId"), W = fn("DAY_PLAN_WEIGHTS");
const routineRows = fn("routineRows"), rtCreate = fn("rtCreate");
const plain = (x) => JSON.parse(JSON.stringify(x));
const deq = (a, b, m) => assert.deepEqual(plain(a), plain(b), m);

const T = "2026-10-26", AT = "2026-10-26T09:00:00.000Z", NOW = 9 * 60;
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
function plan(o = {}) {
  return { id: o.id || uuid(), date: T, time: null, title: "Misión", category: "curso", planned_minutes: 60, intensity: 2, note: "", status: "planned", moved_from: null,
    reminder_minutes: null, recurring_plan_id: null, recurrence_date: null, recurrence_edited: false, priority: null, energy_required: null, duration_mode: null, minimum_minutes: null,
    due_date: null, created_at: "2026-10-20T10:00:00.000Z", updated_at: "2026-10-20T10:00:00.000Z", deleted_at: null, ...o };
}
/** Entrada del plan: plans es una lista; done, los ids que ya tienen actividad */
function input(plans, o = {}) {
  const done = new Set(o.done || []);
  return { today: T, now: NOW, plans, routines: o.routines || new Map(), isDone: (id) => done.has(id), goals: o.goals || [], boss: o.boss || null,
    settings: { minutes: 120, energy: "normal", focus: { kind: "auto" }, ...(o.settings || {}) }, prefs: dpPrefs(o.prefs || {}), removed: o.removed || [], forced: o.forced || [], overrides: o.overrides || {}, ...(o.extra || {}) };
}
const ids = (res) => plain(res.items.map((x) => x.id));
const titles = (res, plans) => plain(res.items.map((x) => plans.find((p) => p.id === x.id).title));
const sum = (res) => res.items.reduce((t, x) => t + x.m, 0);

test("Respeta el tiempo disponible: con 120 min no propone 240", () => {
  const plans = [plan({ title: "Finanzas", category: "finanzas", planned_minutes: 60 }), plan({ title: "Curso", planned_minutes: 60 }),
    plan({ title: "Físico", category: "fisico", planned_minutes: 90 }), plan({ title: "Lectura", category: "lectura", planned_minutes: 30 })];
  const res = buildDayPlan(input(plans));
  assert.ok(sum(res) <= 120, `suma ${sum(res)}`);
  assert.equal(sum(res), 120);
  deq(titles(res, plans).sort(), ["Curso", "Finanzas"], "las dos de más puntos (Finanzas +8 y la más vieja en el desempate)");
  // Si Físico es lo más importante, entra Físico + Lectura = 120
  plans[2].priority = "high";
  const r2 = buildDayPlan(input(plans));
  deq(titles(r2, plans).sort(), ["Físico", "Lectura"]);
  assert.equal(sum(r2), 120);
});

test("No rellena el tiempo: 3 h disponibles y 2 h de misiones = plan de 2 h y 1 h libre, sin agregar sugerencias solas", () => {
  const plans = [plan({ planned_minutes: 60 }), plan({ category: "lectura", planned_minutes: 60 })];
  const res = buildDayPlan(input(plans, { settings: { minutes: 180 }, goals: [{ id: "g1", title: "Finanzas", goal_type: "cat_minutes", category: "finanzas", target: 600, progress: 480 }] }));
  assert.equal(res.items.length, 2);
  assert.equal(res.total, 120);
  assert.equal(res.free, 60);
  assert.equal(res.suggestions.length, 1, "la sugerencia aparece aparte");
  assert.ok(!res.items.some((x) => x.id.startsWith("goal")), "la sugerencia no entra al plan");
  assert.equal(res.suggestions[0].category, "finanzas");
});

test("No selecciona completadas, omitidas, canceladas ni eliminadas", () => {
  const a = plan(), b = plan({ status: "skipped" }), c = plan({ status: "cancelled" }), d = plan({ deleted_at: AT }), e = plan({ title: "Esta sí" });
  const res = buildDayPlan(input([a, b, c, d, e], { done: [a.id], settings: { minutes: 600 } }));
  deq(ids(res), [e.id]);
});

test("Respeta la hora de una actividad con hora y ordena por hora", () => {
  const gym = plan({ title: "Entrenamiento", category: "fisico", time: "18:00", planned_minutes: 60 }), curso = plan({ title: "Curso", planned_minutes: 45 });
  const res = buildDayPlan(input([gym, curso], { settings: { minutes: 180 } }));
  const g = res.items.find((x) => x.id === gym.id), c = res.items.find((x) => x.id === curso.id);
  assert.equal(g.start, 18 * 60); assert.equal(g.end, 19 * 60); assert.ok(g.timed);
  assert.ok(c.start < g.start, "la sin hora va antes, en un hueco libre");
  deq(ids(res), [curso.id, gym.id]);
});

test("Evita solapamientos: un Curso de 120 min no va a las 17:00 con Entrenamiento a las 18:00", () => {
  const gym = plan({ title: "Entrenamiento", category: "fisico", time: "18:00", planned_minutes: 60 }), curso = plan({ title: "Curso", planned_minutes: 120 });
  const res = buildDayPlan(input([gym, curso], { now: 17 * 60, settings: { minutes: 240 }, extra: { now: 17 * 60 } }));
  const c = res.items.find((x) => x.id === curso.id);
  assert.ok(c, "el Curso entra");
  assert.ok(c.start >= 19 * 60, `el Curso empieza a las ${c.start / 60}`);
  // Dos con hora que se superponen: entra la de más puntos y la otra queda afuera con su razón
  const otra = plan({ title: "Reunión", time: "18:30", planned_minutes: 30 });
  const r2 = buildDayPlan(input([gym, otra], { settings: { minutes: 240 }, extra: { now: 17 * 60 } }));
  assert.equal(r2.items.length, 1);
  assert.match(r2.out.find((o) => o.id !== r2.items[0].id).why, /Se superpone con/);
});

test("Prioridad Crítica gana, y si no entra se avisa en vez de agregarla sola", () => {
  const crit = plan({ title: "Entregar proyecto", priority: "critical", planned_minutes: 60 }), rut = plan({ title: "Rutina", time: "10:00", planned_minutes: 60, category: "finanzas" });
  const res = buildDayPlan(input([rut, crit], { settings: { minutes: 60 } }));
  deq(ids(res), [crit.id]);
  const big = plan({ title: "Proyecto grande", priority: "critical", planned_minutes: 90 });
  const r2 = buildDayPlan(input([big], { settings: { minutes: 60 } }));
  assert.equal(r2.items.length, 0);
  deq(r2.critOut, [big.id]);
  const r3 = buildDayPlan(input([big], { settings: { minutes: 60 }, forced: [big.id] }));
  deq(ids(r3), [big.id], "\"Agregarla igual\" la suma aunque no alcance el tiempo");
});

test("Finanzas recibe un bonus moderado: gana un empate y nada más", () => {
  const c = plan({ title: "Curso", planned_minutes: 60, created_at: "2026-10-01T00:00:00.000Z" }), f = plan({ title: "Finanzas", category: "finanzas", planned_minutes: 60, created_at: "2026-10-02T00:00:00.000Z" });
  const res = buildDayPlan(input([c, f], { settings: { minutes: 60 } }));
  deq(ids(res), [f.id]);
  assert.equal(res.byId.get(f.id).score - res.byId.get(c.id).score, W.finanzas);
  assert.equal(W.finanzas, 8);
  assert.ok(res.items[0].reasons.includes("Finanzas es tu categoría prioritaria"));
  // Apagada en Perfil: gana la más vieja
  const r2 = buildDayPlan(input([c, f], { settings: { minutes: 60 }, prefs: { finanzas: false } }));
  deq(ids(r2), [c.id]);
});

test("Fecha límite cercana gana a Finanzas sin urgencia", () => {
  const examen = plan({ title: "Estudiar para el examen", planned_minutes: 60, due_date: "2026-10-27" }), fin = plan({ title: "Finanzas", category: "finanzas", planned_minutes: 60 });
  const res = buildDayPlan(input([fin, examen], { settings: { minutes: 60 } }));
  deq(ids(res), [examen.id]);
  assert.ok(res.items[0].reasons.includes("Vence mañana"));
});

test("Energía baja favorece las tranquilas sin bloquear las intensas", () => {
  const hard = plan({ title: "Entrenamiento intenso", category: "fisico", energy_required: "high", planned_minutes: 60, created_at: "2026-10-01T00:00:00.000Z" });
  const soft = plan({ title: "Lectura tranquila", category: "lectura", energy_required: "low", planned_minutes: 60 });
  const low = buildDayPlan(input([hard, soft], { settings: { minutes: 60, energy: "low" } }));
  deq(ids(low), [soft.id]);
  const both = buildDayPlan(input([hard, soft], { settings: { minutes: 120, energy: "low" } }));
  assert.equal(both.items.length, 2, "con tiempo, la intensa también entra");
  const high = buildDayPlan(input([hard, soft], { settings: { minutes: 60, energy: "high" } }));
  deq(ids(high), [hard.id]);
});

test("Objetivo cerca de completarse sube la prioridad (sin crear progreso)", () => {
  const goal = { id: "g1", title: "Finanzas 600 min", goal_type: "cat_minutes", category: "finanzas", target: 600, progress: 480 };
  const fin = plan({ title: "Finanzas", category: "finanzas", planned_minutes: 60, recurring_plan_id: null }), curso = plan({ title: "Curso", planned_minutes: 60, priority: "high" });
  // Sin objetivo gana Curso (Alta); con el objetivo al 80 % y 3 días, Finanzas
  const in1 = input([fin, curso], { settings: { minutes: 60 } }); in1.today = "2026-10-29";
  for (const p of [fin, curso]) p.date = "2026-10-29";
  deq(ids(buildDayPlan(in1)), [curso.id]);
  const in2 = input([fin, curso], { settings: { minutes: 60 }, goals: [goal] }); in2.today = "2026-10-29";
  const res = buildDayPlan(in2);
  deq(ids(res), [fin.id]);
  assert.ok(res.items[0].reasons.some((r) => /cerca de completarse/.test(r)));
  assert.equal(goal.progress, 480, "el objetivo no cambia");
  for (const p of [fin, curso]) p.date = T;
});

test("Boss casi derrotado sube la prioridad y avisa si la misión podría derrotarlo", () => {
  const boss = { id: "b1", name: "Dragón", goal_type: "cat_xp", category: "curso", left: 100, hp: 1000 };
  const curso = plan({ title: "Curso", planned_minutes: 60 }), lect = plan({ title: "Lectura", category: "lectura", planned_minutes: 60, created_at: "2026-10-01T00:00:00.000Z" });
  const sin = buildDayPlan(input([curso, lect], { settings: { minutes: 60 } }));
  deq(ids(sin), [lect.id]);
  const con = buildDayPlan(input([curso, lect], { settings: { minutes: 60 }, boss }));
  deq(ids(con), [curso.id]);
  assert.ok(con.items[0].defeat, "60 min de Curso normal = 105 XP ≥ 100 HP");
  assert.ok(con.items[0].reasons.includes("⚔ Podría derrotar al Boss"));
  assert.equal(boss.left, 100, "el Boss no cambia");
});

test("Máximo de atrasadas: con 20 atrasadas entran 2, las de más puntos (las más recientes)", () => {
  const late = [...Array(20)].map((_, i) => plan({ title: "Atrasada " + i, date: `2026-10-${String(25 - (i % 7)).padStart(2, "0")}`, planned_minutes: 15 }));
  const res = buildDayPlan(input(late, { settings: { minutes: 600 } }));
  assert.equal(res.items.length, 2);
  for (const x of res.items) assert.equal(late.find((p) => p.id === x.id).date, "2026-10-25");
  const r0 = buildDayPlan(input(late, { settings: { minutes: 600 }, prefs: { maxOverdue: 0 } }));
  assert.equal(r0.items.length, 0, "con 0 en Perfil no entra ninguna");
  const old = plan({ date: "2026-10-10" });
  assert.equal(dpCandidates(input([old])).length, 0, "más de 7 días: sigue en Atrasadas, no en el plan");
});

test("Rutinas: la de hoy entra; la de una rutina pausada no; el plan no crea misiones", () => {
  const r = rtCreate({ title: "Gym", description: "", category: "fisico", weekdays: [1, 2, 3, 4, 5, 6, 7], start_date: T, end_date: null, time: null, planned_minutes: 60, intensity: 2, note: "", reminder_minutes: null },
    { id: uuid(), at: AT });
  const plans = new Map();
  for (const row of plain(routineRows([r], plans, { today: T, at: AT }))) plans.set(row.id, row);
  const before = plans.size;
  const routines = new Map([[r.id, r]]);
  const res = buildDayPlan(input([...plans.values()], { routines }));
  assert.equal(res.items.length, 1);
  assert.equal(res.items[0].kind, "routine");
  assert.ok(res.items[0].reasons.includes("Rutina de hoy"));
  assert.equal(plans.size, before, "no se crean instancias nuevas");
  const paused = new Map([[r.id, { ...r, active: false }]]);
  assert.equal(buildDayPlan(input([...plans.values()], { routines: paused })).items.length, 0);
});

test("Una misión de rutina hereda prioridad, energía y duración de la rutina, salvo que tenga las suyas", () => {
  const r = { id: uuid(), priority: "high", energy_required: "low", duration_mode: "flexible", minimum_minutes: 20 };
  const routines = new Map([[r.id, r]]);
  const p = plan({ recurring_plan_id: r.id, recurrence_date: T, planned_minutes: 45 });
  deq(plain(dpAttrs(p, routines)), { priority: "high", energy: "low", mode: "flexible", min: 20 });
  deq(plain(dpAttrs({ ...p, priority: "critical", duration_mode: "fixed" }, routines)), { priority: "critical", energy: "low", mode: "fixed", min: null });
  assert.equal(dpAttrs({ ...p, planned_minutes: 15 }, routines).min, 15, "el mínimo nunca pasa los minutos planificados");
});

test("Flexibles: se reducen hasta su mínimo; las fijas y las de hora nunca", () => {
  const lect = plan({ title: "Lectura", category: "lectura", planned_minutes: 45, duration_mode: "flexible", minimum_minutes: 20 }), c = plan({ title: "Curso", planned_minutes: 95, priority: "high" });
  const res = buildDayPlan(input([c, lect], { settings: { minutes: 120 } }));
  const l = res.items.find((x) => x.id === lect.id);
  assert.ok(l, "Lectura entra reducida");
  assert.equal(l.m, 25); assert.ok(l.reduced);
  assert.equal(sum(res), 120);
  const r2 = buildDayPlan(input([c, lect], { settings: { minutes: 110 } }));
  assert.ok(!r2.items.some((x) => x.id === lect.id), "15 min no alcanzan el mínimo de 20");
  const fija = plan({ title: "Entrenamiento", planned_minutes: 45 });
  assert.equal(buildDayPlan(input([c, fija], { settings: { minutes: 120 } })).items.length, 1, "una fija no se recorta");
  const conHora = plan({ title: "Lectura 20 h", time: "20:00", planned_minutes: 45, duration_mode: "flexible", minimum_minutes: 20 });
  assert.equal(buildDayPlan(input([c, conHora], { settings: { minutes: 120 } })).items.length, 1, "con hora no se recorta");
});

test("Reorganizar conserva las completadas y vuelve a ordenar solo las pendientes", () => {
  const a = plan({ title: "Hecha 1" }), b = plan({ title: "Hecha 2" }), c = plan({ title: "Pendiente", category: "lectura", planned_minutes: 30 }), d = plan({ title: "Pendiente 2", planned_minutes: 60 });
  const all = [a, b, c, d];
  const res = buildDayPlan(input(all, { done: [a.id, b.id], settings: { minutes: 90 }, extra: { now: 16 * 60 } }));
  deq(ids(res).sort(), [c.id, d.id].sort());
  const plans = new Map(all.map((p) => [p.id, p]));
  const { row, planRows } = dpAcceptRows(res.items, { today: T, at: AT, plans, settings: { minutes: 90, energy: "normal", focus: { kind: "auto" } }, done: [{ id: a.id, m: 60 }, { id: b.id, m: 60 }] });
  assert.equal(planRows.length, 0);
  deq(row.items.slice(0, 2).map((x) => x.id), [a.id, b.id], "las completadas quedan primero, iguales");
  assert.equal(row.items.length, 4);
  assert.equal(row.items.filter((x) => x.id === a.id).length, 1);
});

test("Mismo input, mismo plan (también con el orden de entrada mezclado)", () => {
  const plans = [...Array(12)].map((_, i) => plan({ title: "M" + i, category: ["curso", "finanzas", "fisico", "cuidado", "lectura"][i % 5], planned_minutes: 15 + (i % 4) * 15,
    time: i === 3 ? "15:00" : null, date: i === 7 ? "2026-10-24" : i === 9 ? "2026-10-27" : T, priority: i === 5 ? "high" : null }));
  const ref = JSON.stringify(plain(buildDayPlan(input(plans, { settings: { minutes: 150 } })).items));
  for (let k = 0; k < 100; k++) {
    const sh = [...plans].sort(() => Math.random() - 0.5);
    assert.equal(JSON.stringify(plain(buildDayPlan(input(sh, { settings: { minutes: 150 } })).items)), ref);
  }
});

test("Funciona sin conexión: el cálculo no usa red ni el reloj de la máquina", () => {
  const ctx = R.ctx;
  const saved = { fetch: ctx.fetch };
  ctx.fetch = () => { throw new Error("sin red"); };
  try {
    const p = plan();
    const res = buildDayPlan(input([p]));
    deq(ids(res), [p.id]);
  } finally { ctx.fetch = saved.fetch; }
});

test("Un plan no da XP, Oro ni progreso: generarlo y aceptarlo no cambia las actividades", () => {
  R.setDays({ "2026-10-25": [{ cat: "curso", min: 30, diff: 2 }] });
  const days0 = JSON.stringify(R.get("state").days), xp0 = R.get("compute") ? null : null;
  const p = plan(); const plans = new Map([[p.id, p]]);
  const res = buildDayPlan(input([p]));
  const out = dpAcceptRows(res.items, { today: T, at: AT, plans, settings: { minutes: 120, energy: "normal", focus: { kind: "auto" } } });
  assert.equal(JSON.stringify(R.get("state").days), days0);
  assert.equal(out.planRows.length, 0, "aceptar no toca la planificación");
  deq(Object.keys(out.row).sort(), ["accepted_at", "available_minutes", "closed_at", "created_at", "date", "deleted_at", "energy", "focus_kind", "focus_ref", "id", "items", "removed", "updated_at"]);
  assert.equal(out.row.id, dpId(T)); void xp0;
});

/* ---- Adelantadas ---- */
test("Adelantar: como máximo una, manual, sin hora, de mañana o pasado, con puntos suficientes", () => {
  const manana = plan({ title: "Mañana alta", date: "2026-10-27", priority: "high" }), pasado = plan({ title: "Pasado alta", date: "2026-10-28", priority: "high" });
  const conHora = plan({ title: "Con hora", date: "2026-10-27", time: "10:00", priority: "high" }), lejos = plan({ title: "Lejos", date: "2026-10-29", priority: "high" }), baja = plan({ title: "Sin puntos", date: "2026-10-27" });
  const res = buildDayPlan(input([manana, pasado, conHora, lejos, baja], { settings: { minutes: 600 } }));
  deq(ids(res), [manana.id]);
  assert.equal(res.items[0].kind, "ahead");
  assert.ok(res.items[0].reasons.includes("Planificada para mañana"));
});

test("Adelantada + Mover a hoy: cambia la fecha, conserva moved_from, queda en el plan y no se duplica", () => {
  const p = plan({ title: "Adelantada", date: "2026-10-27", priority: "high" }), hoy = plan({ title: "De hoy" });
  const plans = new Map([[p.id, p], [hoy.id, hoy]]);
  const res = buildDayPlan(input([...plans.values()], { settings: { minutes: 180 } }));
  deq(dpAheadIds(res.items, plans, T), [p.id], "antes de aceptar hay que preguntar");
  const { planRows, row } = dpAcceptRows(res.items, { today: T, at: AT, plans, settings: { minutes: 180, energy: "normal", focus: { kind: "auto" } }, choices: { [p.id]: "move" } });
  assert.equal(planRows.length, 1);
  assert.equal(planRows[0].id, p.id, "la misma planificación, no una copia");
  assert.equal(planRows[0].date, T);
  assert.equal(planRows[0].moved_from, "2026-10-27");
  assert.equal(planRows[0].status, "planned");
  deq(plain(planRows[0]), plain(R.get("planMoveRow")(p, T, null, AT)), "es exactamente el Reprogramar del Planificador");
  assert.equal(row.items.filter((x) => x.id === p.id).length, 1);
  assert.ok(!row.removed.includes(p.id));
  // Después de moverla ya es de hoy: el plan la sigue teniendo y no la vuelve a preguntar
  plans.set(p.id, planRows[0]);
  deq(dpAheadIds(row.items, plans, T), []);
  const again = buildDayPlan(input([...plans.values()], { settings: { minutes: 180 } }));
  assert.equal(again.items.filter((x) => x.id === p.id).length, 1);
  assert.equal(again.items.find((x) => x.id === p.id).kind, "today");
  // moved_from guarda la fecha original aunque se mueva de nuevo
  assert.equal(R.get("planMoveRow")(planRows[0], "2026-10-30", null, AT).moved_from, "2026-10-27");
});

test("Adelantada + Dejar para su fecha: no cambia la planificación, sale del plan y no se crea ninguna copia", () => {
  const p = plan({ title: "Adelantada", date: "2026-10-27", priority: "high" }), hoy = plan({ title: "De hoy" });
  const plans = new Map([[p.id, p], [hoy.id, hoy]]), before = JSON.stringify(p);
  const res = buildDayPlan(input([...plans.values()], { settings: { minutes: 180 } }));
  const { planRows, row } = dpAcceptRows(res.items, { today: T, at: AT, plans, settings: { minutes: 180, energy: "normal", focus: { kind: "auto" } }, choices: { [p.id]: "keep" } });
  assert.equal(planRows.length, 0, "no se escribe ninguna planificación");
  assert.equal(JSON.stringify(p), before, "fecha original y todo igual");
  assert.equal(p.date, "2026-10-27");
  assert.ok(!row.items.some((x) => x.id === p.id), "desaparece del plan");
  deq(row.items.map((x) => x.id), [hoy.id]);
  assert.ok(row.removed.includes(p.id), "y no vuelve a proponerse hoy");
  assert.equal(plans.size, 2);
  const again = buildDayPlan(input([...plans.values()], { settings: { minutes: 180 }, removed: row.removed }));
  assert.ok(!ids(again).includes(p.id));
  // El tiempo libre se recalcula con lo que quedó
  const prog = dpProgress(row, plans, () => false, () => 0);
  assert.equal(prog.planned, 60);
});

test("Plan sin adelantadas: Aceptar plan funciona directo, sin otra pregunta", () => {
  const a = plan(), b = plan({ category: "lectura", planned_minutes: 30 });
  const plans = new Map([[a.id, a], [b.id, b]]);
  const res = buildDayPlan(input([a, b]));
  deq(dpAheadIds(res.items, plans, T), [], "no hay nada que preguntar");
  const { planRows, row } = dpAcceptRows(res.items, { today: T, at: AT, plans, settings: { minutes: 120, energy: "normal", focus: { kind: "auto" } } });
  assert.equal(planRows.length, 0);
  assert.equal(row.items.length, 2);
  assert.equal(row.accepted_at, AT);
});

/* ---- Plan aceptado ---- */
test("Si me atraso: avisa cuando lo hecho tardó 15 min más o una con hora pasó hace 30 min, nunca solo", () => {
  const a = plan({ planned_minutes: 30 }), b = plan({ time: "10:00", planned_minutes: 30 });
  const plans = new Map([[a.id, a], [b.id, b]]), row = { items: [{ id: a.id, m: 30 }, { id: b.id, m: 30 }] };
  const p1 = dpProgress(row, plans, (id) => id === a.id, () => 50);
  assert.ok(dpBehind(p1, 9 * 60 + 30), "tardó 20 min más");
  const p2 = dpProgress(row, plans, (id) => id === a.id, () => 35);
  assert.ok(!dpBehind(p2, 10 * 60 + 20));
  assert.ok(dpBehind(p2, 10 * 60 + 31), "la de las 10:00 pasó hace más de 30 min");
});

test("Preferencias: valores inválidos vuelven al valor por defecto", () => {
  deq(plain(dpPrefs(null)), { enabled: true, minutes: 180, energy: "normal", focus: "auto", finanzas: true, maxOverdue: 2 });
  deq(plain(dpPrefs({ enabled: false, minutes: "x", energy: "mucha", focus: "finanzas", maxOverdue: 9 })), { enabled: false, minutes: 180, energy: "normal", focus: "finanzas", finanzas: true, maxOverdue: 2 });
});
