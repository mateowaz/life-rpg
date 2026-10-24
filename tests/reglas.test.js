/* Pruebas de las reglas del juego: XP, niveles, rangos, rachas, logros, Oro, cofres, objetivos y Boss.
   Corren con el ejecutor de pruebas de Node, sin instalar nada:  node --test tests/ */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadRules } = require("./load.js");
const XP_CASES = require("./cases/xp.json").casos;

const R = loadRules();
// Los arreglos creados dentro del contexto aislado tienen otro prototipo: se copian antes de comparar
const plain = (x) => JSON.parse(JSON.stringify(x));
const $ = R.get;
const T = $("todayKey")();
const day = (n) => $("addDays")(T, n);                  // day(0) = hoy, day(-1) = ayer
const four = (min = 30, diff = 1) => ["curso", "fisico", "cuidado", "lectura"].map((cat) => ({ cat, min, diff }));
// Un mes fijo y pasado (para que nada dependa de la fecha de hoy)
const M = "2025-03";
const md = (d) => `${M}-${String(d).padStart(2, "0")}`;

test("XP de una actividad: casos compartidos con Supabase", () => {
  for (const [min, diff, cat, want] of XP_CASES) assert.equal($("actXP")(min, diff, cat), want, `${min} min, intensidad ${diff}, ${cat}`);
});

test("XP: los minutos se limitan a 0–240", () => {
  assert.equal($("actXP")(500, 1, "curso"), 250);
  assert.equal($("actXP")(-20, 1, "curso"), 10);
  assert.equal($("actXP")("", 1, "curso"), 10);
});

test("Niveles: 120 XP para el 2 y +40 por nivel; categorías 60 y +20", () => {
  const levelOf = $("levelOf"), needG = $("needG"), needC = $("needC");
  assert.equal(levelOf(0, needG).level, 1);
  assert.equal(levelOf(119, needG).level, 1);
  assert.equal(levelOf(120, needG).level, 2);
  assert.equal(levelOf(120 + 160 - 1, needG).level, 2);
  assert.equal(levelOf(120 + 160, needG).level, 3);
  assert.deepEqual(plain(levelOf(130, needG)), { level: 2, into: 10, need: 160, pct: 10 / 160 });
  assert.equal(levelOf(59, needC).level, 1);
  assert.equal(levelOf(60 + 80, needC).level, 3);
});

test("Rangos por nivel", () => {
  const rankOf = $("rankOf");
  const want = { 1: "Aprendiz", 4: "Aprendiz", 5: "Iniciado", 10: "Aventurero", 15: "Veterano", 20: "Campeón", 30: "Maestro", 40: "Gran Maestro", 49: "Gran Maestro", 50: "Leyenda", 80: "Leyenda" };
  for (const [lv, name] of Object.entries(want)) assert.equal(rankOf(+lv).name, name, `nivel ${lv}`);
  assert.equal($("nextRank")(50), null);
});

test("Día completo: 4 categorías distintas de 5 dan +50 XP; 3 no", () => {
  R.setDays({ [md(1)]: four(30, 1), [md(2)]: four(30, 1).slice(0, 3), [md(3)]: [...four(30, 1).slice(1), { cat: "finanzas", min: 30, diff: 1 }] });
  const s = $("compute")();
  assert.equal(s.perDay[md(1)].full, true);
  assert.equal(s.perDay[md(1)].xp, 4 * 40 + 50);
  assert.equal(s.perDay[md(2)].full, false);
  assert.equal(s.perDay[md(2)].xp, 3 * 40);
  assert.equal(s.perDay[md(3)].full, true, "Finanzas cuenta como categoría distinta");
  assert.equal(s.perDay[md(3)].xp, 3 * 40 + 50 + 50);
  assert.equal(s.fullDays, 2);
});

