/* Life RPG — Perfil avanzado: ficha de personaje, avatar, títulos, insignias destacadas, estadísticas de vida y récords.
   Todo se calcula con los datos que ya existen. Solo se guarda lo que eliges: avatar, título equipado y 3 insignias
   (en el perfil, que se sincroniza como siempre). Los títulos no dan ventajas numéricas. */

/* ============ Títulos ============ */
const TITLE_RULES = [
  { id: "aspirante", name: "Aspirante", how: "Disponible desde el principio", p: () => [1, 1], lbl: "" },
  { id: "retador", name: "Retador", how: "Reclama tu primer Boss", p: (s, c) => [c.bosses, 1], lbl: "Bosses" },
  { id: "constante", name: "El Constante", how: "Consigue una racha de 30 días", p: (s) => [s.bestStreak, 30], lbl: "Racha" },
  { id: "erudito", name: "Erudito", how: "Lleva Curso al nivel 20", p: (s) => [s.catLv.curso, 20], lbl: "Curso nivel" },
  { id: "guerrero", name: "Guerrero", how: "Lleva Físico al nivel 20", p: (s) => [s.catLv.fisico, 20], lbl: "Físico nivel" },
  { id: "mente-serena", name: "Mente Serena", how: "Lleva Cuidado al nivel 20", p: (s) => [s.catLv.cuidado, 20], lbl: "Cuidado nivel" },
  { id: "lector-voraz", name: "Lector Voraz", how: "Lleva Lectura al nivel 20", p: (s) => [s.catLv.lectura, 20], lbl: "Lectura nivel" },
  { id: "cazador", name: "Cazador de Dragones", how: "Reclama 3 Bosses", p: (s, c) => [c.bosses, 3], lbl: "Bosses" },
  { id: "veterano", name: "Veterano del Tiempo", how: "Registra actividad en 365 días", p: (s) => [s.activeDays, 365], lbl: "Días activos" },
  { id: "maestro", name: "Maestro Integral", how: "Lleva las 4 categorías al nivel 20", p: (s) => [Math.min(...CATS.map((c) => s.catLv[c.id])), 20], lbl: "Nivel más bajo" },
];
const DEFAULT_TITLE = "rule:aspirante";
/** Bosses reclamados (incluye los reclamos que esperan confirmación) */
const paidBosses = () => (state.demo ? [] : liveBosses().map(bossInfo).filter((i) => isPaid(i.st)));
/** Todos los títulos con su estado. Clave: rule:<id> o boss:<id del Boss>. */
function titleList(s) {
  const c = { bosses: paidBosses().length };
  const out = TITLE_RULES.map((r) => { const [v, t] = r.p(s, c); return { key: "rule:" + r.id, name: r.name, how: r.how, v: Math.min(v, t), t, lbl: r.lbl, got: v >= t }; });
  if (!state.demo) for (const i of liveBosses().map(bossInfo)) {
    if (!i.b.title_reward || i.st === "failed") continue;
    out.push({ key: "boss:" + i.b.id, name: i.b.title_reward, how: `Reclama el Boss ${i.b.name} (${monthName(i.b.year, i.b.month)})`, v: Math.min(i.dmg, i.hp), t: i.hp, lbl: "Daño", got: isPaid(i.st), boss: true });
  }
  return out;
}
/** Título equipado; null si ya no está desbloqueado (se muestra "Sin título", no se borra nada) */
function equippedTitle(s) {
  const key = state.profile.equipped_title || DEFAULT_TITLE;
  return titleList(s).find((t) => t.key === key && t.got) || null;
}
function equipTitle(key) {
  state.profile.equipped_title = key; saveProfile();
  toast("Título equipado.");
  if (dlg && dlg.type === "bossClaimed") dlg = null;
  renderModal(); render();
}

