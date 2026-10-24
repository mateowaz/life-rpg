/* Generador de rutinas (routines.js): las mismas funciones que usa la app, sin pantalla.
   Hoy de prueba: lunes 26/10/2026. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadRules } = require("./load.js");

const R = loadRules();
const fn = (n) => R.get(n);
const routineRows = fn("routineRows"), rtCreate = fn("rtCreate"), rtDuplicate = fn("rtDuplicate"), rtSplit = fn("rtSplit");
const rtInstanceId = fn("rtInstanceId"), rtPausePlanRows = fn("rtPausePlanRows"), rtDeletePlanRows = fn("rtDeletePlanRows");
const rtWinner = fn("rtWinner"), rtSupersededFn = fn("rtSupersededFn"), isoDow = fn("isoDow"), addDays = fn("addDays");
const plain = (x) => JSON.parse(JSON.stringify(x));

const T = "2026-10-26";                         // lunes
const AT = "2026-10-26T09:00:00.000Z";
const LXV = [1, 3, 5];
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
function routine(o = {}) {
  return rtCreate({ title: "Gym", description: "", category: "fisico", weekdays: LXV, start_date: T, end_date: null, time: "18:00", planned_minutes: 90, intensity: 2, note: "", reminder_minutes: 30, ...o },
    { id: o.id || uuid(), at: o.at || "2026-10-20T10:00:00.000Z" });
}
/** Una pasada del generador sobre un mapa de planificaciones, aplicando lo que devuelve */
function gen(routines, plans, o = {}) {
  const rows = plain(routineRows(routines, plans, { today: T, at: AT, ...o }));
  for (const r of rows) plans.set(r.id, r);
  return rows;
}
const live = (plans) => [...plans.values()].filter((p) => !p.deleted_at);
const ofSeries = (plans, r) => live(plans).filter((p) => p.recurring_plan_id && p.id === rtInstanceId(r.series_id, p.recurrence_date));
const dates = (list) => list.map((p) => p.date).sort();
const at2 = (h) => `2026-10-26T${String(h).padStart(2, "0")}:00:00.000Z`;

test("L-X-V genera solo lunes, miércoles y viernes, de hoy a 30 días", () => {
  const r = routine(), plans = new Map();
  gen([r], plans);
  const d = dates(live(plans));
  assert.ok(d.length > 0);
  for (const k of d) assert.ok(LXV.includes(isoDow(k)), `${k} no es L, X ni V`);
  assert.equal(d[0], T);
  assert.ok(d[d.length - 1] <= addDays(T, 30));
  assert.equal(d.length, 14);                     // 26/10 a 25/11: 5 lunes, 5 miércoles, 4 viernes
  const p = plans.get(rtInstanceId(r.series_id, T));
  assert.deepEqual(plain({ ...p, created_at: 0, updated_at: 0 }), plain({ id: p.id, date: T, time: "18:00", title: "Gym", category: "fisico", planned_minutes: 90, intensity: 2, note: "", reminder_minutes: 30,
    status: "planned", moved_from: null, deleted_at: null, recurring_plan_id: r.id, recurrence_date: T, recurrence_edited: false, created_at: 0, updated_at: 0 }));
});