test("Rachas: actual desde hoy, o desde ayer si hoy todavía no hay nada", () => {
  const a = [{ cat: "curso", min: 10, diff: 1 }];
  R.setDays({ [day(-6)]: a, [day(-5)]: a, [day(-4)]: a, [day(-2)]: a, [day(-1)]: a, [day(0)]: a });
  let s = $("compute")();
  assert.equal(s.curStreak, 3);
  assert.equal(s.bestStreak, 3);
  R.setDays({ [day(-3)]: a, [day(-2)]: a, [day(-1)]: a });
  s = $("compute")();
  assert.equal(s.curStreak, 3, "hoy sin actividad no corta la racha");
  R.setDays({ [day(-3)]: a, [day(-2)]: a });
  assert.equal($("compute")().curStreak, 0, "un día sin actividad la corta");
});

test("Logros: se desbloquean el primer día que se cumplen", () => {
  const a = [{ cat: "lectura", min: 20, diff: 1 }];
  R.setDays({ [md(1)]: a, [md(2)]: four(), [md(3)]: a, [md(10)]: a });
  const s = $("compute")();
  assert.equal(s.unlocked["primer-paso"], md(1));
  assert.equal(s.unlocked["dia-completo"], md(2));
  assert.equal(s.unlocked["racha-3"], md(3));
  assert.equal(s.unlocked["racha-7"], undefined);
  assert.deepEqual(plain(s.perDay[md(2)].ach), ["dia-completo"]);
});

test("Logros: Maestría equilibrada pide 4 categorías distintas en nivel 5", () => {
  const xp5 = 60 + 80 + 100 + 120;                   // XP para llegar al nivel 5 de una categoría = 360
  const big = (cat) => ({ cat, min: 240, diff: 3 });  // 500 XP
  R.setDays({ [md(1)]: [big("curso"), big("fisico"), big("cuidado")] });
  assert.equal($("compute")().unlocked.maestria, undefined);
  R.setDays({ [md(1)]: [big("curso"), big("fisico"), big("cuidado")], [md(2)]: [big("finanzas")] });
  const s = $("compute")();
  assert.ok(s.catXP.finanzas >= xp5);
  assert.equal(s.unlocked.maestria, md(2));
});

test("Oro: XP ÷ 10 (mínimo 1), +10 por día completo y +25 cada 7 días de racha", () => {
  const a = (min) => [{ cat: "curso", min, diff: 1 }];
  const spec = {};
  for (let d = 1; d <= 14; d++) spec[md(d)] = a(30);
  spec[md(1)] = four(30, 1);
  spec[md(2)] = a(1);                                  // 11 XP → 1 de Oro
  const days = R.setDays(spec);
  const gold = $("derivedGold")(days);
  const by = (src) => gold.filter((g) => g.source === src);
  assert.equal(by("activity").length, 4 + 13);
  assert.equal(by("activity").find((g) => g.source_id.includes(md(2))).amount, 1);
  assert.ok(by("activity").every((g) => g.amount >= 1));
  assert.deepEqual(plain(by("full_day").map((g) => [g.source_id, g.amount])), [[md(1), 10]]);
  assert.deepEqual(plain(by("streak").map((g) => [g.source_id, g.amount])), [[md(7), 25], [md(14), 25]]);
  // Mismos ids en cada cálculo: la PC y el celular producen las mismas filas
  assert.deepEqual(plain($("derivedGold")(days).map((g) => g.id)), plain(gold.map((g) => g.id)));
});

test("Oro: conciliar no reescribe lo que ya está igual y anula lo que sobra", () => {
  const days = R.setDays({ [md(1)]: [{ id: "a1", cat: "curso", min: 30, diff: 1 }] });
  const at = "2025-03-02T00:00:00.000Z";
  const desired = $("derivedGold")(days);
  const first = $("reconcileGold")(desired, [], at);
  assert.equal(first.length, 1);
  assert.equal($("reconcileGold")(desired, first, at).length, 0, "sin cambios no escribe nada");
  const gone = $("reconcileGold")([], first, at);
  assert.equal(gone.length, 1);
  assert.ok(gone[0].deleted_at);
});