/* ============ Avatar ============ */
const AV_BG = { violet: ["Violeta noche", "#3d2c70", "#140f22"], gold: ["Oro viejo", "#5c4720", "#191307"], emerald: ["Esmeralda", "#1d4b3d", "#0a1813"],
  crimson: ["Carmesí apagado", "#5a2329", "#190b0d"], steel: ["Acero", "#36414f", "#10141a"], obsidian: ["Obsidiana", "#241f2e", "#060509"] };
const AV_FRAMES = { simple: "Simple", gold: "Dorado", runic: "Rúnico", laurel: "Laurel", thorns: "Espinas" };
const AV_ICONS = { sword: "Espada", shield: "Escudo", book: "Libro", flame: "Llama", moon: "Luna", star: "Estrella", crown: "Corona", leaf: "Hoja", mountain: "Montaña", eye: "Ojo", rune: "Runa", owl: "Búho" };
const AV_BADGES = { none: "Ninguna", rank: "Emblema de rango", flame: "Llama de racha", crown: "Corona", coin: "Moneda" };
function defaultInitials(name) {
  const w = String(name || "").trim().split(/\s+/).filter(Boolean);
  return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] || "A").slice(0, 2)).toUpperCase();
}
function frameSVG(f) {
  const ring = (r, st, w, extra = "") => `<circle cx="50" cy="50" r="${r}" fill="none" stroke="${st}" stroke-width="${w}" ${extra}/>`;
  const around = (n, fn) => [...Array(n)].map((_, k) => fn((k / n) * Math.PI * 2, k)).join("");
  switch (f) {
    case "gold": return ring(46, "url(#g-gold)", 3.5) + ring(41.5, "rgba(220,188,120,.35)", 0.8);
    case "runic": return ring(46, "url(#g-gold)", 2) + ring(41.5, "#a8884a", 0.9, `stroke-dasharray="1.2 4.2"`) +
      around(8, (a) => { const x = 50 + Math.cos(a) * 46, y = 50 + Math.sin(a) * 46; return `<path d="M${x - 2.6} ${y}l2.6-3.4 2.6 3.4-2.6 3.4z" fill="#dcbc78"/>`; });
    case "laurel": return ring(46, "#a8884a", 1) + around(22, (a, k) => {
      if (k === 0 || k === 11) return ""; const deg = a * 180 / Math.PI, x = 50 + Math.cos(a) * 46, y = 50 + Math.sin(a) * 46;
      return `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="4.2" ry="1.7" fill="#c9a865" transform="rotate(${(deg + (k < 11 ? 60 : 120)).toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`; });
    case "thorns": return ring(45, "#8a6b3a", 1.4) + around(14, (a) => {
      const p = (r, d) => `${(50 + Math.cos(a + d) * r).toFixed(1)} ${(50 + Math.sin(a + d) * r).toFixed(1)}`;
      return `<path d="M${p(45, -0.09)}L${p(50, 0)}L${p(45, 0.09)}z" fill="#a8884a"/>`; });
  }
  return ring(46, "#3a3150", 3);
}
function avatarSVG(p, s, size = 72) {
  const bg = AV_BG[p.avatar_bg] ? p.avatar_bg : "violet", [, c1, c2] = AV_BG[bg];
  const icon = AV_ICONS[p.avatar_icon] ? p.avatar_icon : null, ini = (p.avatar_initials || defaultInitials(p.name)).slice(0, 2);
  const center = icon ? `<use href="#a-${icon}" x="27" y="27" width="46" height="46" style="color:#f1d79d"/>`
    : `<text x="50" y="52" text-anchor="middle" dominant-baseline="central" font-family="Cinzel,Georgia,serif" font-weight="600" font-size="${ini.length > 1 ? 30 : 36}" fill="#f1d79d" letter-spacing="1">${esc(ini)}</text>`;
  let badge = "";
  if (p.avatar_badge && p.avatar_badge !== "none" && AV_BADGES[p.avatar_badge]) {
    const inner = p.avatar_badge === "rank" ? `<text x="82" y="83" text-anchor="middle" dominant-baseline="central" font-size="11" font-weight="700" fill="#1b1406">${s ? s.G.level : 1}</text>`
      : p.avatar_badge === "coin" ? `<use href="#i-coin" x="73" y="74" width="18" height="18"/>`
      : `<use href="#i-${p.avatar_badge}" x="74" y="75" width="16" height="16" style="color:${p.avatar_badge === "flame" ? "#ec8a62" : "#dcbc78"}"/>`;
    badge = `<circle cx="82" cy="83" r="13" fill="${p.avatar_badge === "rank" ? "url(#g-gold)" : "#0c0a12"}" stroke="#dcbc78" stroke-width="1.5"/>${inner}`;
  }
  return `<svg class="avatar" viewBox="0 0 100 100" width="${size}" height="${size}" role="img" aria-label="Avatar">
    <defs><radialGradient id="avg-${bg}" cx=".5" cy=".35" r=".75"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></radialGradient></defs>
    <circle cx="50" cy="50" r="44" fill="url(#avg-${bg})"/>${frameSVG(p.avatar_frame)}${center}${badge}</svg>`;
}

