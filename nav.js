/* Life RPG — navegación.
   Celular: barra de 5 accesos (Inicio, Hoy, Plan, Boss, Más) y hoja "Más" con el resto. Escritorio: el menú lateral de siempre.
   Botón Atrás como app nativa, con el historial del navegador:
     · cada cambio de pantalla agrega un paso (pushState); Atrás vuelve a la pantalla anterior;
     · ir a Inicio vuelve al primer paso, así Atrás desde Inicio sale de la app;
     · la hoja Más, un formulario o un diálogo agregan un paso propio: Atrás los cierra primero, sin cambiar de pantalla. */

const TABS = ["dashboard", "hoy", "planificador", "boss"];
const MORE = [
  ["objetivos", "Metas del mes y su progreso"],
  ["historial", "Calendario de todo lo que hiciste"],
  ["logros", "Medallas ganadas y por ganar"],
  ["tienda", "Canjea tu Oro por recompensas"],
  ["estadisticas", "Tu progreso en números"],
  ["perfil", "Personaje, cuenta y notificaciones"],
];
const isMore = (r) => MORE.some((m) => m[0] === r);
const isRoute = (r) => NAV.some((n) => n[0] === r);
const H = { pushed: false, timer: null, trav: false, tt: null, after: null, link: null };
/** Movimiento propio por el historial (cerrar algo encima o volver a Inicio). Mientras llega su popstate,
    un cambio de pantalla espera, así nunca se cruzan dos pasos. */
function traverse(n) { H.trav = true; clearTimeout(H.tt); H.tt = setTimeout(travDone, 600); history.go(n); }
function travDone() {
  H.trav = false; clearTimeout(H.tt);
  const r = H.after; H.after = null;
  if (r) go(r); else ovSync();
}
const hState = () => history.state || {};
function hSet(how, st, url) { try { history[how](st, "", url); } catch (e) {} }
/** ¿Hay algo encima de la pantalla? (hoja Más, formulario de actividad o cualquier diálogo) */
const ovOpen = () => !!(form || dlg || state.sheet);

/** Después de abrir o cerrar algo encima de la pantalla: agrega o consume su paso del historial */
function ovSync() {
  document.body.classList.toggle("ov-open", ovOpen());
  if (ovOpen()) {
    if (H.timer) { clearTimeout(H.timer); H.timer = null; H.pushed = true; return; }   // se cerró y se abrió otro en el mismo toque
    if (H.trav) return;                                                                 // se agrega al terminar el paso en curso
    if (!H.pushed) { hSet("pushState", { r: state.route, d: (+hState().d || 0) + 1, ov: 1 }, location.hash || "#" + state.route); H.pushed = true; }
  } else if (H.pushed) {
    H.pushed = false;
    // se consume después del toque, por si el mismo toque navega a otra pantalla (go reemplaza este paso)
    H.timer = setTimeout(() => { H.timer = null; traverse(-1); }, 0);
  }
}

/** Cambiar de pantalla */
function go(r) {
  if (!isRoute(r)) r = "dashboard";
  closeSheet(true);
  if (H.trav) { H.after = r; return; }
  const onOv = H.pushed || !!H.timer;
  if (H.timer) { clearTimeout(H.timer); H.timer = null; }
  H.pushed = false;
  const d = +hState().d || 0;
  if (r === "dashboard" && d > 0) {
    // Inicio es la raíz: se vuelve al primer paso
    traverse(-d);
    setRoute("dashboard"); ovSync(); return;
  }
  if (r === state.route && !onOv) hSet("replaceState", { r, d }, "#" + r);
  else if (onOv) hSet("replaceState", { r, d: Math.max(1, d) }, "#" + r);   // el paso de la hoja/diálogo pasa a ser la pantalla nueva
  else hSet("pushState", { r, d: d + 1 }, "#" + r);
  setRoute(r); ovSync();
}
function setRoute(r) {
  state.route = r; state.confirmDel = null; state.confirmReset = false;
  render(); window.scrollTo(0, 0);
  document.body.classList.remove("fab-hide");
}

addEventListener("popstate", (e) => {
  const st = e.state || {};
  if (H.trav) { travDone(); return; }               // llegó nuestro propio paso
  if (ovOpen()) {
    H.pushed = false;
    if (dlg && dlg.busy) { ovSync(); return; }      // esperando al servidor: no se puede cerrar todavía
    form = null; dlg = null; state.sheet = false;
    renderSheet(); renderModal(); render(); restoreFocus();
    return;
  }
  if (st.ov) { hSet("replaceState", { r: st.r || state.route, d: st.d }, location.hash); }   // un paso de diálogo que ya no está abierto
  const r = st.r || parseHash(location.hash).r;
  if (isRoute(r) && r !== state.route) setRoute(r);
});
/* Un enlace interno escrito a mano o abierto desde fuera (#boss, #planificador?plan=…) */
addEventListener("hashchange", () => { const h = location.hash; if (parseHash(h).r !== state.route || h.includes("?")) openLink(h); });

