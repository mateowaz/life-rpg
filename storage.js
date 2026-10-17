/* Life RPG — copia local (IndexedDB).
   La app lee y escribe SOLO aquí, así funciona sin internet. `sync.js` se encarga de
   copiar estos datos hacia y desde Supabase.

   Guarda:
     activities  una fila por actividad, con los mismos campos que Supabase
                 (las borradas quedan con deleted_at y no se muestran)
     pending     ids de lo que cambió y todavía no se subió ({id, updated_at})
     meta        perfil, cuenta vinculada, marcas de la última bajada, desfase de reloj
     coins       historial de Oro (transacciones)
     items       recompensas de la tienda y deseos de la Wishlist
     purchases   compras (confirmadas, pendientes o rechazadas)
     goals       objetivos mensuales
     chests      cofres por nivel ya abiertos
     bosses      Boss de cada mes (versión 4)
     ops         compras, reclamos y cofres que esperan la confirmación del servidor */
const Store = (() => {
  const NAME = "liferpg", VERSION = 4;
  let db = null;
  const mem = { rows: new Map(), pending: new Map(), meta: new Map(), ops: new Map() }; // si el navegador no deja guardar
  /* Tablas nuevas (versión 3). prefix = cómo se anotan en la cola de pendientes; sin prefix nunca se suben
     (las compras y los cofres solo los escribe el servidor). */
  const T = {
    coins:     { key: "id",    prefix: "coin:" },
    items:     { key: "id",    prefix: "item:" },
    goals:     { key: "id",    prefix: "goal:" },
    purchases: { key: "id" },
    chests:    { key: "level" },
    bosses:    { key: "id",    prefix: "boss:" },   // versión 4
  };
  for (const t in T) mem[t] = new Map();

  /* ---- ids: los ids viejos (no UUID) se convierten siempre al mismo UUID ---- */
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function hash32(str, seed) {
    let h = (seed ^ str.length) >>> 0;
    for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 2654435761); h = (h << 13) | (h >>> 19); }
    h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^ (h >>> 16)) >>> 0;
  }
  function toUUID(id) {
    if (typeof id === "string" && UUID_RE.test(id)) return id.toLowerCase();
    const s = "life-rpg:" + String(id);
    const hex = [1, 2, 3, 4].map((k) => hash32(s, Math.imul(k, 0x9e3779b1)).toString(16).padStart(8, "0")).join("").split("");
    hex[12] = "8"; hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
    const x = hex.join("");
    return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
  }
  function newId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const x = [...b].map((v) => v.toString(16).padStart(2, "0")).join("");
    return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
  }
  /** Campos del perfil. Los de la versión 4 (avatar, título, logros destacados) tienen valor por defecto. */
  function profileFields(p) {
    const str = (v, n, d) => (typeof v === "string" ? v.slice(0, n) : d);
    return { name: str(p.name, 40, ""), motto: str(p.motto, 80, ""), avatar_initials: str(p.avatar_initials, 2, ""), avatar_icon: str(p.avatar_icon, 16, "initials"),
      avatar_frame: str(p.avatar_frame, 16, "simple"), avatar_bg: str(p.avatar_bg, 16, "violet"), avatar_badge: str(p.avatar_badge, 16, "none"),
      equipped_title: str(p.equipped_title, 64, ""), featured_badges: Array.isArray(p.featured_badges) ? p.featured_badges.filter((x) => typeof x === "string").slice(0, 3) : [] };
  }
  const iso = (v) => { const t = typeof v === "number" ? v : Date.parse(v); return new Date(isNaN(t) ? Date.now() : t).toISOString(); };
  const time = (v) => { const t = Date.parse(v); return isNaN(t) ? 0 : t; };

  /** Actividad del formato viejo ({id, cat, title, min, diff, note, ts}) → fila nueva */
  function legacyToRow(date, a) {
    const at = iso(+a.ts || Date.now());
    return { id: toUUID(a.id), date, category: a.cat, title: String(a.title || "").slice(0, 80), minutes: Math.round(+a.min),
      intensity: +a.diff, note: String(a.note || "").slice(0, 120), created_at: at, updated_at: at, deleted_at: null };
  }
  /** Solo los campos que se guardan, con fechas en un formato único */
  function clean(r) {
    return { id: toUUID(r.id), date: String(r.date).slice(0, 10), category: r.category, title: r.title, minutes: +r.minutes,
      intensity: +r.intensity, note: r.note || "", created_at: iso(r.created_at), updated_at: iso(r.updated_at),
      deleted_at: r.deleted_at ? iso(r.deleted_at) : null };
  }

  /* Origen del Oro que calcula la app (el resto lo escribe solo el servidor) */
  const DERIVED = ["activity", "full_day", "streak"];
  const isoN = (v) => (v ? iso(v) : null);
  /** Normaliza filas de las tablas nuevas: fechas en un solo formato, sin campos de más */
  function cleanT(t, r) {
    switch (t) {
      case "coins": return { id: r.id, amount: Math.round(+r.amount), type: r.type, source: r.source, source_id: String(r.source_id),
        description: String(r.description || "").slice(0, 80), created_at: iso(r.created_at), updated_at: iso(r.updated_at), deleted_at: isoN(r.deleted_at) };
      case "items": return { id: r.id, item_type: r.item_type === "wishlist" ? "wishlist" : "reward", name: String(r.name || "").slice(0, 40),
        description: String(r.description || "").slice(0, 120), price: Math.round(+r.price), icon: String(r.icon || "gift").slice(0, 16),
        rarity: r.rarity || "common", category: r.category || null, active: r.active !== false, is_primary_goal: !!r.is_primary_goal,
        created_at: iso(r.created_at), updated_at: iso(r.updated_at), deleted_at: isoN(r.deleted_at) };
      case "goals": return { id: r.id, year: +r.year, month: +r.month, title: String(r.title || "").slice(0, 60), description: String(r.description || "").slice(0, 120),
        goal_type: r.goal_type, category: r.category || null, target_value: Math.round(+r.target_value), manual_progress: Math.max(0, Math.round(+r.manual_progress || 0)),
        coin_reward: Math.round(+r.coin_reward || 0), completed_at: isoN(r.completed_at), claimed_at: isoN(r.claimed_at),
        created_at: iso(r.created_at), updated_at: iso(r.updated_at), deleted_at: isoN(r.deleted_at) };
      case "purchases": return { id: r.id, item_id: r.item_id, item_type: r.item_type || "reward", item_name: String(r.item_name || ""), item_icon: r.item_icon || "gift",
        item_rarity: r.item_rarity || "common", price: Math.round(+r.price), status: r.status, reason: r.reason || null,
        purchased_at: iso(r.purchased_at), updated_at: iso(r.updated_at) };
      case "bosses": return { id: r.id, year: +r.year, month: +r.month, name: String(r.name || "").slice(0, 60), description: String(r.description || "").slice(0, 160),
        boss_type: r.boss_type, category: r.category || null, target_hp: Math.round(+r.target_hp), manual_progress: Math.max(0, Math.round(+r.manual_progress || 0)),
        coin_reward: Math.round(+r.coin_reward || 0), title_reward: r.title_reward ? String(r.title_reward).slice(0, 40) : null, theme: r.theme || "dragon",
        claimed_at: isoN(r.claimed_at), created_at: iso(r.created_at), updated_at: iso(r.updated_at), deleted_at: isoN(r.deleted_at) };
      case "chests": return { level: +r.level, name: r.name, gold: +r.gold, claimed_at: iso(r.claimed_at), updated_at: iso(r.updated_at || r.claimed_at) };
    }
    return r;
  }

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = (e) => {
        const d = req.result, tx = req.transaction;
        if (!d.objectStoreNames.contains("activities")) d.createObjectStore("activities", { keyPath: "id" });
        if (!d.objectStoreNames.contains("pending")) d.createObjectStore("pending", { keyPath: "id" });
        if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta", { keyPath: "key" });
        // Versiones 3 y 4: solo se agregan almacenes nuevos; nada de lo anterior se toca
        for (const t in T) if (!d.objectStoreNames.contains(t)) d.createObjectStore(t, { keyPath: T[t].key });
        if (!d.objectStoreNames.contains("ops")) d.createObjectStore("ops", { keyPath: "key" });
        // Versión 1 guardaba un registro por día: se convierte a una fila por actividad.
        // El almacén viejo "days" se conserva sin tocar, como respaldo.
        if (e.oldVersion === 1 && d.objectStoreNames.contains("days")) {
          const acts = tx.objectStore("activities");
          tx.objectStore("days").openCursor().onsuccess = (ev) => {
            const c = ev.target.result; if (!c) return;
            for (const a of c.value.activities || []) acts.put(legacyToRow(c.value.date, a));
            c.continue();
          };
          const meta = tx.objectStore("meta");
          meta.get("profile").onsuccess = (ev) => {
            const p = ev.target.result;
            if (p) meta.put({ key: "profile", name: p.name || "", motto: p.motto || "", updated_at: iso(p.updated_at || p.updatedAt || Date.now()) });
          };
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("blocked"));
    });
  }
  function tx(stores, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode);
      let out;
      Promise.resolve(fn(t, (v) => (out = v))).catch(reject);
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }
  const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  async function getMeta(key) {
    if (!db) return mem.meta.get(key);
    const row = await tx(["meta"], "readonly", (t, set) => req(t.objectStore("meta").get(key)).then((r) => set(r)));
    return row ? row.value : undefined;
  }
  async function setMeta(key, value) {
    if (!db) { mem.meta.set(key, value); return; }
    await tx(["meta"], "readwrite", (t) => { t.objectStore("meta").put({ key, value }); });
  }

  return {
    toUUID, newId, legacyToRow, clean,

    /** Abre la base. Devuelve false si el navegador no permite guardar. */
    async init() {
      try {
        if (!("indexedDB" in window)) return false;
        db = await open();
        if (!(await getMeta("device"))) await setMeta("device", newId());
        return true;
      } catch (e) { db = null; return false; }
    },

    /** Todas las filas, incluidas las borradas */
    async allRows() {
      if (!db) return [...mem.rows.values()];
      return tx(["activities"], "readonly", (t, set) => req(t.objectStore("activities").getAll()).then(set));
    },

    /** Guarda filas cambiadas en este dispositivo y las anota como pendientes de subir */
    async putRows(rows) {
      rows = rows.map(clean);
      if (!db) { for (const r of rows) { mem.rows.set(r.id, r); mem.pending.set(r.id, { id: r.id, updated_at: r.updated_at }); } return; }
      await tx(["activities", "pending"], "readwrite", (t) => {
        for (const r of rows) {
          t.objectStore("activities").put(r);
          t.objectStore("pending").put({ id: r.id, updated_at: r.updated_at });
        }
      });
    },

    /** Aplica filas que llegaron de Supabase. Gana el updated_at más reciente. Devuelve cuántas cambiaron. */
    async applyRemote(remoteRows) {
      if (!remoteRows.length) return 0;
      const rows = remoteRows.map(clean);
      if (!db) {
        let n = 0;
        for (const r of rows) { const l = mem.rows.get(r.id); if (!l || time(r.updated_at) > time(l.updated_at)) { mem.rows.set(r.id, r); mem.pending.delete(r.id); n++; } }
        return n;
      }
      return tx(["activities", "pending"], "readwrite", async (t, set) => {
        let n = 0;
        const acts = t.objectStore("activities"), pend = t.objectStore("pending");
        await Promise.all(rows.map(async (r) => {
          const l = await req(acts.get(r.id));
          if (!l || time(r.updated_at) > time(l.updated_at)) {
            acts.put(r); n++;
            const p = await req(pend.get(r.id));
            if (p && time(p.updated_at) <= time(r.updated_at)) pend.delete(r.id);
          }
        }));
        set(n);
      });
    },

    async getRows(ids) {
      if (!db) return ids.map((id) => mem.rows.get(id)).filter(Boolean);
      return tx(["activities"], "readonly", (t, set) =>
        Promise.all(ids.map((id) => req(t.objectStore("activities").get(id)))).then((r) => set(r.filter(Boolean))));
    },

    /* ---- perfil ---- */
    async getProfile() {
      const p = db ? await tx(["meta"], "readonly", (t, set) => req(t.objectStore("meta").get("profile")).then(set)) : mem.meta.get("profile");
      return { ...profileFields(p || {}), updated_at: p && p.updated_at ? iso(p.updated_at) : null };
    },
    async saveProfile(p, remote = false) {
      const row = { key: "profile", ...profileFields(p), updated_at: iso(p.updated_at || Date.now()) };
      if (!db) { mem.meta.set("profile", row); if (!remote) mem.pending.set("profile", { id: "profile", updated_at: row.updated_at }); return; }
      await tx(["meta", "pending"], "readwrite", (t) => {
        t.objectStore("meta").put(row);
        if (!remote) t.objectStore("pending").put({ id: "profile", updated_at: row.updated_at });
      });
    },
    /** Perfil que llegó de Supabase: se aplica solo si es más reciente. Devuelve true si cambió. */
    async applyRemoteProfile(p) {
      const local = await this.getProfile();
      if (local.updated_at && time(p.updated_at) <= time(local.updated_at)) return false;
      await this.saveProfile(p, true);
      if (db) await tx(["pending"], "readwrite", (t) => { t.objectStore("pending").delete("profile"); });
      else mem.pending.delete("profile");
      return true;
    },

    /* ---- cola de pendientes ---- */
    async pendingList() {
      if (!db) return [...mem.pending.values()];
      return tx(["pending"], "readonly", (t, set) => req(t.objectStore("pending").getAll()).then(set));
    },
    /** Quita de la cola lo que se subió, salvo que haya cambiado de nuevo mientras tanto */
    async clearPending(entries) {
      if (!db) { for (const e of entries) { const p = mem.pending.get(e.id); if (p && p.updated_at === e.updated_at) mem.pending.delete(e.id); } return; }
      await tx(["pending"], "readwrite", async (t) => {
        const s = t.objectStore("pending");
        await Promise.all(entries.map(async (e) => { const p = await req(s.get(e.id)); if (p && p.updated_at === e.updated_at) s.delete(e.id); }));
      });
    },
    /** Al vincular una cuenta por primera vez: todo lo local queda pendiente de subir */
    async markAllPending() {
      const rows = await this.allRows(), prof = await this.getProfile();
      const entries = rows.map((r) => ({ id: r.id, updated_at: r.updated_at }));
      if (prof.updated_at && (prof.name || prof.motto || prof.avatar_icon !== "initials" || prof.avatar_initials || prof.equipped_title || prof.featured_badges.length)) entries.push({ id: "profile", updated_at: prof.updated_at });
      for (const r of await this.all("items")) entries.push({ id: "item:" + r.id, updated_at: r.updated_at });
      for (const r of await this.all("goals")) entries.push({ id: "goal:" + r.id, updated_at: r.updated_at });
      for (const r of await this.all("bosses")) entries.push({ id: "boss:" + r.id, updated_at: r.updated_at });
      for (const r of await this.all("coins")) if (DERIVED.includes(r.source)) entries.push({ id: "coin:" + r.id, updated_at: r.updated_at });
      if (!db) { for (const e of entries) mem.pending.set(e.id, e); return; }
      await tx(["pending"], "readwrite", (t) => { for (const e of entries) t.objectStore("pending").put(e); });
    },

    getMeta, setMeta,

    /** Borra los datos de este dispositivo (al cerrar sesión). Conserva el id del dispositivo. */
    async clearAll() {
      const stores = ["activities", "pending", "meta", "ops", ...Object.keys(T)];
      if (!db) { mem.rows.clear(); mem.pending.clear(); mem.ops.clear(); for (const t in T) mem[t].clear(); const d = mem.meta.get("device"); mem.meta.clear(); mem.meta.set("device", d); return; }
      const device = await getMeta("device");
      await tx(stores, "readwrite", (t) => {
        for (const st of stores) t.objectStore(st).clear();
        t.objectStore("meta").put({ key: "device", value: device });
      });
    },

    /* ---- Tablas nuevas: coins, items, goals, purchases, chests, bosses ---- */
    DERIVED,
    /** Todas las filas de una tabla */
    async all(t) {
      if (!db) return [...mem[t].values()];
      return tx([t], "readonly", (x, set) => req(x.objectStore(t).getAll()).then(set));
    },
    async getT(t, keys) {
      if (!db) return keys.map((k) => mem[t].get(k)).filter(Boolean);
      return tx([t], "readonly", (x, set) => Promise.all(keys.map((k) => req(x.objectStore(t).get(k)))).then((r) => set(r.filter(Boolean))));
    },
    /** Guarda filas cambiadas en este dispositivo; las que se suben quedan en la cola de pendientes */
    async put(t, rows, { pending = true } = {}) {
      const P = pending && T[t].prefix;
      rows = rows.map((r) => cleanT(t, r));
      if (!db) { for (const r of rows) { mem[t].set(r[T[t].key], r); if (P) mem.pending.set(P + r.id, { id: P + r.id, updated_at: r.updated_at }); } return; }
      await tx(P ? [t, "pending"] : [t], "readwrite", (x) => {
        for (const r of rows) {
          x.objectStore(t).put(r);
          if (P) x.objectStore("pending").put({ id: P + r.id, updated_at: r.updated_at });
        }
      });
    },
    /** Filas que llegaron de Supabase. Gana el updated_at más reciente; con force, siempre el servidor.
        Un objetivo o un Boss reclamado no vuelve atrás. Devuelve cuántas cambiaron. */
    async applyRemoteT(t, remote, { force = false } = {}) {
      if (!remote.length) return 0;
      const K = T[t].key, P = T[t].prefix;
      const sticky = t === "goals" || t === "bosses";
      const merge = (l, r) => (sticky && l && l.claimed_at && !r.claimed_at ? { ...r, claimed_at: l.claimed_at } : r);
      const wins = (l, r) => !l || force || time(r.updated_at) > time(l.updated_at) || (sticky && r.claimed_at && !l.claimed_at);
      const rows = remote.map((r) => cleanT(t, r));
      if (!db) {
        let n = 0;
        for (const r of rows) { const l = mem[t].get(r[K]); if (wins(l, r)) { mem[t].set(r[K], merge(l, r)); if (P) mem.pending.delete(P + r.id); n++; } }
        return n;
      }
      return tx(P ? [t, "pending"] : [t], "readwrite", async (x, set) => {
        let n = 0;
        const s = x.objectStore(t);
        await Promise.all(rows.map(async (r) => {
          const l = await req(s.get(r[K]));
          if (wins(l, r)) {
            s.put(merge(l, r)); n++;
            if (P) { const ps = x.objectStore("pending"), p = await req(ps.get(P + r.id)); if (p && time(p.updated_at) <= time(r.updated_at)) ps.delete(P + r.id); }
          }
        }));
        set(n);
      });
    },

    /* ---- Operaciones que decide el servidor (compras, reclamos, cofres) ---- */
    async ops() {
      const list = db ? await tx(["ops"], "readonly", (x, set) => req(x.objectStore("ops").getAll()).then(set)) : [...mem.ops.values()];
      return list.sort((a, b) => a.seq - b.seq);
    },
    async putOp(op) {
      op = { seq: Date.now() + Math.random(), ...op };
      if (!db) { mem.ops.set(op.key, op); return; }
      await tx(["ops"], "readwrite", (x) => { x.objectStore("ops").put(op); });
    },
    async delOps(keys) {
      if (!keys.length) return;
      if (!db) { for (const k of keys) mem.ops.delete(k); return; }
      await tx(["ops"], "readwrite", (x) => { for (const k of keys) x.objectStore("ops").delete(k); });
    },
  };
})();