/* ============ Estadísticas y récords ============ */
function specialty(s) {
  return CATS.slice().sort((a, b) => s.catLv[b.id] - s.catLv[a.id] || s.catXP[b.id] - s.catXP[a.id])[0];
}
function lifeStats(s) {
  const g = state.demo ? { earned: 0, spent: 0 } : goldNow(), E = state.eco;
  const goalsDone = state.demo ? 0 : live(E.goals).filter((x) => x.claimed_at || E.ops.some((o) => o.kind === "claim" && o.goal_id === x.id)).length;
  const bought = state.demo ? 0 : [...E.purchases.values()].filter((p) => p.status !== "rejected").length;
  return [["XP total", nf(s.xp)], ["Oro ganado", nf(g.earned)], ["Oro gastado", nf(g.spent)], ["Actividades completadas", nf(s.total)],
    ["Horas invertidas", nf(s.minutes / 60)], ["Días activos", nf(s.activeDays)], ["Racha actual", `${s.curStreak} ${s.curStreak === 1 ? "día" : "días"}`],
    ["Mejor racha", `${s.bestStreak} ${s.bestStreak === 1 ? "día" : "días"}`], ["Bosses derrotados", nf(paidBosses().length)], ["Objetivos completados", nf(goalsDone)],
    ["Recompensas compradas", nf(bought)], ["Logros desbloqueados", `${Object.keys(s.unlocked).length} / ${ACH.length}`]];
}
function records(s) {
  const pd = s.perDay, wk = new Map(), mo = new Map();
  let bd = null, bm = null, ba = null, run = 0, prev = null, best = 0, bestEnd = null;
  for (const k of s.keys) {
    const p = pd[k];
    if (!bd || p.xp > pd[bd].xp) bd = k;
    if (!bm || p.min > pd[bm].min) bm = k;
    if (!ba || p.count > pd[ba].count) ba = k;
    const w = addDays(k, -((fromKey(k).getDay() + 6) % 7)); wk.set(w, (wk.get(w) || 0) + p.xp);
    mo.set(k.slice(0, 7), (mo.get(k.slice(0, 7)) || 0) + p.xp);
    run = prev && addDays(prev, 1) === k ? run + 1 : 1; prev = k;
    if (run > best) { best = run; bestEnd = k; }
  }
  const top = (m) => [...m.entries()].reduce((a, b) => (b[1] > a[1] ? b : a), [null, 0]);
  const [w, wx] = top(wk), [m, mx] = top(mo);
  const wEnd = w && addDays(w, 6), wTxt = w ? (w.slice(0, 7) === wEnd.slice(0, 7) ? `${fromKey(w).getDate()}–${fmtShort(wEnd)}` : `${fmtShort(w)} – ${fmtShort(wEnd)}`) : "";
  const sp = specialty(s), hard = paidBosses().sort((a, b) => b.hp - a.hp)[0];
  const none = "—";
  return [
    ["Día con más XP", bd ? `${nf(pd[bd].xp)} XP` : none, bd ? fmtLong(bd) : ""],
    ["Semana con más XP", w ? `${nf(wx)} XP` : none, wTxt],
    ["Mes con más XP", m ? `${nf(mx)} XP` : none, m ? cap(monthName(+m.slice(0, 4), +m.slice(5))) : ""],
    ["Más minutos en un día", bm ? `${nf(pd[bm].min)} min` : none, bm ? fmtLong(bm) : ""],
    ["Más actividades en un día", ba ? `${pd[ba].count} actividades` : none, ba ? fmtLong(ba) : ""],
    ["Mejor racha", best ? `${best} ${best === 1 ? "día" : "días"}` : none, bestEnd ? `Terminó el ${fmtLong(bestEnd)}` : ""],
    ["Categoría de mayor nivel", s.total ? `${sp.name} · Nv ${s.catLv[sp.id]}` : none, s.total ? `${nf(s.catXP[sp.id])} XP en ${sp.name}` : ""],
    ["Boss derrotado más difícil", hard ? `${nf(hard.hp)} ${BOSS_TYPES[hard.b.boss_type].unit} · ${bossTypeText(hard.b)}` : none, hard ? `${hard.b.name} · ${monthName(hard.b.year, hard.b.month)}` : ""],
  ];
}

