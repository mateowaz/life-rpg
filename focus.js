/* Life RPG — Temporizador de enfoque (sesión libre y Pomodoro).
   El tiempo NUNCA se cuenta restando segundos: cada sesión guarda tramos [inicio, fin] y, si está corriendo,
   la hora en que empezó el tramo actual. El tiempo se reconstruye con la hora actual, así sobrevive a la
   pantalla bloqueada, a la PWA cerrada o en segundo plano. Funciona sin internet.
   Una sesión NO da XP ni Oro: solo mide. El progreso llega al guardar una actividad real
   (sesión libre → actividad con el id de la sesión; sesión de una planificación → la actividad de esa planificación). */

/* ============ Reglas ============ */
const POMO_DEF = { focus: 25, short: 5, long: 15, every: 4 };
const POMO_LIM = { focus: [5, 120], short: [1, 30], long: [5, 60], every: [2, 8] };
const LONG_RUN = 4 * 3600;                         // más de 4 horas corriendo: se pregunta al volver
const PHASE = { focus: "Enfoque", short: "Descanso", long: "Descanso largo", ready: "Descanso terminado" };
const fnow = () => Date.parse(Sync.now());           // hora corregida con la del servidor
const tms = (v) => Date.parse(v);
const fEnded = (f) => f.status === "finished" || f.status === "discarded";
const fActive = (f) => !!f && !f.deleted_at && (f.status === "running" || f.status === "paused");
const liveFocus = () => [...state.focus.values()].filter((f) => !f.deleted_at);
const mine = (f) => f.device_id === state.device;
/** La sesión activa de ESTE dispositivo (solo puede haber una) */
const myActive = () => liveFocus().filter((f) => fActive(f) && mine(f)).sort((a, b) => b.started_at.localeCompare(a.started_at))[0] || null;
const fActiveFor = (planId) => liveFocus().find((f) => fActive(f) && f.planned_activity_id === planId) || null;

/** Tramos válidos, igual que en el servidor (private.clean_segments): inicio < fin, dentro de [lo, hi],
    ordenados y sin superposición (lo que se repite se une, así nunca se infla el tiempo). */