/* ============ Barra inferior ============ */
function navHTML() {
  const r = state.route, more = isMore(r) || !!state.sheet, dot = claimCount() > 0;
  return NAV.map(([id, label, icon, short]) => `<a href="#${id}" data-go="${id}" class="${r === id ? "on" : ""}${TABS.includes(id) ? "" : " mob-hide"}" ${r === id ? 'aria-current="page"' : ""}>${ico(icon)}<span class="nl">${label}</span><span class="ns">${short}</span></a>`).join("")
    + `<button type="button" class="more-tab${more ? " on" : ""}" data-more aria-haspopup="dialog" aria-expanded="${!!state.sheet}" ${isMore(r) ? 'aria-current="page"' : ""}>${ico("grid")}<span class="ns">Más</span>${dot ? `<i class="tab-dot" aria-hidden="true"></i><span class="sr">· hay algo para reclamar</span>` : ""}</button>`;
}
const navPaint = () => { const n = document.getElementById("nav"); if (n) n.innerHTML = navHTML(); };
/** Objetivos y Boss para reclamar (lo que está dentro de Más o en Boss) */
function claimCount() {
  if (state.demo || !state.ready) return 0;
  let n = 0;
  for (const g of state.eco.goals.values()) if (!g.deleted_at && g.coin_reward && goalStatus(g, goalProgress(g, state.days), state.eco) === "completed") n++;
  return n;
}

/* ============ Hoja Más ============ */
let sheetFrom = null;
function openSheet() {
  if (state.sheet) return;
  sheetFrom = document.activeElement;
  state.sheet = true; renderSheet(); navPaint(); ovSync();
  setTimeout(() => document.querySelector("#sheet .sheet-row.on, #sheet .sheet-row")?.focus({ preventScroll: true }), 30);
}
/** quiet: cierra sin consumir su paso (lo hace quien navega) */
function closeSheet(quiet) {
  if (!state.sheet) return;
  state.sheet = false; renderSheet(); navPaint();
  if (!quiet) { ovSync(); restoreFocus(); }
}
function restoreFocus() { const el = sheetFrom && document.contains(sheetFrom) ? sheetFrom : document.querySelector(".more-tab"); sheetFrom = null; try { el && el.focus({ preventScroll: true }); } catch (e) {} }
function sheetHTML() {
  return `<div class="sheet-scrim" id="sheetScrim"><div class="sheet" id="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetH">
  <div class="sheet-grab" aria-hidden="true"></div>
  <div class="sheet-h"><h2 id="sheetH">Más secciones</h2><button type="button" class="icon-btn" data-sheet-close aria-label="Cerrar">${ico("x")}</button></div>
  <div class="sheet-list">${MORE.map(([id, desc]) => {
    const n = NAV.find((x) => x[0] === id), c = id === "objetivos" ? claimCount() : 0;
    return `<button type="button" class="sheet-row${state.route === id ? " on" : ""}" data-go="${id}" ${state.route === id ? 'aria-current="page"' : ""}><span class="sr-ico">${ico(n[2])}</span><span class="sr-t"><b>${n[1]}</b><small>${desc}</small></span>${c ? `<span class="chip gold num">${c > 9 ? "9+" : c}</span>` : ico("right", "chev")}</button>`;
  }).join("")}</div></div></div>`;
}
function renderSheet() {
  const root = document.getElementById("sheetRoot"); if (!root) return;
  if (state.sheet) { root.innerHTML = sheetHTML(); return; }
  const sc = root.firstElementChild; if (!sc) return;
  if (matchMedia("(prefers-reduced-motion:reduce)").matches) { root.innerHTML = ""; return; }
  sc.classList.add("closing"); sc.id = "";
  setTimeout(() => { if (!state.sheet && root.firstElementChild === sc) root.innerHTML = ""; }, 160);
}
document.addEventListener("click", (e) => {
  if (e.target.id === "sheetScrim") { closeSheet(); return; }
  const t = e.target.closest("[data-more],[data-sheet-close]"); if (!t) return;
  if (t.dataset.sheetClose !== undefined) { closeSheet(); return; }
  if (state.sheet) closeSheet(); else openSheet();
});
document.addEventListener("keydown", (e) => {
  if (!state.sheet) return;
  if (e.key === "Escape") { e.stopPropagation(); closeSheet(); return; }
  if (e.key === "Tab") {                              // el foco no sale de la hoja
    const f = [...document.querySelectorAll("#sheet button")]; if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
  }
}, true);
/* Deslizar hacia abajo para cerrar: más de 80 px o un gesto rápido */
const sw = { y: 0, t: 0, dy: 0, on: false };
document.addEventListener("touchstart", (e) => {
  const sh = e.target.closest && e.target.closest("#sheet"); if (!sh || e.touches.length !== 1) return;
  if (sh.scrollTop > 0 && !e.target.closest(".sheet-grab,.sheet-h")) return;
  sw.on = true; sw.y = e.touches[0].clientY; sw.t = performance.now(); sw.dy = 0; sh.style.transition = "none";
}, { passive: true });
document.addEventListener("touchmove", (e) => {
  if (!sw.on) return; const sh = document.getElementById("sheet"); if (!sh) { sw.on = false; return; }
  sw.dy = Math.max(0, e.touches[0].clientY - sw.y); sh.style.transform = sw.dy ? `translateY(${sw.dy}px)` : "";
}, { passive: true });
document.addEventListener("touchend", () => {
  if (!sw.on) return; sw.on = false;
  const sh = document.getElementById("sheet"); if (!sh) return;
  const v = sw.dy / Math.max(1, performance.now() - sw.t);
  sh.style.transition = "";
  if (sw.dy > 80 || (sw.dy > 24 && v > 0.5)) closeSheet(); else sh.style.transform = "";
});

