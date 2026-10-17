/* Life RPG — Oro, cofres y objetivos mensuales.
   Reglas puras: no guardan nada. No cambian XP, niveles, rangos, rachas ni logros (game.js).
   El Oro de actividades, días completos y rachas se calcula desde las actividades; compras,
   objetivos reclamados y cofres abiertos los confirma el servidor. */

/* ============ Reglas ============ */
const GOLD_FULL_DAY = 10, GOLD_STREAK = 25, STREAK_STEP = 7;
const goldForXP = (xp) => Math.max(1, Math.round(xp / 10));
// Los mismos cofres que la función chest_def de Supabase
const CHESTS = [
  { level: 5, name: "Cofre de Iniciado", gold: 40 },
  { level: 10, name: "Cofre de Aventurero", gold: 100 },
  { level: 15, name: "Cofre de Veterano", gold: 150 },
  { level: 20, name: "Cofre de Campeón", gold: 200 },
  { level: 30, name: "Cofre de Maestro", gold: 300 },
  { level: 40, name: "Cofre de Gran Maestro", gold: 400 },
  { level: 50, name: "Cofre de Leyenda", gold: 500 },
];
const RARITY = {
  common: { name: "Común", hint: "20–50 Oro" },
  rare: { name: "Rara", hint: "60–120 Oro" },
  epic: { name: "Épica", hint: "150–300 Oro" },
  legendary: { name: "Legendaria", hint: "350–700 Oro" },
  mythic: { name: "Mítica", hint: "800+ Oro" },
};
const GOAL_TYPES = {
  activities: { name: "Completar actividades", unit: "actividades", cat: false },
  xp: { name: "Conseguir XP", unit: "XP", cat: false },
  minutes: { name: "Invertir minutos", unit: "min", cat: false },
  cat_activities: { name: "Actividades de una categoría", unit: "veces", cat: true },
  cat_xp: { name: "XP en una categoría", unit: "XP", cat: true },
  cat_minutes: { name: "Minutos en una categoría", unit: "min", cat: true },
  streak: { name: "Mantener una racha", unit: "días", cat: false },
  manual: { name: "Objetivo manual", unit: "", cat: false },
};
// Atajos al crear un objetivo
const GOAL_PRESETS = [
  { id: "read", label: "Leer X minutos", goal_type: "cat_minutes", category: "lectura", title: (n) => `Leer ${n} minutos` },
  { id: "train", label: "Hacer ejercicio X veces", goal_type: "cat_activities", category: "fisico", title: (n) => `Entrenar ${n} veces` },
];
const SHOP_ICONS = ["gift", "game", "popcorn", "food", "coffee", "bag", "bed", "travel", "book", "music", "headphones", "ticket", "shoe", "laptop", "spa", "star"];
const SHOP_ICON_NAMES = { gift: "Regalo", game: "Videojuegos", popcorn: "Película", food: "Comida", coffee: "Café", bag: "Compras", bed: "Descanso", travel: "Viaje",
  book: "Libro", music: "Música", headphones: "Auriculares", ticket: "Salida", shoe: "Zapatillas", laptop: "Tecnología", spa: "Bienestar", star: "Capricho" };

/* ============ Oro derivado de las actividades ============ */
/** Lo que deberían ser las transacciones de actividades, días completos y rachas.
    Ids fijos: el mismo cálculo en la PC y en el celular produce las mismas filas. */
function derivedGold(days) {
  const out = [];
  const keys = Object.keys(days).filter((k) => days[k].activities.length).sort();
  let run = 0, prev = null;
  for (const k of keys) {
    const cats = new Set();
    for (const a of days[k].activities) {
      cats.add(a.cat);
      out.push({ id: a.id, amount: goldForXP(a.xp), source: "activity", source_id: a.id, description: String(a.title).slice(0, 80), created_at: new Date(a.ts || Date.parse(k)).toISOString() });
    }
    if (cats.size === 4) out.push({ id: Store.toUUID("full_day:" + k), amount: GOLD_FULL_DAY, source: "full_day", source_id: k, description: "Día completo", created_at: k + "T12:00:00.000Z" });
    run = prev && addDays(prev, 1) === k ? run + 1 : 1; prev = k;
    if (run % STREAK_STEP === 0) out.push({ id: Store.toUUID("streak:" + k), amount: GOLD_STREAK, source: "streak", source_id: k, description: `Racha de ${run} días`, created_at: k + "T12:00:00.000Z" });
  }
  return out;
}
/** Compara lo calculado con lo guardado: devuelve solo las filas que hay que crear, ajustar o anular.
    No escribe nada si el contenido es igual, así dos dispositivos no se pisan en bucle. */
