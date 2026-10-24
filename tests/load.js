/* Carga las reglas de la app (los mismos archivos que usa el navegador) en un contexto aislado de Node.
   Los archivos comparten variables globales igual que en la página; aquí se simulan solo document y Sync,
   que esos archivos usan al cargarse para escuchar clics. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const FILES = ["game.js", "storage.js", "economy.js", "tesoro.js", "boss.js"];

function loadRules() {
  const noop = () => {};
  const ctx = vm.createContext({
    console, crypto: globalThis.crypto, setTimeout, clearTimeout,
    document: { addEventListener: noop, getElementById: () => null },
    Sync: { onNotice: noop, onChange: noop },
    addEventListener: noop, matchMedia: () => ({ matches: false }),
    navigator: {}, location: { hash: "" },
  });
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx, { filename: f });
  // Estado mínimo que leen las reglas (game.js usa state.demo; boss.js, state.eco)
  vm.runInContext(`state = { days: {}, demo: false, eco: { coins: new Map(), items: new Map(), purchases: new Map(), goals: new Map(), chests: new Map(), bosses: new Map(), ops: [] } };`, ctx);
  const get = (name) => vm.runInContext(name, ctx);
  /** Reemplaza los días que ven las reglas: { "2026-10-01": [{cat, min, diff, title?}] } */
  const setDays = (spec) => {
    const days = {};
    let n = 0;
    for (const [k, acts] of Object.entries(spec)) {
      days[k] = { activities: acts.map((a) => ({ id: a.id || `act-${k}-${n++}`, cat: a.cat, title: a.title || "Prueba", min: a.min, diff: a.diff,
        xp: get("actXP")(a.min, a.diff, a.cat), note: "", ts: Date.parse(k + "T10:00:00Z") + n })) };
    }
    get("state").days = days;
    return days;
  };
  return { get, setDays, ctx };
}

module.exports = { loadRules, ROOT };