test("Todos los días genera cada fecha; nada antes de hoy, de start_date ni después de end_date", () => {
  const plans = new Map();
  gen([routine({ weekdays: [1, 2, 3, 4, 5, 6, 7], start_date: "2026-10-01" })], plans);
  assert.equal(live(plans).length, 31);
  assert.equal(dates(live(plans))[0], T, "no hay misiones retroactivas");
  const p2 = new Map();
  gen([routine({ weekdays: [1, 2, 3, 4, 5, 6, 7], start_date: "2026-10-28", end_date: "2026-11-02" })], p2);
  assert.deepEqual(dates(live(p2)), ["2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
});

test("Una segunda pasada no escribe nada, y dos dispositivos calculan lo mismo", () => {
  const r = routine(), a = new Map(), b = new Map();
  gen([r], a);
  assert.equal(gen([r], a).length, 0, "segunda pasada sin cambios");
  gen([r], b, { at: "2026-10-26T23:59:00.000Z" });
  const strip = (m) => [...m.values()].map(({ created_at, updated_at, ...x }) => x).sort((x, y) => x.id.localeCompare(y.id));
  assert.deepEqual(plain(strip(a)), plain(strip(b)), "mismos ids y mismo contenido");
  // El otro dispositivo baja lo que generó el primero: no crea nada nuevo
  assert.equal(gen([r], new Map(a)).length, 0);
});

test("Pausada no genera; al reactivar genera desde hoy y revive las que quitó la pausa", () => {
  const r = routine(), plans = new Map();
  gen([r], plans);
  const before = live(plans).length;
  const segIds = [r.id];
  const rm = plain(rtPausePlanRows(plans, segIds, "remove", { today: T, at: AT }));
  for (const x of rm) plans.set(x.id, x);
  const paused = { ...r, active: false, updated_at: AT };
  assert.equal(live(plans).length, 0, "quitar las que no tocaste");
  assert.equal(gen([paused], plans).length, 0, "pausada no genera ni limpia");
  // Pasan dos semanas pausada: al reactivar no aparecen los días de la pausa
  const later = "2026-11-09";
  const rows = plain(routineRows([{ ...paused, active: true, updated_at: "2026-11-09T08:00:00.000Z" }], plans, { today: later, at: "2026-11-09T08:00:00.000Z" }));
  for (const x of rows) plans.set(x.id, x);
  assert.ok(dates(live(plans)).every((k) => k >= later), "sin misiones retroactivas");
  assert.ok(rows.some((x) => plans.get(x.id).created_at < "2026-11-09"), "revive las mismas filas que quitó la pausa");
  assert.ok(before > 0);
});

test("Pausar: Omitirlas las deja omitidas a la vista; Mantenerlas no toca nada; lo tocado y completado no cambia", () => {
  const r = routine(), plans = new Map();
  gen([r], plans);
  const wed = rtInstanceId(r.series_id, "2026-10-28"), mon = rtInstanceId(r.series_id, T);
  plans.set(wed, { ...plans.get(wed), time: "19:00", recurrence_edited: true });
  const isDone = (id) => id === mon;
  assert.equal(rtPausePlanRows(plans, [r.id], "keep", { today: T, at: AT, isDone }).length, 0);
  const sk = plain(rtPausePlanRows(plans, [r.id], "skip", { today: T, at: AT, isDone }));
  assert.ok(sk.length > 0 && sk.every((x) => x.status === "skipped" && !x.recurrence_edited));
  assert.ok(!sk.some((x) => x.id === wed || x.id === mon), "ni la editada ni la completada");
  const rm = plain(rtPausePlanRows(plans, [r.id], "remove", { today: T, at: AT, isDone, hasFocus: (id) => id === rtInstanceId(r.series_id, "2026-10-30") }));
  assert.ok(!rm.some((x) => x.id === rtInstanceId(r.series_id, "2026-10-30")), "con sesión de enfoque no se quita");
});

test("Omitir el miércoles: ese miércoles no vuelve y el viernes sigue normal", () => {
  const r = routine(), plans = new Map();
  gen([r], plans);
  const wed = rtInstanceId(r.series_id, "2026-10-28"), fri = rtInstanceId(r.series_id, "2026-10-30");
  plans.set(wed, { ...plans.get(wed), status: "skipped", recurrence_edited: true, updated_at: at2(10) });
  assert.equal(gen([r], plans).length, 0);
  assert.equal(plans.get(wed).status, "skipped");
  assert.equal(plans.get(fri).status, "planned");
});

test("Reprogramar una: queda en su nueva fecha y no se crea otra para su día original", () => {
  const r = routine(), plans = new Map();
  gen([r], plans);
  const wed = rtInstanceId(r.series_id, "2026-10-28");
  plans.set(wed, { ...plans.get(wed), date: "2026-10-29", moved_from: "2026-10-28", recurrence_edited: true, updated_at: at2(10) });
  assert.equal(gen([r], plans).length, 0);
  assert.equal(live(plans).filter((p) => p.recurrence_date === "2026-10-28").length, 1);
  assert.equal(plans.get(wed).date, "2026-10-29");
  assert.ok(plans.get(rtInstanceId(r.series_id, "2026-11-04")), "la semana siguiente vuelve al miércoles");
});

test("Toda la rutina: cambia las futuras sin tocar; no cambia excepciones, completadas ni pasadas", () => {
  const r = routine(), plans = new Map();
  gen([r], plans);
  const past = { ...plans.get(rtInstanceId(r.series_id, T)), id: rtInstanceId(r.series_id, "2026-10-23"), date: "2026-10-23", recurrence_date: "2026-10-23" };
  plans.set(past.id, past);
  const wed = rtInstanceId(r.series_id, "2026-10-28"), fri = rtInstanceId(r.series_id, "2026-10-30"), mon = rtInstanceId(r.series_id, T);
  plans.set(wed, { ...plans.get(wed), note: "mía", recurrence_edited: true });
  const edited = { ...r, title: "Gimnasio", time: "19:00", updated_at: at2(11) };
  const rows = gen([edited], plans, { isDone: (id) => id === mon });
  assert.ok(rows.length > 0);
  assert.equal(plans.get(fri).title, "Gimnasio");
  assert.equal(plans.get(fri).time, "19:00");
  assert.equal(plans.get(wed).title, "Gym", "la excepción no cambia");
  assert.equal(plans.get(mon).title, "Gym", "la completada no cambia");
  assert.equal(plans.get(past.id).title, "Gym", "la pasada no cambia");
});

test("Recordatorio de la rutina: llega a las futuras sin tocar y no a las editadas", () => {
  const r = routine(), plans = new Map();
  gen([r], plans);
  const wed = rtInstanceId(r.series_id, "2026-10-28"), fri = rtInstanceId(r.series_id, "2026-10-30");
  plans.set(wed, { ...plans.get(wed), reminder_minutes: 5, recurrence_edited: true });
  gen([{ ...r, reminder_minutes: 60, updated_at: at2(11) }], plans);
  assert.equal(plans.get(fri).reminder_minutes, 60);
  assert.equal(plans.get(wed).reminder_minutes, 5);
  gen([{ ...r, time: null, reminder_minutes: 60, updated_at: at2(12) }], plans);
  assert.equal(plans.get(fri).reminder_minutes, null, "sin hora no hay recordatorio");
});

test("Quitar un día de la semana y volver a agregarlo: se quitan y vuelven las mismas filas", () => {
  const r = routine(), plans = new Map();
  gen([r], plans);
  const wed = rtInstanceId(r.series_id, "2026-10-28");
  const noWed = { ...r, weekdays: [1, 5], updated_at: at2(11) };
  gen([noWed], plans);
  assert.ok(plans.get(wed).deleted_at, "el miércoles se quita");
  assert.ok(dates(live(plans)).every((k) => [1, 5].includes(isoDow(k))));
  gen([{ ...noWed, weekdays: [1, 3, 5], updated_at: at2(12) }], plans);
  assert.equal(plans.get(wed).deleted_at, null, "vuelve la misma fila");
  assert.equal(live(plans).length, 14);
});

test("Adelantar la fecha de fin quita las futuras sin tocar, pero no las editadas ni las de enfoque", () => {
  const r = routine(), plans = new Map();
  gen([r], plans);
  const nov4 = rtInstanceId(r.series_id, "2026-11-04"), nov6 = rtInstanceId(r.series_id, "2026-11-06"), nov9 = rtInstanceId(r.series_id, "2026-11-09");
  plans.set(nov6, { ...plans.get(nov6), recurrence_edited: true, note: "mía" });
  gen([{ ...r, end_date: "2026-11-01", updated_at: at2(11) }], plans, { hasFocus: (id) => id === nov9 });
  assert.ok(plans.get(nov4).deleted_at);
  assert.equal(plans.get(nov6).deleted_at, null);
  assert.equal(plans.get(nov9).deleted_at, null);
});

test("Eliminar rutina: quita sus planificaciones futuras abiertas; no toca completadas, pasadas ni con enfoque", () => {
  const r = routine(), plans = new Map();
  gen([r], plans);
  const past = { ...plans.get(rtInstanceId(r.series_id, T)), id: rtInstanceId(r.series_id, "2026-10-23"), date: "2026-10-23", recurrence_date: "2026-10-23" };
  plans.set(past.id, past);
  const mon = rtInstanceId(r.series_id, T), wed = rtInstanceId(r.series_id, "2026-10-28");
  const rows = plain(rtDeletePlanRows(plans, [r.id], { today: T, at: AT, isDone: (id) => id === mon, hasFocus: (id) => id === wed }));
  const ids = new Set(rows.map((x) => x.id));
  assert.ok(!ids.has(mon) && !ids.has(wed) && !ids.has(past.id));
  assert.equal(rows.length, 14 - 2);
  // Con "No", la rutina eliminada ya no genera ni limpia: sus misiones quedan sueltas
  const del = { ...r, deleted_at: at2(11), updated_at: at2(11) };
  assert.equal(gen([del], plans).length, 0);
});

test("Esta y las siguientes: cambia desde esa fecha, mismas filas, sin duplicados y respeta excepciones", () => {
  const A = routine(), plans = new Map();
  gen([A], plans);
  const D = "2026-11-02";
  const ex = rtInstanceId(A.series_id, "2026-11-04");
  plans.set(ex, { ...plans.get(ex), status: "skipped", recurrence_edited: true });
  const before = new Map(plain([...plans]));
  const segs = plain(rtSplit(A, D, { ...A, title: "Gym pesado", time: "07:00" }, { id: uuid(), at: at2(11), routines: [A] }));
  assert.equal(segs.length, 2);
  const [A2, B] = segs;
  assert.equal(A2.id, A.id); assert.equal(A2.end_date, "2026-11-01");
  assert.equal(B.series_id, A.series_id); assert.equal(B.start_date, D); assert.notEqual(B.id, A.id);
  gen(segs, plans);
  assert.equal(plans.size, before.size, "no se crean filas nuevas");
  for (const [id, old] of before) {
    const p = plans.get(id);
    assert.equal(p.id, old.id); assert.equal(p.recurrence_date, old.recurrence_date);
    if (old.recurrence_date < D) assert.deepEqual(p, old, "antes de D no cambia nada");
    else if (old.recurrence_edited) assert.deepEqual(p, old, "la excepción no cambia");
    else { assert.equal(p.recurring_plan_id, B.id, "apunta al tramo nuevo"); assert.equal(p.title, "Gym pesado"); assert.equal(p.time, "07:00"); }
  }
  assert.equal(new Set(live(plans).map((p) => p.recurrence_date)).size, live(plans).length, "una misión por fecha");
});

test("Garantía: después de 'Esta y las siguientes', editar una misión futura modifica el tramo nuevo y no la versión anterior", () => {
  const A = routine(), plans = new Map();
  gen([A], plans);
  const D = "2026-11-02";
  let routines = new Map([[A.id, A]]);
  for (const s of plain(rtSplit(A, D, { ...A, time: "07:00" }, { id: uuid(), at: at2(11), routines: [A] }))) routines.set(s.id, s);
  gen(routines.values(), plans);
  const B = [...routines.values()].find((s) => s.start_date === D);
  const future = plans.get(rtInstanceId(A.series_id, "2026-11-06"));
  assert.equal(future.recurring_plan_id, B.id);
  // "Toda la rutina" desde esa misión abre su tramo (recurring_plan_id) y lo cambia
  const target = routines.get(future.recurring_plan_id);
  assert.equal(target.id, B.id);
  routines.set(B.id, { ...B, title: "Solo el tramo nuevo", updated_at: at2(12) });
  gen(routines.values(), plans);
  assert.equal(routines.get(A.id).title, "Gym", "la versión anterior no cambia");
  assert.equal(routines.get(A.id).end_date, "2026-11-01");
  assert.equal(plans.get(rtInstanceId(A.series_id, "2026-11-06")).title, "Solo el tramo nuevo");
  assert.equal(plans.get(rtInstanceId(A.series_id, "2026-10-28")).title, "Gym", "los días del tramo anterior no cambian");
  assert.equal(plans.get(rtInstanceId(A.series_id, "2026-10-28")).recurring_plan_id, A.id);
  // "Esta y las siguientes" otra vez desde una misión del tramo nuevo: corta B, no A
  const fut2 = plans.get(rtInstanceId(A.series_id, "2026-11-09"));
  const segs2 = plain(rtSplit(routines.get(fut2.recurring_plan_id), "2026-11-09", { ...routines.get(B.id), time: "06:00" }, { id: uuid(), at: at2(13), routines: routines.values() }));
  assert.equal(segs2[0].id, B.id); assert.equal(segs2[0].end_date, "2026-11-08");
  for (const s of segs2) routines.set(s.id, s);
  gen(routines.values(), plans);
  assert.equal(routines.get(A.id).end_date, "2026-11-01", "A sigue igual");
  assert.equal(plans.get(rtInstanceId(A.series_id, "2026-11-09")).time, "06:00");
  assert.equal(plans.get(rtInstanceId(A.series_id, "2026-11-06")).time, "07:00");
});

test("Dos 'Esta y las siguientes' en conflicto: siempre gana el mismo tramo, en cualquier orden", () => {
  const A = routine();
  const [, B] = plain(rtSplit(A, "2026-11-02", { ...A, time: "07:00" }, { id: uuid(), at: at2(10), routines: [A] }));
  const [, C] = plain(rtSplit(A, "2026-11-09", { ...A, time: "21:00" }, { id: uuid(), at: at2(11), routines: [A] }));
  const A1 = { ...A, end_date: "2026-11-01", updated_at: at2(11) };
  for (const order of [[A1, B, C], [C, B, A1], [B, A1, C]]) {
    assert.equal(rtWinner(order, "2026-11-04").id, B.id);
    assert.equal(rtWinner(order, "2026-11-11").id, C.id, "manda el que empezó más tarde");
  }
  const p1 = new Map(), p2 = new Map();
  gen([A1, B, C], p1); gen([C, A1, B], p2);
  const strip = (m) => [...m.values()].map(({ created_at, updated_at, ...x }) => x).sort((x, y) => x.id.localeCompare(y.id));
  assert.deepEqual(plain(strip(p1)), plain(strip(p2)));
  // Mismo inicio: gana la más reciente
  const X = { ...B, id: uuid(), time: "08:00", updated_at: at2(15) };
  assert.equal(rtWinner([B, X], "2026-11-04").id, X.id);
  assert.equal(rtWinner([X, B], "2026-11-04").id, X.id);
});

test("Garantía: Duplicar crea id y series_id nuevos; la copia L-X-V y la original generan su propio día sin chocar", () => {
  const A = routine();
  const C = plain(rtDuplicate(A, { id: uuid(), at: at2(11), today: T }));
  assert.notEqual(C.id, A.id);
  assert.notEqual(C.series_id, A.series_id, "no hereda la familia");
  assert.equal(C.series_id, C.id);
  assert.deepEqual(C.weekdays, LXV);
  const plans = new Map();
  gen([A, C], plans);
  const wed = "2026-10-28";
  const both = live(plans).filter((p) => p.recurrence_date === wed);
  assert.equal(both.length, 2, "una misión de cada rutina el mismo miércoles");
  assert.notEqual(both[0].id, both[1].id, "ids distintos");
  assert.deepEqual(new Set(both.map((p) => p.recurring_plan_id)), new Set([A.id, C.id]));
  assert.equal(new Set(live(plans).map((p) => p.id)).size, live(plans).length, "ningún id repetido");
  assert.equal(live(plans).length, 28);
  // Cambiar la copia no toca la original
  gen([A, { ...C, title: "Copia", updated_at: at2(12) }], plans);
  assert.ok(live(plans).filter((p) => p.recurring_plan_id === A.id).every((p) => p.title === "Gym"));
  assert.ok(live(plans).filter((p) => p.recurring_plan_id === C.id).every((p) => p.title === "Copia"));
});

test("Atrasadas: una misión de rutina deja de verse cuando llega la siguiente; las manuales no cambian", () => {
  const A = routine({ weekdays: [1, 2, 3, 4, 5, 6, 7], start_date: "2026-10-20" });
  const mk = (k) => ({ id: rtInstanceId(A.series_id, k), date: k, recurring_plan_id: A.id, recurrence_date: k, deleted_at: null });
  const sat = mk("2026-10-24"), sun = mk("2026-10-25"), manual = { id: uuid(), date: "2026-10-20", recurring_plan_id: null, recurrence_date: null };
  const gone = rtSupersededFn([sat, sun, mk(T), manual], new Map([[A.id, A]]), T);
  assert.equal(gone(sat), true);
  assert.equal(gone(sun), true, "la de ayer se va cuando llega la de hoy");
  assert.equal(gone(manual), false);
  const gone2 = rtSupersededFn([sat, sun, manual], new Map([[A.id, A]]), T);
  assert.equal(gone2(sun), false, "sin la de hoy, la de ayer sigue en Atrasadas");
});

test("Una rutina nunca da XP ni Oro: el generador solo escribe planificaciones", () => {
  const plans = new Map();
  const rows = gen([routine()], plans);
  for (const r of rows) assert.deepEqual(Object.keys(r).filter((k) => /xp|coin|gold|minutes$/.test(k) && k !== "planned_minutes" && k !== "reminder_minutes"), []);
  assert.equal(Object.keys(fn("state").days).length, 0);
});
