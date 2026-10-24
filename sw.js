/* Life RPG — service worker: guarda la app para que abra sin internet y muestra las notificaciones push.
   Cambia VERSION en cada publicación para que los teléfonos bajen la versión nueva (las pruebas lo comprueban).
   Cada VERSION se guarda completa en su propio caché: la app nunca abre con archivos de dos versiones mezclados. */
const VERSION = "life-rpg-v8";
const SHELL = [
  "./", "./index.html", "./styles.css", "./game.js", "./economy.js", "./storage.js", "./tesoro.js", "./boss.js", "./personaje.js", "./focus.js", "./planner.js", "./notify.js", "./nav.js", "./app.js",
  "./config.js", "./sync.js", "./vendor/supabase-2.117.2.js", "./manifest.webmanifest", "./icons/icon.svg", "./icons/icon-192.png", "./icons/icon-512.png",
  "./icons/icon-maskable-512.png", "./icons/apple-touch-icon.png", "./icons/badge-96.png"
];
const FONTS = "life-rpg-fonts";

// Descarga la versión completa, sin usar el caché HTTP del navegador (si falta un archivo, no se instala nada).
// No se activa sola: espera a que la persona toque "Actualizar" o a que se cierren todas las ventanas de la app.
// La primera vez que se instala no hay nada que esperar y se activa enseguida.
// Desde la v7 o antes (que no sabían mostrar el aviso) se pasa sola, como se actualizaba hasta ahora.
const LEGACY = /^life-rpg-v[1-7]$/;
self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })));
    if ((await caches.keys()).some((k) => LEGACY.test(k))) await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== FONTS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Tipografías de Google: se guardan la primera vez y luego se usan sin conexión
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.open(FONTS).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      try { const res = await fetch(req); if (res.ok || res.type === "opaque") c.put(req, res.clone()); return res; }
      catch (_) { return new Response("", { status: 503 }); }
    }));
    return;
  }
  if (url.origin !== location.origin) return;

  // Archivos de la app: siempre los de la versión instalada. Lo que no está en el caché se pide a la red
  // pero no se guarda, así el caché de una versión nunca cambia.
  e.respondWith(caches.open(VERSION).then(async (c) => {
    const key = req.mode === "navigate" ? "./index.html" : req;
    const hit = await c.match(key, { ignoreSearch: true });
    if (hit) return hit;
    try { return await fetch(req); } catch (_) { return new Response("Sin conexión", { status: 503 }); }
  }));
});

/* ============ Notificaciones push (versión 6) ============
   El servidor manda el aviso ya cifrado; aquí solo se muestra. Este archivo no tiene ninguna clave. */
const ICON = "./icons/icon-192.png", BADGE = "./icons/badge-96.png";
const safeUrl = (u) => (typeof u === "string" && u.startsWith("#") ? u : "#dashboard");

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: "Life RPG", body: e.data ? e.data.text() : "" }; }
  const actions = Array.isArray(d.actions) ? d.actions.filter((a) => a && a.action && a.title).slice(0, 2) : [];
  const show = self.registration.showNotification(String(d.title || "Life RPG").slice(0, 120), {
    body: String(d.body || "").slice(0, 300),
    tag: d.tag || d.id || undefined, renotify: !!d.tag, icon: ICON, badge: BADGE, actions,
    timestamp: d.ts || Date.now(), requireInteraction: d.kind === "focus",
    data: { url: safeUrl(d.url), kind: d.kind || "", id: d.id || "" },
  });
  const badge = Number.isInteger(d.badge) && navigator.setAppBadge ? (d.badge > 0 ? navigator.setAppBadge(d.badge) : navigator.clearAppBadge()).catch(() => {}) : null;
  e.waitUntil(Promise.all([show, badge]));
});

self.addEventListener("notificationclick", (e) => {
  const n = e.notification, data = n.data || {};
  n.close();
  let url = safeUrl(data.url);
  if (e.action === "focus" && /plan=/.test(url)) url += "&focus=1";
  const target = new URL("./" + url, self.registration.scope).href;
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const win = list.find((c) => c.url.startsWith(self.registration.scope));
    if (win) { await win.focus().catch(() => {}); win.postMessage({ type: "open", url }); return; }
    await self.clients.openWindow(target);
  })());
});

// El navegador renovó la suscripción: se vuelve a suscribir con la misma clave pública y la app la registra al abrirse
self.addEventListener("pushsubscriptionchange", (e) => {
  e.waitUntil((async () => {
    try {
      const key = e.oldSubscription && e.oldSubscription.options && e.oldSubscription.options.applicationServerKey;
      if (key) await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    } catch (_) { /* se resuelve al abrir la app */ }
    for (const c of await self.clients.matchAll({ type: "window", includeUncontrolled: true })) c.postMessage({ type: "resubscribe" });
  })());
});

// La app pide cerrar un aviso que ya no corresponde (por ejemplo, una misión que se completó)
// También: la app pide activar la versión nueva cuando la persona toca "Actualizar"
self.addEventListener("message", (e) => {
  const d = e.data || {};
  if (d.type === "skip-waiting") { self.skipWaiting(); return; }
  if (d.type === "close" && typeof d.tag === "string") {
    e.waitUntil(self.registration.getNotifications({ tag: d.tag }).then((l) => l.forEach((n) => n.close())));
  }
});