function cleanSegs(list, lo = -Infinity, hi = Infinity) {
  const s = (Array.isArray(list) ? list : []).filter((x) => Array.isArray(x) && x.length === 2)
    .map(([a, b]) => [Math.max(tms(a), lo), Math.min(tms(b), hi)]).filter(([a, b]) => !isNaN(a) && !isNaN(b) && a < b).sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [a, b] of s) { const l = out[out.length - 1]; if (l && a <= l[1]) l[1] = Math.max(l[1], b); else out.push([a, b]); }
  return out.map(([a, b]) => [new Date(a).toISOString(), new Date(b).toISOString()]);
}
const segSecs = (segs) => segs.reduce((t, [a, b]) => t + Math.max(0, (tms(b) - tms(a)) / 1000), 0);
/** Segundos cubiertos por varios tramos, contando una sola vez lo que se superpone */
function unionSecs(segs) {
  const s = segs.map(([a, b]) => [tms(a), tms(b)]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let tot = 0, cs = null, ce = null;
  for (const [a, b] of s) { if (cs === null) { cs = a; ce = b; } else if (a <= ce) ce = Math.max(ce, b); else { tot += ce - cs; cs = a; ce = b; } }
  if (cs !== null) tot += ce - cs;
  return tot / 1000;
}
/** Tramos de una sesión, incluido el que está corriendo (hasta ahora) */
function liveSegs(f, now = fnow()) {
  const s = f.segments.slice(), st = openStart(f);
  if (st !== null && f.status === "running") {
    const end = f.pomodoro && f.pomodoro.ends_at ? Math.min(now, tms(f.pomodoro.ends_at)) : now;   // en Pomodoro, solo hasta el final del enfoque
    if (end > st) s.push([new Date(st).toISOString(), new Date(end).toISOString()]);
  }
  return s;
}
/** Inicio del tramo abierto, o null. Como en el servidor: en pausa o fuera de la fase de enfoque del Pomodoro no hay tramo abierto. */
function openStart(f) {
  if (!f.segment_started_at || f.status === "paused" || (f.mode === "pomodoro" && (!f.pomodoro || f.pomodoro.phase !== "focus"))) return null;
  const t = tms(f.segment_started_at);
  return isNaN(t) || t < tms(f.started_at) ? null : t;
}
const fSecs = (f, now) => segSecs(liveSegs(f, now));
function pomoClean(p) {
  const o = p && typeof p === "object" ? p : {}, out = {};
  for (const k in POMO_LIM) { const v = Math.round(+o[k]); out[k] = v >= POMO_LIM[k][0] && v <= POMO_LIM[k][1] ? v : POMO_DEF[k]; }
  out.done = Math.max(0, Math.round(+o.done || 0)); out.phase = PHASE[o.phase] ? o.phase : "focus";
  out.ends_at = o.ends_at && !isNaN(tms(o.ends_at)) ? new Date(o.ends_at).toISOString() : null; out.left = o.left != null ? Math.max(0, Math.round(+o.left) || 0) : null;
  return out;
}
/** Minutos que se guardan: redondeo al minuto, mínimo 1 si llegó a 30 segundos */
const toMin = (secs) => (secs < 30 ? 0 : Math.max(1, Math.round(secs / 60)));
const clock = (secs) => { secs = Math.max(0, Math.floor(secs)); const h = Math.floor(secs / 3600), m = Math.floor(secs / 60) % 60, s = secs % 60; return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`; };
const dur = (secs) => { const m = Math.floor(secs / 60), s = Math.floor(secs % 60); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min ${s} s`; };

/** Minutos enfocados para una planificación: la unión de los tramos de todas sus sesiones (no descartadas) */
function planFocusSecs(planId, now) {
  return unionSecs(liveFocus().filter((f) => f.planned_activity_id === planId && f.status !== "discarded").flatMap((f) => liveSegs(f, now)));
}
/** Para qué se usó una sesión. Una sesión se usa como mucho una vez:
    libre → su propia actividad (mismo id); de una planificación → la actividad de esa planificación. */
function fUse(f) {
  if (fActive(f)) return f.status === "running" ? "running" : "paused";
  if (f.status === "discarded") return "discarded";
  if (f.planned_activity_id) {
    const a = state.rows.get(f.planned_activity_id);
    if (a && !a.deleted_at) return tms(f.ended_at || f.updated_at) <= tms(a.created_at) + 60000 ? "used" : "unused";
    return state.plans.get(f.planned_activity_id) && !state.plans.get(f.planned_activity_id).deleted_at ? "inplan" : "unused";
  }
  const a = state.rows.get(f.id);
  return a && !a.deleted_at ? "saved" : "unsaved";
}
const USE_LABEL = { running: "En curso", paused: "Pausada", discarded: "Descartada", used: "Usada en su planificación", unused: "No usada", inplan: "Suma a su planificación", saved: "Guardada como actividad", unsaved: "Sin guardar" };
/** Tramos ya convertidos en actividades (para no contar dos veces el mismo rato) */
function usedSegs(except) {
  return liveFocus().filter((f) => f.id !== except && ["used", "saved"].includes(fUse(f))).flatMap((f) => f.segments);
}

/* ============ Cambios de estado (todos con horas, nunca con contadores) ============ */
/** Aplica los cambios de fase del Pomodoro que pasaron mientras la app no miraba. Puro: devuelve la sesión nueva. */
function pomoAdvance(f, now = fnow()) {
  if (f.mode !== "pomodoro" || f.status !== "running") return { f, ev: [] };
  let x = { ...f, segments: f.segments.slice(), pomodoro: { ...f.pomodoro } }; const ev = [], at = [];   // at: cuándo terminó cada fase (para los avisos)
  for (let i = 0; i < 50; i++) {
    const P = x.pomodoro; if (!P.ends_at || now < tms(P.ends_at)) break;
    if (P.phase === "focus") {
      if (x.segment_started_at) x.segments.push([x.segment_started_at, P.ends_at]);       // el tramo termina justo al final del enfoque
      P.done++; const next = P.done % P.every === 0 ? "long" : "short";
      at.push(tms(P.ends_at)); x.segment_started_at = null; P.phase = next; P.ends_at = new Date(tms(P.ends_at) + P[next] * 60000).toISOString(); ev.push("focusEnd");
    } else {
      at.push(tms(P.ends_at)); P.phase = "ready"; P.ends_at = null; P.left = null; x.status = "paused"; ev.push("breakEnd");   // el próximo enfoque espera tu toque
    }
  }
  return { f: ev.length ? x : f, ev, at };
}
const stamp = (f, now) => new Date(Math.max(now, f ? tms(f.updated_at) + 1 : 0)).toISOString();
function focusNew({ plan, title, cat, mode, pomo }) {
  const now = fnow(), at = new Date(now).toISOString();
  const P = mode === "pomodoro" ? { ...pomoClean(pomo), done: 0, phase: "focus", left: null } : null;
  if (P) P.ends_at = new Date(now + P.focus * 60000).toISOString();
  return { id: Store.newId(), planned_activity_id: plan ? plan.id : null, device_id: state.device, title: (plan ? plan.title : title).slice(0, 80), category: plan ? plan.category : cat,
    mode, status: "running", started_at: at, segment_started_at: at, segments: [], focus_seconds: 0, pomodoro: P, ended_at: null, created_at: at, updated_at: at, deleted_at: null };
}
function fPause(f0) {
  const now = fnow(), f = pomoAdvance(f0, now).f; if (f.status !== "running") return f;
  const x = { ...f, segments: f.segments.slice(), status: "paused", updated_at: stamp(f0, now) };
  const st = openStart(f);
  if (st !== null && now > st) x.segments.push([new Date(st).toISOString(), new Date(now).toISOString()]);
  x.segment_started_at = null;
  if (x.pomodoro) x.pomodoro = { ...x.pomodoro, left: Math.max(0, Math.round((tms(x.pomodoro.ends_at) - now) / 1000)), ends_at: null };
  return x;
}
function fResume(f) {
  const now = fnow(), at = new Date(now).toISOString(); if (f.status !== "paused") return f;
  const x = { ...f, status: "running", updated_at: stamp(f, now) };
  if (x.pomodoro) {
    const P = { ...x.pomodoro };
    if (P.phase === "ready") { P.phase = "focus"; P.left = P.focus * 60; }
    P.ends_at = new Date(now + (P.left != null ? P.left : P[P.phase] * 60) * 1000).toISOString(); P.left = null;
    if (P.phase === "focus") x.segment_started_at = at;
    x.pomodoro = P;
  } else x.segment_started_at = at;
  return x;
}
function fSkipBreak(f0) {
  const now = fnow(), f = pomoAdvance(f0, now).f; if (!f.pomodoro || f.pomodoro.phase === "focus") return f;
  return fResume({ ...f, status: "paused", pomodoro: { ...f.pomodoro, phase: "ready", ends_at: null, left: null } });
}
/** Termina la sesión: cierra el tramo abierto. endAt permite recortar una sesión olvidada. */
function fFinish(f0, status = "finished", endAt) {
  const now = fnow(), f = pomoAdvance(f0, now).f, end = Math.min(now, endAt || now);
  const x = { ...f, segments: f.segments.slice(), status, ended_at: new Date(end).toISOString(), updated_at: stamp(f0, now) };
  const st = openStart(f);
  if (st !== null && end > st) x.segments.push([new Date(st).toISOString(), x.ended_at]);
  x.segment_started_at = null;
  x.segments = cleanSegs(x.segments, tms(x.started_at), end); x.focus_seconds = Math.round(segSecs(x.segments));
  if (x.pomodoro) x.pomodoro = { ...x.pomodoro, ends_at: null };
  return x;
}
function putFocus(rows, ms = 600) {
  for (const r of rows) state.focus.set(r.id, r);
  Store.put("focus", rows).then(() => Sync.changed(ms)).catch(() => toast("No se pudo guardar en este dispositivo."));
}

/* ============ Iniciar ============ */
function openFocusStart(planId) {
  const p = planId ? state.plans.get(planId) : null;
  const a = myActive();
  if (a) { openTimer(a.id); if (!p || a.planned_activity_id !== p.id) toast("Ya hay una sesión activa en este dispositivo."); return; }
  dlg = { type: "focusStart", plan: p ? p.id : null, f: { title: p ? p.title : "", cat: p ? p.category : "curso", mode: "free", pomo: { ...POMO_DEF, ...(state.pomo || {}) } }, err: "" };
  renderModal(); if (!p) setTimeout(() => document.getElementById("fsTitle")?.focus(), 30);
}
function focusStartFor(planId) {
  const run = fActiveFor(planId);
  if (run) { openTimer(run.id); return; }
  openFocusStart(planId);
}
function readFocusStart() {
  const g = (i) => document.getElementById(i), f = dlg && dlg.f; if (!f) return;
  if (g("fsTitle")) f.title = g("fsTitle").value;
  for (const k in POMO_LIM) if (g("fsP" + k)) f.pomo[k] = g("fsP" + k).value;
}
function focusStartForm() {
  const f = dlg.f, p = dlg.plan ? state.plans.get(dlg.plan) : null;
  return `<form class="modal" id="focusStartForm" role="dialog" aria-modal="true" aria-labelledby="fsH">
  <div><div class="eyebrow">Sesión de enfoque · solo mide tiempo</div><h2 id="fsH">${p ? esc(p.title) : "Nueva sesión de enfoque"}</h2></div>
  ${p ? `<span class="muted-s">${CAT[p.category].name} · planificado ${p.planned_minutes} min${planFocusSecs(p.id) >= 60 ? ` · ya enfocaste ${Math.floor(planFocusSecs(p.id) / 60)} min` : ""}</span>`
    : `<div class="field"><label>Categoría</label><div class="seg">${CATS.map((c) => `<button type="button" class="c-${c.id}" data-fscat="${c.id}" aria-pressed="${f.cat === c.id}">${ico(c.id)}${c.name}</button>`).join("")}</div></div>
  <div class="field"><label for="fsTitle">¿En qué te vas a enfocar?</label><input class="inp" id="fsTitle" maxlength="80" placeholder="Ej.: SQL, ejercicios de joins" value="${esc(f.title)}"></div>`}
  <div class="field"><label>Modo</label><div class="seg two">${[["free", "Sesión libre", "Cuenta el tiempo real"], ["pomodoro", "Pomodoro", "Enfoque y descansos"]].map(([m, l, h]) => `<button type="button" data-fsmode="${m}" aria-pressed="${f.mode === m}">${l}<small>${h}</small></button>`).join("")}</div></div>
  ${f.mode === "pomodoro" ? `<div class="pomo-cfg">${[["focus", "Enfoque (min)"], ["short", "Descanso corto"], ["long", "Descanso largo"], ["every", "Largo cada"]].map(([k, l]) => `<div class="field"><label for="fsP${k}">${l}</label><input class="inp num" id="fsP${k}" type="number" min="${POMO_LIM[k][0]}" max="${POMO_LIM[k][1]}" value="${esc(f.pomo[k])}"></div>`).join("")}</div>
  <small class="muted-s">Los descansos no suman minutos. Al terminar un descanso, el siguiente enfoque espera a que lo inicies.</small>` : ""}
  ${dlg.err ? `<div class="err">${dlg.err}</div>` : ""}
  <div class="modal-f"><button type="button" class="btn ghost" data-dlg-close>Cancelar</button><button type="submit" class="btn primary">${ico("play")} Iniciar enfoque</button></div></form>`;
}
function submitFocusStart() {
  readFocusStart();
  const f = dlg.f, p = dlg.plan ? state.plans.get(dlg.plan) : null;
  if (!p && !f.title.trim()) { dlg.err = "Escribe en qué te vas a enfocar."; renderModal(); return; }
  if (f.mode === "pomodoro") {
    for (const k in POMO_LIM) { const v = Math.round(+f.pomo[k]); if (!(v >= POMO_LIM[k][0] && v <= POMO_LIM[k][1])) { dlg.err = `Revisa los valores del Pomodoro (${{ focus: "enfoque", short: "descanso corto", long: "descanso largo", every: "largo cada" }[k]}: ${POMO_LIM[k][0]} a ${POMO_LIM[k][1]}).`; renderModal(); return; } }
    state.pomo = pomoClean(f.pomo); Store.setMeta("pomo", { focus: state.pomo.focus, short: state.pomo.short, long: state.pomo.long, every: state.pomo.every }).catch(() => {});
  }
  const opts = { plan: p, title: f.title.trim(), cat: f.cat, mode: f.mode, pomo: f.pomo };
  // Otro dispositivo ya tiene una sesión activa: con conexión, se avisa antes de empezar otra
  const other = liveFocus().find((x) => fActive(x) && !mine(x));
  if (other && Sync.info.signedIn && navigator.onLine) { dlg = { type: "focusOther", other: other.id, opts }; renderModal(); return; }
  focusGo(opts);
}
function focusGo(opts) {
  if (myActive()) { openTimer(myActive().id); return; }
  unlockSound();
  const row = focusNew(opts); putFocus([row], 300);
  dlg = { type: "timer", id: row.id }; renderModal(); render(); wake();
}

/* ============ Acciones sobre una sesión ============ */
function fAct(id, fn) {
  const f = state.focus.get(id); if (!f || f.deleted_at) return null;
  const x = fn(f); if (x !== f) putFocus([x], 300);
  return x;
}
function focusFinish(id, endAt) {
  const x = fAct(id, (f) => (fActive(f) ? fFinish(f, "finished", endAt) : f)); if (!x) return;
  dlg = { type: "focusEnd", id }; renderModal(); render(); unwake();
}
/** Al completar una planificación, sus sesiones en curso se finalizan primero */
function focusFinishPlan(planId) {
  const rows = liveFocus().filter((f) => fActive(f) && f.planned_activity_id === planId).map((f) => fFinish(f));
  if (rows.length) { putFocus(rows, 300); unwake(); }
}
function focusDiscard(id) {
  const f = state.focus.get(id); if (!f) return;
  if (["used", "saved"].includes(fUse(f))) { toast("Esta sesión ya forma parte de una actividad."); return; }
  putFocus([fActive(f) ? fFinish(f, "discarded") : { ...f, status: "discarded", updated_at: stamp(f, fnow()) }], 300);
  if (dlg && (dlg.type === "focusEnd" || dlg.type === "timer")) { dlg = null; renderModal(); }
  unwake(); toast("Sesión descartada. No suma minutos."); render();
}
/** Sesión libre → actividad con el MISMO id que la sesión (guardarla dos veces escribe la misma fila) */
function focusSave(id) {
  const f = state.focus.get(id); if (!f || f.planned_activity_id) return;
  if (fUse(f) === "saved") { toast("Esta sesión ya está guardada como actividad."); return; }
  const own = unionSecs(f.segments), all = unionSecs([...f.segments, ...usedSegs(f.id)]) - unionSecs(usedSegs(f.id));
  const min = Math.min(240, toMin(all)); if (!min) { toast("La sesión es demasiado corta para guardarla."); return; }
  dlg = null; renderModal();
  form = { date: keyOf(new Date(tms(f.ended_at || f.started_at))) <= todayKey() ? keyOf(new Date(tms(f.ended_at || f.started_at))) : todayKey(), cat: f.category, title: f.title, min, diff: 2, note: "", err: "",
    useId: f.id, fromFocus: { secs: own, overlap: Math.round((own - all) / 60) } };
  renderModal();
}

/* ============ Pantalla del temporizador ============ */
function openTimer(id) { dlg = { type: "timer", id }; renderModal(); wake(); }
function timerView() {
  const f = state.focus.get(dlg.id); if (!f || f.deleted_at) { dlg = null; return ""; }
  if (fEnded(f)) { dlg = { type: "focusEnd", id: f.id }; return focusEndView(); }
  const now = fnow(), g = pomoAdvance(f, now).f, P = g.pomodoro, p = g.planned_activity_id ? state.plans.get(g.planned_activity_id) : null;
  const run = g.status === "running", brk = P && P.phase !== "focus" && P.phase !== "ready", ready = P && P.phase === "ready";
  const longRun = !P && run && g.segment_started_at && (now - tms(g.segment_started_at)) / 1000 > LONG_RUN && !(state.longAck || new Set()).has(g.id);
  let btns;
  if (ready) btns = `<button class="btn primary big" data-fgo="${g.id}">${ico("play")} Siguiente enfoque</button><button class="btn big" data-ffin="${g.id}">Finalizar</button>`;
  else if (brk && run) btns = `<button class="btn big" data-fskip="${g.id}">Saltar descanso</button><button class="btn big" data-ffin="${g.id}">Finalizar</button>`;
  else if (run) btns = `<button class="btn primary big" data-fpause="${g.id}">${ico("pause")} Pausar</button><button class="btn big" data-ffin="${g.id}">Finalizar</button>`;
  else btns = `<button class="btn primary big" data-fgo="${g.id}">${ico("play")} Continuar</button><button class="btn big" data-ffin="${g.id}">Finalizar</button>`;
  return `<div class="modal timer c-${g.category} ${run ? "is-run" : "is-pause"} ${brk ? "is-break" : ""}" role="dialog" aria-modal="true" aria-labelledby="tmH">
    <div class="tm-top"><button type="button" class="btn sm ghost" data-dlg-close aria-label="Minimizar">${ico("down")} Minimizar</button>${mine(g) ? "" : `<span class="pstate">Otro dispositivo</span>`}</div>
    <h2 id="tmH" class="tm-title disp">${esc(g.title)}</h2>
    <div class="eyebrow">${P ? `${PHASE[P.phase]} · ronda ${P.phase === "focus" ? (P.done % P.every) + 1 : ((P.done - 1) % P.every + P.every) % P.every + 1} de ${P.every}` : "Sesión de enfoque"}</div>
    <div class="tm-ring">${ringSVG()}<div class="tm-clock num" data-fclock="${g.id}" aria-live="off">${timerText(g, now)}</div></div>
    <div class="tm-sub"><span class="cat-tag c-${g.category}">${ico(g.category)}${CAT[g.category].name}</span><span>${g.mode === "pomodoro" ? "Pomodoro" : "Libre"}</span><span>${run ? (brk ? "Descansando" : "Corriendo") : ready ? "Esperando" : "Pausado"}</span></div>
    ${P ? `<div class="muted-s num" data-ffocus="${g.id}">Enfocado: ${dur(fSecs(g, now))}</div>` : ""}
    ${p ? `<div class="muted-s num" data-fplan="${p.id}">Planificado: ${Math.floor(planFocusSecs(p.id, now) / 60)} / ${p.planned_minutes} min</div>` : ""}
    ${longRun ? `<div class="demo tm-long"><span>Esta sesión lleva ${dur((now - tms(g.segment_started_at)) / 1000)} corriendo. ¿Seguiste enfocado todo este tiempo?</span>
      <div class="row2"><div class="field"><label for="tmTrim">Minutos reales de enfoque</label><input class="inp num" id="tmTrim" type="number" min="1" value="${Math.round(fSecs(g, now) / 60)}"></div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn sm" data-flongok="${g.id}">Sí, sigo</button><button type="button" class="btn sm primary" data-ftrim="${g.id}">Recortar y finalizar</button></div></div>` : ""}
    <div class="tm-btns">${btns}</div>
    ${"wakeLock" in navigator ? `<label class="tm-wake"><input type="checkbox" id="tmWake" ${state.wakeOn ? "checked" : ""}> Mantener la pantalla encendida</label>` : ""}
    <small class="muted-s">El tiempo se guarda aunque cierres o bloquees la app. No da XP hasta guardarlo como actividad.</small></div>`;
}
function timerText(f, now) {
  const P = f.pomodoro;
  if (P && P.phase !== "ready") return clock(f.status === "running" && P.ends_at ? (tms(P.ends_at) - now) / 1000 : P.left != null ? P.left : P[P.phase] * 60);
  if (P) return clock(0);
  return clock(fSecs(f, now));
}
function ringSVG() {
  const R = 118, C = 2 * Math.PI * R;
  return `<svg class="tm-svg" viewBox="0 0 260 260" aria-hidden="true"><circle cx="130" cy="130" r="${R}" fill="none" stroke="var(--line)" stroke-width="5"/>
    <circle class="tm-arc" cx="130" cy="130" r="${R}" fill="none" stroke="var(--c)" stroke-width="5" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C}" transform="rotate(-90 130 130)" data-c="${C}"/></svg>`;
}
/** Progreso del anillo: fase del Pomodoro, planificación, o el minuto en curso */
function ringPct(f, now) {
  const P = f.pomodoro;
  if (P) { if (P.phase === "ready") return 1; const tot = P[P.phase] * 60, left = f.status === "running" && P.ends_at ? (tms(P.ends_at) - now) / 1000 : P.left != null ? P.left : tot; return Math.min(1, Math.max(0, 1 - left / tot)); }
  const p = f.planned_activity_id && state.plans.get(f.planned_activity_id);
  if (p) return Math.min(1, planFocusSecs(p.id, now) / (p.planned_minutes * 60));
  return (fSecs(f, now) % 3600) / 3600;
}
function focusEndView() {
  const f = state.focus.get(dlg.id); if (!f || f.deleted_at) { dlg = null; return ""; }
  const secs = segSecs(f.segments), m = toMin(secs), p = f.planned_activity_id ? state.plans.get(f.planned_activity_id) : null, use = fUse(f);
  const pm = p ? Math.round(planFocusSecs(p.id) / 60) : 0, done = p && planAct(p);
  let btns = "";
  if (f.status === "discarded") btns = `<button type="button" class="btn" data-dlg-close>Cerrar</button>`;
  else if (p && !p.deleted_at && !done) btns = `<button type="button" class="btn primary" data-fcomplete="${p.id}">Completar planificación con ${Math.min(pm, 240) || m} min</button><button type="button" class="btn" data-dlg-close>Seguir después</button><button type="button" class="btn ghost danger" data-fdiscard="${f.id}">Descartar sesión</button>`;
  else if (!f.planned_activity_id && use === "unsaved") btns = m ? `<button type="button" class="btn primary" data-fsave="${f.id}">Guardar actividad</button><button type="button" class="btn ghost danger" data-fdiscard="${f.id}">Descartar</button>` : `<button type="button" class="btn" data-dlg-close>Cerrar</button><button type="button" class="btn ghost danger" data-fdiscard="${f.id}">Descartar</button>`;
  else btns = `<button type="button" class="btn" data-dlg-close>Cerrar</button>`;
  return `<div class="modal center unlock focus-end" role="dialog" aria-modal="true" aria-labelledby="feH"><div class="eyebrow gold-eye">${f.status === "discarded" ? "Sesión descartada" : "Sesión completada"}</div>
    <h2 id="feH" class="disp">${esc(f.title)}</h2>
    ${f.status === "discarded" ? "" : `<div class="big-focus num">+${m} minutos de enfoque</div>`}<span class="muted-s num">Tiempo: ${dur(secs)}</span>
    ${p ? `<span class="muted-s num">Planificado: ${pm} / ${p.planned_minutes} min enfocados${done ? " · ya completada" : ""}</span>` : ""}
    ${f.planned_activity_id && use === "unused" ? `<small class="muted-s">La planificación ya estaba completada: esta sesión no suma minutos.</small>` : ""}
    ${!f.planned_activity_id && m && use === "unsaved" ? `<small class="muted-s">No da XP hasta que la guardes como actividad.</small>` : ""}
    ${m === 0 && f.status !== "discarded" ? `<small class="muted-s">Sesión muy corta: menos de 30 segundos.</small>` : ""}
    <div class="modal-f fe-btns">${btns}</div></div>`;
}
function focusOtherView() {
  const o = state.focus.get(dlg.other); if (!o || !fActive(o)) { const opts = dlg.opts; dlg = null; setTimeout(() => focusGo(opts)); return ""; }
  return `<div class="modal center" role="dialog" aria-modal="true" aria-labelledby="foH"><div class="eyebrow">Una sesión a la vez</div>
    <h2 id="foH">Ya hay una sesión activa en otro dispositivo</h2><span class="muted-s num">${esc(o.title)} · <span data-fclock="${o.id}">${timerText(o, fnow())}</span> · ${o.status === "running" ? "corriendo" : "pausada"}</span>
    <div class="modal-f fe-btns"><button type="button" class="btn ghost" data-dlg-close>Cancelar</button><button type="button" class="btn" data-fview="${o.id}">Ver sesión</button><button type="button" class="btn primary" data-fswap="${o.id}">Finalizar aquella e iniciar esta</button></div></div>`;
}
function focusDlg(d) {
  if (d.type === "focusStart") return focusStartForm();
  if (d.type === "timer") return timerView();
  if (d.type === "focusEnd") return focusEndView();
  if (d.type === "focusOther") return focusOtherView();
  return "";
}

