/* Life RPG — notificaciones (Web Push) en la app.
   · El permiso del navegador se pide SOLO al tocar "Permitir" en la confirmación de Perfil > Notificaciones.
   · Cada dispositivo se activa por separado, con el mismo id de dispositivo que usa Focus.
   · Preferencias: una fila por cuenta (notification_preferences), offline-first como el perfil.
   · Objetivo cerca, Boss debilitado y Cofre disponible los detecta la app (con goalProgress, bossInfo y chestList)
     y se avisan a tus OTROS dispositivos; lo que ya era cierto al empezar se anota como baseline y no se manda.
   · Lo que esta app ya mostró en pantalla (fin de fase del Pomodoro) se marca shown_in_app SOLO para este dispositivo.
   · Llamadas al servidor sin conexión: quedan en una cola local (almacén "nout") y salen al sincronizar.
   Nunca guarda ni manda la clave VAPID privada: el navegador solo usa la pública (config.js). */
const Notify = window.Notify = (() => {
  const cfg = window.LIFE_RPG_CONFIG || {};
  const VAPID = String(cfg.vapidPublicKey || "");
  const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const tzNow = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch (e) { return "UTC"; } };
  const DEF = { enabled: true, plan_reminders: true, overdue: true, focus: true, goals: true, boss: true, chests: true, default_reminder: 30,
    quiet_enabled: false, quiet_start: "23:00", quiet_end: "08:00" };
  const TYPES = [["plan_reminders", "Recordatorios de planificaciones"], ["overdue", "Misiones atrasadas"], ["focus", "Fin de enfoque y de descanso"],
    ["goals", "Objetivo cerca de completarse"], ["boss", "Boss debilitado"], ["chests", "Cofre disponible"]];
  const REM = [["", "Sin recordatorio"], ["0", "A la hora"], ["10", "10 min antes"], ["30", "30 min antes"], ["60", "1 hora antes"]];
  const S = { ready: false, on: false, endpoint: null, prefs: null, devices: null, server: null, busy: false, err: "", seen: new Set(), base: false, badge: -1 };

  const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unb64u = (s) => { const t = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)); return Uint8Array.from(t, (c) => c.charCodeAt(0)); };
  const linked = () => Sync.info.signedIn && Sync.info.linked;
  const missingFn = (e) => e && (e.code === "PGRST202" || e.code === "42883" || /could not find the function|does not exist/i.test(String(e.message || "")));
  const netErr = (e) => !navigator.onLine || /fetch|network|load failed|timeout/i.test(String((e && e.message) || e || ""));
  function deviceName() {
    const ua = navigator.userAgent;
    const os = /android/i.test(ua) ? "Android" : /iphone/i.test(ua) ? "iPhone" : /ipad/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1) ? "iPad"
      : /windows/i.test(ua) ? "Windows" : /mac os/i.test(ua) ? "Mac" : /cros/i.test(ua) ? "ChromeOS" : /linux/i.test(ua) ? "Linux" : "Dispositivo";
    const br = /samsungbrowser/i.test(ua) ? "Samsung Internet" : /edg\//i.test(ua) ? "Edge" : /opr\//i.test(ua) ? "Opera" : /firefox|fxios/i.test(ua) ? "Firefox"
      : /chrome|crios/i.test(ua) ? "Chrome" : /safari/i.test(ua) ? "Safari" : "Navegador";
    return `${os} · ${br}`;
  }
  async function swReg() {
    if (!("serviceWorker" in navigator)) return null;
    return Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 4000))]);
  }

  /* ============ Preferencias (offline-first, gana la más nueva) ============ */
  const prefs = () => ({ ...DEF, ...(S.prefs || {}) });
  async function savePrefs(patch) {
    S.prefs = { ...prefs(), ...patch, timezone: tzNow(), updated_at: Sync.now() };
    await Store.setMeta("nprefs", S.prefs); await Store.markPending("nprefs", S.prefs.updated_at);
    Sync.changed(800);
  }
  /** Preferencias que llegaron de Supabase (sync.js). Devuelve true si cambiaron. */
  async function applyRemotePrefs(p) {
    if (!p) return false;
    const l = S.prefs;
    if (l && l.updated_at && Date.parse(p.updated_at) <= Date.parse(l.updated_at)) return false;
    const row = { ...DEF }; for (const k in DEF) if (p[k] !== undefined) row[k] = p[k];
    row.quiet_start = String(p.quiet_start || DEF.quiet_start).slice(0, 5); row.quiet_end = String(p.quiet_end || DEF.quiet_end).slice(0, 5);
    row.timezone = p.timezone || "UTC"; row.updated_at = p.updated_at;
    S.prefs = row; await Store.setMeta("nprefs", row); return true;
  }
  /** Fila para subir: la zona horaria es la de este dispositivo */
  const prefsRow = () => (S.prefs ? { ...prefs(), timezone: S.prefs.timezone || tzNow(), updated_at: S.prefs.updated_at } : null);

  /* ============ Respaldo (versión 6): solo preferencias, nunca dispositivos ni suscripciones ============ */
  const exportPrefs = () => { if (!S.prefs) return null; const o = {}; for (const k in DEF) o[k] = prefs()[k]; o.updated_at = S.prefs.updated_at || null; return o; };
  function parsePrefs(x) {
    if (!x || typeof x !== "object") return null;
    const o = {}, hm = /^([01]\d|2[0-3]):[0-5]\d$/;
    for (const k in DEF) {
      const v = x[k];
      if (typeof DEF[k] === "boolean") o[k] = typeof v === "boolean" ? v : DEF[k];
      else if (k === "default_reminder") o[k] = v === null ? null : Number.isInteger(+v) && +v >= 0 && +v <= 1440 && v !== "" ? +v : DEF[k];
      else o[k] = typeof v === "string" && hm.test(v.slice(0, 5)) ? v.slice(0, 5) : DEF[k];
    }
    return o;
  }
  /** Al importar: en Reemplazar se aplican; al Combinar, solo si esta cuenta todavía no tiene preferencias. Nunca activa un dispositivo. */
  async function importPrefs(p, mode) {
    if (!p || (mode !== "replace" && S.prefs)) return false;
    await savePrefs(p); return true;
  }

  /* ============ Cola local de llamadas al servidor ============ */
  async function enqueue(op) { op = { at: Date.now(), ...op }; await Store.putOut(op); Sync.changed(300); }
  /** La llama sync.js en cada ciclo, ya con sesión y conexión. Un error de red o de servidor sin 005 deja el resto para después. */
  async function flush(sb) {
    if (!sb) return;
    if (S.on && !S.devChecked) { S.devChecked = true; loadDevices(); }   // una vez por apertura, ya con sesión: ¿sigue activo este dispositivo?
    const ops = await Store.outbox(); if (!ops.length) return;
    const now = Date.now(), done = [];
    for (const op of ops) {
      if ((op.kind === "queue" && now - op.at > 24 * 3600e3) || (op.kind === "shown" && now - op.at > 30 * 60e3)) { done.push(op.key); continue; }
      const { data, error } = await sb.rpc(op.fn, op.args);
      if (error) { if (missingFn(error)) S.server = false; if (missingFn(error) || netErr(error)) break; }
      else S.server = true;
      done.push(op.key);
      if (op.fn === "register_push_device" && data === "ok") S.devices = null;
    }
    if (done.length) await Store.delOut(done);
  }
  async function call(fn, args) {
    const sb = Sync.client(); if (!sb) throw "offline";
    const { data, error } = await sb.rpc(fn, args);
    if (error) { if (missingFn(error)) { S.server = false; throw "server"; } throw netErr(error) ? "offline" : String(error.message || error); }
    S.server = true; return data;
  }
  async function loadDevices() {
    const sb = Sync.client(); if (!sb) return;
    const { data, error } = await sb.from("push_devices").select("device_id,device_name,enabled,disabled_reason,last_used_at,created_at").order("created_at");
    if (error) { if (/push_devices|PGRST205|42P01/.test(String(error.code || "") + (error.message || ""))) S.server = false; return; }
    S.server = true; S.devices = data;
    // Lo que dice el servidor sobre ESTE dispositivo manda: vencido → se renueva solo; apagado desde otro dispositivo → queda apagado aquí
    const me = data.find((d) => d.device_id === state.device);
    if (S.on && me && !me.enabled) {
      if (me.disabled_reason === "vencida") renew();
      else { S.on = false; S.endpoint = null; Store.setMeta("pushOn", false); Store.setMeta("pushEndpoint", null); }
    }
    render();
  }
  /** La suscripción de este dispositivo venció (404/410): se pide una nueva, una vez por apertura */
  async function renew() {
    if (S.renewed || !supported() || Notification.permission !== "granted" || !VAPID) return;
    S.renewed = true;
    try {
      const reg = await swReg(); if (!reg) return;
      const old = await reg.pushManager.getSubscription(); if (old) await old.unsubscribe();
      await register(await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: unb64u(VAPID) }));
      S.devices = null; render();
    } catch (e) {}
  }

  /* ============ Este dispositivo ============ */
  async function register(sub) {
    const j = sub.toJSON(), args = { p_device: state.device, p_name: deviceName(), p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_tz: tzNow() };
    S.endpoint = j.endpoint; await Store.setMeta("pushEndpoint", j.endpoint);
    try { const r = await call("register_push_device", args); if (r !== "ok") throw r; }
    catch (e) { if (e === "offline") await enqueue({ key: "register", kind: "device", fn: "register_push_device", args }); else throw e; }
  }
  /** Al tocar Permitir: el permiso se pide en este mismo toque, antes de cualquier espera */
  function allow() {
    if (!dlg || dlg.type !== "notifConfirm") return;
    const ask = Notification.requestPermission();
    dlg.busy = true; renderModal();
    Promise.resolve(ask).then(async (perm) => {
      if (perm !== "granted") { dlg = null; renderModal(); toast(perm === "denied" ? "Bloqueaste las notificaciones en este navegador." : "No se activaron las notificaciones."); render(); return; }
      try {
        const reg = await swReg(); if (!reg) throw "La app todavía no terminó de instalarse. Recarga la página y vuelve a probar.";
        let sub = await reg.pushManager.getSubscription();
        const key = unb64u(VAPID);
        if (sub && sub.options && sub.options.applicationServerKey && b64u(sub.options.applicationServerKey) !== VAPID) { await sub.unsubscribe(); sub = null; }
        if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        if (!S.prefs) await savePrefs({});
        await register(sub);
        S.on = true; await Store.setMeta("pushOn", true); S.devices = null;
        dlg = null; renderModal(); toast("Notificaciones activadas en este dispositivo.");
        watch(true); loadDevices();
      } catch (e) {
        dlg.busy = false; dlg.err = e === "server" ? "Falta activar las notificaciones en el servidor." : typeof e === "string" ? e : "No se pudo activar: " + ((e && e.message) || e); renderModal();
      }
      render();
    });
  }
  async function disableHere() {
    S.busy = true; render();
    try { const reg = await swReg(); const sub = reg && (await reg.pushManager.getSubscription()); if (sub) await sub.unsubscribe(); } catch (e) {}
    S.on = false; S.endpoint = null; await Store.setMeta("pushOn", false); await Store.setMeta("pushEndpoint", null);
    await enqueue({ key: "device:" + state.device, kind: "device", fn: "set_push_device", args: { p_device: state.device, p_action: "disable" } });
    S.busy = false; S.devices = null; toast("Notificaciones desactivadas en este dispositivo."); render();
  }
  /** sync.js, antes de cerrar sesión: este dispositivo deja de recibir avisos de esa cuenta */
  async function beforeSignOut(sb) {
    if (!S.on) return;
    try { await Promise.race([sb.rpc("set_push_device", { p_device: state.device, p_action: "signout" }), new Promise((r) => setTimeout(r, 3000))]); } catch (e) {}
    try { const reg = await swReg(); const sub = reg && (await reg.pushManager.getSubscription()); if (sub) await sub.unsubscribe(); } catch (e) {}
    S.on = false; S.endpoint = null; S.prefs = null; S.devices = null; S.seen = new Set(); S.base = false;
  }
  /** Al abrir: si el navegador renovó o perdió la suscripción, se vuelve a registrar sola */
  async function check() {
    if (!S.on || !supported() || Notification.permission !== "granted" || !VAPID) return;
    try {
      const reg = await swReg(); if (!reg) return;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: unb64u(VAPID) });
      if (sub.endpoint !== S.endpoint && linked()) await register(sub);
      if (linked()) loadDevices();
    } catch (e) {}
  }

  /* ============ Objetivo cerca, Boss debilitado, Cofre disponible ============ */
  function conditions() {
    const out = [], c = curMonth(), s = compute();
    for (const g of state.eco.goals.values()) {
      if (g.deleted_at || g.claimed_at || g.year !== c.y || g.month !== c.m) continue;
      const v = goalProgress(g, state.days); if (!(v < g.target_value && v >= 0.8 * g.target_value)) continue;
      const left = g.target_value - v, u = GOAL_TYPES[g.goal_type].unit;
      out.push({ id: `goal:${g.id}:near`, title: "Estás cerca", body: `Te faltan ${nf(left)}${u ? " " + u : ""} para completar ${g.title}`.slice(0, 160), url: `#objetivos?goal=${g.id}` });
    }
    const b = bossFor(c.y, c.m);
    if (b) { const i = bossInfo(b); if (i.st === "weak") out.push({ id: `boss:${b.id}:weak`, title: "El Boss está debilitado", body: `${b.name}: le queda ${Math.max(1, Math.round(i.left / i.hp * 100))} % de HP`.slice(0, 160), url: "#boss" }); }
    for (const ch of chestList(s.G.level, state.eco)) if (ch.status === "available") out.push({ id: `chest:${ch.level}:available`, title: "Cofre disponible", body: `Alcanzaste el nivel ${ch.level}: ${ch.name}`, url: `#dashboard?chest=${ch.level}` });
    return out;
  }
  /** first = recién activadas en este dispositivo: lo que ya era cierto se anota como baseline */
  async function watch(first) {
    if (!state.ready || state.demo || !linked() || !S.prefs) return;
    const list = conditions(), base = first || !S.base; let changed = false;
    for (const x of list) {
      if (S.seen.has(x.id)) continue;
      S.seen.add(x.id); changed = true;
      await enqueue({ key: "q:" + x.id, kind: "queue", fn: "queue_notification", args: { p_logical_id: x.id, p_title: x.title, p_body: x.body, p_url: x.url, p_origin: state.device, p_baseline: base } });
    }
    if (!S.base) { S.base = true; await Store.setMeta("nBase", true); }
    if (changed) await Store.setMeta("nSeen", [...S.seen].slice(-300));
  }

  /* ============ Lo que esta app ya mostró ============ */
  /** Fin de fase del Pomodoro en ESTE dispositivo (focus.js). Si la app está en segundo plano, la notificación la muestra ella misma. */
  async function focusPhase(f, kind, atMs) {
    const lid = `focus:${f.id}:${kind === "focusEnd" ? "focus" : "break"}:${Math.floor(atMs / 1000)}`;
    if (linked() && S.on) enqueue({ key: "shown:" + lid, kind: "shown", fn: "mark_shown_in_app", args: { p_logical_id: lid, p_device: state.device } });
    if (document.visibilityState !== "hidden" || !supported() || Notification.permission !== "granted" || !prefs().enabled || !prefs().focus) return;
    try {
      const reg = await swReg(); if (!reg) return;
      const P = f.pomodoro || {};
      await reg.showNotification(kind === "focusEnd" ? "Enfoque terminado" : "Descanso terminado", {
        body: kind === "focusEnd" ? `${P.focus || 25} minutos completados · ${f.title}` : `¿Empezamos otra ronda? · ${f.title}`,
        tag: "focus-" + f.id, renotify: true, icon: "./icons/icon-192.png", badge: "./icons/badge-96.png", data: { url: `#planificador?session=${f.id}`, kind: "focus", id: lid },
      });
    } catch (e) {}
  }

  /* ============ Número en el ícono ============ */
  function badgeCount() {
    if (!state.ready || state.demo) return 0;
    const s = compute();
    let n = overdueLists().recent.length + chestList(s.G.level, state.eco).filter((c) => c.status === "available").length + claimCount();
    for (const b of liveBosses()) if (bossInfo(b).st === "defeated") n++;
    return Math.min(n, 99);
  }
  function paintBadge() {
    const n = badgeCount(); if (n === S.badge) return; S.badge = n;
    try { if (navigator.setAppBadge) (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {}); } catch (e) {}
  }
  /** Cierra avisos de planificaciones que ya no están pendientes (se completaron u omitieron en otro lado) */
  async function tidy() {
    try {
      const reg = await swReg(); if (!reg || !reg.getNotifications) return;
      for (const n of await reg.getNotifications()) {
        const m = /plan=([0-9a-f-]{36})/.exec((n.data && n.data.url) || ""); if (!m) continue;
        const p = state.plans.get(m[1]); if (!p || p.deleted_at || !isOpenPlan(planState(p))) n.close();
      }
    } catch (e) {}
  }

  /* ============ Perfil > Notificaciones ============ */
  const isAndroid = () => /android/i.test(navigator.userAgent);
  const tog = (id, label, on, dis = false) => `<label class="ntog"><span>${label}</span><input type="checkbox" role="switch" data-npref="${id}" ${on ? "checked" : ""} ${dis ? "disabled" : ""}></label>`;
  const privacy = `<ul class="nprivacy">
    <li>Se usan solo para avisarte de tus planificaciones, tu enfoque, tus objetivos y tus recompensas.</li>
    <li>Cada dispositivo se activa por separado y necesita su propio permiso.</li>
    <li>Puedes apagarlas cuando quieras, en cada dispositivo o en todos.</li>
    <li>Apagarlas no borra ni cambia tus datos ni tu progreso.</li></ul>`;
  function devicesHTML() {
    if (S.devices === null) { loadDevices(); return `<div class="muted-s">Cargando dispositivos…</div>`; }
    if (!S.devices.length) return `<div class="muted-s">Todavía no hay dispositivos activados.</div>`;
    return `<div class="ndevs">${S.devices.map((d) => {
      const me = d.device_id === state.device;
      const st = d.enabled ? "Activo" : d.disabled_reason === "vencida" ? "Vencido: vuelve a activarlo desde ese dispositivo" : d.disabled_reason === "sesión cerrada" ? "Sesión cerrada en ese dispositivo" : "Apagado";
      return `<div class="ndev ${d.enabled ? "on" : ""}"><span class="ndot"></span><div><b>${esc(d.device_name || "Dispositivo")}${me ? ` <span class="chip">este dispositivo</span>` : ""}</b><small>${st}</small></div>
        <div class="ndev-b">${!me && d.enabled ? `<button class="btn sm ghost" data-ndev-off="${esc(d.device_id)}">Apagar</button>` : ""}${!me || !d.enabled ? `<button class="btn sm ghost" data-ndev-del="${esc(d.device_id)}">Quitar</button>` : ""}</div></div>`;
    }).join("")}</div>`;
  }
  function panel() {
    const head = `<section class="panel notif-panel"><div class="panel-h"><h2>Notificaciones</h2>${S.on ? `<span class="chip gold">Activas aquí</span>` : ""}</div>`;
    const intro = `<p class="muted-p">Life RPG puede avisarte sobre actividades planificadas, Focus, objetivos y recompensas.</p>`;
    const end = `</section>`;
    if (!supported()) {
      if (isIOS() && !isStandalone()) return head + intro + `<div class="goal"><b>Primero instala Life RPG en la pantalla de inicio</b><span class="muted-s">En iPhone y iPad las notificaciones funcionan solo con la app instalada (iOS 16.4 o posterior): en Safari toca Compartir y luego "Agregar a inicio". Después ábrela desde el ícono y vuelve aquí.</span></div>` + end;
      return head + `<p class="muted-p">Las notificaciones no están disponibles en este dispositivo. Todo lo demás funciona igual.</p>` + end;
    }
    if (!Sync.info.signedIn) return head + intro + `<p class="muted-s">Para activarlas inicia sesión en Cuenta y sincronización: los avisos salen desde tu cuenta, así llegan aunque la app esté cerrada.</p>` + end;
    if (!VAPID || S.server === false) return head + intro + `<p class="muted-s">Falta activar las notificaciones en el servidor.</p>` + end;
    if (Notification.permission === "denied") return head + intro + `<div class="goal"><b>Las notificaciones están bloqueadas en este navegador</b><span class="muted-s">Para permitirlas: en Chrome toca el candado o los tres puntos › Información del sitio › Notificaciones › Permitir. En la app instalada de Android: mantén presionado el ícono › Información de la app › Notificaciones. Después vuelve aquí.</span></div>`
      + (S.devices && S.devices.length ? `<div class="nsub">Notificar en</div>${devicesHTML()}` : "") + end;
    if (!S.on) return head + intro + `<button class="btn primary sm" id="nOn">${ico("bell")} Activar notificaciones</button>`
      + (S.devices && S.devices.length ? `<div class="nsub">Notificar en</div>${devicesHTML()}` : S.devices === null ? `<div hidden>${devicesHTML()}</div>` : "") + privacy + end;
    const p = prefs(), off = !p.enabled;
    const remSel = `<select class="inp" id="nRem">${REM.map(([v, l]) => `<option value="${v}" ${String(p.default_reminder ?? "") === v ? "selected" : ""}>${l}</option>`).join("")}${REM.some(([v]) => v === String(p.default_reminder ?? "")) ? "" : `<option value="${p.default_reminder}" selected>${p.default_reminder} min antes</option>`}</select>`;
    return head + `<div class="nlist">${tog("enabled", "<b>Recibir notificaciones</b>", p.enabled)}</div>
      <div class="nsub">Qué avisos</div><div class="nlist">${TYPES.map(([k, l]) => tog(k, l, p[k], off)).join("")}</div>
      <div class="row2" style="margin-top:12px"><div class="field"><label for="nRem">Recordatorio por defecto</label>${remSel}<small class="muted-s">Para planificaciones con hora. Lo cambias en cada una.</small></div></div>
      <div class="nsub">Horario silencioso</div><div class="nlist">${tog("quiet_enabled", "No molestar", p.quiet_enabled, off)}</div>
      ${p.quiet_enabled ? `<div class="row2"><div class="field"><label for="nQs">Desde</label><input class="inp num" type="time" id="nQs" value="${esc(p.quiet_start)}"></div><div class="field"><label for="nQe">Hasta</label><input class="inp num" type="time" id="nQe" value="${esc(p.quiet_end)}"></div></div>
      <small class="muted-s">Solo pasan los avisos de Focus. Al terminar llega lo que siga vigente (si son más de 3, un solo resumen).</small>` : ""}
      <div class="nsub">Notificar en</div>${devicesHTML()}
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px"><button class="btn sm" id="nTest" ${S.busy ? "disabled" : ""}>Probar en este dispositivo</button><button class="btn sm ghost" id="nOff" ${S.busy ? "disabled" : ""}>Desactivar notificaciones en este dispositivo</button></div>
      ${isAndroid() ? `<p class="muted-s" style="margin:12px 0 0">Si los avisos llegan tarde, desactiva la optimización de batería para Chrome en los ajustes de Android.</p>` : ""}
      ${isIOS() ? `<p class="muted-s" style="margin:12px 0 0">En iPhone la notificación no tiene botones: tócala para abrir la app.</p>` : ""}
      ${privacy}` + end;
  }
  function dlgView(d) {
    if (d.type !== "notifConfirm") return "";
    return `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="nH"><div><div class="eyebrow">Notificaciones</div><h2 id="nH">¿Activar en este dispositivo?</h2></div>
      <span class="muted-s">Vas a recibir, aunque la app esté cerrada:</span>
      <ul class="nwhat"><li>Recordatorios de tus planificaciones y misiones atrasadas</li><li>Fin de enfoque y de descanso del Pomodoro</li><li>Objetivo cerca, Boss debilitado y Cofre disponible</li></ul>
      <span class="muted-s">Se activa solo en este dispositivo. Después eliges qué avisos recibir y puedes apagarlas cuando quieras. A continuación el navegador te va a pedir permiso.</span>
      ${d.err ? `<div class="err">${esc(d.err)}</div>` : ""}
      <div class="modal-f"><button type="button" class="btn ghost" data-dlg-close ${d.busy ? "disabled" : ""}>Ahora no</button><button type="button" class="btn primary" id="nAllow" ${d.busy ? "disabled" : ""}>${d.busy ? "Activando…" : "Permitir"}</button></div></div>`;
  }

  document.addEventListener("click", async (e) => {
    const t = e.target.closest("button"); if (!t) return;
    if (t.id === "nOn") { dlg = { type: "notifConfirm", err: "" }; renderModal(); return; }
    if (t.id === "nAllow") { allow(); return; }
    if (t.id === "nOff") { disableHere(); return; }
    if (t.id === "nTest") {
      S.busy = true; render();
      try { const r = await call("send_test_push", { p_device: state.device }); toast(r === "ok" ? "Prueba enviada: debería llegar en unos segundos." : r === "no_device" ? "Este dispositivo no está registrado. Desactiva y vuelve a activar." : "Ya mandaste una prueba hace un momento."); }
      catch (err) { toast(err === "offline" ? "Sin conexión: la prueba necesita internet." : err === "server" ? "Falta activar las notificaciones en el servidor." : "No se pudo mandar la prueba."); }
      S.busy = false; render(); return;
    }
    const off = t.dataset.ndevOff, del = t.dataset.ndevDel;
    if (off || del) {
      try { await call("set_push_device", { p_device: off || del, p_action: off ? "disable" : "remove" }); toast(off ? "Dispositivo apagado." : "Dispositivo quitado de la lista."); }
      catch (err) { toast(err === "offline" ? "Sin conexión: intenta de nuevo con internet." : "No se pudo cambiar el dispositivo."); }
      if (del === state.device) { S.on = false; Store.setMeta("pushOn", false); }
      loadDevices();
    }
  });
  document.addEventListener("change", (e) => {
    const k = e.target.dataset && e.target.dataset.npref;
    if (k) { savePrefs({ [k]: e.target.checked }).then(render); return; }
    if (e.target.id === "nRem") { const v = e.target.value; savePrefs({ default_reminder: v === "" ? null : +v }); return; }
    if (e.target.id === "nQs" || e.target.id === "nQe") { const v = e.target.value; if (/^\d{2}:\d{2}$/.test(v)) savePrefs({ [e.target.id === "nQs" ? "quiet_start" : "quiet_end"]: v }); }
  });
  if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", (e) => { if (e.data && e.data.type === "resubscribe") check(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { S.devChecked = false; check(); tidy(); } });

  let wt = null;
  return {
    supported, flush, applyRemotePrefs, prefsRow, exportPrefs, parsePrefs, importPrefs, beforeSignOut, focusPhase, panel, dlgView,
    async init() {
      try {
        S.prefs = (await Store.getMeta("nprefs")) || null; S.on = !!(await Store.getMeta("pushOn")); S.endpoint = (await Store.getMeta("pushEndpoint")) || null;
        S.seen = new Set((await Store.getMeta("nSeen")) || []); S.base = !!(await Store.getMeta("nBase"));
      } catch (e) {}
      S.ready = true;
      if (S.prefs && S.prefs.timezone !== tzNow() && linked()) savePrefs({});      // la zona horaria la actualiza la app al abrirse
      check(); tidy();
    },
    /** Después de cada render: número del ícono y avisos nuevos de objetivos, Boss y cofres */
    afterRender() {
      if (!S.ready) return;
      clearTimeout(wt); wt = setTimeout(() => { paintBadge(); watch(false); }, 1200);
    },
    /** Recordatorio por defecto para una planificación nueva (null = sin recordatorio) */
    defaultReminder: () => { const v = prefs().default_reminder; return v === undefined ? 30 : v; },
    /** Hay notificaciones configuradas en la cuenta (para mostrar la campanita en las planificaciones) */
    accountOn: () => !!S.prefs && prefs().enabled,
    reset() { S.prefs = null; S.on = false; S.endpoint = null; S.devices = null; S.seen = new Set(); S.base = false; S.server = null; },
    REM,
  };
})();
function notifyDlg(d) { return Notify.dlgView(d); }