function reconcileGold(desired, existing, at) {
  const byId = new Map(existing.map((r) => [r.id, r]));
  const want = new Set(), out = [];
  const stamp = (e) => (e && Date.parse(e.updated_at) >= Date.parse(at) ? new Date(Date.parse(e.updated_at) + 1).toISOString() : at);
  for (const d of desired) {
    want.add(d.id);
    const e = byId.get(d.id);
    if (!e) out.push({ ...d, type: "earn", updated_at: at, deleted_at: null });
    else if (Store.DERIVED.includes(e.source) && (e.amount !== d.amount || e.description !== d.description || e.deleted_at))
      out.push({ ...e, amount: d.amount, description: d.description, deleted_at: null, updated_at: stamp(e) });
  }
  for (const e of existing)
    if (Store.DERIVED.includes(e.source) && !e.deleted_at && !want.has(e.id)) out.push({ ...e, deleted_at: at, updated_at: stamp(e) });
  return out;
}

/* ============ Saldo ============ */
/** Saldo = Oro confirmado + operaciones que esperan al servidor */
function goldState(eco) {
  let earned = 0, spent = 0;
  for (const c of eco.coins.values()) { if (c.deleted_at) continue; if (c.amount > 0) earned += c.amount; else spent -= c.amount; }
  let pendIn = 0, pendOut = 0;
  for (const p of eco.purchases.values()) if (p.status === "pending") pendOut += p.price;
  for (const o of eco.ops) {
    if (o.kind === "claim") { const g = eco.goals.get(o.goal_id); if (!(g && g.claimed_at)) pendIn += o.amount; }
    if (o.kind === "chest" && !eco.chests.has(o.level)) pendIn += o.gold;
    if (o.kind === "boss") { const b = eco.bosses && eco.bosses.get(o.boss_id); if (!(b && b.claimed_at)) pendIn += o.amount; }
  }
  return { balance: earned - spent + pendIn - pendOut, earned: earned + pendIn, spent: spent + pendOut, pending: pendIn + pendOut };
}

/* ============ Cofres ============ */
/** Estado de cada cofre: locked | available | opening | opened */
function chestList(level, eco) {
  return CHESTS.map((c) => {
    const opened = eco.chests.get(c.level);
    const op = eco.ops.find((o) => o.kind === "chest" && o.level === c.level);
    const status = opened ? "opened" : op ? "opening" : level >= c.level ? "available" : "locked";
    return { ...c, status, claimed_at: opened ? opened.claimed_at : op ? op.at : null };
  });
}

/* ============ Objetivos mensuales ============ */
const monthKey = (y, m) => `${y}-${pad(m)}`;
/** Progreso de un objetivo, calculado con las actividades de su mes */
function goalProgress(g, days) {
  if (g.goal_type === "manual") return g.manual_progress || 0;
  const pre = monthKey(g.year, g.month) + "-";
  const keys = Object.keys(days).filter((k) => k.startsWith(pre) && days[k].activities.length).sort();
  let v = 0, run = 0, best = 0, prev = null;
  for (const k of keys) {
    const acts = days[k].activities, mine = g.category ? acts.filter((a) => a.cat === g.category) : acts;
    switch (g.goal_type) {
      case "activities": case "cat_activities": v += mine.length; break;
      case "xp": v += acts.reduce((t, a) => t + a.xp, 0) + (new Set(acts.map((a) => a.cat)).size === 4 ? FULL_DAY_BONUS : 0); break;
      case "cat_xp": v += mine.reduce((t, a) => t + a.xp, 0); break;
      case "minutes": case "cat_minutes": v += mine.reduce((t, a) => t + a.min, 0); break;
      case "streak": run = prev && addDays(prev, 1) === k ? run + 1 : 1; prev = k; best = Math.max(best, run); break;
    }
  }
  return g.goal_type === "streak" ? best : v;
}
/** Texto del progreso: minutos largos en horas */
function goalNumbers(g, v) {
  if ((g.goal_type === "minutes" || g.goal_type === "cat_minutes") && g.target_value >= 120) {
    const h = (n) => (n % 60 ? (n / 60).toLocaleString("es", { maximumFractionDigits: 1 }) : n / 60) + " h";
    return `${h(Math.min(v, g.target_value))} / ${h(g.target_value)}`;
  }
  const u = GOAL_TYPES[g.goal_type].unit;
  return `${nf(Math.min(v, g.target_value))} / ${nf(g.target_value)}${u && u !== "actividades" && u !== "veces" ? " " + u : ""}`;
}
/** Estado de un objetivo: claimed | claiming | completed | active */
function goalStatus(g, v, eco) {
  if (g.claimed_at) return "claimed";
  if (eco.ops.some((o) => o.kind === "claim" && o.goal_id === g.id)) return "claiming";
  return v >= g.target_value ? "completed" : "active";
}