/* ============ Pestaña Enfoque e historial ============ */
function vFocusTab() {
  const a = myActive(), others = liveFocus().filter((f) => fActive(f) && !mine(f));
  const hist = liveFocus().filter((f) => !fActive(f)).sort((x, y) => y.started_at.localeCompare(x.started_at)).slice(0, 60);
  const groups = []; for (const f of hist) { const k = keyOf(new Date(tms(f.started_at))); const g = groups[groups.length - 1]; if (g && g[0] === k) g[1].push(f); else groups.push([k, [f]]); }
  const T = todayKey();
  const row = (f) => { const u = fUse(f), m = toMin(segSecs(f.segments)); return `<div class="act c-${f.category} fs-${u}"><div class="cat-ico">${ico(f.category)}</div><div style="min-width:0"><div class="act-t">${esc(f.title)}</div>
    <div class="act-m"><em>${CAT[f.category].name}</em><span>${f.mode === "pomodoro" ? "Pomodoro" : "Libre"}</span><span>${USE_LABEL[u]}</span></div></div>
    <div class="act-r"><span class="num fs-min">${m} min</span>${u === "unsaved" && m ? `<button class="btn sm" data-fsave="${f.id}">Guardar</button><button class="icon-btn" data-fdiscard="${f.id}" aria-label="Descartar sesión">${ico("trash")}</button>` : ""}</div></div>`; };
  return `<div class="grid2 focus-grid"><section class="panel focus-start"><div class="panel-h"><h2>Temporizador de enfoque</h2></div>
    ${a ? `<div class="goal"><div class="goal-h"><span>${a.status === "running" ? "En curso" : "Pausada"} en este dispositivo</span><span class="num" data-fclock="${a.id}">${timerText(a, fnow())}</span></div><b>${esc(a.title)}</b><button class="btn primary" data-fopen="${a.id}">Abrir temporizador</button></div>`
      : `<p class="muted-s" style="margin:0 0 14px">Mide tu tiempo real. Las sesiones no dan XP: cuando terminas, la guardas como actividad o completas tu planificación.</p>
    <div class="seg two"><button type="button" data-fnew="free">${ico("play")}Sesión libre<small>Cuenta el tiempo real</small></button><button type="button" data-fnew="pomodoro">${ico("focus")}Pomodoro<small>${(state.pomo || POMO_DEF).focus} / ${(state.pomo || POMO_DEF).short} min</small></button></div>`}
    ${others.map((o) => `<div class="goal" style="margin-top:12px"><div class="goal-h"><span>Activa en otro dispositivo</span><span class="num" data-fclock="${o.id}">${timerText(o, fnow())}</span></div><b>${esc(o.title)}</b><button class="btn sm" data-fopen="${o.id}">Ver sesión</button></div>`).join("")}</section>
    <section class="panel"><div class="panel-h"><h2>Focus</h2><span class="chip num">${hist.filter((f) => f.status === "finished").length} sesiones</span></div>
    ${groups.length ? groups.map(([k, list]) => `<div class="ag-day"><div class="ag-h"><span class="eyebrow">${k === T ? "Hoy" : k === addDays(T, -1) ? "Ayer" : cap(fmtWeek(k)) + " " + fmtShort(k)}</span><span class="muted-s num">${toMin(unionSecs(list.filter((f) => f.status === "finished").flatMap((f) => f.segments)))} min</span></div><div class="acts">${list.map(row).join("")}</div></div>`).join("")
      : `<div class="empty">${ico("focus")}<div>Todavía no hiciste sesiones de enfoque.</div></div>`}</section></div>`;
}
/** Franja fina con la sesión activa, cuando el temporizador está minimizado */
function focusBar() {
  let el = document.getElementById("focusBar");
  const a = myActive(), show = a && !(dlg && (dlg.type === "timer" || dlg.type === "focusEnd"));
  if (!show) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement("button"); el.id = "focusBar"; el.className = "focus-bar"; document.body.appendChild(el); }
  el.dataset.fopen = a.id; el.className = `focus-bar c-${a.category} ${a.status === "running" ? "run" : ""}`;
  el.innerHTML = `<i class="fb-dot"></i><span class="fb-t">${esc(a.title)}</span><b class="num" data-fclock="${a.id}">${timerText(a, fnow())}</b>`;
}

