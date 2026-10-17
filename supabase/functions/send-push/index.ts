// Life RPG — Edge Function "send-push".
// La despierta pg_cron (a través de pg_net) cuando hay avisos para entregar. Toma un lote con push_claim,
// cifra cada aviso para el navegador (Web Push, aes128gcm, RFC 8291), lo firma con la clave VAPID (RFC 8292)
// y lo entrega al servicio de push del navegador (Google, Apple, Mozilla). Después informa con push_report.
//
// Este archivo NO tiene ningún secreto. Todo llega como secreto de la Edge Function en Supabase:
//   VAPID_PUBLIC_KEY   clave pública VAPID (la misma que va en config.js)
//   VAPID_PRIVATE_KEY  clave privada VAPID: solo existe aquí, nunca en GitHub, config.js ni el navegador
//   VAPID_SUBJECT      un contacto, por ejemplo mailto:tu@email.com
//   PUSH_CRON_SECRET   el mismo valor guardado en el Vault como push_cron_secret
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los pone Supabase solo; la service role nunca sale del servidor.
// Sin dependencias externas: usa la Web Crypto API que ya trae Deno.

type Item = { id: string; endpoint: string; p256dh: string; auth: string; ttl: number; urgency: string; payload: Record<string, unknown> };
type Result = { id: string; result: "sent" | "retry" | "gone" | "failed"; status: number; error?: string };
type Env = { SUPABASE_URL: string; SERVICE_KEY: string; VAPID_PUBLIC_KEY: string; VAPID_PRIVATE_KEY: string; VAPID_SUBJECT: string; PUSH_CRON_SECRET: string };
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const te = new TextEncoder();

export function b64u(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64u(s: string): Uint8Array {
  const t = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(t), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

/** Cifra el aviso para un navegador (RFC 8291, aes128gcm). salt y asKeys solo para pruebas. */
export async function encrypt(plain: Uint8Array, p256dh: string, authSecret: string, salt?: Uint8Array, asKeys?: CryptoKeyPair): Promise<Uint8Array> {
  const uaPublic = unb64u(p256dh), auth = unb64u(authSecret);
  if (uaPublic.length !== 65 || auth.length !== 16) throw new Error("claves del navegador inválidas");
  const as = asKeys || (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));
  const prkKey = await hmac(auth, ecdh);
  const ikm = await hmac(prkKey, concat(te.encode("WebPush: info\0"), uaPublic, asPublic, new Uint8Array([1])));
  const s = salt || crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(s, ikm);
  const cek = (await hmac(prk, concat(te.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(te.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(plain, new Uint8Array([2]))));
  const header = new Uint8Array(21); header.set(s, 0); new DataView(header.buffer).setUint32(16, 4096); header[20] = 65;
  return concat(header, asPublic, ct);
}

/** Firma VAPID (JWT ES256) para el servicio de push de ese endpoint */
const keyCache = new Map<string, CryptoKey>();
export async function vapidAuth(endpoint: string, env: Env, now = Date.now()): Promise<string> {
  const aud = new URL(endpoint).origin;
  let key = keyCache.get(env.VAPID_PRIVATE_KEY);
  if (!key) {
    const pub = unb64u(env.VAPID_PUBLIC_KEY);
    if (pub.length !== 65 || pub[0] !== 4) throw new Error("VAPID_PUBLIC_KEY inválida");
    key = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), d: env.VAPID_PRIVATE_KEY, ext: false },
      { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    keyCache.set(env.VAPID_PRIVATE_KEY, key);
  }
  const head = b64u(te.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64u(te.encode(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, te.encode(`${head}.${body}`)));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}

/** Entrega un aviso. 201 = enviado; 404/410 = suscripción muerta; 429/5xx = reintentar; el resto = falló. */
export async function sendOne(it: Item, env: Env, fetchImpl: Fetch): Promise<Result> {
  try {
    if (!/^https:\/\//.test(it.endpoint)) return { id: it.id, result: "failed", status: 0, error: "endpoint inválido" };
    const body = await encrypt(te.encode(JSON.stringify(it.payload)), it.p256dh, it.auth);
    const res = await fetchImpl(it.endpoint, {
      method: "POST",
      headers: {
        "Authorization": await vapidAuth(it.endpoint, env),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        "TTL": String(Math.max(0, Math.min(Math.floor(it.ttl || 0), 2419200))),
        "Urgency": it.urgency === "high" ? "high" : "normal",
      },
      body,
    });
    const st = res.status;
    let err = "";
    if (st >= 300) { try { err = (await res.text()).slice(0, 200); } catch (_) { /* sin texto */ } }
    if (st >= 200 && st < 300) return { id: it.id, result: "sent", status: st };
    if (st === 404 || st === 410) return { id: it.id, result: "gone", status: st, error: err || "suscripción vencida" };
    if (st === 429 || st >= 500) return { id: it.id, result: "retry", status: st, error: err };
    return { id: it.id, result: "failed", status: st, error: err };
  } catch (e) {
    return { id: it.id, result: "retry", status: 0, error: String((e as Error)?.message || e).slice(0, 200) };
  }
}

async function rpc(env: Env, fetchImpl: Fetch, fn: string, args: unknown): Promise<unknown> {
  const res = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { "apikey": env.SERVICE_KEY, "Authorization": `Bearer ${env.SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`${fn}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

/** Atiende una llamada: solo con el secreto propio. Hasta 4 lotes de 50 por llamada. */
export async function handle(req: Request, env: Env, fetchImpl: Fetch = fetch): Promise<Response> {
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!sameSecret(req.headers.get("x-push-secret") || "", env.PUSH_CRON_SECRET || "")) return json({ error: "unauthorized" }, 401);
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT || !env.SERVICE_KEY) return json({ error: "faltan secretos de la función" }, 500);
  const total = { sent: 0, retry: 0, gone: 0, failed: 0 };
  for (let round = 0; round < 4; round++) {
    const items = (await rpc(env, fetchImpl, "push_claim", { p_limit: 50 })) as Item[];
    if (!Array.isArray(items) || !items.length) break;
    const results: Result[] = [];
    for (let i = 0; i < items.length; i += 10) {
      results.push(...(await Promise.all(items.slice(i, i + 10).map((it) => sendOne(it, env, fetchImpl)))));
    }
    for (const r of results) total[r.result]++;
    await rpc(env, fetchImpl, "push_report", { p_results: results });
    if (items.length < 50) break;
  }
  return json(total);
}

// En Supabase (Deno): atiende las llamadas. En las pruebas locales (Node) no hace nada.
const D = (globalThis as any).Deno;
if (D && D.serve) {
  const g = (k: string): string => D.env.get(k) || "";
  D.serve((req: Request) => handle(req, {
    SUPABASE_URL: g("SUPABASE_URL"), SERVICE_KEY: g("SUPABASE_SERVICE_ROLE_KEY"),
    VAPID_PUBLIC_KEY: g("VAPID_PUBLIC_KEY"), VAPID_PRIVATE_KEY: g("VAPID_PRIVATE_KEY"), VAPID_SUBJECT: g("VAPID_SUBJECT"), PUSH_CRON_SECRET: g("PUSH_CRON_SECRET"),
  }).catch((e: Error) => new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500, headers: { "Content-Type": "application/json" } })));
}
