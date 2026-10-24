/* Imprime la XP de la app para cada combinación posible (1–240 minutos × 3 intensidades × 5 categorías). */
"use strict";
const { loadRules } = require("../load.js");
const R = loadRules();
const actXP = R.get("actXP"), CATS = R.get("CATS");
const out = [];
for (const c of CATS) for (let diff = 1; diff <= 3; diff++) for (let min = 1; min <= 240; min++) out.push([min, diff, c.id, actXP(min, diff, c.id)]);
process.stdout.write(JSON.stringify(out));
