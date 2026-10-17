/* Life RPG — service worker: guarda la app para que abra sin internet.
   Cambia VERSION en cada publicación para que los teléfonos bajen la versión nueva. */
const VERSION = "life-rpg-v1";
const SHELL = [
  "./", "./index.html", "./styles.css", "./game.js", "./storage.js", "./app.js",
  "./manifest.webmanifest", "./icons/icon.svg", "./icons/icon-192.png", "./icons/icon-512.png",
  "./icons/icon-maskable-512.png", "./icons/apple-touch-icon.png"
];
const FONTS = "life-rpg-fonts";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
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

  // Archivos de la app: responde al instante desde el caché y actualiza en segundo plano
  e.respondWith(caches.open(VERSION).then(async (c) => {
    const key = req.mode === "navigate" ? "./index.html" : req;
    const hit = await c.match(key, { ignoreSearch: true });
    const net = fetch(req).then((res) => { if (res.ok) c.put(key, res.clone()); return res; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    return (await net) || new Response("Sin conexión", { status: 503 });
  }));
});