/* ============ Perfil ============ */
function featured(s) { return (state.profile.featured_badges || []).filter((id) => s.unlocked[id]).map((id) => ACH.find((a) => a.id === id)).filter(Boolean).slice(0, 3); }
function fichaPanel(s) {
  const p = state.profile, t = equippedTitle(s), name = p.name ? esc(p.name) : "Aventurero", b = state.demo ? 0 : goldNow().balance;
  const fb = featured(s);
  return `<section class="panel ficha">
    <div class="ficha-av">${avatarSVG(p, s, 112)}<button class="link" data-avedit>Editar avatar</button></div>
    <div class="ficha-main"><div class="eyebrow">Ficha de personaje</div><h2 class="disp ficha-name">${name}</h2>
      <div class="ficha-rank num">Nivel ${s.G.level} · <b>${s.rank.name}</b></div>
      <div class="ficha-title">${ico("crown")}<span>${t ? `“${esc(t.name)}”` : `<i>Sin título</i>`}</span><button class="btn sm" data-titles>Cambiar título</button></div>
      <div class="ficha-stats"><span class="stat gold-stat ${b < 0 ? "neg" : ""}">${coinIco()}<b class="num">${b < 0 ? "−" + nf(-b) : nf(b)}</b> Oro</span><span class="stat"><svg class="flame"><use href="#i-flame"/></svg><b class="num">${s.curStreak}</b> ${s.curStreak === 1 ? "día" : "días"} de racha</span></div>
    </div>
    <div class="ficha-badges"><div class="panel-h"><h2>Insignias destacadas</h2><button class="link" data-badges>Elegir</button></div>
      ${fb.length ? `<div class="badge-row">${fb.map((a) => `<div class="badge-f"><div class="medal">${medal(true, 34)}</div><b>${a.name}</b></div>`).join("")}</div>` : `<div class="goal-h"><span>Elige hasta 3 logros para mostrar aquí.</span></div>`}</div>
  </section>`;
}
function attrPanel(s) {
  const sp = specialty(s);
  return `<section class="panel"><div class="panel-h"><h2>Atributos</h2>${s.total ? `<span class="chip gold">Especialidad: ${sp.name}</span>` : ""}</div>
    <div class="hbars">${CATS.map((c) => { const L = levelOf(s.catXP[c.id], needC); return `<div class="hbar"><span>${c.name}</span><div class="track"><i style="width:${L.pct * 100}%;background:var(--c-${c.id})"></i></div><span class="v num">Nv ${L.level}</span></div>`; }).join("")}</div>
    <p class="muted-s" style="margin:12px 0 0">Los atributos son tus niveles de categoría. La especialidad es la categoría de mayor nivel.</p></section>`;
}
function charCard(s) {
  const p = state.profile, t = equippedTitle(s), b = state.demo ? 0 : goldNow().balance;
  return `<section class="char-card" aria-label="Tarjeta de personaje"><div class="cc-top">${avatarSVG(p, s, 64)}<div><b class="disp">${p.name ? esc(p.name) : "Aventurero"}</b><span class="num">Nivel ${s.G.level} · ${s.rank.name}</span>${t ? `<em>“${esc(t.name)}”</em>` : ""}</div></div>
    <div class="cc-cats">${CATS.map((c) => `<span class="c-${c.id}">${ico(c.id)}${c.name} <b class="num">${s.catLv[c.id]}</b></span>`).join("")}</div>
    <div class="cc-foot num"><span><svg class="flame"><use href="#i-flame"/></svg>${s.curStreak} ${s.curStreak === 1 ? "día" : "días"}</span><span>${coinIco()}${b < 0 ? "−" + nf(-b) : nf(b)} Oro</span><span>Bosses ${paidBosses().length}</span><span>Logros ${Object.keys(s.unlocked).length}</span></div></section>`;
}
function lifePanel(s) {
  return `<section class="panel"><div class="panel-h"><h2>Estadísticas de vida</h2></div><div class="tstats life">${lifeStats(s).map(([l, v]) => `<div><b class="num">${v}</b><span>${l}</span></div>`).join("")}</div></section>`;
}
function recordsPanel(s) {
  return `<section class="panel"><div class="panel-h"><h2>Récords</h2></div><div class="records">${records(s).map(([l, v, d]) => `<div class="rec"><span>${l}</span><b class="num">${esc(v)}</b><small>${esc(d)}</small></div>`).join("")}</div></section>`;
}
/** Parte superior del Perfil: ficha, atributos, tarjeta, estadísticas y récords */
function perfilTop(s) {
  return fichaPanel(s) + `<div class="grid2">${attrPanel(s)}${charCard(s)}</div>` + lifePanel(s) + recordsPanel(s);
}