/* ============ Reloj de pantalla, avisos y pantalla encendida ============ */
let audioCtx = null;
function unlockSound() { try { const C = window.AudioContext || window.webkitAudioContext; if (C && !audioCtx) audioCtx = new C(); if (audioCtx && audioCtx.state === "suspended") audioCtx.resume(); } catch (e) {} }
function chime() {
  try { if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate([180, 90, 180]); } catch (e) {}
  try {
    if (!audioCtx) return; const t = audioCtx.currentTime;
    for (const [fq, d] of [[660, 0], [880, 0.18]]) { const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.frequency.value = fq; o.type = "sine"; g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.18, t + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.5); o.connect(g).connect(audioCtx.destination); o.start(t + d); o.stop(t + d + 0.55); }
  } catch (e) {}
}
let wakeSentinel = null;
async function wake() { if (!state.wakeOn || !("wakeLock" in navigator) || document.visibilityState !== "visible") return; try { if (!wakeSentinel) { wakeSentinel = await navigator.wakeLock.request("screen"); wakeSentinel.addEventListener("release", () => { wakeSentinel = null; }); } } catch (e) {} }
function unwake() { try { wakeSentinel && wakeSentinel.release(); } catch (e) {} wakeSentinel = null; }
/** Cada medio segundo: repinta los números y aplica los cambios de fase del Pomodoro de ESTE dispositivo. No escribe nada si no cambió. */
function focusTick() {
  if (!state.ready) return;
  const now = fnow();
  for (const f of liveFocus()) {
    if (!fActive(f) || !mine(f) || f.mode !== "pomodoro") continue;
    const { f: x, ev, at } = pomoAdvance(f, now);
    if (ev.length) {
      putFocus([{ ...x, updated_at: stamp(f, now) }], 300); chime();
      ev.forEach((k, i) => Notify.focusPhase(f, k, at[i]));   // este dispositivo ya lo avisa: no le llega por push
      const last = ev[ev.length - 1], P = x.pomodoro;
      toast(last === "breakEnd" ? `<b>Descanso terminado</b> · ${esc(x.title)}` : `<b>Enfoque terminado</b> · ${PHASE[P.phase].toLowerCase()} de ${P[P.phase]} min`, "lvl");
      if (dlg && dlg.type === "timer" && dlg.id === f.id) renderModal();
      render(); return;
    }
  }
  for (const el of document.querySelectorAll("[data-fclock]")) { const f = state.focus.get(el.dataset.fclock); if (f) el.textContent = fEnded(f) ? clock(segSecs(f.segments)) : timerText(pomoAdvance(f, now).f, now); }
  for (const el of document.querySelectorAll("[data-ffocus]")) { const f = state.focus.get(el.dataset.ffocus); if (f) el.textContent = `Enfocado: ${dur(fSecs(pomoAdvance(f, now).f, now))}`; }
  for (const el of document.querySelectorAll("[data-fplan]")) { const p = state.plans.get(el.dataset.fplan); if (p) el.textContent = `Planificado: ${Math.floor(planFocusSecs(p.id, now) / 60)} / ${p.planned_minutes} min`; }
  const arc = document.querySelector(".tm-arc");
  if (arc && dlg && dlg.type === "timer") { const f = state.focus.get(dlg.id); if (f) arc.style.strokeDashoffset = String(+arc.dataset.c * (1 - ringPct(pomoAdvance(f, now).f, now))); }
}
setInterval(focusTick, 500);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { focusTick(); if (dlg && dlg.type === "timer") { renderModal(); wake(); } render(); } });
addEventListener("pageshow", () => { focusTick(); });

