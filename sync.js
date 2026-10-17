/* Life RPG — sincronización con Supabase.
   Offline-first: la app siempre lee y escribe en la copia local (storage.js).
   Este módulo sube la cola de pendientes y baja lo nuevo de otros dispositivos.
   Si no hay internet o Supabase está pausado, la app sigue funcionando y reintenta sola.

   Solo usa la Publishable Key (config.js). Nunca la service_role ni una secret key. */
const Sync = (() => {
  const cfg = window.LIFE_RPG_CONFIG || {};
  const enabled = !!(cfg.supabaseUrl && cfg.supabaseKey && window.supabase && window.supabase.createClient);
  const COLS = "id,date,category,title,minutes,intensity,note,created_at,updated_at,deleted_at,synced_at";
  const RETRY = [5, 15, 60, 300]; // segundos
  const PAGE = 1000, CHUNK = 500;
  // Perfil: nombre, lema y (versión 4) avatar, título equipado y logros destacados
  const PROF = ["name", "motto", "avatar_initials", "avatar_icon", "avatar_frame", "avatar_bg", "avatar_badge", "equipped_title", "featured_badges"];
  // Tablas nuevas que la app sube: local → Supabase, columna de conflicto, prefijo en la cola de pendientes
  const PUSH = [
    ["items", "shop_items", "id", "item:"],
    ["goals", "monthly_goals", "id", "goal:"],
    ["coins", "coin_transactions", "user_id,id", "coin:"],
    ["bosses", "monthly_bosses", "user_id,id", "boss:"],
    ["plans", "planned_activities", "user_id,id", "plan:"],   // versión 5
    ["focus", "focus_sessions", "user_id,id", "focus:"],      // versión 5
  ];
  // Tablas nuevas que se bajan: local, Supabase, columnas, orden secundario
  const PULL = [
    ["coins", "coin_transactions", "id,amount,type,source,source_id,description,created_at,updated_at,deleted_at,synced_at", "id"],
    ["items", "shop_items", "id,item_type,name,description,price,icon,rarity,category,active,is_primary_goal,created_at,updated_at,deleted_at,synced_at", "id"],
    ["goals", "monthly_goals", "id,year,month,title,description,goal_type,category,target_value,manual_progress,coin_reward,completed_at,claimed_at,created_at,updated_at,deleted_at,synced_at", "id"],
    ["purchases", "purchases", "id,item_id,item_type,item_name,item_icon,item_rarity,price,status,reason,purchased_at,updated_at,synced_at", "id"],
    ["chests", "level_chests", "level,name,gold,claimed_at,updated_at,synced_at", "level"],
    ["bosses", "monthly_bosses", "id,year,month,name,description,boss_type,category,target_hp,manual_progress,coin_reward,title_reward,theme,claimed_at,created_at,updated_at,deleted_at,synced_at", "id"],
    ["plans", "planned_activities", "id,date,time,title,category,planned_minutes,intensity,note,status,moved_from,created_at,updated_at,deleted_at,synced_at", "id"],
    ["focus", "focus_sessions", "id,planned_activity_id,device_id,title,category,mode,status,started_at,segment_started_at,segments,focus_seconds,pomodoro,ended_at,created_at,updated_at,deleted_at,synced_at", "id"],
  ];

  // Tablas de la versión 5: si todavía no se ejecutó 004 en Supabase, se saltean sin frenar el resto
  const OPTIONAL = new Set(["planned_activities", "focus_sessions"]);
  const missing = (e) => e && (e.code === "PGRST205" || e.code === "42P01" || /could not find the table|does not exist/i.test(String(e.message || "")));

  let sb = null, session = null, linked = null;
  let status = "local"; // local | confirm | syncing | synced | offline | error
  let busy = false, again = false, debounce = null, retryTimer = null, retryN = 0;
  let offset = 0, pendingN = 0, lastSync = null, channel = null, uploadCount = 0;
  const listeners = new Set(), noticeFns = new Set();
  const notice = (n) => noticeFns.forEach((f) => { try { f(n); } catch (e) {} });
  const emit = () => listeners.forEach((f) => { try { f(); } catch (e) {} });
  const uid = () => (session && session.user ? session.user.id : null);
  const ready = () => !!(enabled && session && linked && linked === uid());

  async function refreshCount() {
    try { pendingN = (await Store.pendingList()).length + (await Store.ops()).filter((o) => !o.done).length; } catch (e) {}
  }

  function errText(e) {
    const m = String((e && (e.message || e.error_description || e.msg)) || e || "");
    if (/invalid login credentials/i.test(m)) return "Email o contraseña incorrectos.";
    if (/already registered|already exists/i.test(m)) return "Ya existe una cuenta con ese email. Usa Iniciar sesión.";
    if (/password should be at least|weak password/i.test(m)) return "La contraseña es muy corta: usa al menos 8 caracteres.";
    if (/email.*invalid|invalid.*email|unable to validate email/i.test(m)) return "Ese email no parece válido.";
    if (/email not confirmed/i.test(m)) return "Falta confirmar el email. Desactiva Confirm email en Supabase o revisa tu correo.";
    if (/signups? not allowed|signup is disabled/i.test(m)) return "Los registros nuevos están cerrados en Supabase.";
    if (/rate limit|too many/i.test(m)) return "Demasiados intentos. Espera un minuto y vuelve a probar.";
    if (/fetch|network|load failed|timeout|503|540|paused/i.test(m) || !navigator.onLine)
      return "No se pudo conectar con el servidor. Revisa tu conexión o vuelve a intentar en un rato.";
    return "No se pudo completar: " + m;
  }

  async function afterLogin() {
    const id = uid(); if (!id) return;
    linked = await Store.getMeta("account");
    if (linked && linked !== id) {
      // Datos de otra cuenta en este dispositivo: no se mezclan.
      await Store.clearAll(); linked = null;
      if (window.App) await App.reload();
    }
    if (!linked) {
      const n = (await Store.allRows()).filter((r) => !r.deleted_at).length
        + (await Store.all("items")).filter((r) => !r.deleted_at).length + (await Store.all("goals")).filter((r) => !r.deleted_at).length
        + (await Store.all("bosses")).filter((r) => !r.deleted_at).length
        + (await Store.all("plans")).filter((r) => !r.deleted_at).length + (await Store.all("focus")).filter((r) => !r.deleted_at).length;
      if (n > 0) { uploadCount = n; status = "confirm"; emit(); return; }
      await Store.setMeta("account", id); linked = id;
    }
    startRealtime(); run();
  }

  function startRealtime() {
    if (!sb || channel || !uid()) return;
    try {
      channel = sb.channel("life-rpg-" + uid())
        .on("postgres_changes", { event: "*", schema: "public", table: "activities", filter: `user_id=eq.${uid()}` }, () => changed(800))
        .on("postgres_changes", { event: "*", schema: "public", table: "profiles", filter: `user_id=eq.${uid()}` }, () => changed(800))
        .on("postgres_changes", { event: "*", schema: "public", table: "coin_transactions", filter: `user_id=eq.${uid()}` }, () => changed(800))
        .on("postgres_changes", { event: "*", schema: "public", table: "shop_items", filter: `user_id=eq.${uid()}` }, () => changed(800))
        .on("postgres_changes", { event: "*", schema: "public", table: "purchases", filter: `user_id=eq.${uid()}` }, () => changed(800))
        .on("postgres_changes", { event: "*", schema: "public", table: "monthly_goals", filter: `user_id=eq.${uid()}` }, () => changed(800))
        .on("postgres_changes", { event: "*", schema: "public", table: "level_chests", filter: `user_id=eq.${uid()}` }, () => changed(800))
        .on("postgres_changes", { event: "*", schema: "public", table: "monthly_bosses", filter: `user_id=eq.${uid()}` }, () => changed(800))
        .on("postgres_changes", { event: "*", schema: "public", table: "planned_activities", filter: `user_id=eq.${uid()}` }, () => changed(800))
        .on("postgres_changes", { event: "*", schema: "public", table: "focus_sessions", filter: `user_id=eq.${uid()}` }, () => changed(500))
        .subscribe();
    } catch (e) { channel = null; }
  }
  function stopRealtime() { if (channel && sb) { try { sb.removeChannel(channel); } catch (e) {} } channel = null; }

  function scheduleRetry() {
    clearTimeout(retryTimer);
    const s = RETRY[Math.min(retryN, RETRY.length - 1)]; retryN++;
    retryTimer = setTimeout(run, s * 1000);
  }

  /** Un ciclo: hora del servidor → subir pendientes → bajar lo nuevo */
  async function run() {
    if (!ready()) return;
    if (busy) { again = true; return; }
    clearTimeout(retryTimer);
    if (!navigator.onLine) { status = "offline"; await refreshCount(); emit(); return; }
    busy = true; status = "syncing"; emit();
    let changedLocal = false;
    try {
      // 1. Hora del servidor, para que updated_at no dependa de un reloj desfasado
      const t0 = Date.now();
      const { data: srv, error: e0 } = await sb.rpc("server_now");
      if (e0) throw e0;
      const t1 = Date.now(), st = Date.parse(srv);
      if (!isNaN(st)) { offset = st - (t0 + t1) / 2; Store.setMeta("clockOffset", offset); }

      // 2. Subir
      const pend = await Store.pendingList();
      const actPend = pend.filter((p) => p.id !== "profile" && !p.id.includes(":"));
      for (let i = 0; i < actPend.length; i += CHUNK) {
        const part = actPend.slice(i, i + CHUNK);
        const rows = await Store.getRows(part.map((p) => p.id));
        if (rows.length) {
          const { error } = await sb.from("activities").upsert(rows.map((r) => ({ ...r, user_id: uid() })), { onConflict: "id", defaultToNull: false });
          if (error) throw error;
        }
        await Store.clearPending(part);
      }
      const profPend = pend.find((p) => p.id === "profile");
      if (profPend) {
        const p = await Store.getProfile();
        const row = { user_id: uid(), updated_at: p.updated_at }; for (const k of PROF) row[k] = p[k];
        const { error } = await sb.from("profiles").upsert(row, { onConflict: "user_id", defaultToNull: false });
        if (error) throw error;
        await Store.clearPending([profPend]);
      }

      // 3. Bajar (con 2 minutos de margen para no perder cambios que llegaron casi al mismo tiempo)
      const cursor = (await Store.getMeta("cursor")) || "1970-01-01T00:00:00.000Z";
      const since = new Date(Date.parse(cursor) - 120000).toISOString();
      let from = 0, maxSeen = cursor;
      for (;;) {
        const { data, error } = await sb.from("activities").select(COLS).gt("synced_at", since)
          .order("synced_at", { ascending: true }).order("id", { ascending: true }).range(from, from + PAGE - 1);
        if (error) throw error;
        if (data.length) {
          if (await Store.applyRemote(data)) changedLocal = true;
          for (const r of data) if (Date.parse(r.synced_at) > Date.parse(maxSeen)) maxSeen = new Date(Date.parse(r.synced_at)).toISOString();
        }
        if (data.length < PAGE) break;
        from += PAGE;
      }
      await Store.setMeta("cursor", maxSeen);
      const { data: prof, error: e3 } = await sb.from("profiles").select(PROF.join(",") + ",updated_at").maybeSingle();
      if (e3) throw e3;
      if (prof && (await Store.applyRemoteProfile(prof))) changedLocal = true;

      // 4. Tablas nuevas: subir recompensas, objetivos, Oro derivado, Bosses, planificaciones y sesiones de enfoque
      for (const [t, table, conflict, P] of PUSH) {
        const mine = pend.filter((p) => p.id.startsWith(P));
        for (let i = 0; i < mine.length; i += CHUNK) {
          const part = mine.slice(i, i + CHUNK);
          let rows = await Store.getT(t, part.map((p) => p.id.slice(P.length)));
          if (t === "coins") rows = rows.filter((r) => Store.DERIVED.includes(r.source)); // el resto lo escribe el servidor
          if (t === "bosses") rows = rows.map(({ claimed_at, ...r }) => r);                // claimed_at solo lo escribe claim_boss
          if (rows.length) {
            const { error } = await sb.from(table).upsert(rows.map((r) => ({ ...r, user_id: uid() })), { onConflict: conflict, defaultToNull: false });
            if (error && OPTIONAL.has(table) && missing(error)) break;    // quedan pendientes hasta que exista la tabla
            if (error) throw error;
          }
          await Store.clearPending(part);
        }
      }

      // 5. Compras, reclamos y cofres: los decide el servidor, en el orden en que se hicieron
      for (const op of await Store.ops()) {
        if (op.done) continue;
        const call = op.kind === "buy" ? sb.rpc("buy_reward", { p_id: op.id, p_item: op.item_id, p_at: op.at })
          : op.kind === "claim" ? sb.rpc("claim_goal", { p_goal: op.goal_id, p_at: op.at })
          : op.kind === "boss" ? sb.rpc("claim_boss", { p_boss: op.boss_id, p_at: op.at })
          : sb.rpc("open_chest", { p_level: op.level, p_at: op.at });
        const { data, error } = await call;
        if (error) throw error;
        const res = String(data || "");
        if (res === "ok" || res === "already" || res.startsWith("rejected")) {
          // listo en el servidor; la operación se quita cuando bajan sus filas (paso 7)
          await Store.putOp({ ...op, done: res });
          if (res.startsWith("rejected")) notice({ type: "buy_rejected", reason: res.split(":")[1], op });
        } else {
          // not_found, not_completed, not_defeated, not_reached, invalid: se deshace lo local
          if (op.kind === "buy") {
            const [p] = await Store.getT("purchases", [op.id]);
            if (p) await Store.put("purchases", [{ ...p, status: "rejected", reason: "not_found", updated_at: new Date().toISOString() }], { pending: false });
          }
          await Store.delOps([op.key]);
          notice({ type: op.kind + "_failed", result: res, op });
        }
        changedLocal = true;
      }

      // 6. Bajar las tablas nuevas
      for (const [t, table, cols, second] of PULL) {
        const ck = "cursor:" + table;
        const cur = (await Store.getMeta(ck)) || "1970-01-01T00:00:00.000Z";
        const sinceT = new Date(Date.parse(cur) - 120000).toISOString();
        let off = 0, max = cur;
        for (;;) {
          const { data, error } = await sb.from(table).select(cols).gt("synced_at", sinceT)
            .order("synced_at", { ascending: true }).order(second, { ascending: true }).range(off, off + PAGE - 1);
          if (error && OPTIONAL.has(table) && missing(error)) { max = cur; break; }
          if (error) throw error;
          if (data.length) {
            // compras y cofres: siempre manda el servidor
            if (await Store.applyRemoteT(t, data, { force: t === "purchases" || t === "chests" })) changedLocal = true;
            for (const r of data) if (Date.parse(r.synced_at) > Date.parse(max)) max = new Date(Date.parse(r.synced_at)).toISOString();
          }
          if (data.length < PAGE) break;
          off += PAGE;
        }
        await Store.setMeta(ck, max);
      }

      // 7. Quitar las operaciones que el servidor ya resolvió y ya bajaron
      {
        const ops = await Store.ops();
        if (ops.length) {
          const purchases = new Map((await Store.all("purchases")).map((p) => [p.id, p]));
          const goals = new Map((await Store.all("goals")).map((g) => [g.id, g]));
          const chests = new Set((await Store.all("chests")).map((c) => c.level));
          const bosses = new Map((await Store.all("bosses")).map((b) => [b.id, b]));
          const gone = ops.filter((o) =>
            (o.kind === "buy" && purchases.get(o.id) && purchases.get(o.id).status !== "pending") ||
            (o.kind === "claim" && goals.get(o.goal_id) && goals.get(o.goal_id).claimed_at) ||
            (o.kind === "chest" && chests.has(o.level)) ||
            (o.kind === "boss" && bosses.get(o.boss_id) && bosses.get(o.boss_id).claimed_at)).map((o) => o.key);
          if (gone.length) { await Store.delOps(gone); changedLocal = true; }
        }
      }

      status = "synced"; lastSync = Date.now(); retryN = 0;
    } catch (e) {
      status = navigator.onLine ? "error" : "offline";
      scheduleRetry();
    } finally {
      busy = false;
      await refreshCount();
      if (changedLocal && window.App) await App.reload();
      emit();
      if (again) { again = false; run(); }
    }
  }

  /** Llamar después de cada cambio local: agrupa cambios seguidos y sincroniza */
  function changed(ms = 2000) {
    refreshCount().then(emit);
    if (!ready()) return;
    clearTimeout(debounce); debounce = setTimeout(run, ms);
  }

  return {
    enabled,
    async init() {
      offset = +(await Store.getMeta("clockOffset")) || 0;
      await refreshCount();
      if (!enabled) { emit(); return; }
      sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "liferpg-auth" },
      });
      try { const { data } = await sb.auth.getSession(); session = data.session; } catch (e) { session = null; }
      sb.auth.onAuthStateChange((ev, s) => { session = s; emit(); });
      addEventListener("online", () => { retryN = 0; run(); });
      addEventListener("offline", () => { status = "offline"; emit(); });
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") run(); });
      setInterval(run, 5 * 60 * 1000);
      if (session) await afterLogin(); else emit();
    },
    async signIn(email, password) {
      if (!enabled) throw "La sincronización no está configurada.";
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw errText(error);
      session = data.session; await afterLogin();
    },
    async signUp(email, password) {
      if (!enabled) throw "La sincronización no está configurada.";
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) throw errText(error);
      if (!data.session) throw "La cuenta se creó, pero Supabase pide confirmar el email. Desactiva Confirm email y vuelve a iniciar sesión.";
      session = data.session; await afterLogin();
    },
    /** Primer inicio de sesión con datos locales: el usuario confirmó subirlos */
    async confirmUpload() {
      await Store.markAllPending();
      await Store.setMeta("account", uid()); linked = uid(); uploadCount = 0;
      await refreshCount(); startRealtime(); run();
    },
    /** Cierra sesión y borra los datos de este dispositivo (siguen en la cuenta) */
    async signOut() {
      stopRealtime(); clearTimeout(retryTimer); clearTimeout(debounce);
      try { await sb.auth.signOut({ scope: "local" }); } catch (e) {}
      session = null; linked = null; status = "local";
      await Store.clearAll(); await refreshCount();
      if (window.App) await App.reload();
      emit();
    },
    run, changed,
    /** Hora actual corregida con la del servidor */
    now: () => new Date(Date.now() + offset).toISOString(),
    onChange: (f) => listeners.add(f),
    /** Avisos del servidor: compra rechazada, cofre, objetivo o Boss que no se pudo confirmar */
    onNotice: (f) => noticeFns.add(f),
    get info() {
      return { enabled, signedIn: !!session, email: session && session.user ? session.user.email : "",
        status: session ? status : "local", pending: pendingN, lastSync, uploadCount, linked: ready() };
    },
    /** Texto corto para el indicador */
    label() {
      if (!session) return "Guardado en este dispositivo";
      const p = pendingN ? ` · ${pendingN} pendiente${pendingN === 1 ? "" : "s"}` : "";
      switch (status) {
        case "confirm": return "Falta confirmar la sincronización";
        case "syncing": return "Sincronizando…";
        case "synced": return pendingN ? "Sincronizando…" : "Sincronizado";
        case "offline": return "Sin conexión" + (p || " · todo guardado");
        case "error": return "Servidor no disponible" + p;
        default: return "Guardado en este dispositivo";
      }
    },
  };
})();