/* ============ Botón + ============ */
let lastY = 0;
addEventListener("scroll", () => {
  const y = scrollY, end = y + innerHeight >= document.documentElement.scrollHeight - 40;
  if (y > lastY + 8 && y > 80 && !end) document.body.classList.add("fab-hide");
  else if (y < lastY - 8 || end) document.body.classList.remove("fab-hide");
  lastY = y;
}, { passive: true });

/* ============ Enlaces internos (avisos, accesos directos) ============ */
function parseHash(h) { const [r, q] = String(h || "").replace(/^#/, "").split("?"); return { r: r || "dashboard", q: new URLSearchParams(q || "") }; }
/** Abre un enlace interno: #planificador?plan=<id>[&focus=1], #planificador?session=<id>, #objetivos?goal=<id>, #dashboard?chest=<nivel>, #boss… */
function openLink(h) {
  if (!state.ready) { H.link = h; return; }
  const { r, q } = parseHash(h); if (!isRoute(r)) return;
  form = null; if (dlg && !dlg.busy) dlg = null; renderModal();
  let flash = null, after = null;
  if (r === "planificador") {
    const p = q.get("plan") && state.plans.get(q.get("plan")), f = q.get("session") && state.focus.get(q.get("session"));
    if (p && !p.deleted_at) {
      const T = todayKey();
      if (p.date >= T) { state.planTab = "calendar"; state.planSel = p.date; state.planMonth = p.date.slice(0, 7); } else state.planTab = "agenda";
      if (p.date < addDays(T, -OVERDUE_DAYS)) state.oldOpen = true;
      flash = `[data-pid="${p.id}"]`;
      if (q.get("focus") === "1") after = () => { if (isOpenPlan(planState(p))) focusStartFor(p.id); else toast("Esa planificación ya no está pendiente."); };
    } else if (q.get("plan")) toast("Esa planificación ya no existe.");
    if (f) {
      if (fActive(f) && mine(f)) after = () => openTimer(f.id);
      else if (fActive(f)) { state.planTab = "focus"; toast("Esa sesión de enfoque está en otro dispositivo."); }
      else state.planTab = "focus";
    }
  } else if (r === "objetivos") {
    const g = q.get("goal") && state.eco.goals.get(q.get("goal"));
    if (g && !g.deleted_at) { state.goalMonth = monthKey(g.year, g.month); flash = `[data-gid="${g.id}"]`; }
  } else if (r === "dashboard" && q.get("chest")) flash = ".chest-panel";
  go(r);
  if (flash) setTimeout(() => { const el = document.querySelector(flash); if (el) { el.scrollIntoView({ block: "center", behavior: "smooth" }); el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 2200); } }, 60);
  if (after) after();
}

/** Primera carga: deja Inicio como primer paso, así Atrás desde cualquier pantalla abierta por enlace vuelve a Inicio */
function navInit() {
  const st = hState(), { r, q } = parseHash(location.hash);
  if (st.ov) traverse(-1);                                     // se recargó con un diálogo abierto: ese paso ya no sirve
  if (st.r && isRoute(st.r)) { state.route = st.r; return; }
  hSet("replaceState", { r: "dashboard", d: 0 }, "#dashboard");
  if (isRoute(r) && r !== "dashboard") { hSet("pushState", { r, d: 1 }, "#" + r); state.route = r; }
  if ([...q.keys()].length) H.link = location.hash;
}
/** Cuando los datos ya cargaron: abre el enlace que trajo la app al abrirse */
function navReady() { if (H.link) { const h = H.link; H.link = null; openLink(h); } }
if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", (e) => { if (e.data && e.data.type === "open" && typeof e.data.url === "string") openLink(e.data.url.slice(e.data.url.indexOf("#"))); });