test("Saldo: confirmado + operaciones pendientes", () => {
  const eco = { coins: new Map([["1", { amount: 100 }], ["2", { amount: -30 }], ["3", { amount: 50, deleted_at: "x" }]]),
    purchases: new Map([["p", { status: "pending", price: 20 }]]), goals: new Map(), chests: new Map(), bosses: new Map(),
    ops: [{ kind: "chest", level: 5, gold: 40 }] };
  const g = $("goldState")(eco);
  assert.equal(g.balance, 100 - 30 - 20 + 40);
  assert.equal(g.pending, 60);
});

test("Cofres: niveles y Oro iguales a chest_def de Supabase", () => {
  assert.deepEqual(plain($("CHESTS").map((c) => [c.level, c.gold])), [[5, 40], [10, 100], [15, 150], [20, 200], [30, 300], [40, 400], [50, 500]]);
  const eco = { chests: new Map([[5, { claimed_at: "2025-01-01" }]]), ops: [{ kind: "chest", level: 10, at: "2025-01-02" }] };
  const st = $("chestList")(15, eco).map((c) => c.status);
  assert.deepEqual(plain(st), ["opened", "opening", "available", "locked", "locked", "locked", "locked"]);
});

test("Objetivos: progreso con las actividades de su mes", () => {
  const days = R.setDays({
    "2025-02-28": four(),                                // otro mes: no cuenta
    [md(1)]: four(30, 1), [md(2)]: [{ cat: "lectura", min: 45, diff: 2 }], [md(5)]: [{ cat: "lectura", min: 15, diff: 1 }],
  });
  const g = (goal_type, category = null) => $("goalProgress")({ goal_type, category, year: 2025, month: 3 }, days);
  assert.equal(g("activities"), 6);
  assert.equal(g("cat_activities", "lectura"), 3);
  assert.equal(g("minutes"), 120 + 45 + 15);
  assert.equal(g("cat_minutes", "lectura"), 30 + 45 + 15);
  assert.equal(g("xp"), 160 + 50 + 83 + 25);            // incluye el bonus de día completo
  assert.equal(g("cat_xp", "lectura"), 40 + 83 + 25);   // sin bonus
  assert.equal(g("streak"), 2);
  assert.equal($("goalProgress")({ goal_type: "manual", manual_progress: 7 }, days), 7);
});

test("Boss: el daño usa la misma cuenta que los objetivos y el estado sigue el HP", () => {
  const days = R.setDays({ [md(1)]: four(30, 1), [md(2)]: [{ cat: "finanzas", min: 30, diff: 2 }] });
  const b = { id: "b", year: 2025, month: 3, boss_type: "xp", category: null, target_hp: 300, manual_progress: 0 };
  assert.equal($("bossDamage")(b, days), 160 + 50 + 75);
  assert.equal($("bossDamage")({ ...b, boss_type: "cat_xp", category: "finanzas" }, days), 75);
  const eco = { ops: [] };
  assert.equal($("bossStatus")({ ...b, target_hp: 285 }, 285, eco), "defeated");
  assert.equal($("bossStatus")(b, 285, eco), "failed", "mes pasado sin derrotar");
  assert.equal($("bossStatus")({ ...b, claimed_at: "x" }, 0, eco), "claimed");
  const c = $("curMonth")();
  const now = { ...b, year: c.y, month: c.m, target_hp: 100 };
  assert.equal($("bossStatus")(now, 79, eco), "active");
  assert.equal($("bossStatus")(now, 81, eco), "weak", "menos del 20 % de HP");
  const hits = $("bossHits")(b, days);
  assert.equal(hits.reduce((t, h) => t + h.v, 0), $("bossDamage")(b, days), "los golpes suman el daño");
});
