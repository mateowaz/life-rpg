/* Life RPG — capa de guardado.
   Toda la app guarda y lee SOLO a través de `Store`. Hoy guarda en el dispositivo
   (IndexedDB, funciona sin internet). Para sincronizar PC y celular más adelante,
   basta con agregar aquí un "remoto" (por ejemplo Supabase) que:
     1. envíe los cambios pendientes de `outbox` (qué días cambiaron y cuándo),
     2. envíe los ids borrados de `tombstones`,
     3. traiga los días remotos y los combine por id de actividad (gana el `updatedAt` más nuevo).
   El resto de la app no necesita cambiar. */
const Store = (() => {
  const NAME = "liferpg", VERSION = 1;
  let db = null;
  const mem = { days: {}, profile: {} }; // si el navegador no deja guardar

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore("days", { keyPath: "date" });          // {date, activities[], updatedAt}
        d.createObjectStore("meta", { keyPath: "key" });           // perfil, id del dispositivo
        d.createObjectStore("outbox", { keyPath: "date" });        // días con cambios sin sincronizar
        d.createObjectStore("tombstones", { keyPath: "id" });      // actividades borradas {id, deletedAt}
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("blocked"));
    });
  }
  function run(stores, mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      const out = fn(tx);
      tx.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  const getAll = (store) => run([store], "readonly", (tx) => tx.objectStore(store).getAll());

  async function ensureDeviceId() {
    const rows = await getAll("meta");
    if (!rows.find((r) => r.key === "device")) {
      const id = (crypto.randomUUID && crypto.randomUUID()) || Math.random().toString(36).slice(2) + Date.now().toString(36);
      await run(["meta"], "readwrite", (tx) => tx.objectStore("meta").put({ key: "device", id, createdAt: Date.now() }));
    }
  }

  return {
    /** Abre la base. Devuelve false si el navegador no permite guardar. */
    async init() {
      try { if (!("indexedDB" in window)) return false; db = await open(); await ensureDeviceId(); return true; }
      catch (e) { db = null; return false; }
    },
    /** Todo lo guardado: { days: {"AAAA-MM-DD": {activities}}, profile } */
    async loadAll() {
      if (!db) return { days: { ...mem.days }, profile: { ...mem.profile } };
      const [rows, meta] = await Promise.all([getAll("days"), getAll("meta")]);
      const days = {};
      for (const r of rows) if (r.activities && r.activities.length) days[r.date] = { activities: r.activities };
      const p = meta.find((m) => m.key === "profile") || {};
      return { days, profile: { name: p.name || "", motto: p.motto || "" } };
    },
    /** Guarda (o borra, si quedó vacío) un día completo. */
    async saveDay(date, day) {
      const now = Date.now();
      if (!db) { if (day && day.activities.length) mem.days[date] = day; else delete mem.days[date]; return; }
      await run(["days", "outbox"], "readwrite", (tx) => {
        if (day && day.activities.length) tx.objectStore("days").put({ date, activities: day.activities, updatedAt: now });
        else tx.objectStore("days").delete(date);
        tx.objectStore("outbox").put({ date, changedAt: now });
      });
    },
    async saveProfile(profile) {
      if (!db) { mem.profile = { ...profile }; return; }
      await run(["meta", "outbox"], "readwrite", (tx) => {
        tx.objectStore("meta").put({ key: "profile", name: profile.name || "", motto: profile.motto || "", updatedAt: Date.now() });
        tx.objectStore("outbox").put({ date: "profile", changedAt: Date.now() });
      });
    },
    /** Recuerda que una actividad se borró, para que la sincronización futura no la reviva. */
    markDeleted(id) {
      if (!db || !id) return;
      run(["tombstones"], "readwrite", (tx) => tx.objectStore("tombstones").put({ id, deletedAt: Date.now() })).catch(() => {});
    },
    /** Para la sincronización futura. */
    pendingChanges: () => (db ? getAll("outbox") : Promise.resolve([])),
    deletedIds: () => (db ? getAll("tombstones") : Promise.resolve([])),
  };
})();
