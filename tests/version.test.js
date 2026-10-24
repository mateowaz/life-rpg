/* Comprobaciones de publicación:
   - todo lo que carga index.html está en la lista SHELL de sw.js (si no, no funcionaría sin internet);
   - todo lo de SHELL existe (si falta un archivo, la versión nueva no se instala);
   - si un PR cambia archivos de la app, también sube VERSION en sw.js (si no, los celulares no la reciben).
   La última solo corre con BASE_REF (la rama base del PR, por ejemplo origin/main). */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { ROOT } = require("./load.js");

const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const versionOf = (src) => (src.match(/const VERSION = "([^"]+)"/) || [])[1];
const shellOf = (src) => {
  const m = src.match(/const SHELL = \[([\s\S]*?)\];/);
  assert.ok(m, "sw.js tiene la lista SHELL");
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
};
const norm = (u) => (u === "./" ? "index.html" : u.replace(/^\.\//, ""));
const SW = read("sw.js");
const SHELL = shellOf(SW).map(norm);

test("sw.js tiene VERSION", () => assert.match(versionOf(SW) || "", /^life-rpg-v\d+$/));

test("Todos los archivos de SHELL existen", () => {
  for (const f of SHELL) assert.ok(fs.existsSync(path.join(ROOT, f)), `falta ${f}`);
});

test("Todo lo que carga index.html está en SHELL", () => {
  const html = read("index.html");
  const refs = [...html.matchAll(/<(?:script[^>]*\ssrc|link[^>]*\shref)="([^"]+)"/g)].map((x) => x[1])
    .filter((u) => !/^(https?:)?\/\//.test(u) && !u.startsWith("#") && !u.startsWith("data:")).map(norm);
  assert.ok(refs.length > 10, "se encontraron los archivos de index.html");
  for (const r of refs) assert.ok(SHELL.includes(r), `${r} no está en SHELL de sw.js`);
});

test("Si cambian archivos de la app, VERSION también cambia", { skip: !process.env.BASE_REF && "sin BASE_REF (solo en PRs)" }, () => {
  const base = process.env.BASE_REF;
  const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8" });
  const changed = git("diff", "--name-only", `${base}...HEAD`).split("\n").filter(Boolean);
  const app = changed.filter((f) => f === "sw.js" || SHELL.includes(f));
  if (!app.length) return;
  const before = versionOf(git("show", `${base}:sw.js`));
  assert.notEqual(versionOf(SW), before, `cambiaron ${app.join(", ")} pero VERSION sigue en ${before}: súbela en sw.js`);
});