/* ============ Ventanas ============ */
function avatarForm(s) {
  const f = dlg.f, sw = (attr, map, cur, fn) => Object.entries(map).map(([k, v]) => `<button type="button" data-${attr}="${k}" aria-pressed="${cur === k}" title="${Array.isArray(v) ? v[0] : v}" aria-label="${Array.isArray(v) ? v[0] : v}">${fn(k, v)}</button>`).join("");
  return `<form class="modal" id="avatarForm" role="dialog" aria-modal="true" aria-labelledby="avH">
  <div><div class="eyebrow">Perfil</div><h2 id="avH">Editar avatar</h2></div>
  <div class="av-preview">${avatarSVG(f, s, 132)}</div>
  <div class="field"><label>Centro</label><div class="av-pick">${`<button type="button" data-avicon="initials" aria-pressed="${f.avatar_icon === "initials"}" title="Iniciales"><b class="disp">${esc((f.avatar_initials || defaultInitials(state.profile.name)).slice(0, 2))}</b></button>`}${sw("avicon", AV_ICONS, f.avatar_icon, (k) => `<svg><use href="#a-${k}"/></svg>`)}</div></div>
  ${f.avatar_icon === "initials" ? `<div class="field"><label for="avInit">Iniciales (1 o 2 letras)</label><input class="inp" id="avInit" maxlength="2" placeholder="${esc(defaultInitials(state.profile.name))}" value="${esc(f.avatar_initials)}"></div>` : ""}
  <div class="field"><label>Fondo</label><div class="av-pick sw">${sw("avbg", AV_BG, f.avatar_bg, (k, v) => `<i style="background:radial-gradient(circle at 50% 35%,${v[1]},${v[2]})"></i>`)}</div></div>
  <div class="field"><label>Marco</label><div class="av-pick">${sw("avframe", AV_FRAMES, f.avatar_frame, (k) => `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" fill="#16121f"/>${frameSVG(k)}</svg>`)}</div></div>
  <div class="field"><label>Insignia en la esquina</label><div class="seg five av-badges">${Object.entries(AV_BADGES).map(([k, v]) => `<button type="button" data-avbadge="${k}" aria-pressed="${f.avatar_badge === k}">${v}</button>`).join("")}</div></div>
  <div class="modal-f"><button type="button" class="btn ghost" data-dlg-close>Cancelar</button><button type="submit" class="btn primary">Guardar avatar</button></div></form>`;
}
function titlesDlg(s) {
  const all = titleList(s), got = all.filter((t) => t.got), locked = all.filter((t) => !t.got), tab = dlg.tab || "got", cur = state.profile.equipped_title || DEFAULT_TITLE;
  const list = tab === "got"
    ? got.map((t) => `<div class="title-row got"><div>${ico("crown")}<b>${esc(t.name)}</b><small>${esc(t.boss ? "Título de Boss" : t.how)}</small></div>${t.key === cur ? `<span class="chip gold">Equipado</span>` : `<button type="button" class="btn sm" data-equip="${t.key}">Equipar</button>`}</div>`).join("")
    : locked.length ? locked.map((t) => `<div class="title-row"><div>${ico("crown")}<b>${esc(t.name)}</b><small>${esc(t.how)}</small></div><span class="num muted-s">${t.lbl} ${nf(t.v)} / ${nf(t.t)}</span><div class="xpbar thin"><i style="width:${t.v / t.t * 100}%"></i></div></div>`).join("")
    : `<div class="empty" style="padding:10px">Desbloqueaste todos los títulos.</div>`;
  return `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="tH"><div><div class="eyebrow">Colección</div><h2 id="tH">Títulos</h2></div>
    <div class="tabs">${[["got", `Desbloqueados (${got.length})`], ["locked", `Bloqueados (${locked.length})`]].map(([id, l]) => `<button type="button" role="tab" aria-selected="${tab === id}" data-ttab="${id}">${l}</button>`).join("")}</div>
    <div class="title-list">${list}</div><small class="muted-s">Los títulos son solo decorativos: no cambian XP, Oro ni niveles.</small>
    <div class="modal-f"><button type="button" class="btn" data-dlg-close>Cerrar</button></div></div>`;
}
function badgesDlg(s) {
  const got = ACH.filter((a) => s.unlocked[a.id]), sel = dlg.sel;
  return `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="iH2"><div><div class="eyebrow">Perfil</div><h2 id="iH2">Insignias destacadas</h2></div>
    <span class="muted-s">Elige hasta 3 logros desbloqueados (${sel.length} / 3).</span>
    ${got.length ? `<div class="ach-list badge-pick">${got.map((a) => `<button type="button" class="ach ${sel.includes(a.id) ? "on" : ""}" data-badge="${a.id}" aria-pressed="${sel.includes(a.id)}" ${!sel.includes(a.id) && sel.length >= 3 ? "disabled" : ""}><div class="medal">${medal(true)}</div><div><b>${a.name}</b><span>${a.desc}</span></div></button>`).join("")}</div>`
      : `<div class="empty" style="padding:10px">Todavía no desbloqueaste logros.</div>`}
    <div class="modal-f"><button type="button" class="btn ghost" data-dlg-close>Cancelar</button><button type="button" class="btn primary" id="badgeSave">Guardar</button></div></div>`;
}
/** Ventanas que agregan boss.js y este archivo (las dibuja dlgHTML de tesoro.js) */
function extraDlg(d) {
  const pf = planDlg(d) || focusDlg(d);          // Planificador y Temporizador (planner.js, focus.js)
  if (pf) return pf;
  if (dlg !== d) return "";                      // la ventana se cerró sola (la planificación o la sesión ya no existe)
  if (d.type === "bossForm") return bossForm();
  if (d.type === "bossDown" || d.type === "bossClaimed") return bossDlgHTML(d);
  const s = compute();
  if (d.type === "avatar") return avatarForm(s);
  if (d.type === "titles") return titlesDlg(s);
  if (d.type === "badges") return badgesDlg(s);
  return "";
}
/** Campos del perfil que vienen en un respaldo versión 4 */
function profileFromFile(pr) {
  const pick = (v, ok, d) => (typeof v === "string" && ok(v) ? v : d);
  return { avatar_initials: pick(pr.avatar_initials, (v) => v.length <= 2, "").toUpperCase(), avatar_icon: pick(pr.avatar_icon, (v) => v === "initials" || AV_ICONS[v], "initials"),
    avatar_frame: pick(pr.avatar_frame, (v) => AV_FRAMES[v], "simple"), avatar_bg: pick(pr.avatar_bg, (v) => AV_BG[v], "violet"), avatar_badge: pick(pr.avatar_badge, (v) => AV_BADGES[v], "none"),
    equipped_title: pick(pr.equipped_title, (v) => v.length <= 64, ""), featured_badges: Array.isArray(pr.featured_badges) ? pr.featured_badges.filter((x) => ACH.some((a) => a.id === x)).slice(0, 3) : [],
    hasAvatar: ["avatar_initials", "avatar_icon", "avatar_frame", "avatar_bg", "avatar_badge", "equipped_title", "featured_badges"].some((k) => k in pr) };
}
const AV_KEYS = ["avatar_initials", "avatar_icon", "avatar_frame", "avatar_bg", "avatar_badge"];

/* ============ Eventos ============ */
function readAvatarForm() { const i = document.getElementById("avInit"); if (i && dlg) dlg.f.avatar_initials = i.value.trim().toUpperCase().slice(0, 2); }
document.addEventListener("click", (e) => {
  const t = e.target.closest("button"); if (!t || !t.dataset) return;
  const D = t.dataset;
  if (D.avedit !== undefined) { const p = state.profile; dlg = { type: "avatar", f: { name: p.name, ...Object.fromEntries(AV_KEYS.map((k) => [k, p[k]])) } }; renderModal(); return; }
  if (D.titles !== undefined) { openDlg({ type: "titles", tab: "got" }); return; }
  if (D.badges !== undefined) { const s = compute(); openDlg({ type: "badges", sel: (state.profile.featured_badges || []).filter((id) => s.unlocked[id]) }); return; }
  if (D.equip) { equipTitle(D.equip); return; }
  if (dlg && dlg.type === "titles" && D.ttab) { dlg.tab = D.ttab; renderModal(); return; }
  if (dlg && dlg.type === "badges") {
    if (D.badge) { const i = dlg.sel.indexOf(D.badge); if (i >= 0) dlg.sel.splice(i, 1); else if (dlg.sel.length < 3) dlg.sel.push(D.badge); renderModal(); return; }
    if (t.id === "badgeSave") { state.profile.featured_badges = dlg.sel.slice(0, 3); saveProfile(); closeDlg(); toast("Insignias guardadas."); return; }
  }
  if (dlg && dlg.type === "avatar") {
    readAvatarForm();
    if (D.avicon) { dlg.f.avatar_icon = D.avicon; renderModal(); return; }
    if (D.avbg) { dlg.f.avatar_bg = D.avbg; renderModal(); return; }
    if (D.avframe) { dlg.f.avatar_frame = D.avframe; renderModal(); return; }
    if (D.avbadge) { dlg.f.avatar_badge = D.avbadge; renderModal(); return; }
  }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "avInit" && dlg && dlg.type === "avatar") {
    readAvatarForm(); const pv = document.querySelector(".av-preview"); if (pv) pv.innerHTML = avatarSVG(dlg.f, compute(), 132);
  }
});
document.addEventListener("submit", (e) => {
  if (e.target.id !== "avatarForm") return;
  e.preventDefault(); readAvatarForm();
  for (const k of AV_KEYS) state.profile[k] = dlg.f[k];
  saveProfile(); closeDlg(); toast("Avatar guardado.");
});