/** Después de cada render: franja de sesión activa y aviso si otro dispositivo finalizó la sesión de este */
let fWatch = new Map();
function focusAfterRender() {
  if (!state.ready) return;
  for (const [id, st] of fWatch) {
    const f = state.focus.get(id);
    if (f && fEnded(f) && st) {
      fWatch.delete(id);
      toast(`Esta sesión se finalizó desde otro dispositivo: <b>${esc(f.title)}</b>`, "lvl");
      if (dlg && dlg.type === "timer" && dlg.id === id) { dlg = { type: "focusEnd", id }; renderModal(); unwake(); }
    }
  }
  fWatch = new Map(liveFocus().filter((f) => fActive(f) && mine(f)).map((f) => [f.id, true]));
  if (!(dlg && dlg.type === "timer")) unwake();
  focusBar();
}

/* ============ Eventos ============ */
document.addEventListener("click", (e) => {
  const t = e.target.closest("button"); if (!t || !t.dataset) return;
  const D = t.dataset;
  if (D.fnew !== undefined) { openFocusStart(null); if (dlg && dlg.type === "focusStart" && (D.fnew === "pomodoro" || D.fnew === "free")) { dlg.f.mode = D.fnew; renderModal(); setTimeout(() => document.getElementById("fsTitle")?.focus(), 30); } return; }
  if (D.fopen) { openTimer(D.fopen); render(); return; }
  if (D.fview) { openTimer(D.fview); return; }
  if (D.fswap) { const opts = dlg && dlg.opts; const o = state.focus.get(D.fswap); if (o && fActive(o)) putFocus([fFinish(o)], 300); dlg = null; if (opts) focusGo(opts); return; }
  if (D.fpause) { fAct(D.fpause, fPause); renderModal(); render(); return; }
  if (D.fgo) { unlockSound(); fAct(D.fgo, (f) => fResume(pomoAdvance(f).f)); renderModal(); render(); wake(); return; }
  if (D.fskip) { fAct(D.fskip, fSkipBreak); renderModal(); render(); return; }
  if (D.ffin) { focusFinish(D.ffin); return; }
  if (D.fdiscard) { focusDiscard(D.fdiscard); return; }
  if (D.fsave) { focusSave(D.fsave); return; }
  if (D.fcomplete) { const p = state.plans.get(D.fcomplete); dlg = null; openPlanComplete(D.fcomplete, p ? Math.min(240, Math.round(planFocusSecs(p.id) / 60)) || undefined : undefined); return; }
  if (D.flongok) { (state.longAck || (state.longAck = new Set())).add(D.flongok); renderModal(); return; }
  if (D.ftrim) {
    const f = state.focus.get(D.ftrim), want = Math.round(+document.getElementById("tmTrim")?.value) * 60;
    if (!f || !(want > 0)) return;
    const closed = segSecs(f.segments), start = f.segment_started_at ? tms(f.segment_started_at) : fnow();
    focusFinish(f.id, start + Math.max(0, want - closed) * 1000); return;
  }
  if (dlg && dlg.type === "focusStart") {
    if (D.fscat) { readFocusStart(); dlg.f.cat = D.fscat; renderModal(); return; }
    if (D.fsmode) { readFocusStart(); dlg.f.mode = D.fsmode; renderModal(); return; }
  }
});
document.addEventListener("change", (e) => { if (e.target.id === "tmWake") { state.wakeOn = e.target.checked; Store.setMeta("wakeOn", state.wakeOn).catch(() => {}); if (state.wakeOn) wake(); else unwake(); } });
document.addEventListener("submit", (e) => { if (e.target.id === "focusStartForm") { e.preventDefault(); submitFocusStart(); } });
