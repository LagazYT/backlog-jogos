(() => {
"use strict";

/* =========================================================
   Ponte com o Android. No navegador, cai para fetch().
   ========================================================= */
const Native = window.AndroidBridge || null;
const pending = {};
let seq = 0;
window.__nativeCb = (id, ok, payload) => {
  const p = pending[id];
  delete pending[id];
  if (p) ok ? p.res(payload) : p.rej(new Error(payload || "falha"));
};
function callNative(method, ...args) {
  return new Promise((res, rej) => {
    const id = "c" + (++seq);
    pending[id] = { res, rej };
    try { Native[method](...args, id); } catch (e) { delete pending[id]; rej(e); }
  });
}
async function getText(url) {
  if (Native) return callNative("httpGet", url);
  const r = await fetch(url);
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.text();
}
const getJSON = async url => JSON.parse(await getText(url));

/* Baixa a primeira URL que for uma imagem válida e salva no celular. */
async function downloadCover(urls, key) {
  const list = (Array.isArray(urls) ? urls : [urls]).filter(Boolean);
  for (const u of list) {
    if (!Native) { if (await imageLoads(u)) return u; continue; }
    try { return await callNative("downloadImage", u, key); } catch (_) { /* próxima */ }
  }
  return null;
}
function imageLoads(src) {
  return new Promise(res => {
    const i = new Image();
    i.onload = () => res(i.naturalWidth > 40);
    i.onerror = () => res(false);
    i.src = src;
  });
}

/* =========================================================
   Armazenamento e ajustes
   ========================================================= */
const store = {
  load(k, fb) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? fb; } catch (_) { return fb; } },
  save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }
};
const SETTINGS_KEY = "backlog.settings.v1";
const DEFAULTS = { mode: "dark", theme: "arcade", defaultPlatform: "", sort: "recent", achLang: "brazilian", autoUpdate: "on" };
let settings = { ...DEFAULTS, ...store.load(SETTINGS_KEY, {}) };
const saveSettings = () => store.save(SETTINGS_KEY, settings);

let games = store.load("backlog.games.v1", []);
const saveGames = () => { store.save("backlog.games.v1", games); scheduleSync(); if (profile.shelfPublic) scheduleSocial(); };
let coverCache = store.load("backlog.coverCache.v2", {});     // chave -> file:// salvo
let wikiThumbs = store.load("backlog.wikiThumbs.v1", {});     // título da Wikipédia -> URL
let tracked = store.load("backlog.achTracked.v1", []);        // jogos com conquistas acompanhadas

const THEMES = {
  arcade:  { name: "Arcade",  desc: "Amarelo e vermelho",
    dark:  { a: "#FFD21F", a2: "#F03A2E", at: "#FFD21F", on: "#0B0B0C", on2: "#FFFFFF" },
    light: { a: "#FFCC00", a2: "#D92B20", at: "#8A6100", on: "#121212", on2: "#FFFFFF" } },
  grafite: { name: "Grafite", desc: "Azul e lilás",
    dark:  { a: "#93ABFF", a2: "#C3A4FF", at: "#93ABFF", on: "#0D1330", on2: "#1B0F33" },
    light: { a: "#3F5FE0", a2: "#7B4FD6", at: "#3F5FE0", on: "#FFFFFF", on2: "#FFFFFF" } },
  neon:    { name: "Néon",    desc: "Ciano e magenta",
    dark:  { a: "#3EE6D6", a2: "#FF4FA3", at: "#3EE6D6", on: "#04201D", on2: "#2A0718" },
    light: { a: "#0FB5A6", a2: "#E0287F", at: "#0B7F75", on: "#FFFFFF", on2: "#FFFFFF" } },
  cover:   { name: "Cor da capa", desc: "Muda com o jogo que você está jogando", dynamic: true },
  cafe:    { name: "Café",    desc: "Creme, marrom e laranja-queimado",
    dark:  { a: "#E08A3C", a2: "#C9A27A", at: "#F0A35E", on: "#1E1006", on2: "#1E1006",
             s: { bg: "#16100C", b2: "#211813", b3: "#2E221A", line: "#3B2D22", text: "#F4EADD", muted: "#BBA68F", faint: "#7F6C59" } },
    light: { a: "#C0651F", a2: "#6F4A2E", at: "#9C4F14", on: "#FFFFFF", on2: "#FFFFFF",
             s: { bg: "#F2E9DA", b2: "#FBF6EE", b3: "#E6D8C2", line: "#D9C8AE", text: "#2B1D12", muted: "#6E5A45", faint: "#9A8670" } } },
  lava:    { name: "Lava",    desc: "Preto, laranja e vermelho",
    dark:  { a: "#FF6B1A", a2: "#FF2D2D", at: "#FF8640", on: "#1A0600", on2: "#FFFFFF",
             s: { bg: "#0A0706", b2: "#160F0D", b3: "#221613", line: "#341F1A", text: "#FBEFEA", muted: "#B79C93", faint: "#7C635B" } },
    light: { a: "#EA580C", a2: "#D11F1F", at: "#B8430A", on: "#FFFFFF", on2: "#FFFFFF",
             s: { bg: "#F7EEE9", b2: "#FFFAF7", b3: "#EEDDD4", line: "#E3CBBF", text: "#22100A", muted: "#734F43", faint: "#A07E72" } } },
  sakura:  { name: "Sakura",  desc: "Rosa-claro e vinho",
    dark:  { a: "#FF9EC4", a2: "#E5668F", at: "#FFB1D0", on: "#3A0C1F", on2: "#FFFFFF",
             s: { bg: "#190F14", b2: "#24161D", b3: "#321F28", line: "#402A35", text: "#FCEFF4", muted: "#CBA5B4", faint: "#8F6F7C" } },
    light: { a: "#F27BA7", a2: "#8C1F45", at: "#B0356A", on: "#3A0C1F", on2: "#FFFFFF",
             s: { bg: "#FCEEF3", b2: "#FFFFFF", b3: "#F6DCE6", line: "#EFCAD8", text: "#3B1424", muted: "#83576B", faint: "#B08898" } } },
  dungeon: { name: "Dungeon", desc: "Dourado envelhecido e vermelho-sangue",
    dark:  { a: "#D6A84A", a2: "#C0352B", at: "#E2BA66", on: "#1E1405", on2: "#FFFFFF",
             s: { bg: "#110C08", b2: "#1C1510", b3: "#281E16", line: "#3A2B1E", text: "#EFE4CA", muted: "#B4A37F", faint: "#7C6C4F" } },
    light: { a: "#B8862B", a2: "#9E1F18", at: "#875F14", on: "#FFFFFF", on2: "#FFFFFF",
             s: { bg: "#ECE0C3", b2: "#F7EEDA", b3: "#DFCFAA", line: "#D0BC92", text: "#2A1E10", muted: "#6B5838", faint: "#97835E" } } },
  gameboy: { name: "Game Boy", desc: "Verde da telinha do portátil",
    dark:  { a: "#9BBC0F", a2: "#C6DE6A", at: "#AECD32", on: "#0F380F", on2: "#0F380F",
             s: { bg: "#0D190B", b2: "#152510", b3: "#1F3417", line: "#2B4520", text: "#D2E5A0", muted: "#93AB66", faint: "#647C45" } },
    light: { a: "#306230", a2: "#0F380F", at: "#306230", on: "#D7E6A8", on2: "#D7E6A8",
             s: { bg: "#C5D19F", b2: "#D6E0B6", b3: "#B4C388", line: "#9DAE70", text: "#0F380F", muted: "#305A30", faint: "#557A3E" } } }
};
const BASE_SURF = {
  dark: { bg: "#0b0b0c", b2: "#151517", b3: "#1f1f22", line: "#2a2a2e", text: "#f6f4ee", muted: "#a3a097", faint: "#6d6a63" },
  light: { bg: "#f2f1ed", b2: "#ffffff", b3: "#e6e4de", line: "#d9d6cd", text: "#121212", muted: "#5f5c55", faint: "#8f8b81" }
};
const SURF_VARS = { bg: "--bg", b2: "--bg-2", b3: "--bg-3", line: "--line", text: "--text", muted: "--muted", faint: "--faint" };
const hexRGB = h => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const hslHex = (h, s, l) => {
  h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l));
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return "#" + [f(0), f(8), f(4)].map(v => v.toString(16).padStart(2, "0")).join("");
};
const lumOf = hex => { const [r, g, b] = hexRGB(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };

/* Tema "Cor da capa": cores tiradas da capa do jogo do momento */
function coverPalette(c, mode) {
  const { h, s, h2 } = c;
  const sat = Math.max(.55, Math.min(.92, s));
  if (mode === "light") {
    const a = hslHex(h, sat, .44), a2 = hslHex(h2, Math.max(.5, sat - .1), .42);
    return { a, a2, at: hslHex(h, sat, .34), on: lumOf(a) > .6 ? "#111111" : "#FFFFFF", on2: lumOf(a2) > .6 ? "#111111" : "#FFFFFF",
      s: { bg: hslHex(h, .28, .94), b2: hslHex(h, .4, .985), b3: hslHex(h, .22, .88), line: hslHex(h, .18, .82), text: hslHex(h, .35, .09), muted: hslHex(h, .12, .37), faint: hslHex(h, .08, .56) } };
  }
  const a = hslHex(h, sat, .6), a2 = hslHex(h2, Math.max(.5, sat - .1), .62);
  return { a, a2, at: hslHex(h, sat, .66), on: lumOf(a) > .55 ? "#0B0B0C" : "#FFFFFF", on2: lumOf(a2) > .55 ? "#0B0B0C" : "#FFFFFF",
    s: { bg: hslHex(h, .24, .055), b2: hslHex(h, .2, .09), b3: hslHex(h, .17, .135), line: hslHex(h, .15, .19), text: hslHex(h, .25, .95), muted: hslHex(h, .12, .67), faint: hslHex(h, .08, .45) } };
}
function coverThemeGame() {
  let g = null; try { g = sessionGame(); } catch (_) {}
  if (g) return g;
  const by = st => games.filter(x => x.status === st).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
  return by("playing") || by("done") || games[0] || null;
}
let coverThemeBusy = false;
async function refreshCoverTheme(force) {
  if (settings.theme !== "cover" || coverThemeBusy) return;
  const g = coverThemeGame();
  const key = g ? g.id + "|" + (gameCovers(g)[0] || "") : "";
  const cur = settings.coverTheme;
  if (!force && cur && cur.key === key) return;
  if (!g) { settings.coverTheme = null; saveSettings(); applyTheme(); return; }
  coverThemeBusy = true;
  try {
    const img = await firstImage(gameCovers(g));
    if (!img) return;
    const cv = document.createElement("canvas"); cv.width = cv.height = 40;
    const x = cv.getContext("2d", { willReadFrequently: true });
    x.drawImage(img, 0, 0, 40, 40);
    const d = x.getImageData(0, 0, 40, 40).data;
    const bins = Array.from({ length: 24 }, () => ({ w: 0, s: 0 }));
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255;
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), l = (mx + mn) / 2, dl = mx - mn;
      if (dl < .08 || l < .12 || l > .92) continue;
      const sat = dl / (1 - Math.abs(2 * l - 1));
      let hh = mx === r ? ((gg - b) / dl) % 6 : mx === gg ? (b - r) / dl + 2 : (r - gg) / dl + 4;
      hh = (hh * 60 + 360) % 360;
      const bin = bins[Math.floor(hh / 15)], w = sat * sat * (1 - Math.abs(l - .55));
      bin.w += w; bin.s += sat * w; bin.h = (bin.h || 0) + hh * w;
    }
    const ranked = bins.map((b, i) => ({ i, ...b })).filter(b => b.w > 0).sort((a, b) => b.w - a.w);
    let h = 45, s = .8, h2 = 5;
    if (ranked.length) {
      const top = ranked[0]; h = top.h / top.w; s = top.s / top.w;
      const second = ranked.find(b => Math.min(Math.abs(b.i - top.i), 24 - Math.abs(b.i - top.i)) >= 3 && b.w > top.w * .15);
      h2 = second ? second.h / second.w : h + 150;
    }
    settings.coverTheme = { key, h, s, h2, title: g.title };
    saveSettings(); applyTheme();
    if (themeDrawer) drawThemeGrid();
  } catch (_) { /* capa sem leitura: mantém as cores anteriores */ }
  finally { coverThemeBusy = false; }
}
function themeColors(id, mode) {
  const t = THEMES[id] || THEMES.arcade;
  if (t.dynamic) return settings.coverTheme ? coverPalette(settings.coverTheme, mode) : { ...THEMES.arcade[mode] };
  return t[mode];
}
function resolvedMode() {
  if (settings.mode !== "system") return settings.mode;
  try { if (Native && Native.isSystemDark) return Native.isSystemDark() ? "dark" : "light"; } catch (_) {}
  return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
function applyTheme() {
  const mode = resolvedMode();
  const t = themeColors(settings.theme, mode);
  const r = document.documentElement;
  r.dataset.mode = mode;
  r.dataset.theme = settings.theme;
  r.style.setProperty("--accent", t.a);
  r.style.setProperty("--accent-2", t.a2);
  r.style.setProperty("--accent-text", t.at);
  r.style.setProperty("--on-accent", t.on);
  r.style.setProperty("--on-accent-2", t.on2);
  Object.entries(SURF_VARS).forEach(([k, v]) => t.s && t.s[k] ? r.style.setProperty(v, t.s[k]) : r.style.removeProperty(v));
  if (t.s) {
    const [R, G, B] = hexRGB(t.s.bg), [R3, G3, B3] = hexRGB(t.s.b3);
    r.style.setProperty("--glass", `rgba(${R}, ${G}, ${B}, ${mode === "light" ? .9 : .88})`);
    r.style.setProperty("--tint", `${R3}, ${G3}, ${B3}`);
  } else { r.style.removeProperty("--glass"); r.style.removeProperty("--tint"); }
  const bg = getComputedStyle(r).getPropertyValue("--bg").trim();
  try { Native && Native.setBars && Native.setBars(bg, mode === "light"); } catch (_) {}
}

/* Gaveta de temas */
let themeDrawer = null;
function themePreviewStyle(id, mode) {
  const t = themeColors(id, mode), sf = t.s || BASE_SURF[mode];
  return `--p-bg:${sf.bg};--p-b2:${sf.b2};--p-line:${sf.line};--p-text:${sf.text};--p-muted:${sf.muted};--p-a:${t.a};--p-a2:${t.a2};--p-on:${t.on}`;
}
function drawThemeGrid() {
  if (!themeDrawer) return;
  const mode = resolvedMode();
  themeDrawer.querySelector("#dr-mode").innerHTML = [["dark", "Escuro"], ["light", "Claro"], ["system", "Do sistema"]]
    .map(([v, l]) => `<button class="${settings.mode === v ? "is-on" : ""}" data-dm="${v}">${l}</button>`).join("");
  themeDrawer.querySelector("#dr-grid").innerHTML = Object.entries(THEMES).map(([id, t]) => {
    const on = settings.theme === id;
    const desc = t.dynamic ? (settings.coverTheme && settings.theme === "cover" ? `Agora: ${settings.coverTheme.title}` : t.desc) : t.desc;
    return `<button class="tcard ${on ? "is-on" : ""} ${t.dynamic ? "is-dyn" : ""}" data-th="${id}" style="${themePreviewStyle(id, mode)}" aria-pressed="${on}">
      <span class="tprev" aria-hidden="true">
        <span class="tp-top"><i></i><b></b></span>
        <span class="tp-row"><span class="tp-cv"></span><span class="tp-ln"><i></i><i></i></span></span>
        <span class="tp-row"><span class="tp-cv c2"></span><span class="tp-ln"><i></i><i></i></span></span>
        <span class="tp-btns"><span class="tp-btn"></span><span class="tp-pill"></span></span>
        ${t.dynamic ? `<span class="tp-badge">${ICON.star}</span>` : ""}
      </span>
      <span class="tmeta"><span class="tname">${t.name}${on ? `<span class="tcheck">${ICON.check}</span>` : ""}</span><span class="tdesc">${esc(desc)}</span></span>
    </button>`;
  }).join("");
}
function closeThemeDrawer() {
  const d = themeDrawer;
  if (!d) return;
  themeDrawer = null;
  d.classList.add("is-closing");
  setTimeout(() => { d.remove(); if (sheet.hidden) document.body.style.overflow = ""; }, 220);
  if (currentView === "settings") renderSettings();
}
function openThemeDrawer() {
  if (themeDrawer) return;
  const d = document.createElement("div");
  d.className = "drawer";
  d.innerHTML = `<div class="drawer-scrim" data-dclose></div>
    <section class="drawer-body" role="dialog" aria-modal="true" aria-label="Temas">
      <div class="drawer-grab"><span></span></div>
      <div class="drawer-head"><div><h2>Temas</h2><p>Toque para testar. Muda na hora.</p></div><button class="btn btn-primary btn-sm" data-dclose>Pronto</button></div>
      <div class="segmented" id="dr-mode"></div>
      <div class="theme-grid" id="dr-grid"></div>
    </section>`;
  document.body.appendChild(d);
  document.body.style.overflow = "hidden";
  themeDrawer = d;
  drawThemeGrid();
  d.addEventListener("click", e => {
    if (e.target.closest("[data-dclose]")) { closeThemeDrawer(); return; }
    const m = e.target.closest("[data-dm]");
    if (m) { settings.mode = m.dataset.dm; saveSettings(); applyTheme(); drawThemeGrid(); return; }
    const c = e.target.closest("[data-th]");
    if (c && c.dataset.th !== settings.theme) {
      settings.theme = c.dataset.th; saveSettings(); applyTheme(); drawThemeGrid();
      if (settings.theme === "cover") {
        if (!games.length) toast("Adicione um jogo para o tema pegar a cor da capa");
        refreshCoverTheme(true);
      }
    }
  });
  // Arrastar para baixo fecha
  const bodyEl = d.querySelector(".drawer-body");
  let y0 = null, dy = 0;
  bodyEl.addEventListener("touchstart", e => { y0 = bodyEl.scrollTop <= 0 ? e.touches[0].clientY : null; dy = 0; }, { passive: true });
  bodyEl.addEventListener("touchmove", e => {
    if (y0 == null) return;
    dy = e.touches[0].clientY - y0;
    if (dy > 0) { bodyEl.style.transition = "none"; bodyEl.style.transform = `translateY(${dy}px)`; }
  }, { passive: true });
  bodyEl.addEventListener("touchend", () => {
    if (y0 == null) return;
    bodyEl.style.transition = ""; y0 = null;
    if (dy > 110) closeThemeDrawer(); else bodyEl.style.transform = "";
  });
}
window.__onSystemTheme = () => { if (settings.mode === "system") applyTheme(); };
matchMedia("(prefers-color-scheme: light)").addEventListener?.("change", window.__onSystemTheme);

/* =========================================================
   Dados auxiliares
   ========================================================= */
const STATUSES = [
  { id: "playing", label: "Jogando",     color: "var(--st-playing)" },
  { id: "backlog", label: "Quero jogar", color: "var(--st-backlog)" },
  { id: "done",    label: "Zerado",      color: "var(--st-done)" },
  { id: "dropped", label: "Abandonado",  color: "var(--st-dropped)" }
];
const PLATFORMS = ["PC", "Xbox", "PlayStation", "Switch", "Switch 2"];
// Cores dos status, iguais em todos os temas
const STATUS_HEX = { done: "#2FBF71", playing: "#FFC72C", dropped: "#F0443A", backlog: "#4C8DFF" };
const STATUS_INK = { done: "#06210F", playing: "#2A1E00", dropped: "#FFFFFF", backlog: "#FFFFFF" };
const platLabel = p => p === "Switch" ? "Switch 1" : p;
const statusOf = id => STATUSES.find(s => s.id === id) || STATUSES[1];

const norm = s => (s || "").toLowerCase()
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/\((\d{4} )?video game\)/g, "")
  .replace(/[™®©:'’!.,\-–—]/g, " ")
  .replace(/\s+/g, " ").trim();
const cleanWikiTitle = t => t.replace(/\s*\((\d{4} )?video game\)$/i, "").trim();
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtH = h => (Math.round(h * 10) / 10).toString().replace(".", ",");
const fmtN = n => n.toLocaleString("pt-BR");
const findPopular = (title, wiki) => {
  const n = norm(title);
  return POPULAR_GAMES.find(p => norm(p.title) === n || norm(p.wiki) === n || (wiki && p.wiki === wiki));
};

/* =========================================================
   Capas: mostra a imagem da internet na hora e guarda uma
   cópia no celular em segundo plano.
   ========================================================= */
const steamBase = id => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${id}/`;
const steamCovers = id => steamArtCovers(id) || [steamBase(id) + "library_600x900.jpg", steamBase(id) + "library_600x900_2x.jpg"];
const steamHeader = id => { const a = steamArt[id]; return a && a.header ? a.header : steamBase(id) + "header.jpg"; };
const popKey = p => "pop_" + norm(p.wiki).replace(/\s/g, "_");

function popCovers(p) {
  const list = [];
  const c = coverCache[popKey(p)];
  if (c && c.startsWith("file:")) list.push(c);
  if (p.steam) list.push(...steamCovers(p.steam));
  if (wikiThumbs[p.wiki]) list.push(wikiThumbs[p.wiki]);
  return list;
}

/* opts.ck = chave de cache (salva a imagem quando carregar)
   opts.wiki = título da Wikipédia para usar como última alternativa */
const PLAT_LOGO = { PlayStation: "img/playstation.png", Xbox: "img/xbox.png" };
const PLAT_TEXT = { PC: "PC", Switch: "SWITCH", "Switch 2": "SWITCH 2" };
function platBadge(p) {
  if (!p || !(PLAT_LOGO[p] || PLAT_TEXT[p])) return "";
  const inner = PLAT_LOGO[p] ? `<img src="${PLAT_LOGO[p]}" alt="">` : `<b>${PLAT_TEXT[p]}</b>`;
  return `<span class="plat-badge plat-${p === "Switch 2" ? "switch2" : p.toLowerCase()}" aria-label="${esc(platLabel(p))}">${inner}</span>`;
}
function coverHTML(urls, title, opts = {}) {
  const list = (Array.isArray(urls) ? urls : [urls]).filter(Boolean);
  const fb = `<div class="cover-fallback">${esc(title)}</div>${opts.plat ? platBadge(opts.plat) : ""}${opts.rate ? `<span class="rate-badge" aria-label="Nota ${fmtH(clampRating(opts.rate))}">★ ${fmtH(clampRating(opts.rate))}</span>` : ""}`;
  const wikiAttr = (opts.wiki ? ` data-wiki="${esc(opts.wiki)}"` : "") + (opts.steam ? ` data-steam="${esc(opts.steam)}"` : "") + (title ? ` data-title="${esc(title)}"` : "");
  if (!list.length) return `<div class="cover"${wikiAttr}>${fb}</div>`;
  const co = /upload\.wikimedia\.org/.test(list[0]) ? ' crossorigin="anonymous"' : "";
  return `<div class="cover"${wikiAttr}>${fb}<img src="${esc(list[0])}" alt="" decoding="async" loading="${opts.eager ? "eager" : "lazy"}"${co}
    data-alts="${esc(list.slice(1).join("|"))}" ${opts.ck ? `data-ck="${esc(opts.ck)}"` : ""}
    onload="window.__coverOk(this)" onerror="window.__coverErr(this)"></div>`;
}
window.__coverOk = img => {
  img.classList.add("is-in");
  const ck = img.dataset.ck;
  if (!ck || img.src.startsWith("file:") || coverCache[ck] || !Native) return;
  coverCache[ck] = "…"; // evita baixar duas vezes
  callNative("downloadImage", img.src, ck)
    .then(local => { coverCache[ck] = local; store.save("backlog.coverCache.v2", coverCache); })
    .catch(() => { delete coverCache[ck]; });
};
window.__coverErr = img => {
  const alts = (img.dataset.alts || "").split("|").filter(Boolean);
  if (img.dataset.ck && coverCache[img.dataset.ck] && img.src === coverCache[img.dataset.ck]) {
    delete coverCache[img.dataset.ck]; // arquivo salvo sumiu
  }
  if (alts.length) {
    img.dataset.alts = alts.slice(1).join("|");
    img.removeAttribute("crossorigin");
    if (/upload\.wikimedia\.org/.test(alts[0])) img.crossOrigin = "anonymous";
    img.src = alts[0];
    return;
  }
  const w = img.parentElement && img.parentElement.dataset.wiki;
  if (w && wikiThumbs[w] && !img.dataset.triedWiki && img.src !== wikiThumbs[w]) {
    img.dataset.triedWiki = "1";
    img.crossOrigin = "anonymous";
    img.src = wikiThumbs[w];
    return;
  }
  if (rescueCover(img)) return;
  img.remove();
};

/* Busca de uma vez as capas da Wikipédia dos jogos populares (1 requisição). */
let wikiBatchDone = Object.keys(wikiThumbs).length >= POPULAR_GAMES.length - 2;
async function loadWikiThumbs() {
  if (wikiBatchDone) return;
  wikiBatchDone = true;
  try {
    const url = "https://en.wikipedia.org/w/api.php?" + new URLSearchParams({
      action: "query", format: "json", origin: "*", redirects: "1", pilimit: "50",
      titles: POPULAR_GAMES.map(p => p.wiki).join("|"),
      prop: "pageimages", piprop: "thumbnail", pithumbsize: "330", pilicense: "any"
    });
    const d = await getJSON(url);
    const alias = {};
    (d.query?.normalized || []).forEach(n => alias[n.to] = n.from);
    (d.query?.redirects || []).forEach(n => alias[n.to] = alias[n.from] || n.from);
    Object.values(d.query?.pages || {}).forEach(pg => {
      if (!pg.thumbnail) return;
      const t = POPULAR_GAMES.some(p => p.wiki === pg.title) ? pg.title : alias[pg.title];
      if (t) wikiThumbs[t] = pg.thumbnail.source;
    });
    store.save("backlog.wikiThumbs.v1", wikiThumbs);
    // Preenche capas que ficaram só com o nome
    document.querySelectorAll(".cover[data-wiki]").forEach(c => {
      if (c.querySelector("img") || !wikiThumbs[c.dataset.wiki]) return;
      const p = POPULAR_GAMES.find(x => x.wiki === c.dataset.wiki);
      c.outerHTML = coverHTML([wikiThumbs[c.dataset.wiki]], p ? p.title : "", { ck: p ? popKey(p) : "", wiki: c.dataset.wiki });
    });
  } catch (_) { wikiBatchDone = false; }
}

/* =========================================================
   Busca de jogos: Wikipédia (todas as plataformas) + Steam
   ========================================================= */
async function searchWiki(q) {
  const url = "https://en.wikipedia.org/w/api.php?" + new URLSearchParams({
    action: "query", format: "json", origin: "*",
    generator: "search", gsrsearch: `${q} hastemplate:"Infobox video game"`, gsrlimit: "14",
    prop: "pageimages|description", piprop: "thumbnail", pithumbsize: "500", pilicense: "any"
  });
  const d = await getJSON(url);
  return Object.values(d.query?.pages || {})
    .sort((a, b) => a.index - b.index)
    // tira páginas de lista/série ("Satellaview games from…", "… LCD games")
    .filter(p => !/^List of|\bgames\b|\bseries\b/i.test(p.title))
    .map(p => ({
      title: cleanWikiTitle(p.title), wiki: p.title,
      year: ((p.description || "").match(/\b(19[7-9]\d|20\d\d)\b/) || [])[0] || "",
      covers: p.thumbnail ? [p.thumbnail.source] : [], source: "Wikipédia"
    }));
}
async function searchSteam(q) {
  const d = await getJSON(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(q)}&l=portuguese&cc=BR`);
  return (d.items || []).filter(i => i.type === "app").map(i => ({
    title: i.name, year: "", steamId: i.id, covers: steamCovers(i.id), header: steamHeader(i.id), source: "Steam"
  }));
}
async function searchGames(q) {
  if (window.__PREVIEW) {
    const nq = norm(q);
    return POPULAR_GAMES.filter(p => norm(p.title).includes(nq))
      .map(p => ({ title: p.title, wiki: p.wiki, steamId: p.steam, year: String(p.year), covers: [], source: "Exemplo" }));
  }
  const [w, s] = await Promise.allSettled([searchWiki(q), searchSteam(q)]);
  if (w.status === "rejected" && s.status === "rejected") throw new Error("offline");
  const wiki = w.status === "fulfilled" ? w.value : [];
  const steam = s.status === "fulfilled" ? s.value : [];
  const byName = new Map(wiki.map(r => [norm(r.title), r]));
  const merged = [...wiki];
  for (const r of steam) {
    const twin = byName.get(norm(r.title));
    if (twin) { twin.covers.push(...r.covers); twin.steamId = r.steamId; twin.source = "Wikipédia e Steam"; }
    else merged.push(r);
  }
  const nq = norm(q);
  const score = r => { const n = norm(r.title); return n === nq ? 0 : n.startsWith(nq) ? 1 : n.includes(nq) ? 2 : 3; };
  return merged.map((r, i) => ({ r, i })).sort((a, b) => score(a.r) - score(b.r) || a.i - b.i).map(x => x.r).slice(0, 20);
}

/* =========================================================
   Ícones e componentes
   ========================================================= */
const $ = s => document.querySelector(s);
const ICON = {
  star: '<svg viewBox="0 0 24 24"><path d="M12 2.8l2.75 5.86 6.4.77-4.72 4.4 1.24 6.33L12 17.03l-5.67 3.13 1.24-6.33-4.72-4.4 6.4-.77z"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  chev: '<svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>',
  trophy: '<svg viewBox="0 0 24 24"><path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H4.5a3.5 3.5 0 0 0 3.6 4M16 6h3.5a3.5 3.5 0 0 1-3.6 4M12 13v4M8.5 20h7"/></svg>'
};

/* Notas de 0,5 a 5, de meia em meia estrela */
const clampRating = r => Math.max(0, Math.min(5, Math.round((Number(r) || 0) * 2) / 2));
function starsHTML(r, cls = "minstars", empties = false) {
  r = clampRating(r);
  if (!r) return "";
  let h = "";
  for (let i = 1; i <= 5; i++) {
    const k = r >= i ? "f" : r >= i - 0.5 ? "h" : "e";
    if (k === "e" && !empties) continue;
    h += `<i class="st ${k}">★</i>`;
  }
  return `<span class="${cls}" aria-label="${fmtH(r)} de 5 estrelas">${h}</span>`;
}
const starsText = r => { r = clampRating(r); return "★".repeat(Math.floor(r)) + (r % 1 ? "½" : ""); };
function starPickerHTML(r) {
  r = clampRating(r);
  return `<div class="stars-wrap"><div class="stars" id="f-stars">${[1, 2, 3, 4, 5].map(n => {
    const w = r >= n ? 100 : r >= n - 0.5 ? 50 : 0;
    return `<button class="star" data-v="${n}" aria-label="${n} de 5">${ICON.star}<span class="star-fill" style="--w:${w}%">${ICON.star}</span></button>`;
  }).join("")}</div><span class="star-val" id="f-star-val">${r ? fmtH(r) : ""}</span></div>
  <p class="star-hint">Toque na metade esquerda de uma estrela para dar meia.</p>`;
}
function wireStarPicker(root, get, set) {
  const box = root.querySelector("#f-stars");
  const paint = () => {
    const r = get();
    box.querySelectorAll(".star").forEach(b => { const n = +b.dataset.v; b.querySelector(".star-fill").style.setProperty("--w", (r >= n ? 100 : r >= n - 0.5 ? 50 : 0) + "%"); });
    root.querySelector("#f-star-val").textContent = r ? fmtH(r) : "";
  };
  box.addEventListener("click", e => {
    const b = e.target.closest("[data-v]");
    if (!b) return;
    const rect = b.getBoundingClientRect();
    const n = +b.dataset.v;
    const v = (e.clientX - rect.left) < rect.width / 2 ? n - 0.5 : n;
    set(clampRating(v) === get() ? 0 : clampRating(v));
    paint();
  });
}

function barsHTML(p, max) {
  const row = (label, h, cls) => `<div>
      <div class="bar-head"><span>${label}</span><b>${fmtH(h)}<small> h</small></b></div>
      <div class="track"><div class="fill ${cls}" style="width:${Math.max(3, (h / max) * 100)}%"></div></div>
    </div>`;
  return `<div class="bars">${row("História", p.main, "f-main")}${row("História + extras", p.extra, "f-extra")}${row("100%", p.full, "f-full")}</div>`;
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("is-on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("is-on"), 2300);
}
const skeletonRows = n => Array.from({ length: n }, () =>
  `<li class="row skeleton"><div class="cover"></div><div><div class="bar" style="width:70%"></div><div class="bar" style="width:40%"></div></div><span></span></li>`).join("");

/* =========================================================
   Navegação
   ========================================================= */
let currentView = "library";
function go(view) {
  currentView = view;
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("is-active", v.id === "view-" + view));
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("is-active", t.dataset.view === view));
  window.scrollTo(0, 0);
  if (view === "explore") renderExplore();
  if (view === "ach") { renderTracked(); syncSteamAchievements(); }
  if (view === "settings") renderSettings();
  if (view === "net") renderNet();
}
document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => go(t.dataset.view)));
document.addEventListener("click", e => { const g = e.target.closest("[data-goto]"); if (g) go(g.dataset.goto); });

/* =========================================================
   Biblioteca
   ========================================================= */
let libFilter = "all", libPlat = "all";
const gameCovers = g => [g.cover, g.coverRemote, ...(g.coverAlts || [])].filter((u, i, a) => u && a.indexOf(u) === i);

function sortGames(list) {
  const s = settings.sort;
  if (s === "name") return list.sort((a, b) => a.title.localeCompare(b.title, "pt-BR"));
  if (s === "rating") return list.sort((a, b) => (b.rating || 0) - (a.rating || 0) || b.updatedAt - a.updatedAt);
  return list.sort((a, b) => b.updatedAt - a.updatedAt);
}

function renderLibrary() {
  const counts = { all: games.length };
  STATUSES.forEach(s => counts[s.id] = games.filter(g => g.status === s.id).length);
  const hours = games.reduce((a, g) => a + (Number(g.hours) || 0), 0);

  renderAvatarButton();
  $("#lib-empty").hidden = games.length > 0;
  $("#lib-filters").hidden = games.length === 0;
  $("#lib-plats").hidden = games.length === 0;

  // Distribuição por status
  $("#lib-overview").innerHTML = games.length ? `<div class="overview">
      <div class="dist">${STATUSES.filter(s => counts[s.id]).map(s =>
        `<span style="flex:${counts[s.id]};background:${s.color}"></span>`).join("")}</div>
      <div class="dist-legend">${STATUSES.map(s =>
        `<span><i style="background:${s.color}"></i><b>${counts[s.id]}</b> ${s.label.toLowerCase()}</span>`).join("")}<span><b>${fmtH(hours)} h</b> registradas</span></div>
    </div>` : "";

  // Trilho "Jogando agora"
  const playing = sortGames(games.filter(g => g.status === "playing"));
  $("#lib-playing").innerHTML = playing.length && libFilter === "all" ? `
    <div class="section-label">Jogando agora <small>${playing.length}</small></div>
    <div class="rail">${playing.map(g => `<button class="rail-card" data-id="${g.id}">
        ${coverHTML(gameCovers(g), g.title, { plat: g.platform, steam: g.steamId })}
        <div class="case-title">${esc(g.title)}</div>
        <div class="case-sub">${esc(platLabel(g.platform))}${g.hours ? `, ${fmtH(g.hours)} h` : ""}</div>
      </button>`).join("")}</div>` : "";

  $("#lib-filters").innerHTML = [{ id: "all", label: "Todos" }, ...STATUSES]
    .map(s => `<button class="chip ${libFilter === s.id ? "is-on" : ""}" data-f="${s.id}">${s.label} <span class="count">${counts[s.id]}</span></button>`)
    .join("");

  // Plataformas presentes na estante
  const platOrder = [...PLATFORMS, ""];
  const platCount = {};
  games.forEach(g => { const p = PLATFORMS.includes(g.platform) ? g.platform : ""; platCount[p] = (platCount[p] || 0) + 1; });
  const plats = platOrder.filter(p => platCount[p]);
  if (libPlat !== "all" && !platCount[libPlat]) libPlat = "all";
  $("#lib-plats").hidden = plats.length < 2;
  $("#lib-plats").innerHTML = [["all", "Todas", games.length], ...plats.map(p => [p, p ? platLabel(p) : "Sem plataforma", platCount[p]])]
    .map(([v, l, c]) => `<button class="chip chip-plat ${libPlat === v ? "is-on" : ""}" data-pl="${v}">${l} <span class="count">${c}</span></button>`).join("");

  const inPlat = g => libPlat === "all" || (libPlat === "" ? !PLATFORMS.includes(g.platform) : g.platform === libPlat);
  const list = sortGames(games.filter(g => inPlat(g) && (libFilter === "all" ? g.status !== "playing" || !playing.length : g.status === libFilter)));
  const caseHTML = g => {
    const st = statusOf(g.status);
    const stars = "";
    return `<button class="case" data-id="${g.id}">
      ${coverHTML(gameCovers(g), g.title, { plat: g.platform, steam: g.steamId, rate: g.rating })}
      <div class="case-title">${esc(g.title)}</div>
      <div class="case-sub"><span class="pip" style="background:${st.color}"></span>${esc(st.label)} ${stars}</div>
    </button>`;
  };
  const sectionHead = (label, n, first) => `<div class="section-label shelf-head" style="grid-column:1/-1;margin:${first ? "6px" : "18px"} 0 0">${label} <small>${n}</small></div>`;
  let gridHTML = "";
  if (!list.length) gridHTML = `<p class="status-line" style="grid-column:1/-1;padding:0">Nenhum jogo com esse filtro.</p>`;
  else if (libPlat === "all" && plats.length > 1) {
    // Separado por plataforma: cada uma com seu bloco
    let first = true;
    platOrder.forEach(p => {
      const part = list.filter(g => (PLATFORMS.includes(g.platform) ? g.platform : "") === p);
      if (!part.length) return;
      const src = p === "PC" && part.some(g => g.sources && g.sources.steam) ? " e Steam" : "";
      gridHTML += sectionHead(esc(p ? platLabel(p) + src : "Sem plataforma"), part.length, first) + part.map(caseHTML).join("");
      first = false;
    });
  } else {
    gridHTML = (libFilter === "all" && playing.length ? sectionHead("Na estante", list.length, true) : "") + list.map(caseHTML).join("");
  }
  $("#lib-grid").innerHTML = games.length ? gridHTML : "";
  renderLibExtras();
  if (settings.theme === "cover") setTimeout(() => refreshCoverTheme(), 0);
}
$("#lib-filters").addEventListener("click", e => {
  const c = e.target.closest("[data-f]");
  if (c) { libFilter = c.dataset.f; renderLibrary(); }
});
$("#lib-plats").addEventListener("click", e => {
  const c = e.target.closest("[data-pl]");
  if (c) { libPlat = c.dataset.pl; renderLibrary(); }
});
$("#view-library").addEventListener("click", e => {
  const c = e.target.closest("[data-id]");
  if (c) openGame(games.find(g => g.id === c.dataset.id));
});

/* =========================================================
   Buscar
   ========================================================= */
let lastResults = [];
let searchToken = 0;
async function runSearch(q) {
  q = q.trim();
  const status = $("#search-status"), list = $("#search-results");
  if (q.length < 2) { status.textContent = ""; list.innerHTML = ""; return; }
  const token = ++searchToken;
  status.textContent = "";
  list.innerHTML = skeletonRows(5);
  try {
    const res = await searchGames(q);
    if (token !== searchToken) return;
    lastResults = res;
    status.textContent = res.length ? "" : `Nenhum jogo encontrado para “${q}”. Confira a grafia ou tente o nome em inglês.`;
    list.innerHTML = res.map((r, i) => {
      const added = games.some(g => norm(g.title) === norm(r.title));
      return `<li class="row" data-i="${i}">
        ${coverHTML(r.covers, r.title, { steam: r.steamId })}
        <div><div class="row-title">${esc(r.title)}</div><div class="row-sub">${esc([r.year, r.source].filter(Boolean).join(", "))}</div></div>
        <span class="row-add ${added ? "is-added" : ""}">${added ? ICON.check : ICON.plus}</span>
      </li>`;
    }).join("");
  } catch (_) {
    if (token !== searchToken) return;
    list.innerHTML = "";
    status.textContent = "Sem conexão com a internet. Conecte-se e tente de novo.";
  }
}
let debounce;
$("#search-input").addEventListener("input", e => { clearTimeout(debounce); debounce = setTimeout(() => runSearch(e.target.value), 380); });
$("#search-form").addEventListener("submit", e => {
  e.preventDefault(); clearTimeout(debounce); $("#search-input").blur(); runSearch($("#search-input").value);
});
$("#search-results").addEventListener("click", e => {
  const li = e.target.closest("[data-i]");
  if (!li) return;
  const r = lastResults[+li.dataset.i];
  const existing = games.find(g => norm(g.title) === norm(r.title));
  existing ? openGame(existing) : openGame(null, r);
});
function refreshSearchMarks() {
  document.querySelectorAll("#search-results [data-i]").forEach(li => {
    const r = lastResults[+li.dataset.i];
    const added = games.some(g => norm(g.title) === norm(r.title));
    const b = li.querySelector(".row-add");
    b.classList.toggle("is-added", added);
    b.innerHTML = added ? ICON.check : ICON.plus;
  });
}

/* =========================================================
   Explorar: em alta agora + tempo para zerar
   ========================================================= */
let exploreSeg = "trending";
$("#explore-seg").addEventListener("click", e => {
  const b = e.target.closest("[data-seg]");
  if (!b) return;
  exploreSeg = b.dataset.seg;
  renderExplore();
});
function renderExplore() {
  document.querySelectorAll("#explore-seg [data-seg]").forEach(b => b.classList.toggle("is-on", b.dataset.seg === exploreSeg));
  $("#explore-trending").hidden = exploreSeg !== "trending";
  $("#explore-hltb").hidden = exploreSeg !== "hltb";
  exploreSeg === "trending" ? renderTrending() : renderHltb();
  loadWikiThumbs();
}

/* =========================================================
   Explorar: catálogo sem limite
   "Em alta agora": jogos single player mais jogados da Steam, página por página.
   "Tempo pra zerar": HowLongToBeat (busca interna do site, não oficial).
   ========================================================= */
const HLTB = "https://howlongtobeat.com";
const HLTB_PLAT = { PC: "PC", PlayStation: "PlayStation 5", Xbox: "Xbox Series X/S", Switch: "Nintendo Switch", "Switch 2": "Nintendo Switch 2" };
let hltbToken = null, hltbTokenAt = 0;
const hltbHeaders = () => ({ "Content-Type": "application/json", "Accept": "application/json", "Referer": HLTB + "/", "Origin": HLTB });
async function hltbInit(force) {
  if (hltbToken && !force && Date.now() - hltbTokenAt < 10 * 60 * 1000) return hltbToken;
  const r = await http("GET", `${HLTB}/api/search/site/init?t=${Date.now()}`, { headers: hltbHeaders() });
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  hltbToken = JSON.parse(r.body).token; hltbTokenAt = Date.now();
  return hltbToken;
}
const hrs = s => Math.round((s || 0) / 360) / 10;
function hltbItem(x) {
  const main = hrs(x.comp_main), extra = hrs(x.comp_plus) || main, full = hrs(x.comp_100) || extra;
  return {
    src: "hltb", id: x.game_id, title: x.game_name, year: x.release_world ? String(x.release_world) : "",
    sp: x.comp_lvl_sp === 1, main, extra: Math.max(extra, main), full: Math.max(full, extra, main),
    platforms: (x.profile_platform || "").split(", ").filter(Boolean),
    covers: x.game_image ? [`${HLTB}/games/${encodeURIComponent(x.game_image)}?width=300`] : [],
    playing: x.count_playing || 0
  };
}
async function hltbSearch(o = {}, retry) {
  const tok = await hltbInit(retry);
  const payload = {
    searchType: "games", searchTerms: o.terms || [], searchPage: o.page || 1, size: 20,
    searchOptions: {
      games: {
        userId: 0, platform: o.platform ? { mode: "include", values: [o.platform] } : { mode: "include", values: [] },
        sortCategory: o.sort || "popular", rangeCategory: "main",
        rangeTime: { min: o.min ?? null, max: o.max ?? null },
        gameplay: { perspective: { mode: "include", values: [] }, flow: { mode: "include", values: [] }, genre: { mode: "include", values: [] } },
        year: { mode: "include", values: [] }, modifier: ""
      },
      users: { sortCategory: "postcount" }, lists: { sortCategory: "follows" }, filter: "", sort: 0, randomizer: 0
    },
    useCache: true
  };
  const r = await http("POST", `${HLTB}/api/search/site`, { headers: { ...hltbHeaders(), "x-auth-token": tok }, body: JSON.stringify(payload) });
  if (r.status === 403 && !retry) return hltbSearch(o, true);
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  const d = JSON.parse(r.body);
  const items = (d.data || []).filter(x => x.game_type === "game" && x.comp_main > 0).map(hltbItem);
  items.forEach(rememberTimes);
  return { total: d.count || 0, pages: d.pageTotal || 0, items };
}

/* Tempos guardados por nome, para mostrar em qualquer lugar sem buscar de novo */
let timesCache = store.load("backlog.times.v1", {});
function rememberTimes(it) {
  timesCache[norm(it.title)] = { main: it.main, extra: it.extra, full: it.full, at: Date.now() };
  const keys = Object.keys(timesCache);
  if (keys.length > 600) keys.sort((a, b) => timesCache[a].at - timesCache[b].at).slice(0, keys.length - 600).forEach(k => delete timesCache[k]);
  clearTimeout(rememberTimes.t);
  rememberTimes.t = setTimeout(() => store.save("backlog.times.v1", timesCache), 800);
}
function knownTimes(title, wiki) {
  const p = findPopular(title, wiki);
  if (p) return p;
  return timesCache[norm(title)] || null;
}
const triedTimes = new Set();
async function fetchTimes(title) {
  const k = norm(title);
  const known = knownTimes(title);
  if (known) return known;
  if (triedTimes.has(k)) return null;
  triedTimes.add(k);
  try {
    const terms = cleanWikiTitle(title).replace(/[™®©]/g, "").split(/\s+/).filter(Boolean);
    const r = await hltbSearch({ terms });
    const hit = r.items.find(x => norm(x.title) === k) || r.items.find(x => norm(x.title).startsWith(k)) || r.items[0];
    if (!hit) return null;
    const t = { main: hit.main, extra: hit.extra, full: hit.full, at: Date.now() };
    timesCache[k] = t; store.save("backlog.times.v1", timesCache);
    return t;
  } catch (_) { triedTimes.delete(k); return null; }
}
function timesPanelHTML(p) {
  return `<div class="panel">
    <span class="field-label">Tempo médio para zerar</span>
    ${barsHTML(p, Math.max(p.full, p.extra, p.main))}
    <p class="panel-note" id="compare" hidden></p>
  </div>`;
}

/* --- Rolagem infinita --- */
function infinite(listEl, loadMore) {
  const old = listEl.parentElement.querySelector(".sentinel");
  if (old) old.remove();
  const s = document.createElement("div");
  s.className = "sentinel";
  s.innerHTML = `<span class="ptr-spin"></span>`;
  listEl.after(s);
  let busy = false, done = false;
  const io = new IntersectionObserver(async es => {
    if (!es[0].isIntersecting || busy || done) return;
    busy = true;
    try { done = !(await loadMore()); } catch (_) { done = true; s.innerHTML = `<button class="link-btn" type="button">Tentar carregar mais</button>`; s.querySelector("button").onclick = () => { s.innerHTML = `<span class="ptr-spin"></span>`; done = false; busy = false; io.unobserve(s); io.observe(s); }; }
    busy = false;
    if (done && !s.querySelector("button")) s.remove();
    else if (!done) { io.unobserve(s); io.observe(s); }
  }, { rootMargin: "600px" });
  io.observe(s);
  return () => { io.disconnect(); s.remove(); };
}

/* --- Em alta agora (Steam) --- */
let trend = { page: 0, items: [], stop: null, players: store.load("backlog.players.v2", {}) };
function steamRowsFrom(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return [...doc.querySelectorAll("a[data-ds-appid]")].map(a => ({
    src: "steam", steam: +String(a.getAttribute("data-ds-appid")).split(",")[0],
    title: (a.querySelector(".title") || {}).textContent || "",
    year: (((a.querySelector(".search_released") || {}).textContent || "").match(/\d{4}/) || [""])[0]
  })).filter(x => x.steam && x.title);
}
async function trendingPage() {
  const start = trend.page * 25;
  const d = await getJSON(`https://store.steampowered.com/search/results/?query=&start=${start}&count=25&category1=998&category2=2&filter=mostplayed&infinite=1&cc=BR&l=portuguese`);
  const rows = steamRowsFrom(d.results_html || "").filter(r => !trend.items.some(x => x.steam === r.steam));
  await steamAssets(rows.map(r => r.steam));
  rows.forEach(r => { r.covers = [...steamCovers(r.steam), steamHeader(r.steam)]; r.players = trend.players[r.steam] || 0; });
  // Números de jogadores chegam depois, sem segurar a lista
  Promise.allSettled(rows.map(r => getJSON(`https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${r.steam}`)
    .then(j => {
      r.players = j.response?.player_count ?? 0; trend.players[r.steam] = r.players;
      const el = document.querySelector(`#trending-list [data-steam="${r.steam}"] .row-sub`);
      if (el && r.players) el.innerHTML = `<span class="live">${fmtN(r.players)} jogando agora</span>`;
    }))).then(() => store.save("backlog.players.v2", trend.players));
  trend.page++;
  trend.items.push(...rows);
  return { rows, more: rows.length > 0 && start + 25 < (d.total_count || 0) };
}
function trendRowHTML(r, i) {
  const t = knownTimes(r.title);
  return `<li><button class="row rank-row" data-ti="${i}" data-steam="${r.steam}">
    <span class="rank">${i + 1}</span>
    ${coverHTML(r.covers, r.title, { steam: r.steam })}
    <div>
      <div class="row-title">${esc(r.title)}</div>
      <div class="row-sub">${r.players ? `<span class="live">${fmtN(r.players)} jogando agora</span>` : esc(r.year)}</div>
    </div>
    ${t ? `<span class="pill">${fmtH(t.main)} h</span>` : `<span></span>`}
  </button></li>`;
}
async function renderTrending(reset) {
  const list = $("#trending-list");
  if (reset || !trend.items.length) {
    if (trend.stop) trend.stop();
    trend = { page: 0, items: [], stop: null, players: trend.players };
    list.innerHTML = skeletonRows(6);
    try {
      const { more } = await trendingPage();
      list.innerHTML = trend.items.map(trendRowHTML).join("");
      $("#explore-trending .lede").textContent = "Jogos com modo single player que mais gente está jogando agora na Steam. Role para ver mais.";
      if (more) trend.stop = infinite(list, async () => {
        const n = trend.items.length;
        const r = await trendingPage();
        list.insertAdjacentHTML("beforeend", r.rows.map((x, i) => trendRowHTML(x, n + i)).join(""));
        return r.more;
      });
    } catch (_) {
      // Sem internet: usa a lista que vem no app
      const data = playersCache.data || {};
      const ranked = POPULAR_GAMES.filter(p => p.steam).sort((a, b) => (data[b.steam] || 0) - (data[a.steam] || 0));
      trend.items = ranked.map(p => ({ src: "steam", steam: p.steam, title: p.title, year: String(p.year), players: data[p.steam] || 0, covers: popCovers(p), pop: p }));
      list.innerHTML = trend.items.map(trendRowHTML).join("");
      $("#explore-trending .lede").textContent = window.__PREVIEW ? "Prévia sem conexão com a Steam: mostrando a lista que vem no app." : "Sem conexão com a Steam agora. Mostrando a lista que vem no app. Puxe para baixo para tentar de novo.";
    }
  }
}
let playersCache = store.load("backlog.players.v1", { at: 0, data: {} });
$("#trending-list").addEventListener("click", e => {
  const b = e.target.closest("[data-ti]");
  if (b) openCatalog(trend.items[+b.dataset.ti]);
});

/* --- Tempo pra zerar (HowLongToBeat) --- */
const HLTB_RANGES = [["any", "Mais populares", null, null], ["s", "Até 10 h", null, 10], ["m", "10 a 30 h", 10, 30], ["l", "30 a 60 h", 30, 60], ["xl", "Mais de 60 h", 60, null]];
let hl = { range: "any", platform: "", q: "", page: 0, items: [], stop: null };
function hltbRowHTML(p, i) {
  return `<li><button class="hltb-item" data-hi="${i}">
    ${coverHTML(p.covers, p.title)}
    <div>
      <div class="hltb-title">${esc(p.title)}</div>
      <div class="hltb-sub">${[p.year, p.platforms.slice(0, 3).join(", ")].filter(Boolean).map(esc).join(", ")}</div>
      ${barsHTML(p, 120)}
    </div></button></li>`;
}
function hltbQuery(page) {
  const r = HLTB_RANGES.find(x => x[0] === hl.range);
  return { terms: hl.q ? hl.q.split(/\s+/) : [], page, min: hl.q ? null : r[2], max: hl.q ? null : r[3], platform: hl.q ? "" : HLTB_PLAT[hl.platform] || "" };
}
async function hltbPage() {
  const res = await hltbSearch(hltbQuery(hl.page + 1));
  hl.page++;
  const rows = res.items.filter(x => (hl.q || x.sp) && !hl.items.some(y => y.id === x.id));
  hl.items.push(...rows);
  return { rows, more: hl.page < res.pages };
}
async function renderHltb(reset) {
  $("#hltb-sort").innerHTML = HLTB_RANGES.map(([id, l]) => `<button class="chip ${hl.range === id ? "is-on" : ""}" data-s="${id}">${l}</button>`).join("");
  $("#hltb-plat").innerHTML = [["", "Todas"], ...PLATFORMS.map(p => [p, platLabel(p)])].map(([v, l]) => `<button class="chip ${hl.platform === v ? "is-on" : ""}" data-pl="${v}">${l}</button>`).join("");
  $("#hltb-sort").hidden = $("#hltb-plat").hidden = !!hl.q;
  if (!reset && hl.items.length) return;
  const list = $("#hltb-list");
  if (hl.stop) hl.stop();
  hl = { ...hl, page: 0, items: [], stop: null };
  list.innerHTML = skeletonRows(5);
  try {
    const { more } = await hltbPage();
    list.innerHTML = hl.items.length ? hl.items.map(hltbRowHTML).join("") : `<p class="status-line" style="padding:0">Nenhum jogo encontrado${hl.q ? ` para “${esc(hl.q)}”` : ""}.</p>`;
    $("#hltb-note").textContent = "Dados do HowLongToBeat, média da comunidade em horas. Role para ver mais.";
    if (more) hl.stop = infinite(list, async () => {
      const n = hl.items.length;
      const r = await hltbPage();
      list.insertAdjacentHTML("beforeend", r.rows.map((x, i) => hltbRowHTML(x, n + i)).join(""));
      return r.more;
    });
  } catch (_) {
    hl.items = POPULAR_GAMES.filter(p => !hl.q || norm(p.title).includes(norm(hl.q))).map(p => ({ ...p, src: "local", covers: popCovers(p), year: String(p.year) }));
    list.innerHTML = hl.items.map(hltbRowHTML).join("");
    $("#hltb-note").textContent = window.__PREVIEW ? "Prévia sem conexão: mostrando a lista que vem no app." : "Sem conexão com o HowLongToBeat agora. Mostrando a lista que vem no app. Puxe para baixo para tentar de novo.";
  }
}
$("#hltb-sort").addEventListener("click", e => { const c = e.target.closest("[data-s]"); if (c) { hl.range = c.dataset.s; renderHltb(true); } });
$("#hltb-plat").addEventListener("click", e => { const c = e.target.closest("[data-pl]"); if (c) { hl.platform = c.dataset.pl; renderHltb(true); } });
$("#hltb-list").addEventListener("click", e => { const b = e.target.closest("[data-hi]"); if (b) openCatalog(hl.items[+b.dataset.hi]); });
let hlDeb;
$("#hltb-q").addEventListener("input", e => { clearTimeout(hlDeb); hlDeb = setTimeout(() => { hl.q = e.target.value.trim(); renderHltb(true); }, 450); });
$("#hltb-form").addEventListener("submit", e => { e.preventDefault(); clearTimeout(hlDeb); $("#hltb-q").blur(); hl.q = $("#hltb-q").value.trim(); renderHltb(true); });

/* --- Ficha de um jogo do catálogo --- */
async function openCatalog(it, back) {
  if (!it) return;
  if (it.pop) return openPopular(it.pop);
  const owned = games.find(g => norm(g.title) === norm(it.title));
  const t0 = it.main ? it : knownTimes(it.title);
  const players = it.steam ? (it.players || trend.players[it.steam]) : 0;
  showSheet(`
    <div class="sheet-top"><button class="icon-btn" data-back aria-label="${back ? "Voltar" : "Fechar"}">${back ? ICON.back : ICON.close}</button></div>
    <div class="hero">
      ${coverHTML(it.covers || [], it.title)}
      <div>
        <h2 class="hero-title">${esc(it.title)}</h2>
        <div class="hero-sub">${[it.year, (it.platforms || []).slice(0, 4).join(", ")].filter(Boolean).map(esc).join("<br>")}</div>
        ${players ? `<div class="hero-sub"><span class="live">${fmtN(players)} jogando agora</span></div>` : ""}
      </div>
    </div>
    <div id="cat-times">${t0 ? timesPanelHTML(t0) : `<div class="panel"><span class="field-label">Tempo médio para zerar</span><p class="panel-note" style="margin:0">Procurando no HowLongToBeat…</p></div>`}</div>
    <div class="actions">
      <button class="btn ${owned ? "btn-ghost" : "btn-primary"}" id="cat-add">${owned ? "Abrir na minha estante" : "Adicionar à estante"}</button>
      ${it.steam ? `<button class="btn btn-ghost" id="cat-ach">${ICON.trophy}Ver conquistas</button>` : ""}
    </div>`, back);
  const reopen = () => openCatalog(it, back);
  body.querySelector("#cat-add").onclick = () => owned ? openGame(owned, null, reopen)
    : openGame(null, { title: it.title, year: it.year || "", covers: it.covers || [], steamId: it.steam }, reopen);
  const a = body.querySelector("#cat-ach");
  if (a) a.onclick = () => openAchievements(it.steam, it.title, reopen);
  if (!t0) {
    const t = await fetchTimes(it.title);
    const box = body.querySelector("#cat-times");
    if (box) box.innerHTML = t ? timesPanelHTML(t) : `<div class="panel"><span class="field-label">Tempo médio para zerar</span><p class="panel-note" style="margin:0">O HowLongToBeat ainda não tem tempo para esse jogo.</p></div>`;
  }
}

/* =========================================================
   Folha (tela por cima) com voltar
   ========================================================= */
const sheet = $("#sheet"), body = $("#sheet-body");
let sheetBack = null, sheetReload = null;

function showSheet(html, back, reload) {
  sheetBack = back || null;
  sheetReload = reload || null;
  body.innerHTML = html;
  sheet.hidden = false;
  sheet.classList.remove("is-closing");
  body.scrollTop = 0;
  document.body.style.overflow = "hidden";
  const img = body.querySelector(".hero img, .banner img");
  if (img) tintFrom(img); else body.style.setProperty("--tint", getComputedStyle(document.documentElement).getPropertyValue("--tint"));
  body.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", closeSheet));
  body.querySelectorAll("[data-back]").forEach(b => b.addEventListener("click", () => sheetBack ? sheetBack() : closeSheet()));
}
function closeSheet() {
  if (sheet.hidden) return;
  sheet.classList.add("is-closing");
  setTimeout(() => {
    sheet.hidden = true;
    sheet.classList.remove("is-closing");
    document.body.style.overflow = "";
    body.innerHTML = "";
    sheetBack = null; sheetReload = null;
  }, 170);
}
sheet.querySelector(".sheet-scrim").addEventListener("click", closeSheet);

function tintFrom(img) {
  const light = document.documentElement.dataset.mode === "light";
  const apply = () => {
    try {
      const c = document.createElement("canvas");
      c.width = c.height = 16;
      const x = c.getContext("2d", { willReadFrequently: true });
      x.drawImage(img, 0, 0, 16, 16);
      const d = x.getImageData(0, 0, 16, 16).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const w = 1 + (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2])) / 40;
        r += d[i] * w; g += d[i + 1] * w; b += d[i + 2] * w; n += w;
      }
      r /= n; g /= n; b /= n;
      const mix = (v, k, t) => Math.round(v * k + t * (1 - k));
      body.style.setProperty("--tint", light
        ? `${mix(r, .35, 255)}, ${mix(g, .35, 255)}, ${mix(b, .35, 255)}`
        : `${Math.round(r * .5)}, ${Math.round(g * .5)}, ${Math.round(b * .5)}`);
    } catch (_) { /* imagem sem permissão de leitura: mantém o fundo neutro */ }
  };
  img.complete && img.naturalWidth ? apply() : img.addEventListener("load", apply, { once: true });
}

/* =========================================================
   Jogo: adicionar (resultado de busca) ou editar
   ========================================================= */
function openGame(game, result, back) {
  const isNew = !game;
  const draft = isNew
    ? { title: result.title, year: result.year, covers: result.covers || [], wiki: result.wiki, steamId: result.steamId,
        platform: settings.defaultPlatform, status: "backlog", rating: 0, review: "", hours: "" }
    : { ...game };
  let pop = knownTimes(draft.title, draft.wiki);
  const covers = isNew ? draft.covers : gameCovers(game);
  const steamId = draft.steamId || (pop && pop.steam);

  showSheet(`
    <div class="sheet-top">
      <button class="icon-btn" data-back aria-label="Voltar">${back ? ICON.back : ICON.close}</button>
      ${isNew ? "" : `<button class="btn btn-danger" id="del">Remover</button>`}
    </div>
    <div class="hero">
      ${coverHTML(covers, draft.title, { eager: true, steam: draft.steamId || (pop && pop.steam) })}
      <div>
        <h2 class="hero-title">${esc(draft.title)}</h2>
        <div class="hero-sub">${esc(draft.year || "")}</div>
        ${!isNew && game.sources ? `<div class="src-tags">${Object.entries(game.sources).map(([k, v]) =>
          `<span class="src-tag">${esc((PLATFORM_INFO[k] || {}).name || k)}${v.minutes ? `, ${fmtH(Math.round(v.minutes / 6) / 10)} h` : ""}${v.ach && v.ach.total ? `, ${v.ach.done}/${v.ach.total}` : ""}</span>`).join("")}</div>` : ""}
        ${isNew ? "" : `<button class="link-btn" id="swap">Trocar capa</button>`}
      </div>
    </div>
    ${isNew ? "" : sessionBtnHTML(game)}

    <div class="field">
      <span class="field-label">Onde você jogou</span>
      <div class="seg" id="f-platform">${PLATFORMS.map(p =>
        `<button class="chip ${draft.platform === p ? "is-on" : ""}" data-v="${p}">${platLabel(p)}</button>`).join("")}</div>
    </div>

    <div class="field">
      <span class="field-label">Status</span>
      <div class="seg" id="f-status">${STATUSES.map(s =>
        `<button class="chip ${draft.status === s.id ? "is-on" : ""}" data-v="${s.id}"><span class="pip" style="background:${s.color}"></span>${s.label}</button>`).join("")}</div>
    </div>

    <div class="field">
      <span class="field-label">Sua nota</span>
      ${starPickerHTML(draft.rating)}
    </div>

    <div class="field">
      <span class="field-label" id="hours-label">${draft.status === "done" ? "Horas para zerar" : "Horas jogadas"}</span>
      <div class="hours-field">
        <div class="stepper">
          <button data-step="-1" aria-label="Menos uma hora">−</button>
          <input id="f-hours" type="number" inputmode="decimal" min="0" step="0.5" placeholder="0" value="${esc(draft.hours)}">
          <button data-step="1" aria-label="Mais uma hora">+</button>
        </div>
        <span class="hours-hint">horas</span>
      </div>
    </div>

    <div class="field" id="done-field" ${draft.status === "done" ? "" : "hidden"}>
      <label class="field-label" for="f-done">Zerado em</label>
      <input class="text-input date-input" id="f-done" type="date" max="${isoDate(Date.now())}" value="${draft.doneAt ? isoDate(draft.doneAt) : ""}">
    </div>

    <div class="field">
      <label class="field-label" for="f-review">Sua análise</label>
      <textarea class="review" id="f-review" placeholder="O que achou da história, da jogabilidade, do final…">${esc(draft.review)}</textarea>
    </div>

    ${socialReady() ? `<div class="panel net-share">
      <div class="switch-row">
        <div><b>Publicar na rede</b><span>Sua nota e análise aparecem para outras pessoas.</span></div>
        <button class="switch ${draft.shared !== false ? "is-on" : ""}" id="f-shared" role="switch" aria-checked="${draft.shared !== false}" aria-label="Publicar na rede"></button>
      </div>
      <button class="chip ${draft.spoiler ? "is-on" : ""}" id="f-spoiler" style="margin-top:12px">Minha análise tem spoiler</button>
      <p class="panel-note" id="net-sum" style="margin-top:12px">Carregando o que a rede achou…</p>
    </div>` : ""}

    <div id="times-panel">${pop ? timesPanelHTML(pop) : ""}</div>

    <div class="actions">
      <button class="btn btn-primary" id="save">${isNew ? "Adicionar à biblioteca" : "Salvar alterações"}</button>
      ${isNew ? "" : `<div class="two-btns"><button class="btn btn-ghost" id="see-ach">${ICON.trophy}Conquistas</button><button class="btn btn-ghost" id="share-card">${SHARE}Compartilhar</button></div>
      <button class="btn btn-ghost" id="to-list">${LIST_ICO}Colocar em uma lista</button>`}
    </div>`, back);

  const compare = () => {
    const el = body.querySelector("#compare");
    if (!el) return;
    const h = parseFloat(draft.hours);
    el.hidden = !(draft.status === "done" && h);
    if (el.hidden) return;
    const diff = h - pop.main;
    el.textContent = Math.abs(diff) < 1
      ? `Você zerou em ${fmtH(h)} h, na média da história principal.`
      : `Você zerou em ${fmtH(h)} h, ${fmtH(Math.abs(diff))} h ${diff > 0 ? "acima" : "abaixo"} da média da história principal.`;
  };
  compare();
  if (!pop) fetchTimes(draft.title).then(t => {
    const tp = body.querySelector("#times-panel");
    if (!t || !tp || !tp.isConnected) return;
    pop = t; tp.innerHTML = timesPanelHTML(t); compare();
  });

  const seg = (sel, key, after) => body.querySelector(sel).addEventListener("click", e => {
    const b = e.target.closest("[data-v]");
    if (!b) return;
    draft[key] = draft[key] === b.dataset.v && key === "platform" ? "" : b.dataset.v;
    b.parentElement.querySelectorAll("[data-v]").forEach(x => x.classList.toggle("is-on", x.dataset.v === draft[key]));
    after && after();
  });
  seg("#f-platform", "platform");
  seg("#f-status", "status", () => {
    body.querySelector("#hours-label").textContent = draft.status === "done" ? "Horas para zerar" : "Horas jogadas";
    const df = body.querySelector("#done-field"), di = body.querySelector("#f-done");
    df.hidden = draft.status !== "done";
    if (draft.status === "done" && !di.value) di.value = isoDate(Date.now());
    compare();
  });
  const doneInput = body.querySelector("#f-done");
  doneInput.addEventListener("change", () => {
    const v = doneInput.value;
    draft.doneAt = v ? new Date(v + "T12:00:00").getTime() : null;
  });
  const sw = body.querySelector("#f-shared");
  if (sw) sw.onclick = () => { draft.shared = draft.shared === false; sw.classList.toggle("is-on", draft.shared !== false); sw.setAttribute("aria-checked", draft.shared !== false); };
  const sp = body.querySelector("#f-spoiler");
  if (sp) sp.onclick = () => { draft.spoiler = !draft.spoiler; sp.classList.toggle("is-on", draft.spoiler); };
  const ns = body.querySelector("#net-sum");
  if (ns) netGameSummary(draft.title).then(sum => {
    if (!ns.isConnected) return;
    const others = sum.items.filter(r => r.uid !== auth.uid);
    if (!others.length) { ns.textContent = "Ninguém mais avaliou esse jogo na rede ainda."; return; }
    const rated = others.filter(r => r.rating), avg = rated.length ? rated.reduce((a, r) => a + r.rating, 0) / rated.length : 0;
    ns.innerHTML = `${avg ? `Média da rede: <b>${fmtH(Math.round(avg * 10) / 10)}</b> ${starsHTML(Math.round(avg * 2) / 2)}, ` : ""}${others.length} ${others.length === 1 ? "avaliação" : "avaliações"}. <button class="link-btn" id="net-see" style="margin:0">Ver</button>`;
    ns.querySelector("#net-see").onclick = () => openNetGame(keyOf(draft.title), draft.title, safeImg(covers[0]) || safeImg(covers[1]) || "", () => game ? openGame(game, null, back) : openGame(null, result, back));
  }).catch(() => { if (ns.isConnected) ns.textContent = ""; });
  wireStarPicker(body, () => clampRating(draft.rating), v => { draft.rating = v; });
  const hoursInput = body.querySelector("#f-hours");
  hoursInput.addEventListener("input", () => { draft.hours = hoursInput.value; compare(); });
  body.querySelectorAll("[data-step]").forEach(b => b.addEventListener("click", () => {
    const v = Math.max(0, (parseFloat(hoursInput.value) || 0) + +b.dataset.step);
    hoursInput.value = v; draft.hours = String(v); compare();
  }));
  const rv = body.querySelector("#f-review");
  const grow = () => { rv.style.height = "auto"; rv.style.height = Math.max(130, rv.scrollHeight + 2) + "px"; };
  rv.addEventListener("input", e => { draft.review = e.target.value; grow(); });
  setTimeout(grow, 0);

  body.querySelector("#save").addEventListener("click", () => {
    if (!draft.platform) { toast("Escolha a plataforma em que você jogou"); return; }
    if (isNew) {
      const g = {
        id: "g" + Date.now().toString(36), title: draft.title, year: draft.year, wiki: draft.wiki || "",
        steamId: steamId || null, cover: "", coverRemote: draft.covers[0] || "", coverAlts: draft.covers.slice(1),
        platform: draft.platform, status: draft.status, rating: draft.rating, review: draft.review.trim(),
        hours: draft.hours, addedAt: Date.now(), updatedAt: Date.now(),
        doneAt: draft.status === "done" ? (draft.doneAt || Date.now()) : null,
        shared: socialReady() ? draft.shared !== false : undefined, spoiler: !!draft.spoiler, history: []
      };
      logEvent(g, "added");
      if (g.status !== "backlog") logEvent(g, "status", { to: g.status });
      if (g.rating) logEvent(g, "rating", { n: g.rating });
      games.push(g);
      syncReview(g).catch(() => toast("Salvo na estante. Não deu para publicar na rede agora."));
      saveGames();
      toast("Adicionado à biblioteca");
      refreshSearchMarks();
      // Salva a capa no celular sem travar a tela
      downloadCover(draft.covers, "cover_" + g.id).then(local => {
        if (!local) return;
        g.cover = local; saveGames();
        if (currentView === "library" && sheet.hidden) renderLibrary();
      });
    } else {
      if (draft.status !== game.status) logEvent(game, "status", { to: draft.status });
      if (draft.rating && draft.rating !== game.rating) logEvent(game, "rating", { n: draft.rating });
      if (draft.review.trim() && !(game.review || "").trim()) logEvent(game, "review");
      const doneAt = draft.status === "done" ? (draft.doneAt || game.doneAt || Date.now()) : game.doneAt || null;
      Object.assign(game, { platform: draft.platform, status: draft.status, rating: draft.rating,
        review: draft.review.trim(), hours: draft.hours, updatedAt: Date.now(), doneAt,
        shared: socialReady() ? draft.shared !== false : game.shared, spoiler: !!draft.spoiler });
      syncReview(game).catch(() => toast("Salvo. Não deu para atualizar na rede agora."));
      saveGames();
      toast("Alterações salvas");
    }
    renderLibrary();
    closeSheet();
  });

  const del = body.querySelector("#del");
  if (del) {
    let armed = false;
    del.addEventListener("click", () => {
      if (!armed) { armed = true; del.textContent = "Toque de novo para remover"; setTimeout(() => { armed = false; del.textContent = "Remover"; }, 3000); return; }
      markDeleted(game.id);
      unpublishReview(game);
      games = games.filter(g => g.id !== game.id);
      saveGames();
      if (Native && game.cover && game.cover.startsWith("file:")) Native.deleteFile(game.cover);
      renderLibrary(); refreshSearchMarks(); closeSheet();
      toast("Removido da biblioteca");
    });
  }
  const swap = body.querySelector("#swap");
  if (swap) swap.addEventListener("click", () => openCoverPicker(game));
  const seeAch = body.querySelector("#see-ach");
  if (seeAch) seeAch.addEventListener("click", () => openGameAchievements(game, () => openGame(game, null, back)));
  const shareBtn = body.querySelector("#share-card");
  if (shareBtn) shareBtn.addEventListener("click", () => openShareCard({ kind: "game", game }, () => openGame(game, null, back)));
  const toList = body.querySelector("#to-list");
  if (toList) toList.addEventListener("click", () => openAddToList(game, () => openGame(game, null, back)));
  if (!isNew) wireSessionBtn(body, game, () => openGame(game, null, back), () => {
    // Começar a jogar muda o status: a ficha aberta acompanha para não desfazer ao salvar
    draft.status = game.status;
    body.querySelectorAll("#f-status [data-v]").forEach(x => x.classList.toggle("is-on", x.dataset.v === draft.status));
  });
}

/* --- Trocar capa --- */
async function openCoverPicker(game) {
  showSheet(`
    <div class="sheet-top"><button class="icon-btn" data-back aria-label="Voltar">${ICON.back}</button></div>
    <div class="field" style="margin-top:16px">
      <h2 class="hero-title">Escolha a capa</h2>
      <p class="hero-sub">${esc(game.title)}</p>
    </div>
    <div class="picker" id="picker"><p class="status-line" style="grid-column:1/-1;padding:0">Procurando capas…</p></div>`,
    () => openGame(game));

  const options = [];
  try {
    const res = await searchGames(game.title);
    const nt = norm(game.title);
    const close = res.filter(r => { const n = norm(r.title); return n === nt || n.includes(nt) || nt.includes(n); });
    (close.length ? close : res.slice(0, 6)).forEach(r => r.covers.forEach((u, i) => {
      if (i > 0 && r.covers[0].includes("steamstatic") && u.includes("library_600x900.jpg")) return;
      if (!options.some(o => o.url === u)) options.push({ url: u, src: /steam/.test(u) ? "Steam" : "Wikipédia", title: r.title });
    }));
  } catch (_) {}

  const pk = body.querySelector("#picker");
  if (!pk) return;
  if (!options.length) { pk.innerHTML = `<p class="status-line" style="grid-column:1/-1;padding:0">Nenhuma outra capa encontrada. Verifique a conexão.</p>`; return; }
  pk.innerHTML = options.map((o, i) => `<button data-o="${i}" class="${o.url === game.coverRemote ? "is-current" : ""}">
      ${coverHTML([o.url], o.title)}<div class="picker-src">${esc(o.src)}</div></button>`).join("");
  pk.addEventListener("click", async e => {
    const b = e.target.closest("[data-o]");
    if (!b) return;
    const o = options[+b.dataset.o];
    toast("Salvando a capa…");
    const local = await downloadCover(o.url, "cover_" + game.id + "_" + Date.now().toString(36));
    if (!local) { toast("Essa capa não está disponível. Escolha outra."); return; }
    if (Native && game.cover && game.cover.startsWith("file:")) Native.deleteFile(game.cover);
    Object.assign(game, { cover: local, coverRemote: o.url, coverAlts: [], updatedAt: Date.now() });
    saveGames(); renderLibrary();
    toast("Capa atualizada");
    openGame(game);
  });
}

/* --- Jogo popular (Explorar) --- */
function openPopular(p) {
  const existing = games.find(g => norm(g.title) === norm(p.title) || g.wiki === p.wiki);
  const players = p.steam && playersCache.data[p.steam];
  showSheet(`
    <div class="sheet-top"><button class="icon-btn" data-back aria-label="Fechar">${ICON.close}</button></div>
    <div class="hero">
      ${coverHTML(popCovers(p), p.title, { ck: popKey(p), wiki: p.wiki })}
      <div>
        <h2 class="hero-title">${esc(p.title)}</h2>
        <div class="hero-sub">${p.year}, ${esc(p.genre)}<br>${p.platforms.map(platLabel).join(", ")}</div>
        ${players ? `<div class="hero-sub"><span class="live">${fmtN(players)} jogando agora</span></div>` : ""}
      </div>
    </div>
    <div class="panel">
      <span class="field-label">Tempo médio para zerar</span>
      ${barsHTML(p, p.full)}
    </div>
    <div class="actions">
      <button class="btn ${existing ? "btn-ghost" : "btn-primary"}" id="pop-add">${existing ? "Abrir na biblioteca" : "Adicionar à biblioteca"}</button>
      ${p.steam ? `<button class="btn btn-ghost" id="pop-ach">${ICON.trophy}Ver conquistas</button>` : ""}
    </div>`);
  body.querySelector("#pop-add").addEventListener("click", () => {
    if (existing) return openGame(existing, null, () => openPopular(p));
    openGame(null, { title: p.title, year: String(p.year), wiki: p.wiki, steamId: p.steam,
      covers: popCovers(p) }, () => openPopular(p));
  });
  const a = body.querySelector("#pop-ach");
  if (a) a.addEventListener("click", () => openAchievementsFor(p.title, p.steam, () => openPopular(p)));
}

/* =========================================================
   Conquistas (lista pública da Steam Community)
   ========================================================= */
const achDone = appid => new Set(store.load("backlog.achDone." + appid, []));
const saveAchDone = (appid, set) => {
  store.save("backlog.achDone." + appid, [...set]);
  store.save("backlog.achAt." + appid, Date.now());
  scheduleSync();
};
const achMem = {};

async function fetchAchievements(appid) {
  const cacheKey = appid + "_" + settings.achLang;
  if (achMem[cacheKey]) return achMem[cacheKey];
  const cached = store.load("backlog.achData2." + cacheKey, null);
  if (cached && Date.now() - cached.at < 3 * 24 * 3600 * 1000) return (achMem[cacheKey] = cached.list);
  if (window.__PREVIEW && window.__PREVIEW.achievements) return window.__PREVIEW.achievements(appid);
  let list = [];
  try {
    // Serviço público da Steam: nome, descrição, ícone e % de jogadores, já no idioma escolhido
    const d = await getJSON(`https://api.steampowered.com/IPlayerService/GetGameAchievements/v1/?appid=${appid}&language=${settings.achLang}`);
    list = (d.response?.achievements || []).map(a => ({
      id: a.internal_name,
      name: (a.localized_name || a.internal_name || "").trim(),
      desc: (a.localized_desc || "").trim(),
      icon: a.icon ? `https://cdn.fastly.steamstatic.com/steamcommunity/public/images/apps/${appid}/${a.icon}` : "",
      hidden: !!a.hidden,
      pct: parseFloat(a.player_percent_unlocked) || 0
    })).filter(a => a.name);
  } catch (e) {
    // Alternativa: porcentagens globais (sem nomes traduzidos)
    const g = await getJSON(`https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${appid}`);
    list = (g.achievementpercentages?.achievements || []).map(a => ({
      id: a.name, name: a.name.replace(/_/g, " ").toLowerCase().replace(/^\w/, c => c.toUpperCase()),
      desc: "", icon: "", hidden: false, pct: parseFloat(a.percent) || 0
    }));
  }
  if (list.length) store.save("backlog.achData2." + cacheKey, { at: Date.now(), list });
  return (achMem[cacheKey] = list);
}

function updateTracked(appid, title, total, done) {
  tracked = tracked.filter(t => t.appid !== appid);
  tracked.unshift({ appid, title, total, done, at: Date.now() });
  tracked = tracked.slice(0, 30);
  store.save("backlog.achTracked.v1", tracked);
  scheduleSync();
}

async function openAchievementsFor(title, steamId, back) {
  if (steamId) return openAchievements(steamId, title, back);
  toast("Procurando o jogo na Steam…");
  try {
    const res = await searchSteam(title);
    const hit = res.find(r => norm(r.title) === norm(title)) || res.find(r => norm(r.title).startsWith(norm(title)));
    if (hit) return openAchievements(hit.steamId, hit.title, back);
  } catch (_) {}
  toast("Esse jogo não está na Steam, então não há lista de conquistas");
}

async function openAchievements(appid, title, back) {
  return openAchSheet({
    title, banner: steamHeader(appid), source: "Steam", manualKey: appid, trackKey: appid,
    emptyText: "Esse jogo não tem conquistas na Steam.",
    load: async () => {
      const list = await fetchAchievements(appid);
      let synced = new Set();
      if (accounts.steam && accounts.steam.key) { try { synced = await steamUnlocked(appid); } catch (_) {} }
      return { list, synced };
    }
  }, back);
}

/* Tela de conquistas/troféus de qualquer plataforma.
   cfg.load() devolve { list: [{id,name,desc,icon,pct,hidden,kind}], synced: Set de ids já desbloqueados na conta }.
   cfg.manualKey permite marcar à mão (só Steam); cfg.trackKey guarda em "Acompanhando". */
let achFilter = "all", achSort = "default";
async function openAchSheet(cfg, back) {
  const noun = cfg.noun || "conquistas";
  showSheet(`
    <div class="sheet-top"><button class="icon-btn" data-back aria-label="${back ? "Voltar" : "Fechar"}">${back ? ICON.back : ICON.close}</button></div>
    <div class="banner">${coverHTML([cfg.banner].filter(Boolean), "").replace('class="cover"', 'class="cover" style="aspect-ratio:auto;height:100%;border-radius:0"')}</div>
    <div class="ach-head">
      <h2 class="hero-title">${esc(cfg.title)}</h2>
      <div id="ach-body"><ul class="ach-list">${skeletonRows(6)}</ul></div>
    </div>`, back, () => openAchSheet(cfg, back));

  let data;
  try { data = await cfg.load(); }
  catch (e) {
    const el = body.querySelector("#ach-body");
    if (el) el.innerHTML = `<p class="hero-sub">${esc(e && e.userMessage || `Não foi possível carregar ${noun === "troféus" ? "os troféus" : "as conquistas"}. Verifique a internet e tente de novo.`)}</p>`;
    return;
  }
  const el = body.querySelector("#ach-body");
  if (!el) return;
  const list = data.list || [];
  const synced = data.synced || new Set();
  if (!list.length) { el.innerHTML = `<p class="hero-sub">${esc(cfg.emptyText)}</p>`; return; }
  const manual = cfg.manualKey != null ? achDone(cfg.manualKey) : new Set();
  const isDone = id => synced.has(id) || manual.has(id);
  const KIND = { platinum: "Platina", gold: "Ouro", silver: "Prata", bronze: "Bronze" };

  const draw = () => {
    const n = list.filter(a => isDone(a.id)).length;
    let items = list.filter(a => achFilter === "all" || (achFilter === "done" ? isDone(a.id) : !isDone(a.id)));
    if (achSort === "rare") items = [...items].sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101));
    if (achSort === "common") items = [...items].sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));
    el.innerHTML = `
      <div class="progress-big"><b>${n}/${list.length}</b><span>${noun}, ${Math.round(n / list.length * 100)}%</span></div>
      <div class="progress-track"><div style="width:${n / list.length * 100}%"></div></div>
      ${synced.size || cfg.readonly ? `<p class="panel-note" style="margin:10px 0 0">Progresso lido da sua conta ${esc(cfg.source)}.</p>` : ""}
      <div class="chips" style="padding-left:0;padding-right:0" id="ach-filter">
        ${[["all", "Todas", list.length], ["todo", "Faltando", list.length - n], ["done", noun === "troféus" ? "Conquistados" : "Conquistadas", n]].map(([id, l, c]) =>
          `<button class="chip ${achFilter === id ? "is-on" : ""}" data-af="${id}">${l} <span class="count">${c}</span></button>`).join("")}
        ${[["default", "Ordem do jogo"], ["common", "Mais comuns"], ["rare", "Mais raras"]].map(([id, l]) =>
          `<button class="chip ${achSort === id ? "is-on" : ""}" data-as="${id}">${l}</button>`).join("")}
      </div>
      <ul class="ach-list">${items.map(a => {
        const r = a.pct == null ? null : a.pct < 5 ? ["r-ultra", "Ultra rara"] : a.pct < 20 ? ["r-rare", "Rara"] : ["r-common", "Comum"];
        return `<li><button class="ach ${isDone(a.id) ? "is-done" : ""}" data-a="${esc(a.id)}">
          <div class="ach-icon">${a.icon ? `<img src="${esc(a.icon)}" alt="" loading="lazy">` : ""}</div>
          <div>
            <div class="ach-name">${esc(a.name)}</div>
            ${a.desc ? `<div class="ach-desc">${esc(a.desc)}</div>` : ""}
            <div class="ach-meta">
              ${a.kind ? `<span class="rarity kind-${a.kind}">${KIND[a.kind] || a.kind}</span>` : ""}
              ${r ? `<span class="rarity ${r[0]}">${r[1]}</span>` : ""}
              ${a.hidden ? `<span class="rarity r-common">Secreta</span>` : ""}
              ${synced.has(a.id) ? `<span class="rarity r-synced">${esc(cfg.source)}</span>` : ""}
              ${a.pct != null ? `<span>${fmtH(a.pct)}% dos jogadores</span>` : ""}
            </div>
          </div>
          <span class="check" aria-label="Conquistada">${ICON.check}</span>
        </button></li>`;
      }).join("") || `<p class="hero-sub">Nada aqui ainda.</p>`}</ul>`;
    if (cfg.trackKey != null) updateTracked(cfg.trackKey, cfg.title, list.length, n);
  };
  draw();
  el.addEventListener("click", e => {
    const f = e.target.closest("[data-af]"), s = e.target.closest("[data-as]"), a = e.target.closest("[data-a]");
    if (f) { achFilter = f.dataset.af; draw(); return; }
    if (s) { achSort = s.dataset.as; draw(); return; }
    if (!a) return;
    const id = a.dataset.a;
    if (synced.has(id)) { toast(`Essa já está desbloqueada na sua conta ${cfg.source}`); return; }
    if (cfg.manualKey == null) { toast(`O progresso vem direto da sua conta ${cfg.source}`); return; }
    manual.has(id) ? manual.delete(id) : manual.add(id);
    saveAchDone(cfg.manualKey, manual);
    const y = body.scrollTop;
    draw();
    body.scrollTop = y;
  });
}

/* Aba Conquistas */
let achResults = [], achToken = 0;
function renderTracked() {
  const box = $("#ach-tracked");
  if ($("#ach-input").value.trim().length >= 2) { box.innerHTML = ""; return; }
  const linked = ["steam", "xbox", "psn"].some(k => accounts[k]);
  box.innerHTML = accountAchHTML() + (tracked.length ? `
    <div class="section-label">Acompanhando <small>${tracked.length}</small></div>
    <ul class="rows">${tracked.map((t, i) => `<li><button class="row tracked-row" data-t="${i}">
        ${coverHTML(steamCovers(t.appid).concat(steamHeader(t.appid)), t.title, { steam: t.appid })}
        <div><div class="row-title">${esc(t.title)}</div>
          <div class="row-sub">${t.done} de ${t.total} conquistas</div>
          <div class="progress-track"><div style="width:${t.total ? t.done / t.total * 100 : 0}%"></div></div></div>
        <span class="row-chev">${ICON.chev}</span></button></li>`).join("")}</ul>`
    : linked ? "" : `<div class="empty"><p class="empty-title">Acompanhe suas conquistas</p>
       <p class="empty-text">Busque um jogo da Steam para ver todas as conquistas, quantos jogadores têm cada uma e marcar as que você já fez.</p></div>`);
}
$("#ach-tracked").addEventListener("click", e => {
  if (e.target.closest("#ach-go-accts")) { go("settings"); return; }
  if (e.target.closest("#ach-more")) { achShowAll = true; renderTracked(); return; }
  const ag = e.target.closest("[data-ag]");
  if (ag) { const g = games.find(x => x.id === ag.dataset.ag); if (g) openGameAchievements(g, null, ag.dataset.src); return; }
  const b = e.target.closest("[data-t]");
  if (b) { const t = tracked[+b.dataset.t]; openAchievements(t.appid, t.title); }
});
async function runAchSearch(q) {
  q = q.trim();
  const status = $("#ach-status"), list = $("#ach-results");
  renderTracked();
  if (q.length < 2) { status.textContent = ""; list.innerHTML = ""; return; }
  const token = ++achToken;
  list.innerHTML = skeletonRows(5);
  status.textContent = "";
  try {
    let res;
    if (window.__PREVIEW) res = POPULAR_GAMES.filter(p => p.steam && norm(p.title).includes(norm(q))).map(p => ({ title: p.title, steamId: p.steam, covers: [] }));
    else res = await searchSteam(q);
    if (token !== achToken) return;
    achResults = res;
    status.textContent = res.length ? "" : `Nenhum jogo da Steam encontrado para “${q}”.`;
    list.innerHTML = res.map((r, i) => `<li class="row" data-i="${i}">
        ${coverHTML(r.covers.concat(r.header || []), r.title)}
        <div><div class="row-title">${esc(r.title)}</div><div class="row-sub">Ver conquistas</div></div>
        <span class="row-chev">${ICON.chev}</span></li>`).join("");
  } catch (_) {
    if (token !== achToken) return;
    list.innerHTML = "";
    status.textContent = "Sem conexão com a internet. Conecte-se e tente de novo.";
  }
}
let achDebounce;
$("#ach-input").addEventListener("input", e => { clearTimeout(achDebounce); achDebounce = setTimeout(() => runAchSearch(e.target.value), 380); });
$("#ach-form").addEventListener("submit", e => { e.preventDefault(); clearTimeout(achDebounce); $("#ach-input").blur(); runAchSearch($("#ach-input").value); });
$("#ach-results").addEventListener("click", e => {
  const li = e.target.closest("[data-i]");
  if (li) { const r = achResults[+li.dataset.i]; openAchievements(r.steamId, r.title); }
});

/* =========================================================
   Ajustes
   ========================================================= */
function renderSettings() {
  const segBtns = (key, opts) => opts.map(([v, l]) => `<button class="${settings[key] === v ? "is-on" : ""}" data-set="${key}" data-val="${v}">${l}</button>`).join("");
  $("#settings").innerHTML = `
    <div class="group">${profileCardHTML()}</div>
    ${socialSettingsHTML()}
    <div class="group">
      <h2 class="group-title">Contas de jogos</h2>
      <div class="card-list" id="accts">${accountsRowsHTML()}</div>
    </div>
    <div class="group">
      <h2 class="group-title">Aparência</h2>
      <div class="card-list">
        <div class="setting">
          <div class="setting-name">Modo</div>
          <div class="segmented">${segBtns("mode", [["dark", "Escuro"], ["light", "Claro"], ["system", "Do sistema"]])}</div>
        </div>
        <div class="setting"><button class="setting-btn" id="s-theme">
          <div><div class="setting-name">Tema</div><div class="setting-desc">${esc((THEMES[settings.theme] || THEMES.arcade).name)}${settings.theme === "cover" && settings.coverTheme ? `, cores de ${esc(settings.coverTheme.title)}` : ""}</div></div>
          <span class="theme-dots" style="${themePreviewStyle(settings.theme, resolvedMode())}"><i></i><i></i><i></i></span>
          <span class="row-chev">${ICON.chev}</span></button>
        </div>
      </div>
    </div>

    <div class="group">
      <h2 class="group-title">Biblioteca</h2>
      <div class="card-list">
        <div class="setting">
          <div class="setting-name">Plataforma padrão</div>
          <div class="setting-desc">Já vem marcada ao adicionar um jogo.</div>
          <div class="seg">${[["", "Nenhuma"], ...PLATFORMS.map(p => [p, platLabel(p)])].map(([v, l]) =>
            `<button class="chip ${settings.defaultPlatform === v ? "is-on" : ""}" data-set="defaultPlatform" data-val="${v}">${l}</button>`).join("")}</div>
        </div>
        <div class="setting">
          <div class="setting-name">Ordem da estante</div>
          <div class="segmented">${segBtns("sort", [["recent", "Recentes"], ["name", "Nome"], ["rating", "Nota"]])}</div>
        </div>
      </div>
    </div>

    <div class="group">
      <h2 class="group-title">Conquistas</h2>
      <div class="card-list">
        <div class="setting">
          <div class="setting-name">Idioma das conquistas</div>
          <div class="setting-desc">Quando o jogo não tem tradução, a Steam mostra em inglês.</div>
          <div class="segmented">${segBtns("achLang", [["brazilian", "Português"], ["english", "Inglês"]])}</div>
        </div>
      </div>
    </div>

    <div class="group">
      <h2 class="group-title">Atualizações</h2>
      <div class="card-list">
        <div class="setting">
          <div class="setting-btn">
            <div><div class="setting-name">Versão instalada</div><div class="setting-desc" id="upd-status">${esc(APP.tag === "dev" ? "Versão de teste" : APP.tag)}</div></div>
            <button class="btn btn-ghost" id="s-update" style="height:42px;padding:0 14px;flex:none">Buscar atualizações</button>
          </div>
        </div>
        <div class="setting">
          <div class="setting-name">Atualização automática</div>
          <div class="setting-desc">O app confere sozinho quando sai versão nova. O Android sempre pede sua confirmação para instalar.</div>
          <div class="segmented">${segBtns("autoUpdate", [["on", "Baixar sozinho"], ["notify", "Só avisar"], ["off", "Desligada"]])}</div>
        </div>
      </div>
    </div>

    <div class="group">
      <h2 class="group-title">Dados</h2>
      <div class="card-list">
        <div class="setting"><button class="setting-btn" id="s-export">
          <div><div class="setting-name">Exportar backup</div><div class="setting-desc">Envia sua biblioteca e conquistas marcadas para onde você quiser guardar.</div></div>
          <span class="row-chev">${ICON.chev}</span></button></div>
        <div class="setting"><button class="setting-btn" id="s-import">
          <div><div class="setting-name">Importar backup</div><div class="setting-desc">Cole o texto de um backup exportado.</div></div>
          <span class="row-chev">${ICON.chev}</span></button></div>
        <div class="setting"><button class="setting-btn" id="s-cache">
          <div><div class="setting-name">Limpar capas salvas</div><div class="setting-desc">Apaga as capas da aba Explorar. Elas são baixadas de novo quando aparecerem.</div></div>
          <span class="row-chev">${ICON.chev}</span></button></div>
        <div class="setting"><button class="setting-btn danger" id="s-wipe">
          <div><div class="setting-name">Apagar biblioteca</div><div class="setting-desc">Remove todos os jogos. Não dá para desfazer.</div></div>
          <span class="row-chev">${ICON.chev}</span></button></div>
      </div>
    </div>
    <p class="about">Zerei ${esc(APP.tag)}. Capas da Wikipédia e da Steam. Conquistas e jogadores agora vêm da Steam.</p>`;
  wireSocialSettings();
  const st = $("#s-theme"); if (st) st.onclick = openThemeDrawer;
}
$("#settings").addEventListener("click", e => {
  const b = e.target.closest("[data-set]");
  if (b) {
    settings[b.dataset.set] = b.dataset.val;
    saveSettings();
    if (b.dataset.set === "mode" || b.dataset.set === "theme") applyTheme();
    if (b.dataset.set === "sort") renderLibrary();
    if (b.dataset.set === "achLang") Object.keys(achMem).forEach(k => delete achMem[k]);
    renderSettings();
    return;
  }
  if (e.target.closest("#profile-card")) { openProfile(); return; }
  const acct = e.target.closest("[data-acct]");
  if (acct) { openAccount(acct.dataset.acct); return; }
  const id = e.target.closest("button")?.id;
  if (id === "s-update") { manualUpdateCheck($("#upd-status")); return; }
  if (id === "s-export") exportBackup();
  if (id === "s-import") openImport();
  if (id === "s-cache") {
    try { Native && Native.clearCovers("pop_"); } catch (_) {}
    coverCache = {}; store.save("backlog.coverCache.v2", coverCache);
    toast("Capas salvas apagadas");
  }
  if (id === "s-wipe") {
    const btn = e.target.closest("button");
    if (!btn.dataset.armed) {
      btn.dataset.armed = "1";
      btn.querySelector(".setting-name").textContent = "Toque de novo para apagar tudo";
      setTimeout(() => { if (btn.isConnected) renderSettings(); }, 3500);
      return;
    }
    games.forEach(g => { if (Native && g.cover && g.cover.startsWith("file:")) Native.deleteFile(g.cover); });
    games.forEach(g => markDeleted(g.id));
    games = []; saveGames(); renderLibrary(); renderSettings();
    toast("Biblioteca apagada");
  }
});

function backupData() {
  const ach = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith("backlog.achDone.")) ach[k.slice(16)] = store.load(k, []);
    }
  } catch (_) {}
  return JSON.stringify({ app: "backlog", version: 1, exportedAt: new Date().toISOString(),
    games: games.map(g => ({ ...g, cover: "" })), achievements: ach, tracked, settings });
}
function exportBackup() {
  const data = backupData();
  if (Native && Native.share) { Native.share(data, "Backup do Zerei"); return; }
  navigator.clipboard?.writeText(data).then(() => toast("Backup copiado"), () => toast("Não foi possível copiar"));
}
function openImport() {
  showSheet(`
    <div class="sheet-top"><button class="icon-btn" data-back aria-label="Fechar">${ICON.close}</button></div>
    <div class="field" style="margin-top:16px">
      <h2 class="hero-title">Importar backup</h2>
      <p class="hero-sub">Cole abaixo o texto exportado. Os jogos que já estão na biblioteca são mantidos.</p>
    </div>
    <textarea class="review" id="imp-text" style="min-height:200px;margin-top:16px" placeholder='{"app":"backlog", …}'></textarea>
    <div class="actions"><button class="btn btn-primary" id="imp-go">Importar</button></div>`);
  body.querySelector("#imp-go").addEventListener("click", () => {
    let d;
    try { d = JSON.parse(body.querySelector("#imp-text").value); } catch (_) { toast("Esse texto não é um backup válido"); return; }
    if (!d || d.app !== "backlog" || !Array.isArray(d.games)) { toast("Esse texto não é um backup do Zerei"); return; }
    let added = 0;
    d.games.forEach(g => {
      if (!g.title || games.some(x => norm(x.title) === norm(g.title))) return;
      games.push({ ...g, cover: "", id: g.id || "g" + Math.random().toString(36).slice(2) });
      added++;
    });
    Object.entries(d.achievements || {}).forEach(([appid, ids]) => {
      const set = achDone(appid); ids.forEach(i => set.add(i)); saveAchDone(appid, set);
    });
    (d.tracked || []).forEach(t => { if (!tracked.some(x => x.appid === t.appid)) tracked.push(t); });
    store.save("backlog.achTracked.v1", tracked);
    saveGames(); renderLibrary(); closeSheet();
    toast(`${added} ${added === 1 ? "jogo importado" : "jogos importados"}`);
    // Baixa as capas dos importados em segundo plano
    games.filter(g => !g.cover).forEach(g => downloadCover([g.coverRemote, ...(g.coverAlts || [])], "cover_" + g.id).then(l => {
      if (l) { g.cover = l; saveGames(); }
    }));
  });
}

/* =========================================================
   Perfil e conta na nuvem (Firebase Auth + Realtime Database,
   usados pela API REST; o login com Google é nativo)
   ========================================================= */
const FB = window.FIREBASE || {};
const cloudReady = !!(FB.apiKey && FB.databaseURL);
const googleReady = cloudReady && !!FB.webClientId && !!(Native && Native.googleSignIn);
let auth = store.load("backlog.auth.v1", null);
let profile = { name: "", bio: "", color: "#FFD21F", usePhoto: true, favPlatform: "", favGame: "", at: 0, ...store.load("backlog.profile.v1", {}) };
let deleted = store.load("backlog.deleted.v1", {});
const sync = { busy: false, again: false, last: store.load("backlog.lastSync.v1", 0), error: "" };
const toArr = v => Array.isArray(v) ? v.filter(Boolean) : (v && typeof v === "object" ? Object.values(v) : []);

function saveProfile() {
  setTimeout(scheduleSocial, 0);
  profile.at = Date.now();
  store.save("backlog.profile.v1", profile);
  scheduleSync();
  renderAvatarButton();
}
function markDeleted(id) {
  deleted[id] = Date.now();
  store.save("backlog.deleted.v1", deleted);
}
function relTime(ts) {
  if (!ts) return "nunca";
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "agora mesmo";
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h} h`;
  return new Date(ts).toLocaleDateString("pt-BR");
}

async function request(method, url, body, ct = "application/json") {
  const payload = body == null ? "" : (typeof body === "string" ? body : JSON.stringify(body));
  let text;
  if (Native && Native.httpRequest) text = await callNative("httpRequest", method, url, payload, ct);
  else {
    const r = await fetch(url, { method, headers: payload ? { "Content-Type": ct } : {}, body: payload || undefined });
    text = await r.text();
    if (!r.ok) throw new Error("HTTP " + r.status + " " + text);
  }
  return text ? JSON.parse(text) : null;
}

const AUTH_ERRORS = {
  EMAIL_EXISTS: "Já existe uma conta com esse e-mail. Toque em Entrar.",
  INVALID_LOGIN_CREDENTIALS: "E-mail ou senha incorretos.",
  INVALID_PASSWORD: "E-mail ou senha incorretos.",
  EMAIL_NOT_FOUND: "E-mail ou senha incorretos.",
  INVALID_EMAIL: "Esse e-mail não é válido.",
  WEAK_PASSWORD: "A senha precisa ter pelo menos 6 caracteres.",
  MISSING_PASSWORD: "Digite a senha.",
  TOO_MANY_ATTEMPTS_TRY_LATER: "Muitas tentativas seguidas. Espere alguns minutos.",
  OPERATION_NOT_ALLOWED: "Esse tipo de login não está ativado no Firebase.",
  CONFIGURATION_NOT_FOUND: "O login não está ativado no Firebase."
};
function authError(e) {
  const m = String(e && e.message || e);
  if (m.includes("cancelado")) return "";
  const k = Object.keys(AUTH_ERRORS).find(code => m.includes(code));
  if (k) return AUTH_ERRORS[k];
  if (/HTTP|Unable to resolve|timeout|failed to connect/i.test(m) && !/googleSignIn|credential/i.test(m)) return "Sem conexão com a internet. Tente de novo.";
  return "Não foi possível entrar com o Google. Tente entrar com e-mail.";
}
function setAuth(r, provider) {
  auth = {
    uid: r.localId || r.user_id,
    idToken: r.idToken || r.id_token,
    refreshToken: r.refreshToken || r.refresh_token,
    exp: Date.now() + (parseInt(r.expiresIn || r.expires_in, 10) || 3600) * 1000,
    email: r.email || "",
    name: r.displayName || r.fullName || "",
    photo: r.photoUrl || "",
    provider
  };
  store.save("backlog.auth.v1", auth);
  if (!profile.name && auth.name) { profile.name = auth.name; profile.at = 0; store.save("backlog.profile.v1", profile); }
}
async function signInGoogle() {
  const token = await callNative("googleSignIn", FB.webClientId);
  const r = await request("POST", `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${FB.apiKey}`, {
    postBody: `id_token=${token}&providerId=google.com`, requestUri: "http://localhost",
    returnIdpCredential: true, returnSecureToken: true
  });
  setAuth(r, "google");
}
async function signInEmail(mode, email, password) {
  const ep = mode === "up" ? "signUp" : "signInWithPassword";
  const r = await request("POST", `https://identitytoolkit.googleapis.com/v1/accounts:${ep}?key=${FB.apiKey}`,
    { email, password, returnSecureToken: true });
  setAuth({ ...r, email }, "email");
}
async function idToken() {
  if (Date.now() < auth.exp - 60000) return auth.idToken;
  const r = await request("POST", `https://securetoken.googleapis.com/v1/token?key=${FB.apiKey}`,
    `grant_type=refresh_token&refresh_token=${encodeURIComponent(auth.refreshToken)}`, "application/x-www-form-urlencoded");
  Object.assign(auth, { idToken: r.id_token, refreshToken: r.refresh_token, exp: Date.now() + parseInt(r.expires_in, 10) * 1000 });
  store.save("backlog.auth.v1", auth);
  return auth.idToken;
}
const userURL = async () => `${FB.databaseURL.replace(/\/+$/, "")}/users/${auth.uid}.json?auth=${await idToken()}`;

function collectData() {
  const achievements = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith("backlog.achDone.")) {
        const appid = k.slice(16);
        achievements[appid] = { ids: store.load(k, []), at: store.load("backlog.achAt." + appid, 0) };
      }
    }
  } catch (_) {}
  return { v: 1, updatedAt: Date.now(), games: games.map(g => ({ ...g, cover: "" })), achievements, tracked, profile, deleted, lists };
}
function mergeData(r) {
  if (!r) return;
  Object.entries(r.deleted || {}).forEach(([id, t]) => { if (!deleted[id] || deleted[id] < t) deleted[id] = t; });
  const byId = new Map(games.map(g => [g.id, g]));
  toArr(r.games).forEach(rg => {
    if (!rg.id) return;
    const lg = byId.get(rg.id);
    if (!lg) byId.set(rg.id, { ...rg, cover: "", coverAlts: toArr(rg.coverAlts) });
    else if ((rg.updatedAt || 0) > (lg.updatedAt || 0)) byId.set(rg.id, { ...rg, cover: lg.cover, coverAlts: toArr(rg.coverAlts) });
  });
  games = [...byId.values()].filter(g => !(deleted[g.id] && deleted[g.id] >= (g.updatedAt || 0)));
  Object.entries(r.achievements || {}).forEach(([appid, v]) => {
    if ((v.at || 0) > store.load("backlog.achAt." + appid, 0)) {
      store.save("backlog.achDone." + appid, toArr(v.ids));
      store.save("backlog.achAt." + appid, v.at);
    }
  });
  const tmap = new Map(tracked.map(t => [String(t.appid), t]));
  toArr(r.tracked).forEach(t => { const l = tmap.get(String(t.appid)); if (!l || (t.at || 0) > (l.at || 0)) tmap.set(String(t.appid), t); });
  tracked = [...tmap.values()].sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 30);
  if (r.profile && (r.profile.at || 0) > (profile.at || 0)) profile = { ...profile, ...r.profile };
  const lmap = new Map(lists.map(l => [l.id, l]));
  toArr(r.lists).forEach(rl => { if (!rl || !rl.id) return; const l = lmap.get(rl.id); if (!l || (rl.updatedAt || 0) > (l.updatedAt || 0)) lmap.set(rl.id, { ...rl, items: toArr(rl.items) }); });
  lists = [...lmap.values()].filter(l => !(deleted[l.id] && deleted[l.id] >= (l.updatedAt || 0)));
  store.save("backlog.lists.v1", lists);
  store.save("backlog.games.v1", games);
  store.save("backlog.deleted.v1", deleted);
  store.save("backlog.achTracked.v1", tracked);
  store.save("backlog.profile.v1", profile);
}
const coverQueue = [], coverBusy = new Set();
let coverRunning = 0;
function ensureCovers() {
  games.filter(g => !g.cover && !coverBusy.has(g.id) && (g.coverRemote || toArr(g.coverAlts).length)).forEach(g => { coverBusy.add(g.id); coverQueue.push(g); });
  pumpCovers();
}
function pumpCovers() {
  while (coverRunning < 2 && coverQueue.length) {
    const g = coverQueue.shift();
    coverRunning++;
    downloadCover(gameCovers(g), "cover_" + g.id).then(l => {
      if (l) { g.cover = l; clearTimeout(pumpCovers.t); pumpCovers.t = setTimeout(() => store.save("backlog.games.v1", games), 500); }
    }).finally(() => { coverRunning--; coverBusy.delete(g.id); pumpCovers(); });
  }
}

async function fullSync() {
  if (!cloudReady || !auth) return;
  if (sync.busy) { sync.again = true; return; }
  sync.busy = true;
  renderSyncStatus();
  try {
    const remote = await request("GET", await userURL());
    mergeData(remote);
    await request("PUT", await userURL(), collectData());
    sync.last = Date.now();
    sync.error = "";
    store.save("backlog.lastSync.v1", sync.last);
    renderLibrary();
    ensureCovers();
  } catch (e) {
    const m = String(e.message);
    sync.error = /HTTP 40[13]|Permission denied|TOKEN_EXPIRED|INVALID_REFRESH_TOKEN|USER_NOT_FOUND/i.test(m)
      ? "A nuvem recusou o acesso. Saia e entre de novo na conta."
      : "Não deu para sincronizar agora. Tento de novo quando houver internet.";
  } finally {
    sync.busy = false;
    renderSyncStatus();
    if (sync.again) { sync.again = false; scheduleSync(); }
  }
}
let syncTimer;
function scheduleSync() {
  if (!cloudReady || !auth) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(fullSync, 2500);
}
function startCloud() { if (cloudReady && auth) { fullSync(); checkSocialMe().then(() => { if (socialReady()) scheduleSocial(); }); } }

/* --- Avatar --- */
function renderAvatarButton() {
  const el = $("#lib-count");
  if (!el) return;
  el.innerHTML = `<span class="top-actions">${bellHTML()}<button class="avatar-btn" id="avatar-btn" aria-label="Seu perfil">${avatarHTML(40)}${auth ? `<i class="sync-dot ${sync.error ? "is-err" : ""}"></i>` : ""}</button></span>`;
  el.querySelector("#avatar-btn").onclick = () => openProfile();
  renderBell();
}
function syncLine() {
  if (!cloudReady) return "Seu perfil fica salvo neste celular.";
  if (!auth) return "Entre para salvar seus dados na nuvem.";
  if (sync.busy) return `${esc(auth.email)}, sincronizando…`;
  if (sync.error) return `${esc(auth.email)}. ${esc(sync.error)}`;
  return `${esc(auth.email)}, salvo na nuvem ${relTime(sync.last)}`;
}
function profileCardHTML() {
  return `<button class="profile-card" id="profile-card">
    ${avatarHTML(56)}
    <div style="min-width:0">
      <div class="profile-name">${esc(profile.name || "Criar seu perfil")}</div>
      <div class="setting-desc">${syncLine()}</div>
    </div>
    <span class="row-chev">${ICON.chev}</span></button>`;
}
function renderSyncStatus() {
  renderAvatarButton();
  const card = $("#profile-card");
  if (card) card.outerHTML = profileCardHTML();
  const line = body.querySelector("#acct-status");
  if (line) line.innerHTML = syncLine();
}

/* --- Tela do perfil --- */
const AVATAR_COLORS = ["#FFD21F", "#F03A2E", "#3EE6D6", "#93ABFF", "#FF4FA3", "#43CF86", "#F6F4EE", "#2A2A2E"];
function profileStats() {
  const done = games.filter(g => g.status === "done").length;
  const hours = games.reduce((a, g) => a + (Number(g.hours) || 0), 0);
  const rated = games.filter(g => g.rating);
  const avg = rated.length ? rated.reduce((a, g) => a + g.rating, 0) / rated.length : 0;
  let ach = 0;
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith("backlog.achDone.")) ach += store.load(k, []).length; } } catch (_) {}
  const plat = {};
  games.forEach(g => { if (g.platform) plat[g.platform] = (plat[g.platform] || 0) + 1; });
  const top = Object.entries(plat).sort((a, b) => b[1] - a[1])[0];
  return [
    [games.length, games.length === 1 ? "jogo" : "jogos"],
    [done, done === 1 ? "zerado" : "zerados"],
    [fmtH(hours) + " h", "jogadas"],
    [ach, ach === 1 ? "conquista" : "conquistas"],
    [avg ? fmtH(avg) : "–", "nota média"],
    [top ? platLabel(top[0]) : "–", "mais jogada"]
  ];
}
function avatarMode() {
  if (profile.avatarMode) return profile.avatarMode;
  return profile.usePhoto && auth && auth.photo ? "google" : "color";
}
function avatarHTML(size) {
  const mode = avatarMode();
  const src = mode === "photo" && profile.photoData ? profile.photoData
    : mode === "google" && auth && auth.photo ? auth.photo : "";
  if (src) return `<span class="avatar" style="width:${size}px;height:${size}px"><img src="${esc(src)}" alt=""></span>`;
  const initials = (profile.name || "").trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("");
  const c = profile.color || "#FFD21F";
  const rgb = parseInt(c.slice(1), 16);
  const lum = (0.299 * (rgb >> 16) + 0.587 * ((rgb >> 8) & 255) + 0.114 * (rgb & 255)) / 255;
  return `<span class="avatar" style="width:${size}px;height:${size}px;background:${c};color:${lum > .6 ? "#111" : "#fff"};font-size:${Math.round(size * .4)}px">${
    initials ? esc(initials) : `<svg viewBox="0 0 24 24" style="width:55%;height:55%"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.4-3.6 4.2-5.4 7.5-5.4s6.1 1.8 7.5 5.4"/></svg>`}</span>`;
}

/* Recorta a foto escolhida em um quadrado de 256 px (fica leve para salvar e sincronizar) */
function photoToAvatar(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const c = document.createElement("canvas");
      c.width = c.height = 256;
      c.getContext("2d").drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
      URL.revokeObjectURL(url);
      res(c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("foto")); };
    img.src = url;
  });
}

const GOOGLE_G = '<svg viewBox="0 0 24 24" class="g-logo"><path fill="#4285F4" stroke="none" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z"/><path fill="#34A853" stroke="none" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z"/><path fill="#FBBC05" stroke="none" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2z"/><path fill="#EA4335" stroke="none" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10c.8-2.3 3-4 5.6-4z"/></svg>';
const PHONE_ICON = '<svg viewBox="0 0 24 24"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg>';
const CAMERA_ICON = '<svg viewBox="0 0 24 24"><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.5"/></svg>';

function openProfile(showEmail) {
  const fav = games.find(g => g.id === profile.favGame);
  const mode = avatarMode();
  showSheet(`
    <div class="sheet-top"><button class="icon-btn" data-back aria-label="Fechar">${ICON.close}</button></div>
    <div class="profile-hero">
      <button class="avatar-edit" id="p-avatar" aria-label="Trocar foto do perfil">${avatarHTML(104)}<span class="avatar-cam">${CAMERA_ICON}</span></button>
      <input type="file" id="p-file" accept="image/*" hidden>
      <input class="name-input" id="p-name" maxlength="40" placeholder="Seu nome" value="${esc(profile.name)}">
      <input class="bio-input" id="p-bio" maxlength="80" placeholder="Uma frase sua, tipo: zerando o backlog um dia por vez" value="${esc(profile.bio)}">
      <button class="btn btn-ghost p-share" id="p-share">${SHARE}Compartilhar perfil</button>
    </div>

    <div class="stats-grid">${profileStats().map(([v, l]) => `<div class="stat"><b>${esc(v)}</b><span>${l}</span></div>`).join("")}</div>

    <div class="field">
      <span class="field-label">Avatar</span>
      <div class="swatches" id="p-colors">
        <button class="chip" id="p-pick">${CAMERA_ICON}Escolher foto</button>
        ${profile.photoData ? `<button class="chip ${mode === "photo" ? "is-on" : ""}" id="p-usephoto">Minha foto</button>` : ""}
        ${auth && auth.photo ? `<button class="chip ${mode === "google" ? "is-on" : ""}" id="p-google-photo">Foto do Google</button>` : ""}
      </div>
      <div class="swatches" style="margin-top:12px">${AVATAR_COLORS.map(c =>
        `<button class="sw ${mode === "color" && profile.color === c ? "is-on" : ""}" data-c="${c}" style="background:${c}" aria-label="Cor ${c}"></button>`).join("")}</div>
    </div>

    <div class="field">
      <span class="field-label">Plataforma favorita</span>
      <div class="seg" id="p-plat">${PLATFORMS.map(p => `<button class="chip ${profile.favPlatform === p ? "is-on" : ""}" data-v="${p}">${platLabel(p)}</button>`).join("")}</div>
    </div>

    <div class="field">
      <span class="field-label">Jogo favorito${fav ? `: ${esc(fav.title)}` : ""}</span>
      ${games.length ? `<div class="rail fav-rail" id="p-fav" style="padding:0">${sortGames([...games]).map(g =>
        `<button class="fav ${profile.favGame === g.id ? "is-on" : ""}" data-g="${g.id}">${coverHTML(gameCovers(g), g.title)}</button>`).join("")}</div>`
        : `<p class="hero-sub" style="margin:0">Adicione jogos à biblioteca para escolher o favorito.</p>`}
    </div>

    <div class="field">
      <span class="field-label">Conta</span>
      <div class="acct-options">
        <div class="acct-opt ${!auth ? "is-on" : ""}">
          <span class="acct-ico">${PHONE_ICON}</span>
          <div><b>Perfil offline</b><span>Tudo fica salvo só neste celular. Não precisa de conta.</span></div>
          ${!auth ? `<span class="tag">Em uso</span>` : ""}
        </div>
        <div class="acct-opt ${auth ? "is-on" : ""}">
          <span class="acct-ico">${GOOGLE_G}</span>
          <div><b>${googleReady || !cloudReady ? "Conta Google" : "Conta na nuvem"}</b><span id="acct-status">${auth ? syncLine() : "Salva na nuvem, sincroniza entre celulares e libera a rede."}</span></div>
          ${auth ? `<span class="tag">Conectada</span>` : ""}
        </div>
      </div>
      <div class="actions" style="margin-top:14px">
        ${auth ? `
          <button class="btn btn-ghost" id="a-sync">Sincronizar agora</button>
          <button class="btn btn-danger" id="a-out">Sair e voltar ao perfil offline</button>`
        : googleReady ? `
          <button class="btn btn-google" id="a-google">${GOOGLE_G}Entrar com Google</button>
          <button class="link-btn" id="a-email-toggle" style="justify-self:center">Prefiro entrar com e-mail</button>`
        : cloudReady ? `
          <button class="btn btn-primary" id="a-email-toggle">Entrar com e-mail</button>`
        : `
          <button class="btn btn-google" disabled>${GOOGLE_G}Entrar com Google</button>
          <p class="panel-note" style="margin:0">O login na nuvem ainda não foi ativado nesta versão. Enquanto isso, o perfil offline guarda tudo neste celular.</p>`}
      </div>
      ${!auth && cloudReady ? `
        <form class="email-form" id="a-email" ${showEmail ? "" : "hidden"}>
          <input class="text-input" id="a-mail" type="email" autocomplete="email" placeholder="E-mail">
          <input class="text-input" id="a-pass" type="password" autocomplete="current-password" placeholder="Senha (mínimo 6 caracteres)">
          <p class="form-error" id="a-err" hidden></p>
          <div class="two-btns">
            <button class="btn btn-primary" type="submit" data-mode="in">Entrar</button>
            <button class="btn btn-ghost" type="submit" data-mode="up">Criar conta</button>
          </div>
          <button class="link-btn forgot" type="button" id="a-forgot">Esqueci minha senha</button>
        </form>` : ""}
    </div>`);

  // Nome e frase entram no perfil na hora; o salvamento espera a pessoa parar de digitar
  let t;
  const later = () => { clearTimeout(t); t = setTimeout(saveProfile, 500); };
  body.querySelector("#p-name").addEventListener("input", e => { profile.name = e.target.value.trim(); later(); });
  body.querySelector("#p-bio").addEventListener("input", e => { profile.bio = e.target.value.trim(); later(); });

  const refresh = () => { const y = body.scrollTop; openProfile(); body.scrollTop = y; };
  body.querySelector("#p-share").onclick = () => { const d = myProfileShareData(); openShareCard({ kind: "profile", ...d }, () => openProfile()); };
  const fileInput = body.querySelector("#p-file");
  const pick = () => fileInput.click();
  body.querySelector("#p-avatar").addEventListener("click", pick);
  body.querySelector("#p-pick").addEventListener("click", pick);
  fileInput.addEventListener("change", async () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    try {
      profile.photoData = await photoToAvatar(f);
      profile.avatarMode = "photo";
      saveProfile();
      toast("Foto do perfil atualizada");
      refresh();
    } catch (_) { toast("Não consegui abrir essa foto. Tente outra, em JPG ou PNG."); }
  });
  body.querySelector("#p-colors").addEventListener("click", e => {
    if (e.target.closest("#p-usephoto")) profile.avatarMode = "photo";
    else if (e.target.closest("#p-google-photo")) profile.avatarMode = "google";
    else return;
    saveProfile(); refresh();
  });
  body.querySelectorAll("[data-c]").forEach(sw => sw.addEventListener("click", () => {
    profile.color = sw.dataset.c; profile.avatarMode = "color"; saveProfile(); refresh();
  }));
  body.querySelector("#p-plat").addEventListener("click", e => {
    const b = e.target.closest("[data-v]");
    if (!b) return;
    profile.favPlatform = profile.favPlatform === b.dataset.v ? "" : b.dataset.v;
    saveProfile();
    b.parentElement.querySelectorAll("[data-v]").forEach(x => x.classList.toggle("is-on", x.dataset.v === profile.favPlatform));
  });
  const favRail = body.querySelector("#p-fav");
  if (favRail) favRail.addEventListener("click", e => {
    const b = e.target.closest("[data-g]");
    if (!b) return;
    profile.favGame = profile.favGame === b.dataset.g ? "" : b.dataset.g;
    saveProfile(); refresh();
  });

  const on = (id, fn) => { const el = body.querySelector(id); if (el) el.addEventListener("click", fn); };
  on("#a-sync", () => { fullSync(); toast("Sincronizando…"); });
  on("#a-out", () => {
    auth = null; store.save("backlog.auth.v1", null);
    if (profile.avatarMode === "google") profile.avatarMode = profile.photoData ? "photo" : "color";
    store.save("backlog.profile.v1", profile);
    toast("Você voltou ao perfil offline. Seus dados continuam neste celular.");
    renderAvatarButton(); openProfile();
    if (currentView === "settings") renderSettings();
  });
  const afterLogin = async () => {
    if (!profile.avatarMode && auth.photo && !profile.photoData) profile.avatarMode = "google";
    toast("Conta conectada. Sincronizando…");
    openProfile();
    await fullSync();
    if (!sheet.hidden) refresh();
    if (currentView === "settings") renderSettings();
  };
  on("#a-google", async e => {
    const b = e.currentTarget; b.disabled = true;
    try { await signInGoogle(); await afterLogin(); }
    catch (err) { const m = authError(err); if (m) toast(m); b.disabled = false; }
  });
  on("#a-email-toggle", () => { const f = body.querySelector("#a-email"); if (!f) return; f.hidden = !f.hidden; if (!f.hidden) body.querySelector("#a-mail").focus(); });
  const fg = body.querySelector("#a-forgot");
  if (fg) fg.onclick = () => openForgot(body.querySelector("#a-mail").value.trim(), () => openProfile(true));
  const form = body.querySelector("#a-email");
  if (form) form.addEventListener("submit", async e => {
    e.preventDefault();
    const modeBtn = (e.submitter && e.submitter.dataset.mode) || "in";
    const err = body.querySelector("#a-err");
    const email = body.querySelector("#a-mail").value.trim(), pass = body.querySelector("#a-pass").value;
    err.hidden = true;
    if (!email || !pass) { err.textContent = "Preencha e-mail e senha."; err.hidden = false; return; }
    form.querySelectorAll("button").forEach(x => x.disabled = true);
    try { await signInEmail(modeBtn, email, pass); await afterLogin(); }
    catch (ex) {
      err.textContent = authError(ex) || "Não foi possível entrar."; err.hidden = false;
      form.querySelectorAll("button").forEach(x => x.disabled = false);
    }
  });
}

/* =========================================================
   Atualizações (GitHub Releases)
   ========================================================= */
const APP = window.APP_VERSION || { tag: "dev", build: 0 };
const REPO = "LagazYT/backlog-jogos";
let updateInfo = null, updateState = "idle", updatePct = 0, updateDownload = null;

function cleanNotes(body) {
  let t = String(body || "").trim();
  if (t.startsWith('"')) { try { t = JSON.parse(t); } catch (_) {} }
  return t.split(/\n\s*(Co-Authored-By|Claude-Session)/i)[0].trim();
}
async function findUpdate() {
  const r = await getJSON(`https://api.github.com/repos/${REPO}/releases/latest`);
  store.save("backlog.updateCheck.v1", Date.now());
  const build = parseInt(((r.tag_name || "").match(/(\d+)$/) || [])[1], 10) || 0;
  const apk = (r.assets || []).find(a => /\.apk$/i.test(a.name));
  if (!apk || build <= APP.build) return null;
  return { tag: r.tag_name, build, url: apk.browser_download_url, size: apk.size, notes: cleanNotes(r.body), page: r.html_url };
}
function startUpdateDownload() {
  if (!Native || !Native.downloadUpdate || !updateInfo) return Promise.reject(new Error("sem app"));
  if (updateDownload) return updateDownload;
  updateState = "downloading"; updatePct = 0; drawUpdateSheet();
  updateDownload = callNative("downloadUpdate", updateInfo.url)
    .then(() => { updateState = "ready"; drawUpdateSheet(); })
    .catch(e => { updateState = "error"; drawUpdateSheet(); throw e; })
    .finally(() => { updateDownload = null; });
  return updateDownload;
}
window.__updateProgress = pct => {
  updatePct = pct;
  const bar = body.querySelector("#upd-bar"), lbl = body.querySelector("#upd-go");
  if (bar) bar.style.width = pct + "%";
  if (lbl && updateState === "downloading") lbl.textContent = `Baixando… ${pct}%`;
};
function installNow() {
  const res = Native && Native.installUpdate ? Native.installUpdate() : "missing";
  if (res === "permission") toast("Permita instalar apps do Zerei e toque em Instalar de novo");
  if (res === "missing") startUpdateDownload().catch(() => {});
}
function openUpdateSheet() {
  showSheet(`<div id="upd"></div>`);
  drawUpdateSheet();
}
function drawUpdateSheet() {
  const box = body.querySelector("#upd");
  if (!box || !updateInfo) return;
  const mb = updateInfo.size ? `${fmtH(updateInfo.size / 1048576)} MB` : "";
  const btn = {
    idle: `Baixar e instalar${mb ? ` (${mb})` : ""}`,
    downloading: `Baixando… ${updatePct}%`,
    ready: "Instalar agora",
    error: "Tentar baixar de novo"
  }[updateState];
  box.innerHTML = `
    <div class="sheet-top"><button class="icon-btn" data-close aria-label="Fechar">${ICON.close}</button></div>
    <div class="update-hero">
      <span class="update-badge">${updateInfo.tag}</span>
      <h2 class="hero-title">Versão nova chegou</h2>
      <p class="hero-sub">Você está na ${esc(APP.tag)}. ${updateState === "ready" ? "A nova já foi baixada, é só instalar." : "Sua biblioteca continua igual depois de atualizar."}</p>
    </div>
    ${updateInfo.notes ? `<div class="panel"><span class="field-label">O que mudou</span><p class="update-notes">${esc(updateInfo.notes)}</p></div>` : ""}
    ${updateState === "downloading" ? `<div class="progress-track" style="margin-top:22px"><div id="upd-bar" style="width:${updatePct}%"></div></div>` : ""}
    ${updateState === "error" ? `<p class="form-error" style="margin-top:16px">O download falhou. Confira a internet e tente de novo.</p>` : ""}
    <div class="actions">
      <button class="btn btn-primary" id="upd-go" ${updateState === "downloading" ? "disabled" : ""}>${btn}</button>
      <button class="btn btn-ghost" data-close>Depois</button>
    </div>`;
  box.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", closeSheet));
  box.querySelector("#upd-go").addEventListener("click", () => {
    if (!Native) { window.open(updateInfo.page, "_blank"); return; }
    if (updateState === "ready") installNow();
    else startUpdateDownload().then(installNow).catch(() => {});
  });
}
async function manualUpdateCheck(statusEl) {
  statusEl.textContent = "Procurando atualizações…";
  try {
    updateInfo = await findUpdate();
    if (!updateInfo) { statusEl.textContent = `Você já está na versão mais nova (${APP.tag}).`; return; }
    statusEl.textContent = `Versão ${updateInfo.tag} disponível.`;
    if (updateState !== "ready" && updateState !== "downloading") updateState = "idle";
    openUpdateSheet();
  } catch (_) { statusEl.textContent = "Sem conexão com o GitHub agora. Tente de novo mais tarde."; }
}
async function autoUpdateCheck() {
  if (!Native || window.__PREVIEW || settings.autoUpdate === "off" || !APP.build) return;
  if (Date.now() - store.load("backlog.updateCheck.v1", 0) < 3 * 3600 * 1000) return;
  try {
    updateInfo = await findUpdate();
    if (!updateInfo) return;
    if (settings.autoUpdate === "notify") { updateState = "idle"; if (sheet.hidden) openUpdateSheet(); return; }
    await startUpdateDownload();
    if (sheet.hidden) openUpdateSheet();
  } catch (_) { /* tenta na próxima abertura */ }
}

/* =========================================================
   Contas de jogos: Steam, Xbox e PlayStation (só login, sem chaves)
   Os dados de login ficam só neste celular (não vão para a nuvem).
   ========================================================= */
let accounts = store.load("backlog.accounts.v1", {});
const saveAccounts = () => store.save("backlog.accounts.v1", accounts);
// Conta do Xbox antiga (chave do OpenXBL) não vale mais: pede login de novo
if (accounts.xbox && !accounts.xbox.xsts) { delete accounts.xbox; saveAccounts(); }

/* Requisição completa (cabeçalhos, redirecionamento) pela ponte nativa */
async function http(method, url, { headers = {}, body = "", follow = true } = {}) {
  if (Native && Native.httpFull) {
    return JSON.parse(await callNative("httpFull", method, url, JSON.stringify(headers), body, follow));
  }
  const r = await fetch(url, { method, headers, body: body || undefined, redirect: follow ? "follow" : "manual" });
  return { status: r.status, location: r.headers.get("location") || "", body: await r.text() };
}
async function httpJSON(method, url, opts) {
  const r = await http(method, url, opts);
  let data = null;
  try { data = r.body ? JSON.parse(r.body) : null; } catch (_) {}
  if (r.status < 200 || r.status >= 300) { const e = new Error("HTTP " + r.status); e.status = r.status; e.data = data; throw e; }
  return data;
}
function openLogin(title, startUrl, captureJs, finishUrl, hint) {
  if (!Native || !Native.openLogin) return Promise.reject(new Error("Disponível só no app instalado"));
  return callNative("openLogin", title, startUrl, captureJs, finishUrl || "", hint || "");
}
const userErr = (msg) => { const e = new Error(msg); e.userMessage = msg; return e; };
const isoMinutes = d => {
  const m = String(d || "").match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?/);
  return m ? (+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0) + Math.round((+m[4] || 0) / 60) : 0;
};

/* ---------- Steam (login no site da Steam, sem chave de API) ---------- */
function jwtPayload(t) {
  try { return JSON.parse(atob(String(t).split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); } catch (_) { return {}; }
}
async function cookieGet(url, follow = true) {
  if (!Native || !Native.httpCookie) throw userErr("Disponível só no app instalado");
  return JSON.parse(await callNative("httpCookie", url, follow));
}
const STEAM_TOKEN_URL = "https://store.steampowered.com/pointssummary/ajaxgetasyncconfig";
const STEAM_CAPTURE = `
  if (location.host !== 'store.steampowered.com') return null;
  if (location.pathname.indexOf('/pointssummary/ajaxgetasyncconfig') === 0) {
    try { var j = JSON.parse(document.body.innerText); if (j && j.data && j.data.webapi_token) return JSON.stringify({ token: j.data.webapi_token }); } catch (e) {}
    if (!sessionStorage.getItem('sl')) { sessionStorage.setItem('sl', '1'); location.href = 'https://store.steampowered.com/login/?redir=pointssummary%2Fajaxgetasyncconfig'; }
    return null;
  }
  if (location.pathname.indexOf('/login') !== 0 && /g_AccountID\\s*=\\s*[1-9]/.test(document.documentElement.innerHTML)) {
    location.href = '${STEAM_TOKEN_URL}';
  }
  return null;`;
async function steamProfile(steamid) {
  try {
    const x = new DOMParser().parseFromString(await getText(`https://steamcommunity.com/profiles/${steamid}/?xml=1`), "text/xml");
    return { name: (x.querySelector("steamID") || {}).textContent || "", avatar: (x.querySelector("avatarFull") || {}).textContent || "" };
  } catch (_) { return { name: "", avatar: "" }; }
}
async function connectSteam() {
  const raw = await openLogin("Steam", "https://store.steampowered.com/login/?redir=pointssummary%2Fajaxgetasyncconfig", STEAM_CAPTURE,
    STEAM_TOKEN_URL, "Entre na sua conta Steam. Se não voltar sozinho, toque em Concluir.");
  const { token } = JSON.parse(raw);
  const p = jwtPayload(token);
  if (!p.sub) throw userErr("A Steam não confirmou o login. Tente de novo.");
  accounts.steam = { token, exp: (p.exp || 0) * 1000, steamid: p.sub, ...(await steamProfile(p.sub)) };
  saveAccounts();
}
async function steamToken() {
  const a = accounts.steam;
  if (a.token && Date.now() < a.exp - 120000) return a.token;
  // Renova sozinho usando a sessão da Steam guardada no celular
  let t = "";
  try { const r = await cookieGet(STEAM_TOKEN_URL); t = ((JSON.parse(r.body || "{}").data) || {}).webapi_token || ""; } catch (_) {}
  if (!t) throw userErr("Sua sessão da Steam expirou. Toque em Desconectar e entre de novo na Steam.");
  a.token = t; a.exp = (jwtPayload(t).exp || 0) * 1000; saveAccounts();
  return t;
}
const steamAuth = async () => accounts.steam.key ? `key=${accounts.steam.key}` : `access_token=${await steamToken()}`;
async function steamLibrary() {
  const { steamid } = accounts.steam;
  const d = await getJSON(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?${await steamAuth()}&steamid=${steamid}&include_appinfo=1&include_played_free_games=1&format=json`);
  const list = d.response && d.response.games;
  if (list) await steamAssets(list.map(g => g.appid));
  if (!list) throw userErr("A Steam não mostrou seus jogos. Abra a Steam > Perfil > Editar perfil > Privacidade e deixe \"Detalhes dos jogos\" como Público.");
  return list.map(g => ({
    id: String(g.appid), title: g.name, platform: "PC", steamId: g.appid,
    minutes: g.playtime_forever || 0, last: (g.rtime_last_played || 0) * 1000,
    covers: [...steamCovers(g.appid), steamHeader(g.appid)]
  }));
}
async function steamUnlocked(appid) {
  const { steamid } = accounts.steam;
  const d = await getJSON(`https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?${await steamAuth()}&steamid=${steamid}&appid=${appid}`);
  return new Set(((d.playerstats && d.playerstats.achievements) || []).filter(a => a.achieved).map(a => a.apiname));
}

/* ---------- Xbox (login da conta Microsoft, direto no Xbox Live) ---------- */
const XBOX_CLIENT = "000000004C12AE6F";
const XBOX_REDIRECT = "https://login.live.com/oauth20_desktop.srf";
const XBOX_AUTH_URL = `https://login.live.com/oauth20_authorize.srf?client_id=${XBOX_CLIENT}&redirect_uri=${encodeURIComponent(XBOX_REDIRECT)}&response_type=token&scope=${encodeURIComponent("service::user.auth.xboxlive.com::MBI_SSL")}&display=touch&locale=pt-BR`;
const XBOX_CAPTURE = `
  if (location.href.indexOf('oauth20_desktop.srf') >= 0 && location.hash.indexOf('access_token=') >= 0) return location.hash.slice(1);
  return null;`;
const jsonHeaders = extra => ({ "Content-Type": "application/json", "Accept": "application/json", ...extra });
async function xboxTokensFromRps(rps) {
  const u = await httpJSON("POST", "https://user.auth.xboxlive.com/user/authenticate", {
    headers: jsonHeaders({ "x-xbl-contract-version": "1" }),
    body: JSON.stringify({ Properties: { AuthMethod: "RPS", SiteName: "user.auth.xboxlive.com", RpsTicket: rps }, RelyingParty: "http://auth.xboxlive.com", TokenType: "JWT" })
  });
  const x = await httpJSON("POST", "https://xsts.auth.xboxlive.com/xsts/authorize", {
    headers: jsonHeaders({ "x-xbl-contract-version": "1" }),
    body: JSON.stringify({ Properties: { SandboxId: "RETAIL", UserTokens: [u.Token] }, RelyingParty: "http://xboxlive.com", TokenType: "JWT" })
  }).catch(e => {
    const code = e.data && e.data.XErr;
    throw userErr(code === 2148916233 ? "Essa conta Microsoft ainda não tem perfil Xbox. Crie um em xbox.com e tente de novo."
      : code === 2148916238 ? "Contas de menores de idade precisam de permissão de um adulto da família Microsoft."
      : "O Xbox Live recusou o login. Tente de novo.");
  });
  const c = (x.DisplayClaims && x.DisplayClaims.xui && x.DisplayClaims.xui[0]) || {};
  return { xsts: x.Token, uhs: c.uhs, xuid: c.xid, name: c.gtg || "", exp: Date.parse(x.NotAfter) || Date.now() + 3600 * 1000 };
}
async function connectXbox() {
  const raw = await openLogin("Xbox", XBOX_AUTH_URL, XBOX_CAPTURE, "", "Entre com a conta Microsoft que você usa no Xbox.");
  const rps = new URLSearchParams(raw).get("access_token");
  if (!rps) throw userErr("A Microsoft não confirmou o login. Tente de novo.");
  accounts.xbox = { ...(await xboxTokensFromRps(rps)), avatar: "" };
  saveAccounts();
  try {
    const p = await httpJSON("GET", `https://profile.xboxlive.com/users/xuid(${accounts.xbox.xuid})/profile/settings?settings=GameDisplayPicRaw,Gamertag`, { headers: await xblHeaders() });
    const st = ((p.profileUsers || [])[0] || {}).settings || [];
    const v = id => (st.find(s => s.id === id) || {}).value || "";
    accounts.xbox.avatar = v("GameDisplayPicRaw");
    accounts.xbox.name = v("Gamertag") || accounts.xbox.name;
    saveAccounts();
  } catch (_) {}
}
async function xblHeaders(contract = "2") {
  const a = accounts.xbox;
  if (!a.xsts) throw userErr("Conecte o Xbox de novo em Ajustes.");
  if (Date.now() > a.exp - 120000) {
    // Renova sozinho usando a sessão da Microsoft guardada no celular
    let rps = "";
    try {
      const r = await cookieGet(XBOX_AUTH_URL, false);
      rps = new URLSearchParams((r.location.split("#")[1] || "")).get("access_token") || "";
    } catch (_) {}
    if (!rps) throw userErr("Sua sessão do Xbox expirou. Toque em Desconectar e entre de novo.");
    Object.assign(a, await xboxTokensFromRps(rps));
    saveAccounts();
  }
  return { Authorization: `XBL3.0 x=${a.uhs};${a.xsts}`, "x-xbl-contract-version": contract, Accept: "application/json", "Accept-Language": "pt-BR" };
}
async function xboxLibrary() {
  const { xuid } = accounts.xbox;
  const d = await httpJSON("GET", `https://titlehub.xboxlive.com/users/xuid(${xuid})/titles/titlehistory/decoration/achievement,image,detail?maxItems=1000`, { headers: await xblHeaders("2") });
  const titles = (d.titles || []).filter(t => !t.type || t.type === "Game");
  const items = titles.map(t => {
    const devs = t.devices || [];
    const ach = t.achievement || {};
    return {
      id: String(t.titleId), title: t.name,
      platform: devs.length && devs.every(x => /PC|Win32/i.test(x)) ? "PC" : "Xbox",
      minutes: 0, last: Date.parse((t.titleHistory || {}).lastTimePlayed || "") || 0,
      covers: t.displayImage ? [t.displayImage] : [],
      ach: ach.totalAchievements ? { done: ach.currentAchievements || 0, total: ach.totalAchievements } : null,
      complete: (ach.progressPercentage || 0) >= 100
    };
  });
  // Tempo de jogo: uma consulta em lote para até 200 jogos
  try {
    const s = await httpJSON("POST", "https://userstats.xboxlive.com/batch", {
      headers: { ...(await xblHeaders("2")), "Content-Type": "application/json" },
      body: JSON.stringify({ arrangebyfield: "xuid", xuids: [xuid], stats: items.slice(0, 200).map(i => ({ name: "MinutesPlayed", titleid: i.id })) })
    });
    const stats = ((s.statlistscollection || [])[0] || {}).stats || [];
    const byId = new Map(stats.map(x => [String(x.titleid), Number(x.value) || 0]));
    items.forEach(i => { if (byId.get(i.id)) i.minutes = byId.get(i.id); });
  } catch (_) { /* sem horas, segue com o resto */ }
  return items;
}
async function xboxAchievements(titleId) {
  const { xuid } = accounts.xbox;
  const d = await httpJSON("GET", `https://achievements.xboxlive.com/users/xuid(${xuid})/achievements?titleId=${titleId}&maxItems=1000`, { headers: await xblHeaders("4") });
  const synced = new Set();
  const list = (d.achievements || []).map(a => {
    if (a.progressState === "Achieved") synced.add(String(a.id));
    const icon = ((a.mediaAssets || []).find(m => /Icon/i.test(m.type || m.name || "")) || (a.mediaAssets || [])[0] || {}).url || "";
    const pct = a.rarity && a.rarity.currentPercentage != null ? Number(a.rarity.currentPercentage) : null;
    return { id: String(a.id), name: a.name, desc: a.progressState === "Achieved" ? a.description : (a.lockedDescription || a.description || ""), icon, pct, hidden: !!a.isSecret };
  });
  return { list, synced };
}

/* ---------- PlayStation ---------- */
const PSN_AUTH = "https://ca.account.sony.com/api/authz/v3/oauth";
const PSN_CLIENT = "09515159-7237-4370-9b40-3806e67c0891";
const PSN_REDIRECT = "com.scee.psxandroid.scecompcall://redirect";
const PSN_BASIC = "Basic MDk1MTUxNTktNzIzNy00MzcwLTliNDAtMzgwNmU2N2MwODkxOnVjUGprYTV0bnRCMktxc1A=";
const PSN_CAPTURE = `
  if (location.host === 'ca.account.sony.com' && location.pathname.indexOf('/api/v1/ssocookie') === 0) {
    try { var j = JSON.parse(document.body.innerText); if (j.npsso) return JSON.stringify({ npsso: j.npsso }); } catch (e) {}
    if (!sessionStorage.getItem('bt')) { sessionStorage.setItem('bt', '1'); location.href = 'https://my.playstation.com/'; }
  }
  return null;`;
async function psnTokensFromNpsso(npsso) {
  const auth = await http("GET", `${PSN_AUTH}/authorize?access_type=offline&client_id=${PSN_CLIENT}&redirect_uri=${encodeURIComponent(PSN_REDIRECT)}&response_type=code&scope=${encodeURIComponent("psn:mobile.v2.core psn:clientapp")}`,
    { headers: { Cookie: `npsso=${npsso}` }, follow: false });
  const code = ((auth.location || "").match(/[?&]code=([^&]+)/) || [])[1];
  if (!code) throw userErr("A PlayStation não liberou o acesso. Entre de novo na sua conta.");
  return psnToken(`code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(PSN_REDIRECT)}&grant_type=authorization_code&token_format=jwt`);
}
async function psnToken(form) {
  const t = await httpJSON("POST", `${PSN_AUTH}/token`, {
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Authorization": PSN_BASIC }, body: form
  });
  return {
    access: t.access_token, refresh: t.refresh_token,
    exp: Date.now() + (t.expires_in || 3600) * 1000,
    refreshExp: Date.now() + (t.refresh_token_expires_in || 5184000) * 1000
  };
}
async function psnAccess() {
  const a = accounts.psn;
  if (Date.now() < a.exp - 60000) return a.access;
  if (Date.now() > a.refreshExp) throw userErr("O acesso à PlayStation expirou. Conecte a conta de novo em Ajustes.");
  Object.assign(a, await psnToken(`refresh_token=${encodeURIComponent(a.refresh)}&grant_type=refresh_token&scope=${encodeURIComponent("psn:mobile.v2.core psn:clientapp")}&token_format=jwt`));
  saveAccounts();
  return a.access;
}
const psnHeaders = async () => ({ Authorization: "Bearer " + await psnAccess(), "Accept-Language": "pt-BR", Accept: "application/json" });
async function connectPsn() {
  const raw = await openLogin("PlayStation", "https://ca.account.sony.com/api/v1/ssocookie", PSN_CAPTURE,
    "https://ca.account.sony.com/api/v1/ssocookie", "Entre na sua conta PlayStation. Depois de entrar, toque em Concluir.");
  const { npsso } = JSON.parse(raw);
  accounts.psn = { ...(await psnTokensFromNpsso(npsso)), name: "", avatar: "" };
  saveAccounts();
  try {
    const p = await httpJSON("GET", "https://us-prof.np.community.playstation.net/userProfile/v1/users/me/profile2?fields=onlineId,avatarUrls", { headers: await psnHeaders() });
    accounts.psn.name = p.profile.onlineId;
    accounts.psn.avatar = ((p.profile.avatarUrls || []).slice(-1)[0] || {}).avatarUrl || "";
    saveAccounts();
  } catch (_) {}
}
async function psnLibrary() {
  const h = await psnHeaders();
  const titles = [];
  for (let offset = 0; offset < 2000;) {
    const d = await httpJSON("GET", `https://m.np.playstation.com/api/gamelist/v2/users/me/titles?categories=ps4_game,ps5_native_game&limit=200&offset=${offset}`, { headers: h });
    titles.push(...(d.titles || []));
    if (!d.nextOffset) break;
    offset = d.nextOffset;
  }
  let trophies = [];
  try { trophies = (await httpJSON("GET", "https://m.np.playstation.com/api/trophy/v1/users/me/trophyTitles?limit=800", { headers: h })).trophyTitles || []; } catch (_) {}
  const byName = new Map(trophies.map(t => [norm(t.trophyTitleName), t]));
  const items = titles.map(t => {
    const name = t.localizedName || t.name;
    const tr = byName.get(norm(name)) || byName.get(norm(t.name));
    if (tr) byName.delete(norm(tr.trophyTitleName));
    return psnItem(t.titleId, name, t.localizedImageUrl || t.imageUrl, isoMinutes(t.playDuration), Date.parse(t.lastPlayedDateTime || "") || 0, tr);
  });
  // Jogos que só aparecem nos troféus (PS3, Vita…)
  byName.forEach(tr => items.push(psnItem(tr.npCommunicationId, tr.trophyTitleName, tr.trophyTitleIconUrl, 0, Date.parse(tr.lastUpdatedDateTime || "") || 0, tr)));
  return items;
}
function psnItem(id, title, img, minutes, last, tr) {
  const sum = o => o ? (o.bronze || 0) + (o.silver || 0) + (o.gold || 0) + (o.platinum || 0) : 0;
  return {
    id: String(id), title, platform: "PlayStation", minutes, last, covers: img ? [img] : [],
    npId: tr ? tr.npCommunicationId : "", svc: tr ? tr.npServiceName : "",
    ach: tr ? { done: sum(tr.earnedTrophies), total: sum(tr.definedTrophies) } : null,
    complete: tr ? tr.progress >= 100 : false
  };
}
async function psnTrophies(npId, svc) {
  const h = await psnHeaders();
  const q = `trophyGroups/all/trophies?npServiceName=${svc || "trophy"}`;
  const [defs, mine] = await Promise.all([
    httpJSON("GET", `https://m.np.playstation.com/api/trophy/v1/npCommunicationIds/${npId}/${q}`, { headers: h }),
    httpJSON("GET", `https://m.np.playstation.com/api/trophy/v1/users/me/npCommunicationIds/${npId}/${q}`, { headers: h })
  ]);
  const earned = new Map((mine.trophies || []).map(t => [t.trophyId, t]));
  const synced = new Set();
  const list = (defs.trophies || []).map(t => {
    const e = earned.get(t.trophyId) || {};
    if (e.earned) synced.add(String(t.trophyId));
    return { id: String(t.trophyId), name: t.trophyName, desc: t.trophyDetail || "", icon: t.trophyIconUrl, kind: t.trophyType,
      hidden: !!t.trophyHidden, pct: e.trophyEarnedRate != null ? Number(e.trophyEarnedRate) : null };
  });
  return { list, synced };
}

/* ---------- Importar para a biblioteca ---------- */
const PLATFORM_INFO = {
  steam: { name: "Steam", color: "#1b2838", library: () => steamLibrary() },
  xbox: { name: "Xbox", color: "#107C10", library: () => xboxLibrary() },
  psn: { name: "PlayStation", color: "#0070D1", library: () => psnLibrary() }
};
async function importFrom(src, onlyPlayed) {
  const items = await PLATFORM_INFO[src].library();
  let added = 0, updated = 0;
  const month = 30 * 24 * 3600 * 1000;
  items.forEach(it => {
    if (!it.title) return;
    if (onlyPlayed && !it.minutes && !(it.ach && it.ach.done)) return;
    const info = { id: it.id, minutes: it.minutes, last: it.last, ach: it.ach || null, npId: it.npId || "", svc: it.svc || "" };
    const hours = it.minutes ? Math.round(it.minutes / 6) / 10 : 0;
    let g = games.find(x => (x.sources && x.sources[src] && x.sources[src].id === it.id) || norm(x.title) === norm(it.title));
    if (g) {
      g.sources = { ...(g.sources || {}), [src]: info };
      if (hours > (parseFloat(g.hours) || 0)) g.hours = String(hours);
      if (!g.steamId && it.steamId) g.steamId = it.steamId;
      if (it.complete && g.status !== "done") {
        g.status = "done";
        g.doneAt = g.doneAt || it.last || Date.now();
        logEvent(g, "status", { to: "done", approx: true });
      }
      g.updatedAt = Date.now();
      updated++;
    } else {
      games.push({
        id: "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        title: it.title, year: "", wiki: "", steamId: it.steamId || null,
        cover: "", coverRemote: it.covers[0] || "", coverAlts: it.covers.slice(1),
        platform: it.platform, status: it.complete ? "done" : (it.last && Date.now() - it.last < month ? "playing" : "backlog"),
        rating: 0, review: "", hours: hours ? String(hours) : "", sources: { [src]: info },
        addedAt: Date.now(), updatedAt: Date.now(), doneAt: it.complete ? (it.last || null) : null,
        history: [{ t: Date.now(), type: "imported", src }].concat(it.complete && it.last ? [{ t: it.last, type: "status", to: "done", approx: true }] : [])
      });
      added++;
    }
  });
  accounts[src].lastImport = Date.now();
  accounts[src].count = items.length;
  saveAccounts();
  saveGames();
  renderLibrary();
  ensureCovers();
  return { added, updated, total: items.length };
}

/* Abre conquistas/troféus de um jogo da biblioteca pela melhor fonte disponível */
function openGameAchievements(game, back, prefer) {
  const s = game.sources || {};
  if (prefer === "steam" && s.steam) return openAchievements(s.steam.id || game.steamId, game.title, back);
  if (prefer === "xbox" && s.xbox && accounts.xbox) return openAchSheet({ title: game.title, banner: game.coverRemote, source: "Xbox", readonly: true,
      emptyText: "Esse jogo não tem conquistas no Xbox.", load: () => xboxAchievements(s.xbox.id) }, back);
  if (s.psn && s.psn.npId && accounts.psn) {
    return openAchSheet({ title: game.title, banner: game.coverRemote, source: "PlayStation", noun: "troféus", readonly: true,
      emptyText: "Esse jogo não tem troféus.", load: () => psnTrophies(s.psn.npId, s.psn.svc) }, back);
  }
  if (s.xbox && accounts.xbox) {
    return openAchSheet({ title: game.title, banner: game.coverRemote, source: "Xbox", readonly: true,
      emptyText: "Esse jogo não tem conquistas no Xbox.", load: () => xboxAchievements(s.xbox.id) }, back);
  }
  return openAchievementsFor(game.title, game.steamId || (findPopular(game.title, game.wiki) || {}).steam, back);
}

/* ---------- Tela "Contas de jogos" ---------- */
const PLATFORM_LOGO = { steam: "<b>ST</b>", xbox: "<b>XB</b>", psn: "<b>PS</b>" };
function accountsRowsHTML() {
  return ["steam", "xbox", "psn"].map(src => {
    const a = accounts[src];
    const info = PLATFORM_INFO[src];
    const desc = a ? `${esc(a.name || "Conectado")}${a.lastImport ? `, ${a.count} jogos, importado ${relTime(a.lastImport)}` : ", ainda não importou"}` : "Não conectado";
    return `<div class="setting"><button class="setting-btn" data-acct="${src}">
      <span class="plat-logo" style="background:${info.color}">${PLATFORM_LOGO[src]}</span>
      <div style="flex:1;min-width:0"><div class="setting-name">${info.name}</div><div class="setting-desc">${desc}</div></div>
      ${a ? `<span class="tag">Conectado</span>` : `<span class="row-chev">${ICON.chev}</span>`}
    </button></div>`;
  }).join("");
}
function openAccount(src) {
  const a = accounts[src];
  const info = PLATFORM_INFO[src];
  const how = {
    steam: "Entre com a sua conta Steam aqui dentro do app e pronto: ele lê seus jogos, as horas jogadas e as conquistas. Se a Steam disser que os jogos estão ocultos, deixe \"Detalhes dos jogos\" como Público na privacidade do seu perfil.",
    xbox: "Entre com a conta Microsoft que você usa no Xbox aqui dentro do app. Ele lê seus jogos, as horas jogadas e as conquistas direto do Xbox Live.",
    psn: "Você entra na sua conta PlayStation aqui dentro do app e o app pega o acesso sozinho. Ele lê seus jogos de PS4 e PS5, as horas jogadas e os troféus. O acesso vale por uns dois meses; depois é só conectar de novo."
  }[src];
  showSheet(`
    <div class="sheet-top"><button class="icon-btn" data-back aria-label="Voltar">${ICON.back}</button></div>
    <div class="acct-head">
      <span class="plat-logo big" style="background:${info.color}">${PLATFORM_LOGO[src]}</span>
      <h2 class="hero-title">${info.name}</h2>
      ${a ? `<div class="acct-user">${a.avatar ? `<img src="${esc(a.avatar)}" alt="">` : ""}<span>${esc(a.name || "Conta conectada")}</span></div>` : ""}
    </div>
    ${a ? `
      <div class="panel">
        <span class="field-label">Importar jogos</span>
        <p class="panel-note" style="margin:0 0 12px">Traz seus jogos para a biblioteca com as horas jogadas. Jogos que já estão lá ganham as horas e o progresso de ${src === "psn" ? "troféus" : "conquistas"}, sem perder sua nota e análise.</p>
        <div class="segmented" style="margin:0 0 12px" id="imp-mode">
          <button class="is-on" data-v="played">Só os que joguei</button><button data-v="all">Todos</button>
        </div>
        <button class="btn btn-primary" id="acct-import" style="width:100%">Importar agora</button>
        <p class="panel-note" id="acct-msg" ${a.lastImport ? "" : "hidden"}>${a.lastImport ? `Última importação ${relTime(a.lastImport)}: ${a.count} jogos encontrados.` : ""}</p>
      </div>
      <div class="actions"><button class="btn btn-danger" id="acct-out">Desconectar ${info.name}</button></div>`
    : `
      <p class="hero-sub" style="margin-top:14px">${how}</p>
      <div class="actions">
        <button class="btn btn-primary" id="acct-connect">Entrar com ${info.name}</button>
        <p class="form-error" id="acct-err" hidden></p>
      </div>
      <p class="panel-note">O login é feito no site oficial da ${info.name}. O app não vê sua senha, e o acesso fica guardado só neste celular.</p>`}`,
    () => { closeSheet(); if (currentView === "settings") renderSettings(); });

  const on = (id, fn) => { const el = body.querySelector(id); if (el) el.addEventListener("click", fn); };
  const showErr = m => { const el = body.querySelector("#acct-err"); if (el) { el.textContent = m; el.hidden = !m; } };
  on("#acct-connect", async e => {
    const b = e.currentTarget; b.disabled = true; showErr("");
    try {
      if (src === "steam") await connectSteam();
      else if (src === "psn") await connectPsn();
      else await connectXbox();
      toast(`${info.name} conectado`);
      openAccount(src);
    } catch (err) {
      const m = String(err && err.message);
      if (!m.includes("cancelado")) showErr(err.userMessage || `Não deu para conectar agora. Tente de novo.`);
      b.disabled = false;
    }
  });
  let mode = "played";
  const seg = body.querySelector("#imp-mode");
  if (seg) seg.addEventListener("click", e => {
    const b = e.target.closest("[data-v]"); if (!b) return;
    mode = b.dataset.v; seg.querySelectorAll("button").forEach(x => x.classList.toggle("is-on", x === b));
  });
  on("#acct-import", async e => {
    const b = e.currentTarget, msg = body.querySelector("#acct-msg");
    b.disabled = true; b.textContent = "Importando…";
    try {
      const r = await importFrom(src, mode === "played");
      if (src === "steam") syncSteamAchievements(true);
      msg.hidden = false;
      msg.textContent = `${r.total} jogos encontrados. ${r.added} ${r.added === 1 ? "novo entrou" : "novos entraram"} na biblioteca e ${r.updated} ${r.updated === 1 ? "foi atualizado" : "foram atualizados"}.`;
      toast("Importação concluída");
    } catch (err) {
      msg.hidden = false;
      msg.textContent = err.userMessage || "A importação falhou. Confira a internet e tente de novo.";
    }
    b.disabled = false; b.textContent = "Importar de novo";
  });
  on("#acct-out", () => {
    delete accounts[src]; saveAccounts();
    // Apaga também a sessão do site guardada na tela de login
    const SESSION_HOSTS = {
      steam: "store.steampowered.com,steamcommunity.com,login.steampowered.com,help.steampowered.com,api.steampowered.com",
      xbox: "login.live.com,account.live.com,login.microsoftonline.com,account.microsoft.com,www.xbox.com",
      psn: "ca.account.sony.com,my.account.sony.com,id.sonyentertainmentnetwork.com,my.playstation.com,www.playstation.com"
    };
    try { Native && Native.clearSession && Native.clearSession(SESSION_HOSTS[src]); } catch (_) {}
    toast(`${info.name} desconectado e sessão apagada. Os jogos importados continuam na biblioteca.`);
    openAccount(src);
  });
}

/* =========================================================
   Histórico de cada jogo (base da linha do tempo e das metas)
   ========================================================= */
function logEvent(g, type, extra) {
  g.history = Array.isArray(g.history) ? g.history : toArr(g.history);
  g.history.push({ t: Date.now(), type, ...(extra || {}) });
  if (g.history.length > 60) g.history = g.history.slice(-60);
}
function gameEvents(g) {
  const h = toArr(g.history);
  const list = h.slice();
  if (!list.some(e => e.type === "added" || e.type === "imported") && g.addedAt) list.unshift({ t: g.addedAt, type: "added" });
  if (g.status === "done" && g.doneAt && !list.some(e => e.type === "status" && e.to === "done")) list.push({ t: g.doneAt, type: "status", to: "done" });
  return list;
}
const yearOf = t => new Date(t).getFullYear();
const doneIn = y => games.filter(g => g.status === "done" && g.doneAt && yearOf(g.doneAt) === y);
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const fmtDay = t => { const d = new Date(t); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const isoDate = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

const DICE = '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="9" cy="9" r="1.2" fill="currentColor"/><circle cx="15" cy="15" r="1.2" fill="currentColor"/><circle cx="15" cy="9" r="1.2" fill="currentColor"/><circle cx="9" cy="15" r="1.2" fill="currentColor"/></svg>';
const FLAG = '<svg viewBox="0 0 24 24"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>';
const CLOCK = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>';
const STARBURST = '<svg viewBox="0 0 24 24"><path d="M12 3l2.2 5.6L20 9.3l-4.4 3.9 1.3 5.8L12 16l-4.9 3 1.3-5.8L4 9.3l5.8-.7z"/></svg>';
const CMP_ICO = '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="7" height="14" rx="1.5"/><rect x="13.5" y="5" width="7" height="14" rx="1.5"/></svg>';
const SHARE = '<svg viewBox="0 0 24 24"><path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13"/></svg>';

/* --- Bloco extra da Biblioteca: meta do ano e atalhos --- */
function renderLibExtras() {
  const box = $("#lib-extras");
  if (!box) return;
  if (!games.length) { box.innerHTML = ""; return; }
  const y = new Date().getFullYear();
  const goal = profile.goals && profile.goals[y];
  box.innerHTML = `
    ${wrapBannerHTML()}
    ${goal ? goalCardHTML(y, goal) : ""}
    <div class="quick quick-4">
      <button class="quick-btn" id="q-roulette">${DICE}<span>Sortear jogo</span></button>
      <button class="quick-btn" id="q-goal">${FLAG}<span>${goal ? "Meta do ano" : "Criar meta"}</span></button>
      <button class="quick-btn" id="q-timeline">${CLOCK}<span>Linha do tempo</span></button>
      <button class="quick-btn" id="q-lists">${LIST_ICO}<span>Listas</span></button>
    </div>`;
  box.querySelector("#q-lists").onclick = () => openLists();
  const wb = box.querySelector("#q-wrap");
  if (wb) wb.onclick = () => { const m = new Date().getMonth(); openWrap(m === 0 ? new Date().getFullYear() - 1 : new Date().getFullYear()); };
  box.querySelector("#q-roulette").onclick = () => openRoulette();
  box.querySelector("#q-goal").onclick = () => openGoals();
  box.querySelector("#q-timeline").onclick = () => openTimeline();
  const gc = box.querySelector(".goal-card");
  if (gc) gc.onclick = () => openGoals();
}

/* =========================================================
   Metas do ano
   ========================================================= */
function goalPace(y, target, done) {
  const start = new Date(y, 0, 1).getTime(), end = new Date(y + 1, 0, 1).getTime();
  const now = Math.min(Math.max(Date.now(), start), end);
  const frac = (now - start) / (end - start);
  const expected = target * frac;
  const daysLeft = Math.max(0, Math.ceil((end - now) / 86400000));
  const left = Math.max(0, target - done);
  if (done >= target) return `Meta batida! ${done > target ? `Você já passou ${done - target} da meta.` : "Agora é só lucro."}`;
  if (y < new Date().getFullYear()) return `Faltaram ${left} para bater a meta.`;
  const diff = Math.round(done - expected);
  const rhythm = daysLeft && left ? `Faltam ${left} em ${daysLeft} dias, cerca de 1 a cada ${Math.max(1, Math.round(daysLeft / left))} dias.` : "";
  if (diff >= 1) return `Você está ${diff} ${diff === 1 ? "jogo" : "jogos"} à frente do ritmo. ${rhythm}`;
  if (diff <= -1) return `Você está ${-diff} ${diff === -1 ? "jogo" : "jogos"} atrás do ritmo. ${rhythm}`;
  return `Você está no ritmo. ${rhythm}`;
}
function monthBarsHTML(y) {
  const counts = Array(12).fill(0);
  doneIn(y).forEach(g => counts[new Date(g.doneAt).getMonth()]++);
  const max = Math.max(1, ...counts);
  const cur = new Date().getFullYear() === y ? new Date().getMonth() : -1;
  return `<div class="months" role="img" aria-label="Jogos zerados por mês">${counts.map((c, i) => `
    <div class="mbar ${i === cur ? "is-cur" : ""}">
      <span class="mval">${c || ""}</span>
      <span class="mcol"><i style="height:${c ? Math.max(8, c / max * 100) : 0}%"></i></span>
      <span class="mlab">${MONTHS[i][0].toUpperCase()}</span>
    </div>`).join("")}</div>`;
}
function goalCardHTML(y, goal) {
  const done = doneIn(y).length;
  const pct = Math.min(100, done / goal.games * 100);
  return `<button class="goal-card">
    <div class="goal-top"><span>Meta de ${y}</span><span class="goal-pct">${Math.round(pct)}%</span></div>
    <div class="goal-num"><b>${done}</b><span>de ${goal.games} zerados</span></div>
    <div class="progress-track"><div style="width:${pct}%"></div></div>
    <p class="goal-pace">${esc(goalPace(y, goal.games, done))}</p>
  </button>`;
}
function openGoals(year) {
  const y = year || new Date().getFullYear();
  profile.goals = profile.goals || {};
  const goal = profile.goals[y];
  const list = doneIn(y).sort((a, b) => b.doneAt - a.doneAt);
  const noDate = games.filter(g => g.status === "done" && !g.doneAt).length;
  const target = goal ? goal.games : 12;
  showSheet(`
    <div class="sheet-top"><button class="icon-btn" data-back aria-label="Fechar">${ICON.close}</button>
      <div class="year-nav"><button class="icon-btn" id="g-prev" aria-label="Ano anterior">${ICON.back}</button><b>${y}</b>
      <button class="icon-btn" id="g-next" aria-label="Próximo ano" ${y >= new Date().getFullYear() + 1 ? "disabled" : ""}>${ICON.chev}</button></div></div>
    <h2 class="hero-title" style="margin-top:18px">Meta de ${y}</h2>
    ${goal ? `
      <div class="goal-big"><b>${list.length}</b><span>de ${goal.games} jogos zerados</span></div>
      <div class="progress-track" style="height:12px"><div style="width:${Math.min(100, list.length / goal.games * 100)}%"></div></div>
      <p class="hero-sub">${esc(goalPace(y, goal.games, list.length))}</p>`
    : `<p class="hero-sub">Escolha quantos jogos você quer zerar em ${y}. O app conta sozinho cada jogo que você marcar como Zerado.</p>`}

    <div class="field">
      <span class="field-label">Quantos jogos zerar</span>
      <div class="hours-field">
        <div class="stepper">
          <button data-gstep="-1" aria-label="Menos um">−</button>
          <input id="g-target" type="number" inputmode="numeric" min="1" max="365" value="${target}">
          <button data-gstep="1" aria-label="Mais um">+</button>
        </div>
        <span class="hours-hint">jogos em ${y}</span>
      </div>
      <div class="actions" style="margin-top:14px">
        <button class="btn btn-primary" id="g-save">${goal ? "Atualizar meta" : "Criar meta"}</button>
        ${goal ? `<button class="btn btn-ghost" id="g-share">${SHARE}Compartilhar meta</button>
        <button class="link-btn" id="g-del" style="justify-self:center;color:var(--accent-2)">Apagar meta</button>` : ""}
      </div>
    </div>

    <div class="panel">
      <span class="field-label">Zerados por mês</span>
      ${monthBarsHTML(y)}
      ${y <= new Date().getFullYear() && list.length ? `<button class="btn btn-ghost" id="g-wrap" style="width:100%;margin-top:16px">${STARBURST}${wrapReady(y) ? `Ver retrospectiva de ${y}` : "Prévia da retrospectiva"}</button>` : ""}
    </div>

    <div class="field">
      <span class="field-label">Zerados em ${y} <small class="count">${list.length}</small></span>
      ${list.length ? `<ul class="rows" style="padding:0">${list.map(g => `<li><button class="row" data-gid="${g.id}">
          ${coverHTML(gameCovers(g), g.title)}
          <div><div class="row-title">${esc(g.title)}</div>
          <div class="row-sub">${fmtDay(g.doneAt)}${g.hours ? `, ${fmtH(g.hours)} h` : ""}${g.rating ? ` ${starsHTML(g.rating)}` : ""}</div></div>
          <span class="row-chev">${ICON.chev}</span></button></li>`).join("")}</ul>`
        : `<p class="hero-sub" style="margin:0">Nenhum jogo zerado em ${y} ainda.</p>`}
      ${noDate ? `<p class="panel-note">${noDate} ${noDate === 1 ? "jogo zerado não tem" : "jogos zerados não têm"} data. Abra o jogo e preencha "Zerado em" para ${noDate === 1 ? "ele contar" : "eles contarem"} na meta.</p>` : ""}
    </div>`);
  const input = body.querySelector("#g-target");
  body.querySelectorAll("[data-gstep]").forEach(b => b.onclick = () => { input.value = Math.max(1, (parseInt(input.value, 10) || 0) + +b.dataset.gstep); });
  body.querySelector("#g-save").onclick = () => {
    const n = Math.max(1, Math.min(365, parseInt(input.value, 10) || 0));
    profile.goals[y] = { games: n, at: Date.now() };
    saveProfile(); renderLibrary();
    toast(`Meta de ${y}: zerar ${n} ${n === 1 ? "jogo" : "jogos"}`);
    openGoals(y);
  };
  const del = body.querySelector("#g-del");
  if (del) del.onclick = () => { delete profile.goals[y]; saveProfile(); renderLibrary(); toast("Meta apagada"); openGoals(y); };
  const sh = body.querySelector("#g-share");
  if (sh) sh.onclick = () => openShareCard({ kind: "goal", year: y }, () => openGoals(y));
  const gw = body.querySelector("#g-wrap");
  if (gw) gw.onclick = () => openWrap(y);
  body.querySelector("#g-prev").onclick = () => openGoals(y - 1);
  const nx = body.querySelector("#g-next");
  if (nx && !nx.disabled) nx.onclick = () => openGoals(y + 1);
  body.querySelectorAll("[data-gid]").forEach(b => b.onclick = () => openGame(games.find(g => g.id === b.dataset.gid), null, () => openGoals(y)));
}

/* =========================================================
   Linha do tempo
   ========================================================= */
const SRC_NAME = { steam: "Steam", xbox: "Xbox", psn: "PlayStation" };
function eventText(e, g) {
  const t = `<b>${esc(g.title)}</b>`;
  if (e.type === "added") return `Adicionou ${t} à estante`;
  if (e.type === "imported") return `Importou ${t} da ${esc(SRC_NAME[e.src] || e.src || "conta")}`;
  if (e.type === "rating") return `Deu ${fmtH(e.n)} ${e.n <= 1 ? "estrela" : "estrelas"} para ${t}`;
  if (e.type === "review") return `Escreveu uma análise de ${t}`;
  if (e.type === "session") return `Jogou ${t} por ${fmtDur(e.min || 0)}`;
  if (e.type === "status") return ({ playing: `Começou a jogar ${t}`, done: `Zerou ${t}`, dropped: `Abandonou ${t}`, backlog: `Colocou ${t} na lista` })[e.to] || t;
  return t;
}
let tlFilter = "all";
function openTimeline() {
  const all = [];
  games.forEach(g => gameEvents(g).forEach(e => all.push({ e, g })));
  all.sort((a, b) => b.e.t - a.e.t);
  const keep = ({ e }) => tlFilter === "all" ? true
    : tlFilter === "done" ? e.type === "status" && e.to === "done"
    : tlFilter === "start" ? e.type === "status" && e.to === "playing"
    : tlFilter === "session" ? e.type === "session"
    : e.type === "rating" || e.type === "review";
  const items = all.filter(keep);
  const groups = [];
  items.forEach(it => {
    const d = new Date(it.e.t);
    const label = d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, list: [] });
    groups[groups.length - 1].list.push(it);
  });
  showSheet(`
    <div class="sheet-top"><button class="icon-btn" data-back aria-label="Fechar">${ICON.close}</button></div>
    <h2 class="hero-title" style="margin-top:18px">Linha do tempo</h2>
    <p class="hero-sub">Tudo o que aconteceu na sua estante, do mais recente para o mais antigo.</p>
    <button class="btn btn-ghost" id="tl-wrap" style="width:100%;margin-top:14px">${STARBURST}${wrapReady(new Date().getFullYear()) ? `Retrospectiva de ${new Date().getFullYear()}` : `Prévia da retrospectiva de ${new Date().getFullYear()}`}</button>
    <div class="chips" style="padding-left:0;padding-right:0" id="tl-f">${[["all", "Tudo"], ["done", "Zerados"], ["start", "Começados"], ["notes", "Notas e análises"], ["session", "Sessões"]].map(([id, l]) =>
      `<button class="chip ${tlFilter === id ? "is-on" : ""}" data-tf="${id}">${l}</button>`).join("")}</div>
    ${groups.length ? groups.map(gr => `
      <div class="tl-month">${esc(gr.label.charAt(0).toUpperCase() + gr.label.slice(1))}</div>
      <ol class="tl">${gr.list.map(({ e, g }) => `<li class="tl-item tl-${e.type === "status" ? e.to : e.type}">
        <span class="tl-dot"></span>
        <button class="tl-body" data-gid="${g.id}">
          <span class="tl-cover">${coverHTML(gameCovers(g), g.title)}</span>
          <span class="tl-text"><span>${eventText(e, g)}</span><small>${fmtDay(e.t)}${e.approx ? ", data aproximada" : ""}${e.type === "status" && e.to === "done" && g.hours ? `, ${fmtH(g.hours)} h` : ""}</small></span>
        </button></li>`).join("")}</ol>`).join("")
    : `<p class="hero-sub" style="margin-top:20px">Nada por aqui ainda. Conforme você começa, zera ou avalia jogos, a história aparece aqui.</p>`}`);
  body.querySelector("#tl-wrap").onclick = () => openWrap();
  body.querySelector("#tl-f").onclick = e => { const b = e.target.closest("[data-tf]"); if (b) { tlFilter = b.dataset.tf; const y = body.scrollTop; openTimeline(); body.scrollTop = y; } };
  body.querySelectorAll("[data-gid]").forEach(b => b.onclick = () => openGame(games.find(g => g.id === b.dataset.gid), null, openTimeline));
}

/* =========================================================
   Roleta: sorteia da sua lista ou de qualquer jogo (HowLongToBeat)
   ========================================================= */
const ROULETTE_TIMES = [["any", "Qualquer", null, null], ["s", "Até 10 h", null, 10], ["m", "10 a 30 h", 10, 30], ["l", "30 a 60 h", 30, 60], ["xl", "Mais de 60 h", 60, null]];
let rouletteOpts = { source: "mine", time: "any", platform: "", dropped: false };
const estHours = g => { const t = knownTimes(g.title, g.wiki); return t ? t.main : null; };
const itemCovers = x => x.covers ? x.covers : gameCovers(x);
const inRange = (h, key) => {
  const r = ROULETTE_TIMES.find(x => x[0] === key);
  if (!r || key === "any") return true;
  if (h == null) return false;
  return (r[2] == null || h > r[2]) && (r[3] == null || h <= r[3]);
};
function roulettePool() {
  const o = rouletteOpts;
  return games.filter(g => (g.status === "backlog" || (o.dropped && g.status === "dropped"))
    && (!o.platform || g.platform === o.platform) && inRange(estHours(g), o.time));
}
/* Catálogo: guarda o total de páginas por filtro para sortear uma página qualquer */
const catalogMeta = {};
const catKey = () => `${rouletteOpts.time}|${rouletteOpts.platform}`;
async function catalogPool() {
  const r = ROULETTE_TIMES.find(x => x[0] === rouletteOpts.time);
  const q = { min: r[2], max: r[3], platform: HLTB_PLAT[rouletteOpts.platform] || "" };
  let meta = catalogMeta[catKey()];
  if (!meta) { const first = await hltbSearch({ ...q, page: 1 }); meta = catalogMeta[catKey()] = { total: first.total, pages: first.pages, first: first.items }; }
  // Fica entre os ~1000 mais populares para sair jogo conhecido
  const page = 1 + Math.floor(Math.random() * Math.max(1, Math.min(meta.pages, 50)));
  const res = page === 1 ? { items: meta.first } : await hltbSearch({ ...q, page });
  const owned = new Set(games.map(g => norm(g.title)));
  return res.items.filter(x => x.sp && !owned.has(norm(x.title)));
}
let prefetching = false;
async function prefetchTimes(list) {
  if (prefetching) return;
  prefetching = true;
  const todo = list.filter(g => estHours(g) == null && !triedTimes.has(norm(g.title))).slice(0, 12);
  for (let i = 0; i < todo.length; i += 3) await Promise.all(todo.slice(i, i + 3).map(g => fetchTimes(g.title)));
  prefetching = false;
  return todo.length;
}
let rouletteSpinning = false;
function openRoulette(result) {
  const any = rouletteOpts.source === "any";
  const pool = any ? [] : roulettePool();
  const unknownList = !any && rouletteOpts.time !== "any" ? games.filter(g => g.status === "backlog" && estHours(g) == null) : [];
  const plats = any ? PLATFORMS : [...new Set(games.map(g => g.platform).filter(Boolean))];
  const meta = catalogMeta[catKey()];
  const owned = result && games.find(g => g.id === result.id || norm(g.title) === norm(result.title));
  showSheet(`
    <div class="sheet-top"><button class="icon-btn" data-back aria-label="Fechar">${ICON.close}</button></div>
    <h2 class="hero-title" style="margin-top:18px">Roleta</h2>
    <div class="segmented" style="margin:14px 0 0" id="r-src">
      <button class="${!any ? "is-on" : ""}" data-v="mine">Da minha lista</button>
      <button class="${any ? "is-on" : ""}" data-v="any">Qualquer jogo</button>
    </div>
    <p class="hero-sub">${any ? "Sorteia entre milhares de jogos single player do HowLongToBeat, dentro do tempo que você tem." : "Sorteia um jogo da sua lista \"Quero jogar\" que caiba no tempo que você tem."}</p>

    <div class="slot ${result ? "has-result" : ""}" id="slot">
      ${result ? coverHTML(itemCovers(result), result.title) : `<div class="slot-empty">${DICE}<span id="slot-count">${any
        ? (meta ? `${fmtN(meta.total)} jogos no sorteio` : "Contando os jogos…")
        : `${pool.length} ${pool.length === 1 ? "jogo entra" : "jogos entram"} no sorteio`}</span></div>`}
    </div>
    <div class="slot-title" id="slot-title">${result ? esc(result.title) : ""}</div>
    <div class="slot-sub" id="slot-sub">${result ? rouletteSub(result) : ""}</div>

    <div class="actions" id="r-actions">
      ${result ? `
        <button class="btn btn-primary" id="r-start">${result.src === "hltb" ? (owned ? "Abrir na minha estante" : "Adicionar à estante") : "Começar a jogar"}</button>
        <div class="two-btns"><button class="btn btn-ghost" id="r-again">${DICE}Outro</button><button class="btn btn-ghost" id="r-open">${result.src === "hltb" ? "Ver tempos" : "Ver jogo"}</button></div>`
      : `<button class="btn btn-primary" id="r-spin" ${!any && !pool.length ? "disabled" : ""}>${DICE}Sortear</button>`}
    </div>

    <div class="field">
      <span class="field-label">Quanto tempo você tem</span>
      <div class="seg" id="r-time">${ROULETTE_TIMES.map(([v, l]) => `<button class="chip ${rouletteOpts.time === v ? "is-on" : ""}" data-v="${v}">${l}</button>`).join("")}</div>
      ${unknownList.length ? `<p class="panel-note" id="r-unknown">${unknownList.length} ${unknownList.length === 1 ? "jogo da lista ainda não tem" : "jogos da lista ainda não têm"} tempo médio. Buscando no HowLongToBeat…</p>` : ""}
    </div>
    ${plats.length > 1 ? `<div class="field">
      <span class="field-label">Plataforma</span>
      <div class="seg" id="r-plat"><button class="chip ${!rouletteOpts.platform ? "is-on" : ""}" data-v="">Todas</button>${plats.map(p =>
        `<button class="chip ${rouletteOpts.platform === p ? "is-on" : ""}" data-v="${p}">${platLabel(p)}</button>`).join("")}</div>
    </div>` : ""}
    ${!any ? `<div class="field">
      <button class="chip ${rouletteOpts.dropped ? "is-on" : ""}" id="r-dropped">Incluir jogos abandonados</button>
    </div>` : ""}
    ${!any && !pool.length ? `<p class="panel-note">Nenhum jogo da sua lista bate com esses filtros. Mude o tempo, a plataforma, ou sorteie de "Qualquer jogo".</p>` : ""}`);

  const refresh = () => { const y = body.scrollTop; openRoulette(); body.scrollTop = y; };
  const pick = (sel, key) => { const el = body.querySelector(sel); if (el) el.onclick = e => { const b = e.target.closest("[data-v]"); if (b && !rouletteSpinning) { rouletteOpts[key] = b.dataset.v; refresh(); } }; };
  pick("#r-src", "source"); pick("#r-time", "time"); pick("#r-plat", "platform");
  const dr = body.querySelector("#r-dropped");
  if (dr) dr.onclick = () => { rouletteOpts.dropped = !rouletteOpts.dropped; refresh(); };
  const spinBtn = body.querySelector("#r-spin");
  if (spinBtn) spinBtn.onclick = () => doSpin();
  if (any && !meta && !result) catalogPool().then(() => { const c = body.querySelector("#slot-count"); if (c && catalogMeta[catKey()]) c.textContent = `${fmtN(catalogMeta[catKey()].total)} jogos no sorteio`; }).catch(() => {
    const c = body.querySelector("#slot-count"); if (c) c.textContent = "Sem conexão com o HowLongToBeat agora";
  });
  if (unknownList.length && !result) prefetchTimes(unknownList).then(n => {
    if (!n || rouletteSpinning || !body.querySelector("#r-unknown")) return;
    refresh();
  });
  if (result) {
    body.querySelector("#r-again").onclick = () => doSpin(result);
    const back = () => openRoulette(result);
    if (result.src === "hltb") {
      body.querySelector("#r-open").onclick = () => openCatalog(result, back);
      body.querySelector("#r-start").onclick = () => owned ? openGame(owned, null, back)
        : openGame(null, { title: result.title, year: result.year, covers: result.covers }, back);
    } else {
      body.querySelector("#r-open").onclick = () => openGame(result, null, back);
      body.querySelector("#r-start").onclick = () => {
        if (result.status !== "playing") { logEvent(result, "status", { to: "playing" }); result.status = "playing"; }
        result.updatedAt = Date.now(); saveGames(); renderLibrary();
        toast(`Bom jogo! ${result.title} foi para Jogando agora`);
        closeSheet();
      };
    }
  }
}
function rouletteSub(g) {
  const h = g.src === "hltb" ? g.main : estHours(g);
  const where = g.src === "hltb" ? (g.platforms || []).slice(0, 3).join(", ") : platLabel(g.platform);
  return [where, h != null ? `cerca de ${fmtH(h)} h de história` : "tempo médio desconhecido"].filter(Boolean).map(esc).join(", ");
}
async function doSpin(avoid) {
  if (rouletteSpinning) return;
  const any = rouletteOpts.source === "any";
  const acts = body.querySelector("#r-actions");
  if (acts) acts.querySelectorAll("button").forEach(b => b.disabled = true);
  let pool;
  if (any) {
    const t = body.querySelector("#slot-count"); if (t) t.textContent = "Escolhendo…";
    try { pool = await catalogPool(); } catch (_) { toast("Sem conexão com o HowLongToBeat agora. Tente de novo."); openRoulette(); return; }
  } else pool = roulettePool();
  if (!pool.length) { toast("Nada para sortear com esses filtros"); openRoulette(); return; }
  const options = pool.length > 1 && avoid ? pool.filter(g => norm(g.title) !== norm(avoid.title)) : pool;
  const chosen = options[Math.floor(Math.random() * options.length)];
  const slot = body.querySelector("#slot"), title = body.querySelector("#slot-title"), sub = body.querySelector("#slot-sub");
  if (!slot || matchMedia("(prefers-reduced-motion: reduce)").matches || pool.length === 1) return openRoulette(chosen);
  rouletteSpinning = true;
  slot.classList.add("is-spinning");
  const steps = 22;
  let i = 0;
  const tick = () => {
    if (!slot.isConnected) { rouletteSpinning = false; return; }
    const g = i === steps ? chosen : pool[Math.floor(Math.random() * pool.length)];
    slot.innerHTML = coverHTML(itemCovers(g), g.title);
    title.textContent = g.title;
    sub.textContent = "";
    if (i === steps) { slot.classList.remove("is-spinning"); setTimeout(() => { rouletteSpinning = false; openRoulette(chosen); }, 380); return; }
    i++;
    setTimeout(tick, 45 + Math.pow(i / steps, 3) * 320);
  };
  tick();
}

/* =========================================================
   Cartão de compartilhar (imagem para Stories ou post)
   ========================================================= */
async function imgToData(url) {
  if (!url) return null;
  if (url.startsWith("data:")) return url;
  try {
    if (Native && Native.imageData) return await callNative("imageData", url);
    const r = await fetch(url);
    if (!r.ok) return null;
    const blob = await r.blob();
    return await new Promise(res => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = () => res(null); f.readAsDataURL(blob); });
  } catch (_) { return null; }
}
const loadImage = src => new Promise(res => { if (!src) return res(null); const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
async function firstImage(urls) {
  for (const u of urls.filter(Boolean)) { const img = await loadImage(await imgToData(u)); if (img && img.naturalWidth > 40) return img; }
  return null;
}
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function drawCover(ctx, img, x, y, w, h) {
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const iw = img.naturalWidth * s, ih = img.naturalHeight * s;
  ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
}
function setFont(ctx, weight, size, stretch) {
  ctx.font = `${weight} ${stretch || "normal"} ${size}px Archivo, Roboto, sans-serif`;
  try { ctx.fontStretch = stretch || "normal"; } catch (_) {}
}
function wrap(ctx, text, maxW, maxLines) {
  const words = String(text || "").replace(/\s+/g, " ").trim().split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width <= maxW || !line) line = test;
    else { lines.push(line); line = w; }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);
  const used = lines.join(" ").split(" ").length;
  if (used < words.length && lines.length) {
    let last = lines[lines.length - 1];
    while (last && ctx.measureText(last + "…").width > maxW) last = last.slice(0, -1);
    lines[lines.length - 1] = last.replace(/[\s,.;:]+$/, "") + "…";
  }
  return lines;
}
function drawStar(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? r * 0.45 : r;
    ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
  }
  ctx.closePath(); ctx.fill();
}
function pills(ctx, items, x, y, align, size) {
  setFont(ctx, 700, size);
  const pad = size * 0.7, h = size * 2, gap = size * 0.5;
  const widths = items.map(it => ctx.measureText(it.text).width + pad * 2);
  const total = widths.reduce((a, b) => a + b, 0) + gap * (items.length - 1);
  let cx = align === "center" ? x - total / 2 : x;
  items.forEach((it, i) => {
    ctx.fillStyle = it.bg; rr(ctx, cx, y, widths[i], h, h / 2); ctx.fill();
    ctx.fillStyle = it.fg; ctx.textBaseline = "middle"; ctx.textAlign = "left";
    ctx.fillText(it.text, cx + pad, y + h / 2 + 1);
    cx += widths[i] + gap;
  });
  ctx.textBaseline = "alphabetic";
  return h;
}
async function avatarImage() {
  const mode = avatarMode();
  const src = mode === "photo" ? profile.photoData : mode === "google" && auth ? auth.photo : "";
  return src ? firstImage([src]) : null;
}
function drawAvatar(ctx, img, x, y, d) {
  ctx.save(); ctx.beginPath(); ctx.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2); ctx.clip();
  if (img) drawCover(ctx, img, x, y, d, d);
  else {
    ctx.fillStyle = profile.color || "#FFD21F"; ctx.fillRect(x, y, d, d);
    const ini = (profile.name || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join("");
    setFont(ctx, 900, d * 0.42, "condensed"); ctx.fillStyle = "#111"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(ini, x + d / 2, y + d / 2 + 2); ctx.textBaseline = "alphabetic";
  }
  ctx.restore();
}
function cardColors() {
  const cs = getComputedStyle(document.documentElement);
  return { a: cs.getPropertyValue("--accent").trim() || "#FFD21F", a2: cs.getPropertyValue("--accent-2").trim() || "#F03A2E",
    on: cs.getPropertyValue("--on-accent").trim() || "#0B0B0C", on2: cs.getPropertyValue("--on-accent-2").trim() || "#fff" };
}
function drawBackdrop(ctx, img, W, H) {
  ctx.fillStyle = "#0B0B0C"; ctx.fillRect(0, 0, W, H);
  if (img) {
    ctx.save(); ctx.filter = "blur(60px) brightness(0.55) saturate(1.25)";
    drawCover(ctx, img, -120, -120, W + 240, H + 240); ctx.restore();
  }
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "rgba(11,11,12,0.25)"); g.addColorStop(0.55, "rgba(11,11,12,0.7)"); g.addColorStop(1, "rgba(11,11,12,0.96)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}
function drawBrand(ctx, x, y, c) {
  // O mesmo controle do ícone do app
  ctx.save();
  ctx.translate(x - 22, y - 50); ctx.scale(0.95, 0.95);
  ctx.fillStyle = c.a;
  ctx.fill(new Path2D("M30 44c0-6.6 5-11 12-11h24c7 0 12 4.4 12 11l4.6 21.5c1.4 6.6-3.4 12.5-9.6 11.5-3.6-.6-6.4-3.6-8.6-7.6L62 66H46l-2.4 3.4c-2.2 4-5 7-8.6 7.6-6.2 1-11-4.9-9.6-11.5z"));
  ctx.strokeStyle = "#0B0B0C"; ctx.lineWidth = 5; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.stroke(new Path2D("M37 49.5l5 5 9-10"));
  ctx.fillStyle = c.a2; ctx.beginPath(); ctx.arc(66, 46.5, 3.6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#0B0B0C"; ctx.beginPath(); ctx.arc(72.5, 53, 3.6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  setFont(ctx, 900, 44, "condensed"); ctx.fillStyle = c.t || "#F6F4EE"; ctx.textAlign = "left";
  ctx.fillText("Zerei", x + 80, y);
}
async function drawFooter(ctx, W, H, c) {
  const av = await avatarImage();
  const y = H - 150;
  drawAvatar(ctx, av, 72, y, 76);
  setFont(ctx, 800, 36); ctx.fillStyle = "#F6F4EE"; ctx.textAlign = "left";
  ctx.fillText(profile.name || "Meu backlog", 168, y + 34);
  setFont(ctx, 500, 28); ctx.fillStyle = "rgba(246,244,238,0.6)";
  ctx.fillText(socialMe && socialMe.handle ? "@" + socialMe.handle : "no app Zerei", 168, y + 70);
  ctx.strokeStyle = "rgba(246,244,238,0.15)"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(72, y - 36); ctx.lineTo(W - 72, y - 36); ctx.stroke();
}
async function drawGameCard(g, format) {
  const W = 1080, H = format === "post" ? 1350 : 1920;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  try { await Promise.all([document.fonts.load("900 90px Archivo"), document.fonts.load("500 40px Archivo"), document.fonts.load("700 30px Archivo")]); } catch (_) {}
  const c = cardColors();
  const img = await firstImage(gameCovers(g));
  drawBackdrop(ctx, img, W, H);
  drawBrand(ctx, 72, 124, c);
  const st = statusOf(g.status);
  const tags = [{ text: st.label, bg: STATUS_HEX[g.status] || "rgba(246,244,238,0.14)", fg: STATUS_INK[g.status] || "#F6F4EE" }];
  if (g.hours) tags.push({ text: `${fmtH(g.hours)} h`, bg: "rgba(246,244,238,0.14)", fg: "#F6F4EE" });
  if (g.platform) tags.push({ text: platLabel(g.platform), bg: "rgba(246,244,238,0.14)", fg: "#F6F4EE" });

  const coverBox = (x, y, w, h) => {
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 70; ctx.shadowOffsetY = 34;
    ctx.fillStyle = "#1f1f22"; rr(ctx, x, y, w, h, 30); ctx.fill(); ctx.restore();
    ctx.save(); rr(ctx, x, y, w, h, 30); ctx.clip();
    if (img) drawCover(ctx, img, x, y, w, h);
    else { setFont(ctx, 900, 64, "condensed"); ctx.fillStyle = "#6d6a63"; ctx.textAlign = "left"; wrap(ctx, g.title, w - 60, 4).forEach((l, i) => ctx.fillText(l, x + 30, y + h - 40 - (3 - i) * 70)); }
    ctx.restore();
  };
  const starsRow = (cx, y, size, align) => {
    const gap = size * 0.28, total = 5 * size + 4 * gap;
    let x = align === "center" ? cx - total / 2 : cx;
    const r = clampRating(g.rating);
    for (let i = 1; i <= 5; i++) {
      ctx.fillStyle = "rgba(246,244,238,0.18)"; drawStar(ctx, x + size / 2, y, size / 2);
      const part = r >= i ? 1 : r >= i - 0.5 ? 0.5 : 0;
      if (part) { ctx.save(); ctx.beginPath(); ctx.rect(x - 2, y - size, (size + 4) * part, size * 2); ctx.clip(); ctx.fillStyle = c.a; drawStar(ctx, x + size / 2, y, size / 2); ctx.restore(); }
      x += size + gap;
    }
  };
  const quote = (x, y, w, lines, align) => {
    if (!g.review) return y;
    setFont(ctx, 900, 120, "condensed"); ctx.fillStyle = c.a2; ctx.textAlign = align;
    ctx.fillText("“", align === "center" ? W / 2 : x - 6, y + 96);
    setFont(ctx, 500, 40); ctx.fillStyle = "rgba(246,244,238,0.9)";
    const ls = wrap(ctx, g.review, w, lines);
    ls.forEach((l, i) => ctx.fillText(l, align === "center" ? W / 2 : x, y + 110 + i * 56));
    return y + 110 + ls.length * 56;
  };

  if (format === "post") {
    const cw = 420, ch = 588;
    coverBox(72, 196, cw, ch);
    const tx = 72 + cw + 56, tw = W - tx - 72;
    setFont(ctx, 900, 84, "condensed"); ctx.fillStyle = "#F6F4EE"; ctx.textAlign = "left";
    const tl = wrap(ctx, g.title, tw, 4);
    tl.forEach((l, i) => ctx.fillText(l, tx, 290 + i * 84));
    let y = 290 + tl.length * 84 + 10;
    if (g.rating) { starsRow(tx, y + 24, 54, "left"); y += 80; }
    pills(ctx, tags.slice(0, 2), tx, y, "left", 30);
    if (tags[2]) pills(ctx, [tags[2]], tx, y + 76, "left", 30);
    quote(72, 830, W - 144, 5, "left");
  } else {
    const cw = 560, ch = 784;
    coverBox((W - cw) / 2, 200, cw, ch);
    setFont(ctx, 900, 96, "condensed"); ctx.fillStyle = "#F6F4EE"; ctx.textAlign = "center";
    const tl = wrap(ctx, g.title, W - 144, 2);
    tl.forEach((l, i) => ctx.fillText(l, W / 2, 1110 + i * 96));
    let y = 1110 + (tl.length - 1) * 96 + 50;
    if (g.rating) { starsRow(W / 2, y + 34, 64, "center"); y += 90; }
    pills(ctx, tags, W / 2, y + 10, "center", 32);
    quote(W / 2, y + 110, W - 220, 4, "center");
  }
  await drawFooter(ctx, W, H, c);
  return cv.toDataURL("image/png");
}
async function drawGoalCard(y, format) {
  const W = 1080, H = format === "post" ? 1350 : 1920;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  try { await document.fonts.load("900 200px Archivo"); } catch (_) {}
  const c = cardColors();
  const goal = (profile.goals || {})[y] || { games: 0 };
  const list = doneIn(y).sort((a, b) => a.doneAt - b.doneAt);
  drawBackdrop(ctx, null, W, H);
  drawBrand(ctx, 72, 124, c);
  setFont(ctx, 700, 40); ctx.fillStyle = "rgba(246,244,238,0.7)"; ctx.textAlign = "left";
  ctx.fillText(`Meta de ${y}`, 72, 250);
  setFont(ctx, 900, 260, "extra-condensed"); ctx.fillStyle = c.a;
  const num = String(list.length);
  ctx.fillText(num, 64, 480);
  const nw = ctx.measureText(num).width;
  setFont(ctx, 800, 64, "condensed"); ctx.fillStyle = "#F6F4EE";
  ctx.fillText(`/ ${goal.games}`, 64 + nw + 20, 480);
  setFont(ctx, 600, 36); ctx.fillStyle = "rgba(246,244,238,0.75)";
  ctx.fillText(list.length === 1 ? "jogo zerado" : "jogos zerados", 72, 540);
  const pct = goal.games ? Math.min(1, list.length / goal.games) : 0;
  ctx.fillStyle = "rgba(246,244,238,0.14)"; rr(ctx, 72, 590, W - 144, 22, 11); ctx.fill();
  ctx.fillStyle = c.a; rr(ctx, 72, 590, Math.max(22, (W - 144) * pct), 22, 11); ctx.fill();
  const cols = format === "post" ? 5 : 4, gap = 22, cw = (W - 144 - gap * (cols - 1)) / cols, ch = cw * 1.4;
  const rows = Math.max(1, Math.floor(((H - 260) - 680) / (ch + gap)));
  const shown = list.slice(-cols * rows);
  const imgs = await Promise.all(shown.map(g => firstImage(gameCovers(g))));
  shown.forEach((g, i) => {
    const x = 72 + (i % cols) * (cw + gap), yy = 680 + Math.floor(i / cols) * (ch + gap);
    ctx.save(); rr(ctx, x, yy, cw, ch, 18); ctx.clip();
    ctx.fillStyle = "#1f1f22"; ctx.fillRect(x, yy, cw, ch);
    if (imgs[i]) drawCover(ctx, imgs[i], x, yy, cw, ch);
    ctx.restore();
  });
  if (!shown.length) { setFont(ctx, 600, 40); ctx.fillStyle = "rgba(246,244,238,0.6)"; ctx.fillText("Bora começar!", 72, 720); }
  await drawFooter(ctx, W, H, c);
  return cv.toDataURL("image/png");
}

let shareFormat = "story";
async function openShareCard(what, back) {
  const g = what.kind === "game" ? what.game : null;
  showSheet(`
    <div class="sheet-top"><button class="icon-btn" data-back aria-label="Voltar">${back ? ICON.back : ICON.close}</button></div>
    <h2 class="hero-title" style="margin-top:18px">Compartilhar</h2>
    <div class="segmented" style="margin:16px 0 0" id="sh-fmt">
      <button class="${shareFormat === "story" ? "is-on" : ""}" data-v="story">Stories</button>
      <button class="${shareFormat === "post" ? "is-on" : ""}" data-v="post">Post</button>
    </div>
    <div class="card-preview ${shareFormat}" id="sh-prev"><div class="skeleton" style="width:100%;height:100%"><div class="cover" style="width:100%;height:100%;aspect-ratio:auto"></div></div></div>
    <div class="actions">
      <button class="btn btn-primary" id="sh-go" disabled>${SHARE}Compartilhar</button>
      <button class="btn btn-ghost" id="sh-save" disabled>Salvar na galeria</button>
    </div>
    ${g && !g.review ? `<p class="panel-note">Dica: escreva uma análise do jogo e ela aparece no cartão.</p>` : ""}`, back);
  let data = null;
  try { data = what.kind === "list" ? await drawListCard(what.list, shareFormat, what.by) : what.kind === "goal" ? await drawGoalCard(what.year, shareFormat) : what.kind === "profile" ? await drawProfileCard(what.p, what.covers, shareFormat) : await drawGameCard(g, shareFormat); }
  catch (_) { data = null; }
  const prev = body.querySelector("#sh-prev");
  if (!prev) return;
  if (!data) { prev.innerHTML = `<p class="hero-sub" style="padding:20px">Não consegui montar a imagem. Tente de novo.</p>`; return; }
  prev.innerHTML = `<img src="${data}" alt="Prévia do cartão">`;
  const go = body.querySelector("#sh-go"), save = body.querySelector("#sh-save");
  go.disabled = save.disabled = false;
  const text = g ? `${g.title}${g.rating ? ` ${starsText(g.rating)}` : ""} no Zerei`
    : what.kind === "list" ? `${what.list.name}: ${what.by ? `lista de @${what.by.handle}` : "minha lista"} no Zerei`
    : what.kind === "profile" ? (what.p.handle ? `Me siga no Zerei: @${what.p.handle}` : "Minha estante no Zerei")
    : `Minha meta de ${what.year} no Zerei`;
  go.onclick = async () => {
    if (Native && Native.shareImage) { try { await callNative("shareImage", data, text); } catch (_) { toast("Não deu para compartilhar agora"); } }
    else toast("Toque e segure na imagem para salvar ou compartilhar");
  };
  save.onclick = async () => {
    if (!(Native && Native.saveImage)) { toast("Toque e segure na imagem para salvar"); return; }
    try { await callNative("saveImage", data, "zerei-" + Date.now()); toast("Imagem salva em Imagens > Zerei"); }
    catch (e) { toast(String(e.message).includes("antigo") ? "Neste Android, use Compartilhar e escolha salvar" : "Não deu para salvar agora"); }
  };
  body.querySelector("#sh-fmt").onclick = e => { const b = e.target.closest("[data-v]"); if (b && b.dataset.v !== shareFormat) { shareFormat = b.dataset.v; openShareCard(what, back); } };
}

/* =========================================================
   Rede: perfis públicos, avaliações, seguir, curtir, denunciar
   (Firebase Realtime Database pela API REST)
   ========================================================= */
let socialMe = store.load("backlog.social.v1", null);          // { uid, handle }
let blocked = store.load("backlog.blocked.v1", []);             // uids escondidos
const socialReady = () => cloudReady && auth && socialMe && socialMe.uid === auth.uid && socialMe.handle;
const keyOf = title => norm(title).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "jogo";
const safeImg = u => typeof u === "string" && (/^data:image\/(png|jpe?g|webp);base64,/.test(u) || /^https:\/\//.test(u)) ? u : "";
const HEART = '<svg viewBox="0 0 24 24"><path d="M12 20s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.6-7.5 10-7.5 10z"/></svg>';
const PENCIL = '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>';
const DOTS = '<svg viewBox="0 0 24 24"><circle cx="5.5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor"/></svg>';

async function dbURL(path, params) {
  const q = new URLSearchParams({ auth: await idToken(), ...(params || {}) });
  return `${FB.databaseURL.replace(/\/+$/, "")}/${path}.json?${q}`;
}
const dbGet = async (path, params) => request("GET", await dbURL(path, params));
// Sempre em JSON: um texto solto ("u123") precisa ir com aspas para o Firebase aceitar
const dbPut = async (path, val) => request("PUT", await dbURL(path), JSON.stringify(val));
const dbPost = async (path, val) => request("POST", await dbURL(path), JSON.stringify(val));
const dbDel = async path => request("DELETE", await dbURL(path));
const q = v => JSON.stringify(v);

function publicStats() {
  const done = games.filter(g => g.status === "done").length;
  const rated = games.filter(g => g.rating);
  return {
    games: games.length, done,
    hours: Math.round(games.reduce((a, g) => a + (Number(g.hours) || 0), 0)),
    avg: rated.length ? Math.round(rated.reduce((a, g) => a + g.rating, 0) / rated.length * 10) / 10 : 0
  };
}
function myPublicPhoto() {
  const mode = avatarMode();
  return safeImg(mode === "photo" ? profile.photoData : mode === "google" && auth ? auth.photo : "");
}
async function publishProfile() {
  if (!socialReady()) return;
  const fav = games.find(g => g.id === profile.favGame);
  const y = new Date().getFullYear(), goal = (profile.goals || {})[y];
  await dbPut(`profiles/${auth.uid}`, {
    handle: socialMe.handle, name: profile.name || socialMe.handle, bio: profile.bio || "",
    color: profile.color || "#FFD21F", photo: myPublicPhoto(), favPlatform: profile.favPlatform || "",
    favGame: fav ? { title: fav.title, cover: safeImg(fav.coverRemote) } : null,
    goal: goal ? { year: y, games: goal.games, done: doneIn(y).length } : null,
    stats: publicStats(), shelf: !!profile.shelfPublic, updatedAt: Date.now()
  });
  await publishShelf().catch(() => {});
}
let socialTimer;
function scheduleSocial() {
  if (!socialReady()) return;
  clearTimeout(socialTimer);
  socialTimer = setTimeout(() => publishProfile().catch(() => {}), 4000);
}
function reviewPayload(g) {
  if (!g.sharedAt) g.sharedAt = Date.now();
  const edited = Date.now() - g.sharedAt > 60000 ? Date.now() : null;
  return {
    uid: auth.uid, handle: socialMe.handle, gameKey: keyOf(g.title), game: g.title,
    cover: safeImg(g.coverRemote) || safeImg((g.coverAlts || [])[0]) || "",
    rating: g.rating || 0, text: (g.review || "").slice(0, 2000), spoiler: !!g.spoiler,
    hours: Number(g.hours) || 0, platform: g.platform || "", status: g.status, at: g.sharedAt, edited
  };
}
async function syncReview(g) {
  if (!socialReady()) return;
  const rid = `${auth.uid}_${keyOf(g.title)}`;
  if (g.shared && (g.rating || (g.review || "").trim())) await dbPut(`reviews/${rid}`, reviewPayload(g));
  else await dbDel(`reviews/${rid}`).catch(() => {});
  scheduleSocial();
}
async function unpublishReview(g) {
  if (!socialReady()) return;
  await dbDel(`reviews/${auth.uid}_${keyOf(g.title)}`).catch(() => {});
}

/* --- Cache de perfis públicos --- */
const profCache = new Map();
async function getProfile(uid) {
  if (profCache.has(uid)) return profCache.get(uid);
  const p = dbGet(`profiles/${uid}`).then(v => v || null).catch(() => null);
  profCache.set(uid, p);
  return p;
}
function avatarFor(p, size) {
  const src = p && safeImg(p.photo);
  if (src) return `<span class="avatar" style="width:${size}px;height:${size}px"><img src="${esc(src)}" alt=""></span>`;
  const name = (p && (p.name || p.handle)) || "?";
  const ini = name.trim().split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join("");
  const c = /^#[0-9a-f]{6}$/i.test(p && p.color) ? p.color : "#FFD21F";
  const rgb = parseInt(c.slice(1), 16);
  const lum = (0.299 * (rgb >> 16) + 0.587 * ((rgb >> 8) & 255) + 0.114 * (rgb & 255)) / 255;
  return `<span class="avatar" style="width:${size}px;height:${size}px;background:${c};color:${lum > .6 ? "#111" : "#fff"};font-size:${Math.round(size * .4)}px">${esc(ini)}</span>`;
}
const ago = t => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} d`;
  return fmtDay(t);
};
const listOf = obj => Object.entries(obj || {}).map(([id, v]) => ({ id, ...v })).filter(r => r && r.uid && !blocked.includes(r.uid));

/* --- Cartão de avaliação --- */
function postHTML(r, prof, likes, opts = {}) {
  const lk = likes[r.id] || {};
  const n = Object.keys(lk).length, mine = !!lk[auth.uid];
  const st = statusOf(r.status);
  return `<article class="post" data-rid="${esc(r.id)}" data-uid="${esc(r.uid)}">
    ${opts.hideUser ? "" : `<header class="post-head">
      <button class="post-user" data-user="${esc(r.uid)}">${avatarFor(prof, 38)}<span><b>${esc((prof && prof.name) || r.handle)}</b><small>@${esc(r.handle)}</small></span></button>
      <span class="post-time">${ago(r.at)}${r.edited ? ", editada" : ""}</span>
      <button class="icon-btn post-more" data-more="${esc(r.id)}" aria-label="Mais opções">${DOTS}</button>
    </header>`}
    ${opts.hideGame ? "" : `<button class="post-game" data-game="${esc(r.gameKey)}" data-title="${esc(r.game)}" data-cover="${esc(safeImg(r.cover))}">
      ${coverHTML([safeImg(r.cover)].filter(Boolean), r.game)}
      <span><b>${esc(r.game)}</b>
        ${r.rating ? starsHTML(r.rating, "post-stars", true) : ""}
        <small>${[st.label, r.hours ? `${fmtH(r.hours)} h` : "", platLabel(r.platform)].filter(Boolean).map(esc).join(", ")}</small></span>
    </button>`}
    ${r.text ? `<div class="post-text ${r.spoiler ? "is-spoiler" : ""}" ${r.spoiler ? `data-spoiler` : ""}>
      ${r.spoiler ? `<span class="spoiler-tag">Contém spoiler. Toque para ler</span>` : ""}<p>${esc(r.text)}</p></div>` : ""}
    <footer class="post-foot">
      <span class="post-acts"><button class="like ${mine ? "is-on" : ""}" data-like="${esc(r.id)}" aria-pressed="${mine}">${HEART}<span>${n || ""}</span></button>
      ${opts.noCmt ? "" : `<button class="like cmt-btn" data-cmt="${esc(r.id)}" aria-label="Comentários">${BUBBLE}<span>${commentCount(r.id) || ""}</span></button>`}</span>
      ${r.uid === auth.uid ? `<button class="post-edit" data-edit="${esc(r.id)}">${PENCIL}Editar</button>` : ""}
      ${opts.hideUser ? `<span class="post-time">${ago(r.at)}</span>` : ""}
    </footer>
  </article>`;
}
function wirePosts(root, refresh) {
  root.querySelectorAll("[data-user]").forEach(b => b.onclick = () => openNetProfile(b.dataset.user, refresh));
  root.querySelectorAll("[data-game]").forEach(b => b.onclick = () => openNetGame(b.dataset.game, b.dataset.title, b.dataset.cover, refresh));
  root.querySelectorAll("[data-spoiler]").forEach(b => b.onclick = () => {
    b.classList.remove("is-spoiler"); b.removeAttribute("data-spoiler");
    const tag = b.querySelector(".spoiler-tag"); if (tag) tag.remove();
    b.onclick = null;
  });
  root.querySelectorAll("[data-like]").forEach(b => b.onclick = async () => {
    const on = !b.classList.contains("is-on");
    const span = b.querySelector("span");
    const n = (parseInt(span.textContent, 10) || 0) + (on ? 1 : -1);
    b.classList.toggle("is-on", on); span.textContent = n > 0 ? n : "";
    try { on ? await dbPut(`likes/${b.dataset.like}/${auth.uid}`, true) : await dbDel(`likes/${b.dataset.like}/${auth.uid}`); }
    catch (_) { toast("Não deu para curtir agora"); }
  });
  root.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => editMyReview(b.dataset.edit, refresh));
  root.querySelectorAll("[data-cmt]").forEach(b => b.onclick = () => openComments(b.dataset.cmt, refresh || (() => { closeSheet(); renderNet(); })));
  root.querySelectorAll("[data-more]").forEach(b => b.onclick = () => {
    const card = b.closest(".post");
    openPostMenu(card.dataset.rid, card.dataset.uid, refresh);
  });
}
function openPostMenu(rid, uid, back) {
  const mineP = uid === auth.uid;
  showSheet(`
    <div class="sheet-top"><button class="icon-btn" data-back aria-label="Voltar">${ICON.back}</button></div>
    <div class="actions" style="margin-top:22px">
      <button class="btn btn-ghost" id="pm-profile">Ver perfil</button>
      ${mineP ? `<button class="btn btn-primary" id="pm-edit">${PENCIL}Editar avaliação</button>
      <button class="btn btn-danger" id="pm-del">Tirar da rede</button>` : `
      <span class="field-label" style="margin:14px 0 0">Denunciar esta avaliação</span>
      <div class="seg" id="pm-reasons">${["Spam", "Ofensiva ou com ódio", "Spoiler sem aviso", "Outro motivo"].map(r => `<button class="chip" data-v="${r}">${r}</button>`).join("")}</div>
      <button class="btn btn-danger" id="pm-block">Bloquear esta pessoa</button>`}
    </div>`, back);
  body.querySelector("#pm-profile").onclick = () => openNetProfile(uid, back);
  const pe = body.querySelector("#pm-edit");
  if (pe) pe.onclick = () => editMyReview(rid, back);
  const pd = body.querySelector("#pm-del");
  if (pd) pd.onclick = async () => {
    if (!pd.dataset.armed) { pd.dataset.armed = "1"; pd.textContent = "Toque de novo para tirar da rede"; return; }
    try {
      await dbDel(`reviews/${rid}`);
      dbDel(`comments/${rid}`).catch(() => {});
      const g = games.find(x => `${auth.uid}_${keyOf(x.title)}` === rid);
      if (g) { g.shared = false; saveGames(); }
      toast("Avaliação tirada da rede. Ela continua na sua estante.");
    } catch (_) { toast("Não deu agora. Tente de novo."); }
    back ? back() : (closeSheet(), renderNet());
  };
  const rs = body.querySelector("#pm-reasons");
  if (rs) rs.onclick = async e => {
    const b = e.target.closest("[data-v]"); if (!b) return;
    try { await dbPost("reports", { by: auth.uid, uid, rid, reason: b.dataset.v, at: Date.now() }); toast("Denúncia enviada. Obrigado por avisar."); }
    catch (_) { toast("Não deu para enviar a denúncia agora"); }
    back ? back() : closeSheet();
  };
  const bl = body.querySelector("#pm-block");
  if (bl) bl.onclick = () => {
    if (!blocked.includes(uid)) blocked.push(uid);
    store.save("backlog.blocked.v1", blocked);
    toast("Pessoa bloqueada. As avaliações dela não aparecem mais para você.");
    renderNet(); closeSheet();
  };
}

/* --- Editar uma avaliação sua --- */
async function editMyReview(rid, back) {
  const g = games.find(x => `${auth.uid}_${keyOf(x.title)}` === rid);
  if (g) {
    // Está na estante: edita direto na ficha do jogo
    openGame(g, null, back);
    const rv = body.querySelector("#f-review");
    if (rv) { rv.scrollIntoView({ block: "center" }); setTimeout(() => { rv.focus(); rv.setSelectionRange(rv.value.length, rv.value.length); }, 250); }
    return;
  }
  let r;
  try { r = await dbGet(`reviews/${rid}`); } catch (_) { toast("Não deu para abrir agora"); return; }
  if (!r) { toast("Essa avaliação não existe mais"); return; }
  const d = { rating: clampRating(r.rating), text: r.text || "", spoiler: !!r.spoiler };
  showSheet(`
    <div class="sheet-top"><button class="icon-btn" data-back aria-label="Voltar">${back ? ICON.back : ICON.close}</button></div>
    <h2 class="hero-title" style="margin-top:18px">Editar avaliação</h2>
    <p class="hero-sub">${esc(r.game)}</p>
    <div class="field"><span class="field-label">Sua nota</span>${starPickerHTML(d.rating)}</div>
    <div class="field"><label class="field-label" for="f-review">Sua análise</label>
      <textarea class="review" id="f-review" maxlength="2000">${esc(d.text)}</textarea></div>
    <button class="chip ${d.spoiler ? "is-on" : ""}" id="e-spoiler">Minha análise tem spoiler</button>
    <div class="actions"><button class="btn btn-primary" id="e-save">Salvar avaliação</button></div>`, back);
  wireStarPicker(body, () => d.rating, v => { d.rating = v; });
  const rv = body.querySelector("#f-review");
  rv.oninput = () => { d.text = rv.value; rv.style.height = "auto"; rv.style.height = Math.max(130, rv.scrollHeight + 2) + "px"; };
  const sp = body.querySelector("#e-spoiler");
  sp.onclick = () => { d.spoiler = !d.spoiler; sp.classList.toggle("is-on", d.spoiler); };
  body.querySelector("#e-save").onclick = async e => {
    const btn = e.currentTarget;
    if (!d.rating && !d.text.trim()) { toast("Dê uma nota ou escreva algo"); return; }
    btn.disabled = true;
    try {
      await dbPut(`reviews/${rid}`, { ...r, rating: d.rating, text: d.text.trim().slice(0, 2000), spoiler: d.spoiler, edited: Date.now() });
      toast("Avaliação atualizada");
      back ? back() : closeSheet();
    } catch (_) { toast("Não deu para salvar agora. Tente de novo."); btn.disabled = false; }
  };
}

/* --- Aba Rede --- */
let netSeg = "recent", netSearch = "";
async function loadLikes() { const [l] = await Promise.all([dbGet("likes").catch(() => null), loadComments()]); return l || {}; }
async function renderNet() {
  const box = $("#net");
  if (!box) return;
  $("#net-me").innerHTML = `<span class="top-actions">${bellHTML()}${socialReady() ? `<button class="avatar-btn" id="net-me-btn" aria-label="Meu perfil público">${avatarHTML(40)}</button>` : ""}</span>`;
  renderBell();
  const meBtn = $("#net-me-btn");
  if (meBtn) meBtn.onclick = () => openNetProfile(auth.uid);
  if (!cloudReady) {
    box.innerHTML = `<div class="empty"><div class="empty-art" aria-hidden="true"><span></span><span></span><span></span></div>
      <p class="empty-title">A rede está chegando</p>
      <p class="empty-text">Aqui você vai ver as avaliações e os perfis de outras pessoas, seguir quem joga o mesmo que você e publicar suas análises. Ela liga numa próxima atualização do app.</p></div>`;
    return;
  }
  if (!auth) {
    box.innerHTML = `<div class="net-intro">
      <p class="empty-title">Entre para ver a rede</p>
      <p class="empty-text">Veja o que a galera está jogando, leia avaliações e publique as suas. Sua estante continua salva no celular, e ganha uma cópia na nuvem.</p>
      ${googleReady ? `<button class="btn btn-google" id="net-google" style="width:100%;margin-top:4px">${GOOGLE_G}Entrar com Google</button>
      <div class="or-line"><span>ou com e-mail</span></div>` : ""}
      <form class="email-form" id="net-login">
        <input class="text-input" id="nl-mail" type="email" autocomplete="email" placeholder="E-mail">
        <input class="text-input" id="nl-pass" type="password" autocomplete="current-password" placeholder="Senha (mínimo 6 caracteres)">
        <p class="form-error" id="nl-err" hidden></p>
        <div class="two-btns"><button class="btn btn-primary" type="submit" data-mode="up">Criar conta</button><button class="btn btn-ghost" type="submit" data-mode="in">Já tenho conta</button></div>
        <button class="link-btn forgot" type="button" id="nl-forgot">Esqueci minha senha</button>
      </form></div>`;
    const f = box.querySelector("#net-login");
    box.querySelector("#nl-forgot").onclick = () => openForgot(box.querySelector("#nl-mail").value.trim());
    const gb = box.querySelector("#net-google");
    if (gb) gb.onclick = async () => {
      gb.disabled = true;
      try {
        await signInGoogle();
        if (!profile.avatarMode && auth.photo && !profile.photoData) { profile.avatarMode = "google"; store.save("backlog.profile.v1", profile); }
        toast("Conta Google conectada"); fullSync(); await checkSocialMe(); renderNet();
      } catch (ex) { const m = authError(ex); if (m) toast(m); gb.disabled = false; }
    };
    f.onsubmit = async e => {
      e.preventDefault();
      const mode = (e.submitter && e.submitter.dataset.mode) || "in", err = f.querySelector("#nl-err");
      const mail = f.querySelector("#nl-mail").value.trim(), pass = f.querySelector("#nl-pass").value;
      err.hidden = true;
      if (!mail || !pass) { err.textContent = "Preencha e-mail e senha."; err.hidden = false; return; }
      f.querySelectorAll("button").forEach(b => b.disabled = true);
      try { await signInEmail(mode, mail, pass); toast("Conta conectada"); fullSync(); await checkSocialMe(); renderNet(); }
      catch (ex) { err.textContent = authError(ex) || "Não foi possível entrar."; err.hidden = false; f.querySelectorAll("button").forEach(b => b.disabled = false); }
    };
    return;
  }
  if (!socialReady()) {
    await checkSocialMe();
    if (!socialReady()) return renderJoin(box);
  }
  box.innerHTML = `
    <div class="segmented" id="net-seg">${[["recent", "Recentes"], ["following", "Seguindo"], ["people", "Pessoas"]].map(([id, l]) =>
      `<button class="${netSeg === id ? "is-on" : ""}" data-s="${id}">${l}</button>`).join("")}</div>
    ${netSeg === "people" ? `<form class="searchbar" id="net-sf" autocomplete="off">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input id="net-q" type="search" placeholder="Buscar @usuário" value="${esc(netSearch)}" enterkeyhint="search"></form>` : ""}
    <div id="net-list" class="net-list">${skeletonRows(4)}</div>`;
  box.querySelector("#net-seg").onclick = e => { const b = e.target.closest("[data-s]"); if (b) { netSeg = b.dataset.s; renderNet(); } };
  const list = box.querySelector("#net-list");
  try {
    if (netSeg === "people") {
      const sf = box.querySelector("#net-sf"), qi = box.querySelector("#net-q");
      let t; qi.oninput = () => { clearTimeout(t); t = setTimeout(() => { netSearch = qi.value.trim(); drawPeople(list); }, 350); };
      sf.onsubmit = e => { e.preventDefault(); netSearch = qi.value.trim(); drawPeople(list); };
      return drawPeople(list);
    }
    const [revs, likes, fol] = await Promise.all([
      dbGet("reviews", { orderBy: q("at"), limitToLast: netSeg === "following" ? "300" : "60" }),
      loadLikes(),
      netSeg === "following" ? dbGet(`following/${auth.uid}`) : Promise.resolve(null)
    ]);
    let items = listOf(revs).sort((a, b) => b.at - a.at);
    if (netSeg === "following") { const set = new Set(Object.keys(fol || {})); items = items.filter(r => set.has(r.uid)).slice(0, 60); }
    if (!items.length) {
      list.innerHTML = netSeg === "following"
        ? `<p class="hero-sub net-empty">Você ainda não segue ninguém. Abra a aba Pessoas ou toque no nome de alguém para seguir.</p>`
        : `<p class="hero-sub net-empty">Ninguém publicou ainda. Seja a primeira pessoa: abra um jogo da sua estante, dê uma nota e deixe "Publicar na rede" ligado.</p>`;
      return;
    }
    const profs = new Map(await Promise.all([...new Set(items.map(r => r.uid))].map(async u => [u, await getProfile(u)])));
    list.innerHTML = items.map(r => postHTML(r, profs.get(r.uid), likes)).join("");
    wirePosts(list);
  } catch (e) {
    list.innerHTML = `<p class="hero-sub net-empty">${/40[13]/.test(String(e.message)) ? "A rede recusou o acesso. Saia e entre de novo na conta em Ajustes > Perfil." : "Não deu para carregar a rede. Confira a internet e puxe de novo tocando na aba."}</p>`;
  }
}
async function drawPeople(list) {
  list.innerHTML = skeletonRows(4);
  const h = netSearch.replace(/^@/, "").toLowerCase();
  let res;
  try {
    res = h ? await dbGet("profiles", { orderBy: q("handle"), startAt: q(h), endAt: q(h + ""), limitToFirst: "30" })
            : await dbGet("profiles", { orderBy: q("handle"), limitToFirst: "40" });
  } catch (_) { list.innerHTML = `<p class="hero-sub net-empty">Não deu para buscar agora.</p>`; return; }
  const people = Object.entries(res || {}).filter(([u]) => !blocked.includes(u)).map(([u, p]) => ({ uid: u, ...p }));
  list.innerHTML = people.length ? `<ul class="rows" style="padding:0">${people.map(p => `<li><button class="row person" data-user="${esc(p.uid)}">
      ${avatarFor(p, 52)}
      <div><div class="row-title">${esc(p.name || p.handle)}${p.uid === auth.uid ? ` <span class="tag">Você</span>` : ""}</div>
      <div class="row-sub">@${esc(p.handle)}${p.stats ? `, ${p.stats.done || 0} zerados` : ""}</div></div>
      <span class="row-chev">${ICON.chev}</span></button></li>`).join("")}</ul>`
    : `<p class="hero-sub net-empty">${h ? `Ninguém com @${esc(h)}.` : "Ninguém por aqui ainda."}</p>`;
  list.querySelectorAll("[data-user]").forEach(b => b.onclick = () => openNetProfile(b.dataset.user));
}
async function checkSocialMe() {
  if (!cloudReady || !auth) return;
  if (socialMe && socialMe.uid === auth.uid && socialMe.handle) return;
  try {
    const p = await dbGet(`profiles/${auth.uid}`);
    socialMe = p && p.handle ? { uid: auth.uid, handle: p.handle } : null;
    store.save("backlog.social.v1", socialMe);
  } catch (_) {}
}
function renderJoin(box) {
  const suggestion = (profile.name || (auth.email || "").split("@")[0] || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9_.]/g, "").slice(0, 20);
  box.innerHTML = `<div class="net-intro">
    <p class="empty-title">Crie seu perfil público</p>
    <p class="empty-text">Escolha um @ para as pessoas te acharem. Aparecem para os outros: seu nome, foto, frase, jogo favorito, números da estante e só as avaliações que você publicar.</p>
    <form class="email-form" id="join">
      <div class="handle-input"><span>@</span><input class="text-input" id="j-handle" maxlength="20" autocomplete="off" autocapitalize="none" placeholder="seu_usuario" value="${esc(suggestion)}"></div>
      <input class="text-input" id="j-name" maxlength="40" placeholder="Seu nome" value="${esc(profile.name)}">
      ${games.some(g => g.rating || (g.review || "").trim()) ? `<div class="switch-row panel" style="margin:0">
        <div><b>Publicar minhas notas atuais</b><span>${games.filter(g => g.rating || (g.review || "").trim()).length} jogos com nota ou análise. Dá para esconder qualquer um depois.</span></div>
        <button type="button" class="switch" id="j-pub" role="switch" aria-checked="false" aria-label="Publicar minhas notas atuais"></button>
      </div>` : ""}
      <p class="form-error" id="j-err" hidden></p>
      <button class="btn btn-primary" type="submit">Entrar na rede</button>
      <p class="panel-note" style="margin:0">Ao entrar, você concorda em respeitar as outras pessoas. Avaliações ofensivas podem ser denunciadas.</p>
    </form></div>`;
  const f = box.querySelector("#join");
  const pub = f.querySelector("#j-pub");
  if (pub) pub.onclick = () => { const on = !pub.classList.contains("is-on"); pub.classList.toggle("is-on", on); pub.setAttribute("aria-checked", on); };
  f.onsubmit = async e => {
    e.preventDefault();
    const err = f.querySelector("#j-err"), btn = f.querySelector("button");
    const h = f.querySelector("#j-handle").value.trim().replace(/^@/, "").toLowerCase();
    const name = f.querySelector("#j-name").value.trim();
    err.hidden = true;
    if (!/^[a-z0-9_.]{3,20}$/.test(h)) { err.textContent = "Use de 3 a 20 letras, números, ponto ou _ (sem espaço nem acento)."; err.hidden = false; return; }
    btn.disabled = true;
    try {
      const owner = await dbGet(`handles/${h}`);
      if (owner && owner !== auth.uid) throw userErr("Esse @ já está em uso. Tente outro.");
      if (!owner) await dbPut(`handles/${h}`, auth.uid).catch(() => { throw userErr("Esse @ já está em uso. Tente outro."); });
      if (name) { profile.name = name; store.save("backlog.profile.v1", profile); }
      socialMe = { uid: auth.uid, handle: h };
      store.save("backlog.social.v1", socialMe);
      await publishProfile();
      // As notas antigas só vão para a rede se a pessoa ligou a opção
      const publishOld = !!(pub && pub.classList.contains("is-on"));
      games.forEach(g => { if (g.shared === undefined) g.shared = publishOld; });
      if (publishOld) await Promise.allSettled(games.filter(g => g.shared && (g.rating || (g.review || "").trim())).map(syncReview));
      saveGames();
      toast(`Bem-vindo à rede, @${h}!`);
      renderNet();
    } catch (ex) {
      err.textContent = ex.userMessage || "Não deu para criar o perfil agora. Tente de novo."; err.hidden = false; btn.disabled = false;
    }
  };
}

/* --- Perfil de outra pessoa --- */
async function openNetProfile(uid, back) {
  showSheet(`<div class="sheet-top"><button class="icon-btn" data-back aria-label="Voltar">${back ? ICON.back : ICON.close}</button></div>
    <div id="np">${skeletonRows(4)}</div>`, back, () => openNetProfile(uid, back));
  const box = body.querySelector("#np");
  let p, revs, likes, fol, nlists;
  try {
    profCache.delete(uid);
    [p, revs, likes, fol, nlists] = await Promise.all([getProfile(uid), dbGet("reviews", { orderBy: q("uid"), equalTo: q(uid) }), loadLikes(),
      uid === auth.uid ? null : dbGet(`following/${auth.uid}/${uid}`), dbGet("lists", { orderBy: q("uid"), equalTo: q(uid) }).catch(() => null)]);
  } catch (_) { if (box) box.innerHTML = `<p class="hero-sub">Não deu para abrir esse perfil agora.</p>`; return; }
  if (!box) return;
  if (!p) { box.innerHTML = `<p class="hero-sub">Esse perfil não existe mais.</p>`; return; }
  const me = uid === auth.uid;
  const items = listOf(revs).sort((a, b) => b.at - a.at);
  const s = p.stats || {};
  box.innerHTML = `
    <div class="profile-hero">
      ${avatarFor(p, 96)}
      <h2 class="hero-title" style="margin-top:8px">${esc(p.name || p.handle)}</h2>
      <div class="hero-sub" style="margin:0">@${esc(p.handle)}${p.favPlatform ? `, joga mais no ${esc(platLabel(p.favPlatform))}` : ""}</div>
      ${p.bio ? `<p class="np-bio">${esc(p.bio)}</p>` : ""}
      <div class="actions two-btns" style="width:100%;margin-top:14px">
        ${me ? `<button class="btn btn-ghost" id="np-edit">Editar perfil</button>`
          : `<button class="btn ${fol ? "btn-ghost" : "btn-primary"}" id="np-follow">${fol ? "Seguindo" : "Seguir"}</button>`}
        <button class="btn btn-ghost" id="np-share">${SHARE}Compartilhar</button>
      </div>
      ${me ? "" : `<button class="btn btn-ghost" id="np-cmp" style="width:100%;margin-top:10px">${CMP_ICO}Comparar estantes</button>`}
    </div>
    <div class="stats-grid">
      <div class="stat"><b>${s.games || 0}</b><span>jogos</span></div>
      <div class="stat"><b>${s.done || 0}</b><span>zerados</span></div>
      <div class="stat"><b>${fmtH(s.hours || 0)} h</b><span>jogadas</span></div>
      <div class="stat"><b>${items.length}</b><span>${items.length === 1 ? "avaliação" : "avaliações"}</span></div>
      <div class="stat"><b>${s.avg ? fmtH(s.avg) : "–"}</b><span>nota média</span></div>
      <div class="stat"><b>${p.goal ? `${p.goal.done}/${p.goal.games}` : "–"}</b><span>${p.goal ? `meta ${p.goal.year}` : "sem meta"}</span></div>
    </div>
    ${p.favGame ? `<div class="field"><span class="field-label">Jogo favorito</span>
      <div class="np-fav">${coverHTML([safeImg(p.favGame.cover)].filter(Boolean), p.favGame.title)}<b>${esc(p.favGame.title)}</b></div></div>` : ""}
    ${(() => { const ls = Object.entries(nlists || {}).map(([id, v]) => ({ id, ...v })).filter(l => l && l.name).sort((a, b) => (b.at || 0) - (a.at || 0));
      return ls.length || me ? `<div class="field"><span class="field-label">Listas <small class="count">${ls.length}</small></span>
      ${ls.length ? `<ul class="rows" style="padding:0">${ls.map(l => `<li><button class="row list-row" data-nl="${esc(l.id)}">
        ${listStackHTML(toArr(l.items), it => [safeImg(it.cover)].filter(Boolean))}
        <div><div class="row-title">${esc(l.name)}</div><div class="row-sub">${l.count || toArr(l.items).length} jogos${l.ranked ? ", ranking" : ""}</div></div>
        <span class="row-chev">${ICON.chev}</span></button></li>`).join("")}</ul>` : `<p class="hero-sub" style="margin:0">Nenhuma lista no perfil. <button class="link-btn" id="np-lists" style="margin:0">Criar uma</button></p>`}</div>` : ""; })()}
    <div class="field"><span class="field-label">Avaliações</span>
      <div class="net-list" id="np-list">${items.length ? items.map(r => postHTML(r, p, likes, { hideUser: true })).join("") : `<p class="hero-sub" style="margin:0">${me ? "Você ainda não publicou nenhuma avaliação." : "Nenhuma avaliação publicada ainda."}</p>`}</div>
    </div>`;
  const reopen = () => openNetProfile(uid, back);
  wirePosts(box.querySelector("#np-list"), reopen);
  const sh = box.querySelector("#np-share");
  if (sh) sh.onclick = () => {
    const covers = me ? myProfileShareData().covers : items.filter(r => r.status === "done" && safeImg(r.cover)).slice(0, 4).map(r => safeImg(r.cover));
    openShareCard({ kind: "profile", p: { ...p, photo: safeImg(p.photo), coversLabel: me ? "Últimos zerados" : "Zerados recentes" }, covers }, reopen);
  };
  const ed = box.querySelector("#np-edit");
  if (ed) ed.onclick = () => openProfile();
  const cmp = box.querySelector("#np-cmp");
  if (cmp) cmp.onclick = () => openCompare(uid, p, reopen);
  const npl = box.querySelector("#np-lists");
  if (npl) npl.onclick = () => openLists(reopen);
  box.querySelectorAll("[data-nl]").forEach(b => b.onclick = () => openNetList({ ...nlists[b.dataset.nl] }, p, reopen));
  const fb = box.querySelector("#np-follow");
  if (fb) fb.onclick = async () => {
    fb.disabled = true;
    try {
      if (fol) await dbDel(`following/${auth.uid}/${uid}`); else await dbPut(`following/${auth.uid}/${uid}`, Date.now());
      fol = !fol; fb.textContent = fol ? "Seguindo" : "Seguir"; fb.className = `btn ${fol ? "btn-ghost" : "btn-primary"}`;
      toast(fol ? `Agora você segue @${p.handle}` : `Você deixou de seguir @${p.handle}`);
    } catch (_) { toast("Não deu agora. Tente de novo."); }
    fb.disabled = false;
  };
}

/* --- Avaliações de um jogo na rede --- */
async function netGameSummary(title) {
  const r = await dbGet("reviews", { orderBy: q("gameKey"), equalTo: q(keyOf(title)) });
  const items = listOf(r);
  const rated = items.filter(x => x.rating);
  return { items, count: items.length, avg: rated.length ? rated.reduce((a, x) => a + x.rating, 0) / rated.length : 0 };
}
async function openNetGame(gameKey, title, cover, back) {
  showSheet(`<div class="sheet-top"><button class="icon-btn" data-back aria-label="Voltar">${back ? ICON.back : ICON.close}</button></div>
    <div class="hero">${coverHTML([cover].filter(Boolean), title)}<div><h2 class="hero-title">${esc(title)}</h2><div class="hero-sub" id="ng-sum">Carregando avaliações…</div></div></div>
    <div class="actions" id="ng-act"></div>
    <div class="net-list" id="ng-list">${skeletonRows(3)}</div>`, back, () => openNetGame(gameKey, title, cover, back));
  let sum, likes;
  try { [sum, likes] = await Promise.all([netGameSummary(title), loadLikes()]); }
  catch (_) { const el = body.querySelector("#ng-list"); if (el) el.innerHTML = `<p class="hero-sub">Não deu para carregar agora.</p>`; return; }
  const list = body.querySelector("#ng-list");
  if (!list) return;
  body.querySelector("#ng-sum").innerHTML = sum.count
    ? `${sum.avg ? `${starsHTML(Math.round(sum.avg * 2) / 2, "minstars big-stars")} <b>${fmtH(Math.round(sum.avg * 10) / 10)}</b> de média, ` : ""}${sum.count} ${sum.count === 1 ? "avaliação" : "avaliações"} na rede`
    : "Ninguém avaliou esse jogo na rede ainda.";
  const owned = games.find(g => norm(g.title) === norm(title));
  const act = body.querySelector("#ng-act");
  act.innerHTML = owned ? `<button class="btn btn-ghost" id="ng-open">Abrir na minha estante</button>` : `<button class="btn btn-primary" id="ng-add">Adicionar à minha estante</button>`;
  const reopen = () => openNetGame(gameKey, title, cover, back);
  if (owned) act.querySelector("#ng-open").onclick = () => openGame(owned, null, reopen);
  else act.querySelector("#ng-add").onclick = () => openGame(null, { title, year: "", covers: [cover].filter(Boolean) }, reopen);
  const profs = new Map(await Promise.all([...new Set(sum.items.map(r => r.uid))].map(async u => [u, await getProfile(u)])));
  list.innerHTML = sum.items.sort((a, b) => b.at - a.at).map(r => postHTML(r, profs.get(r.uid), likes, { hideGame: true })).join("");
  wirePosts(list, reopen);
}

/* --- Sair da rede --- */
async function leaveNetwork() {
  const revs = await dbGet("reviews", { orderBy: q("uid"), equalTo: q(auth.uid) }).catch(() => ({}));
  await Promise.allSettled(Object.keys(revs || {}).map(id => dbDel(`reviews/${id}`)));
  await dbDel(`following/${auth.uid}`).catch(() => {});
  await dbDel(`shelves/${auth.uid}`).catch(() => {});
  await Promise.allSettled(lists.filter(l => l.public).map(l => dbDel(`lists/${auth.uid}_${l.id}`)));
  lists.forEach(l => { l.public = false; }); saveLists();
  await dbDel(`profiles/${auth.uid}`).catch(() => {});
  if (socialMe && socialMe.handle) await dbDel(`handles/${socialMe.handle}`).catch(() => {});
  games.forEach(g => { delete g.shared; });
  saveGames();
  socialMe = null; store.save("backlog.social.v1", null);
}
function socialSettingsHTML() {
  if (!cloudReady || !auth || !socialReady()) return "";
  return `<div class="group">
    <h2 class="group-title">Rede</h2>
    <div class="card-list">
      <div class="setting"><button class="setting-btn" id="s-net-me">
        <div><div class="setting-name">Meu perfil público</div><div class="setting-desc">@${esc(socialMe.handle)}</div></div>
        <span class="row-chev">${ICON.chev}</span></button></div>
      <div class="setting"><div class="switch-row">
        <div><div class="setting-name">Estante visível para comparar</div><div class="setting-desc">Outras pessoas podem comparar a estante delas com a sua (jogos, status, notas e horas).</div></div>
        <button class="switch ${profile.shelfPublic ? "is-on" : ""}" id="s-shelf" role="switch" aria-checked="${!!profile.shelfPublic}" aria-label="Estante visível para comparar"></button></div></div>
      <div class="setting"><button class="setting-btn" id="s-net-blocked">
        <div><div class="setting-name">Pessoas bloqueadas</div><div class="setting-desc">${blocked.length ? `${blocked.length} ${blocked.length === 1 ? "pessoa" : "pessoas"}. Toque para desbloquear todas.` : "Ninguém bloqueado"}</div></div>
        </button></div>
      <div class="setting"><button class="setting-btn danger" id="s-net-leave">
        <div><div class="setting-name">Sair da rede</div><div class="setting-desc">Apaga seu perfil público, seu @ e todas as avaliações publicadas. Sua estante não muda.</div></div>
        </button></div>
    </div>
  </div>`;
}
function wireSocialSettings() {
  const me = $("#s-net-me"); if (me) me.onclick = () => openNetProfile(auth.uid);
  const sh = $("#s-shelf");
  if (sh) sh.onclick = async () => {
    profile.shelfPublic = !profile.shelfPublic; saveProfile();
    sh.classList.toggle("is-on", profile.shelfPublic); sh.setAttribute("aria-checked", profile.shelfPublic);
    try { await publishProfile(); toast(profile.shelfPublic ? "Sua estante agora pode ser comparada" : "Sua estante não aparece mais para comparar"); }
    catch (_) { toast("Não deu para atualizar agora"); }
  };
  const bl = $("#s-net-blocked");
  if (bl) bl.onclick = () => { if (!blocked.length) return; blocked = []; store.save("backlog.blocked.v1", blocked); toast("Todas as pessoas foram desbloqueadas"); renderSettings(); };
  const lv = $("#s-net-leave");
  if (lv) lv.onclick = async () => {
    if (!lv.dataset.armed) { lv.dataset.armed = "1"; lv.querySelector(".setting-name").textContent = "Toque de novo para sair da rede"; setTimeout(() => { if (lv.isConnected) renderSettings(); }, 3500); return; }
    lv.disabled = true;
    try { await leaveNetwork(); toast("Você saiu da rede. Seu perfil público foi apagado."); }
    catch (_) { toast("Não deu para sair agora. Tente de novo."); }
    renderSettings();
  };
}

/* =========================================================
   Puxar para atualizar
   ========================================================= */
async function refreshCurrent() {
  if (!sheet.hidden) { if (sheetReload) await sheetReload(); return; }
  checkNotifs();
  if (currentView === "library") {
    if (cloudReady && auth) await fullSync();
    ensureCovers();
    renderLibrary();
  } else if (currentView === "search") await runSearch($("#search-input").value);
  else if (currentView === "explore") {
    if (exploreSeg === "trending") await renderTrending(true);
    else { hltbToken = null; await renderHltb(true); }
  } else if (currentView === "net") { profCache.clear(); await renderNet(); }
  else if (currentView === "ach") { renderTracked(); syncSteamAchievements(true); if ($("#ach-input").value.trim()) await runAchSearch($("#ach-input").value); }
  else if (currentView === "settings") renderSettings();
}
(function pullToRefresh() {
  const ind = document.createElement("div");
  ind.className = "ptr";
  ind.setAttribute("aria-hidden", "true");
  ind.innerHTML = `<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4h-4"/></svg>`;
  document.body.appendChild(ind);
  let startY = null, d = 0, busy = false;
  const scroller = () => (!sheet.hidden ? body : document.scrollingElement || document.documentElement);
  const canPull = () => sheet.hidden || !!sheetReload;
  const set = v => {
    ind.style.transform = `translate(-50%, ${v - 50}px) rotate(${v * 4}deg)`;
    ind.style.opacity = Math.min(1, v / 50);
    ind.classList.toggle("is-ready", v >= 70);
  };
  document.addEventListener("touchstart", e => {
    if (busy || e.touches.length > 1 || !canPull() || scroller().scrollTop > 2) { startY = null; return; }
    if (e.target.closest("textarea, input, .rail, .chips")) { startY = null; return; }
    startY = e.touches[0].clientY; d = 0;
  }, { passive: true });
  document.addEventListener("touchmove", e => {
    if (startY == null) return;
    const dy = e.touches[0].clientY - startY;
    if (dy <= 0) { d = 0; set(0); return; }
    d = Math.min(110, dy * 0.5);
    set(d);
  }, { passive: true });
  document.addEventListener("touchend", async () => {
    if (startY == null) return;
    startY = null;
    if (d < 70) { ind.classList.add("is-back"); set(0); setTimeout(() => ind.classList.remove("is-back"), 200); return; }
    busy = true;
    ind.classList.add("is-loading");
    set(70);
    try { await refreshCurrent(); } catch (_) {}
    ind.classList.remove("is-loading");
    ind.classList.add("is-back"); set(0);
    setTimeout(() => ind.classList.remove("is-back"), 200);
    busy = false;
  });
  window.__refresh = refreshCurrent;
})();

/* =========================================================
   Capas que faltam
   1) Steam: jogos novos guardam a capa numa pasta com código;
      o serviço público da loja diz o endereço certo (até 50 jogos por vez).
   2) Qualquer outro jogo: capa do HowLongToBeat pelo nome.
   ========================================================= */
let steamArt = store.load("backlog.steamArt.v1", {});
let titleArt = store.load("backlog.titleArt.v1", {});
const steamArtCovers = id => { const a = steamArt[id]; return a && !a.none ? [a.cover, a.header || a.capsule].filter(Boolean) : null; };
async function steamAssets(ids) {
  const need = [...new Set(ids.map(Number).filter(id => id && !steamArt[id]))];
  for (let i = 0; i < need.length; i += 50) {
    const chunk = need.slice(i, i + 50);
    const inp = { ids: chunk.map(appid => ({ appid })), context: { language: "brazilian", country_code: "BR" }, data_request: { include_assets: true } };
    try {
      const d = await getJSON("https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=" + encodeURIComponent(JSON.stringify(inp)));
      const got = new Set();
      (d.response?.store_items || []).forEach(it => {
        const a = it.assets || {}, fmt = a.asset_url_format;
        got.add(it.appid);
        if (!fmt) { steamArt[it.appid] = { none: 1 }; return; }
        const u = f => f ? "https://shared.akamai.steamstatic.com/store_item_assets/" + fmt.replace("${FILENAME}", f) : "";
        steamArt[it.appid] = { cover: u(a.library_capsule), header: u(a.header), capsule: u(a.main_capsule) };
      });
      chunk.forEach(id => { if (!got.has(id)) steamArt[id] = { none: 1 }; });
    } catch (_) { /* tenta de novo outra hora */ }
  }
  store.save("backlog.steamArt.v1", steamArt);
  return steamArt;
}
async function titleCover(title) {
  const k = norm(title);
  if (k in titleArt) return titleArt[k];
  let url = "";
  try {
    const r = await hltbSearch({ terms: cleanWikiTitle(title).replace(/[™®©]/g, "").split(/\s+/).filter(Boolean) });
    const hit = r.items.find(x => norm(x.title) === k) || r.items.find(x => norm(x.title).startsWith(k)) || r.items[0];
    url = hit && hit.covers[0] || "";
  } catch (_) { return ""; }
  titleArt[k] = url;
  store.save("backlog.titleArt.v1", titleArt);
  return url;
}
/* Corrige a capa guardada dos jogos da estante que estavam sem imagem */
function fixGameCover(match, covers) {
  let changed = false;
  games.forEach(g => {
    if (!match(g) || (g.cover && g.cover.startsWith("file:"))) return;
    if (g.coverRemote === covers[0]) return;
    g.coverRemote = covers[0]; g.coverAlts = covers.slice(1); g.cover = "";
    changed = true;
  });
  if (changed) { clearTimeout(fixGameCover.t); fixGameCover.t = setTimeout(() => { store.save("backlog.games.v1", games); ensureCovers(); }, 600); }
}
function rescueCover(img) {
  const holder = img.parentElement;
  if (!holder) return false;
  const sid = holder.dataset.steam, title = holder.dataset.title;
  if (sid && !img.dataset.triedSteam && !(steamArt[sid] && steamArt[sid].tried)) {
    img.dataset.triedSteam = "1";
    steamAssets([sid]).then(() => {
      const c = steamArtCovers(sid);
      if (c && c[0] && img.isConnected && c[0] !== img.src) {
        img.dataset.alts = c.slice(1).join("|"); img.src = c[0];
        fixGameCover(g => String(g.steamId) === String(sid), c);
      } else { if (steamArt[sid]) steamArt[sid].tried = 1; rescueCover(img) || img.remove(); }
    });
    return true;
  }
  if (title && !img.dataset.triedTitle) {
    img.dataset.triedTitle = "1";
    titleCover(title).then(u => {
      if (u && img.isConnected && u !== img.src) {
        img.dataset.alts = ""; img.src = u;
        fixGameCover(g => norm(g.title) === norm(title), [u]);
      } else if (img.isConnected) img.remove();
    });
    return true;
  }
  return false;
}

/* =========================================================
   Notificações (sininho)
   ========================================================= */
let notifs = store.load("backlog.notifs.v1", []);
let notifSeen = store.load("backlog.notifSeen.v1", {});
const BELL = '<svg viewBox="0 0 24 24"><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2H4.5z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>';
const N_ICON = {
  update: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M5 19h14"/></svg>',
  like: '<svg viewBox="0 0 24 24"><path d="M12 20s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.6-7.5 10-7.5 10z" fill="currentColor"/></svg>',
  goal: '<svg viewBox="0 0 24 24"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
  comment: '<svg viewBox="0 0 24 24"><path d="M5 18.5V7.5A2.5 2.5 0 0 1 7.5 5h9A2.5 2.5 0 0 1 19 7.5v6a2.5 2.5 0 0 1-2.5 2.5H9z"/></svg>',
  wrap: '<svg viewBox="0 0 24 24"><path d="M12 3l2.2 5.6L20 9.3l-4.4 3.9 1.3 5.8L12 16l-4.9 3 1.3-5.8L4 9.3l5.8-.7z"/></svg>'
};
const saveNotifs = () => { store.save("backlog.notifs.v1", notifs); renderBell(); };
function addNotif(n) {
  if (notifs.some(x => x.id === n.id)) return;
  notifs.unshift({ read: false, t: Date.now(), ...n });
  notifs = notifs.slice(0, 80);
  saveNotifs();
}
const unreadCount = () => notifs.filter(n => !n.read).length;
function bellHTML() {
  const n = unreadCount();
  return `<button class="bell" data-bell aria-label="Notificações${n ? `, ${n} novas` : ""}">${BELL}${n ? `<i class="bell-dot">${n > 9 ? "9+" : n}</i>` : ""}</button>`;
}
function renderBell() {
  document.querySelectorAll("[data-bell]").forEach(b => { b.outerHTML = bellHTML(); });
  document.querySelectorAll("[data-bell]").forEach(b => b.onclick = () => openNotifs());
}

let notifChecking = false;
async function checkNotifs() {
  if (notifChecking) return;
  notifChecking = true;
  try {
    // Versão nova do app (no máximo a cada 30 min)
    if (Native && APP.build && Date.now() - (notifSeen.updAt || 0) > 30 * 60 * 1000) {
      notifSeen.updAt = Date.now();
      try {
        const u = await findUpdate();
        if (u) { updateInfo = u; addNotif({ id: "upd_" + u.tag, type: "update", text: `Versão ${u.tag} disponível`, sub: (u.notes || "").split("\n")[0].slice(0, 120), act: { kind: "update" } }); }
      } catch (_) {}
    }
    // Meta do ano batida
    const y = new Date().getFullYear(), goal = profile.goals && profile.goals[y];
    if (new Date().getMonth() === 11 && doneIn(y).length) addNotif({ id: `wrap_${y}`, type: "wrap", text: `Sua retrospectiva de ${y} está pronta`, sub: `${doneIn(y).length} zerados. Veja seu ano nos jogos e compartilhe.`, act: { kind: "wrap", year: y } });
    if (goal && doneIn(y).length >= goal.games) addNotif({ id: `goal_${y}_${goal.games}`, type: "goal", text: `Você bateu a meta de ${y}!`, sub: `${doneIn(y).length} jogos zerados de ${goal.games}`, act: { kind: "goal" } });

    if (!socialReady()) return;
    if (notifSeen.uid !== auth.uid) notifSeen = { uid: auth.uid, updAt: notifSeen.updAt };
    const [fol, likes, revs] = await Promise.all([
      dbGet("following").catch(() => null), loadLikes(),
      dbGet("reviews", { orderBy: q("at"), limitToLast: "100" }).catch(() => null)
    ]);
    // Novos seguidores
    const followers = Object.entries(fol || {}).filter(([u, m]) => u !== auth.uid && m && m[auth.uid] && !blocked.includes(u)).map(([u]) => u);
    if (Array.isArray(notifSeen.followers)) {
      for (const u of followers.filter(u => !notifSeen.followers.includes(u))) {
        const p = await getProfile(u);
        addNotif({ id: `fol_${u}_${Date.now()}`, type: "follow", text: `@${p ? p.handle : "alguém"} começou a seguir você`, sub: p && p.name ? p.name : "", act: { kind: "profile", uid: u }, who: p ? { name: p.name, handle: p.handle, color: p.color, photo: safeImg(p.photo) } : null });
      }
    }
    notifSeen.followers = followers;
    // Curtidas nas suas avaliações
    const pairs = [];
    Object.entries(likes || {}).forEach(([rid, users]) => { if (rid.startsWith(auth.uid + "_")) Object.keys(users || {}).forEach(u => { if (u !== auth.uid && !blocked.includes(u)) pairs.push(rid + "|" + u); }); });
    if (Array.isArray(notifSeen.likes)) {
      for (const pr of pairs.filter(x => !notifSeen.likes.includes(x))) {
        const [rid, u] = pr.split("|");
        const p = await getProfile(u);
        const gk = rid.slice(auth.uid.length + 1);
        const g = games.find(x => keyOf(x.title) === gk);
        addNotif({ id: "like_" + pr, type: "like", text: `@${p ? p.handle : "alguém"} curtiu sua avaliação`, sub: g ? g.title : "", act: { kind: "profile", uid: auth.uid } });
      }
    }
    notifSeen.likes = pairs;
    // Avaliações de quem você segue
    const following = new Set(Object.keys((fol || {})[auth.uid] || {}));
    if (notifSeen.reviewsAt) {
      Object.entries(revs || {}).filter(([, r]) => r && following.has(r.uid) && r.at > notifSeen.reviewsAt && !blocked.includes(r.uid))
        .sort((a, b) => a[1].at - b[1].at)
        .forEach(([id, r]) => addNotif({ id: `rev_${id}_${r.at}`, type: "review", text: `@${r.handle} avaliou ${r.game}`, sub: r.rating ? starsText(r.rating) : (r.text || "").slice(0, 80), cover: safeImg(r.cover), act: { kind: "game", gameKey: r.gameKey, title: r.game, cover: safeImg(r.cover) } }));
    }
    notifSeen.reviewsAt = Date.now();
    // Comentários nas suas avaliações e nas conversas em que você comentou
    const cms = await loadComments();
    if (notifSeen.cmtAt) {
      const found = [];
      Object.entries(cms || {}).forEach(([rid, list]) => {
        const all = Object.values(list || {}).filter(c => c && c.uid);
        const mineRev = rid.startsWith(auth.uid + "_"), joined = all.some(c => c.uid === auth.uid);
        if (!mineRev && !joined) return;
        all.filter(c => c.uid !== auth.uid && c.at > notifSeen.cmtAt && !blocked.includes(c.uid)).forEach(c => found.push({ rid, c, mineRev }));
      });
      for (const { rid, c, mineRev } of found.sort((a, b) => a.c.at - b.c.at)) {
        let gname = "";
        if (mineRev) { const g = games.find(x => keyOf(x.title) === rid.slice(auth.uid.length + 1)); gname = g ? g.title : ""; }
        addNotif({ id: `cmt_${rid}_${c.at}_${c.uid}`, type: "comment", text: mineRev ? `@${c.handle} comentou na sua avaliação${gname ? ` de ${gname}` : ""}` : `@${c.handle} também comentou numa avaliação`, sub: (c.text || "").slice(0, 100), act: { kind: "comments", rid } });
      }
    }
    notifSeen.cmtAt = Date.now();
  } finally {
    store.save("backlog.notifSeen.v1", notifSeen);
    notifChecking = false;
  }
}

function notifIcon(n) {
  if (n.type === "follow") return avatarFor(n.who || { handle: "?", color: "#FFD21F" }, 44);
  if (n.type === "review") return `<span class="n-cover">${coverHTML([n.cover].filter(Boolean), n.text)}</span>`;
  return `<span class="n-ico n-${n.type}">${N_ICON[n.type] || BELL}</span>`;
}
function openNotifs() {
  const fresh = notifs.filter(n => !n.read), old = notifs.filter(n => n.read);
  const row = (n, i) => `<li><button class="n-row ${n.read ? "" : "is-new"}" data-n="${i}">
      ${notifIcon(n)}
      <span class="n-text"><b>${esc(n.text)}</b>${n.sub ? `<small>${esc(n.sub)}</small>` : ""}</span>
      <span class="n-time">${ago(n.t)}</span></button></li>`;
  showSheet(`
    <div class="sheet-top"><button class="icon-btn" data-back aria-label="Fechar">${ICON.close}</button>
      ${notifs.length ? `<button class="link-btn" id="n-clear" style="margin:0">Limpar tudo</button>` : ""}</div>
    <h2 class="hero-title" style="margin-top:18px">Notificações</h2>
    ${!notifs.length ? `<p class="hero-sub">Nada novo por aqui. Quando alguém seguir você, curtir suas avaliações, quem você segue avaliar um jogo ou sair versão nova do app, aparece aqui.</p>
      ${!socialReady() ? `<p class="panel-note">Entre na aba Rede para receber avisos de seguidores e curtidas.</p>` : ""}` : ""}
    ${fresh.length ? `<div class="n-group">Novas</div><ul class="n-list">${fresh.map(n => row(n, notifs.indexOf(n))).join("")}</ul>` : ""}
    ${old.length ? `<div class="n-group">Anteriores</div><ul class="n-list">${old.map(n => row(n, notifs.indexOf(n))).join("")}</ul>` : ""}`,
    null, async () => { await checkNotifs(); openNotifs(); });
  const snapshot = notifs.slice();
  body.querySelectorAll("[data-n]").forEach(b => b.onclick = () => {
    const n = snapshot[+b.dataset.n], a = n.act || {}, back = () => openNotifs();
    if (a.kind === "profile" && socialReady()) openNetProfile(a.uid, back);
    else if (a.kind === "game" && socialReady()) openNetGame(a.gameKey, a.title, a.cover, back);
    else if (a.kind === "update") { if (updateInfo) { updateState = updateState === "ready" ? "ready" : "idle"; openUpdateSheet(); } else { go("settings"); closeSheet(); } }
    else if (a.kind === "goal") openGoals();
    else if (a.kind === "comments" && socialReady()) openComments(a.rid, back);
    else if (a.kind === "wrap") { closeSheet(); openWrap(a.year); }
  });
  const clr = body.querySelector("#n-clear");
  if (clr) clr.onclick = () => { notifs = []; saveNotifs(); openNotifs(); };
  // Abriu: tudo vira lido
  if (fresh.length) { notifs.forEach(n => { n.read = true; }); saveNotifs(); }
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) checkNotifs(); });
setInterval(() => { if (!document.hidden) checkNotifs(); }, 5 * 60 * 1000);

/* =========================================================
   Busca dentro de "Em alta agora"
   ========================================================= */
let trendQ = "", trendSearchToken = 0, trendResults = [];
async function runTrendSearch(qs) {
  const list = $("#trending-list");
  trendQ = qs.trim();
  if (!trendQ) { trendResults = []; return renderTrending(true); }
  if (trend.stop) { trend.stop(); trend.stop = null; }
  const tok = ++trendSearchToken;
  list.innerHTML = skeletonRows(4);
  $("#explore-trending .lede").textContent = `Resultados para “${trendQ}” na Steam, com quantas pessoas estão jogando agora.`;
  let res;
  try { res = await searchSteam(trendQ); } catch (_) {
    if (tok === trendSearchToken) list.innerHTML = `<p class="status-line" style="padding:0">Sem conexão com a Steam agora. Tente de novo.</p>`;
    return;
  }
  if (tok !== trendSearchToken) return;
  await steamAssets(res.map(r => r.steamId));
  trendResults = res.map(r => ({ src: "steam", steam: r.steamId, title: r.title, year: "", covers: [...steamCovers(r.steamId), steamHeader(r.steamId)], players: trend.players[r.steamId] || 0 }));
  if (!trendResults.length) { list.innerHTML = `<p class="status-line" style="padding:0">Nenhum jogo encontrado para “${esc(trendQ)}”.</p>`; return; }
  const draw = () => {
    const sorted = [...trendResults].sort((a, b) => (b.players || 0) - (a.players || 0));
    list.innerHTML = sorted.map((r, i) => trendRowHTML(r, i).replace(`data-ti="${i}"`, `data-tr="${trendResults.indexOf(r)}"`)).join("");
  };
  draw();
  await Promise.allSettled(trendResults.map(r => getJSON(`https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${r.steam}`)
    .then(j => { r.players = j.response?.player_count ?? 0; trend.players[r.steam] = r.players; })));
  if (tok === trendSearchToken) draw();
}
$("#trending-list").addEventListener("click", e => {
  const b = e.target.closest("[data-tr]");
  if (b) openCatalog(trendResults[+b.dataset.tr]);
});
let trendDeb;
$("#trend-q").addEventListener("input", e => { clearTimeout(trendDeb); trendDeb = setTimeout(() => runTrendSearch(e.target.value), 450); });
$("#trend-form").addEventListener("submit", e => { e.preventDefault(); clearTimeout(trendDeb); $("#trend-q").blur(); runTrendSearch($("#trend-q").value); });

/* =========================================================
   Esqueci minha senha (Firebase manda um e-mail com link e código)
   ========================================================= */
const fbHeaders = { "Content-Type": "application/json", "X-Firebase-Locale": "pt-BR" };
async function sendPasswordReset(email) {
  const r = await http("POST", `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${FB.apiKey}`,
    { headers: fbHeaders, body: JSON.stringify({ requestType: "PASSWORD_RESET", email }) });
  if (r.status >= 400 && !/EMAIL_NOT_FOUND/.test(r.body)) throw new Error(r.body || ("HTTP " + r.status));
}
function codeFrom(text) {
  const t = String(text || "").trim();
  const m = t.match(/[?&]oobCode=([^&#\s]+)/);
  return m ? decodeURIComponent(m[1]) : t.replace(/\s+/g, "");
}
async function resetPassword(code, newPassword) {
  const r = await http("POST", `https://identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=${FB.apiKey}`,
    { headers: fbHeaders, body: JSON.stringify({ oobCode: code, newPassword }) });
  if (r.status >= 400) throw new Error(r.body || ("HTTP " + r.status));
  return JSON.parse(r.body || "{}");
}
function openForgot(email, back) {
  const state = { email: email || "", sent: false };
  const draw = () => {
    showSheet(`
      <div class="sheet-top"><button class="icon-btn" data-back aria-label="Voltar">${back ? ICON.back : ICON.close}</button></div>
      <h2 class="hero-title" style="margin-top:18px">Esqueci minha senha</h2>
      ${!state.sent ? `
        <p class="hero-sub">Digite o e-mail da sua conta. Vamos mandar um e-mail com um link de confirmação para você criar uma senha nova.</p>
        <form class="email-form" id="fp-send">
          <input class="text-input" id="fp-mail" type="email" autocomplete="email" placeholder="E-mail da conta" value="${esc(state.email)}">
          <p class="form-error" id="fp-err" hidden></p>
          <button class="btn btn-primary" type="submit">Enviar e-mail de confirmação</button>
        </form>`
      : `
        <div class="panel" style="margin-top:16px">
          <span class="field-label">E-mail enviado para ${esc(state.email)}</span>
          <p class="panel-note" style="margin:0">Abra o e-mail (olhe também no spam) e escolha um jeito:</p>
          <ol class="fp-steps">
            <li>Toque no link do e-mail e crie a senha nova na página que abrir. Depois é só entrar aqui com ela.</li>
            <li>Ou copie o link do e-mail, cole abaixo e troque a senha aqui mesmo.</li>
          </ol>
        </div>
        <form class="email-form" id="fp-reset">
          <textarea class="text-input fp-code" id="fp-code" rows="3" placeholder="Cole aqui o link ou o código do e-mail"></textarea>
          <input class="text-input" id="fp-new" type="password" autocomplete="new-password" placeholder="Senha nova (mínimo 6 caracteres)">
          <input class="text-input" id="fp-new2" type="password" autocomplete="new-password" placeholder="Repita a senha nova">
          <p class="form-error" id="fp-err" hidden></p>
          <button class="btn btn-primary" type="submit">Trocar senha</button>
          <button class="link-btn" type="button" id="fp-again" style="justify-self:center">Enviar o e-mail de novo</button>
        </form>`}`, back);
    const err = m => { const el = body.querySelector("#fp-err"); el.textContent = m; el.hidden = !m; };
    const sf = body.querySelector("#fp-send");
    if (sf) sf.onsubmit = async e => {
      e.preventDefault();
      const mail = body.querySelector("#fp-mail").value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return err("Digite um e-mail válido.");
      const btn = sf.querySelector("button"); btn.disabled = true; err("");
      try { await sendPasswordReset(mail); state.email = mail; state.sent = true; draw(); toast("E-mail enviado"); }
      catch (ex) { err(/TOO_MANY/.test(String(ex.message)) ? "Muitos pedidos seguidos. Espere alguns minutos." : "Não deu para enviar agora. Confira a internet e tente de novo."); btn.disabled = false; }
    };
    const rf = body.querySelector("#fp-reset");
    if (rf) {
      rf.onsubmit = async e => {
        e.preventDefault();
        const code = codeFrom(body.querySelector("#fp-code").value);
        const p1 = body.querySelector("#fp-new").value, p2 = body.querySelector("#fp-new2").value;
        if (!code) return err("Cole o link ou o código que chegou no e-mail.");
        if (p1.length < 6) return err("A senha precisa ter pelo menos 6 caracteres.");
        if (p1 !== p2) return err("As duas senhas estão diferentes.");
        const btn = rf.querySelector("button[type=submit]"); btn.disabled = true; err("");
        try {
          const r = await resetPassword(code, p1);
          await signInEmail("in", r.email || state.email, p1);
          toast("Senha trocada. Você já entrou na conta.");
          fullSync(); await checkSocialMe();
          closeSheet();
          if (currentView === "net") renderNet();
          if (currentView === "settings") renderSettings();
        } catch (ex) {
          const m = String(ex.message);
          err(/EXPIRED_OOB_CODE/.test(m) ? "Esse link expirou. Peça um e-mail novo."
            : /INVALID_OOB_CODE/.test(m) ? "Esse link ou código não vale. Copie o link inteiro do e-mail mais recente."
            : /WEAK_PASSWORD/.test(m) ? "A senha precisa ter pelo menos 6 caracteres."
            : "Não deu para trocar a senha agora. Tente de novo.");
          btn.disabled = false;
        }
      };
      body.querySelector("#fp-again").onclick = () => { state.sent = false; draw(); };
    }
  };
  draw();
}

/* =========================================================
   Compartilhar perfil (cartão com @, números e jogos)
   ========================================================= */
function drawAvatarOf(ctx, img, p, x, y, d) {
  ctx.save(); ctx.beginPath(); ctx.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2); ctx.clip();
  if (img) drawCover(ctx, img, x, y, d, d);
  else {
    ctx.fillStyle = /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : "#FFD21F"; ctx.fillRect(x, y, d, d);
    const ini = (p.name || p.handle || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join("");
    setFont(ctx, 900, d * 0.42, "condensed"); ctx.fillStyle = "#111"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(ini, x + d / 2, y + d / 2 + 2); ctx.textBaseline = "alphabetic";
  }
  ctx.restore();
}
async function drawProfileCard(p, coverUrls, format) {
  const W = 1080, H = format === "post" ? 1350 : 1920;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  try { await Promise.all([document.fonts.load("900 90px Archivo"), document.fonts.load("600 40px Archivo")]); } catch (_) {}
  const c = cardColors();
  const [av, ...covers] = await Promise.all([firstImage([p.photo].filter(Boolean)), ...coverUrls.slice(0, 4).map(u => firstImage([u]))]);
  drawBackdrop(ctx, covers.find(Boolean) || null, W, H);
  drawBrand(ctx, 72, 124, c);
  const post = format === "post";
  const d = post ? 170 : 230, ay = post ? 190 : 230;
  ctx.save(); ctx.beginPath(); ctx.arc(W / 2, ay + d / 2, d / 2 + 10, 0, Math.PI * 2); ctx.fillStyle = c.a; ctx.fill(); ctx.restore();
  drawAvatarOf(ctx, av, p, W / 2 - d / 2, ay, d);
  let y = ay + d + (post ? 92 : 110);
  setFont(ctx, 900, post ? 84 : 100, "condensed"); ctx.fillStyle = "#F6F4EE"; ctx.textAlign = "center";
  ctx.fillText(wrap(ctx, p.name || p.handle || "Meu perfil", W - 160, 1)[0], W / 2, y);
  if (p.handle) { y += 58; setFont(ctx, 700, 40); ctx.fillStyle = c.a; ctx.fillText("@" + p.handle, W / 2, y); }
  if (p.bio) {
    setFont(ctx, 500, 36); ctx.fillStyle = "rgba(246,244,238,0.8)";
    wrap(ctx, p.bio, W - 220, 2).forEach(l => { y += 52; ctx.fillText(l, W / 2, y); });
  }
  const s = p.stats || {};
  const stats = [[s.games || 0, "jogos"], [s.done || 0, "zerados"], [`${fmtH(s.hours || 0)} h`, "jogadas"]];
  y += post ? 60 : 80;
  const bw = (W - 144 - 2 * 24) / 3, bh = post ? 150 : 180;
  stats.forEach(([v, l], i) => {
    const x = 72 + i * (bw + 24);
    ctx.fillStyle = i === 1 ? c.a : "rgba(246,244,238,0.1)"; rr(ctx, x, y, bw, bh, 28); ctx.fill();
    setFont(ctx, 900, post ? 70 : 84, "extra-condensed"); ctx.fillStyle = i === 1 ? c.on : "#F6F4EE"; ctx.textAlign = "center";
    ctx.fillText(String(v), x + bw / 2, y + bh * 0.58);
    setFont(ctx, 600, 30); ctx.fillStyle = i === 1 ? c.on : "rgba(246,244,238,0.65)";
    ctx.fillText(l, x + bw / 2, y + bh * 0.85);
  });
  y += bh + (post ? 56 : 90);
  const shown = covers.filter(Boolean);
  if (shown.length) {
    setFont(ctx, 700, 34); ctx.fillStyle = "rgba(246,244,238,0.7)"; ctx.textAlign = "left";
    ctx.fillText(p.coversLabel || "Últimos zerados", 72, y);
    y += 26;
    const cols = 4, gap = 20, cw = (W - 144 - gap * (cols - 1)) / cols, ch = Math.min(cw * 1.4, H - y - 260);
    shown.forEach((img, i) => {
      const x = 72 + i * (cw + gap);
      ctx.save(); rr(ctx, x, y, cw, ch, 18); ctx.clip(); drawCover(ctx, img, x, y, cw, ch); ctx.restore();
    });
  }
  ctx.strokeStyle = "rgba(246,244,238,0.15)"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(72, H - 186); ctx.lineTo(W - 72, H - 186); ctx.stroke();
  setFont(ctx, 800, 40); ctx.fillStyle = "#F6F4EE"; ctx.textAlign = "center";
  ctx.fillText(p.handle ? `Me siga no Zerei: @${p.handle}` : "Minha estante no Zerei", W / 2, H - 110);
  return cv.toDataURL("image/png");
}
function myProfileShareData() {
  const done = games.filter(g => g.status === "done").sort((a, b) => (b.doneAt || b.updatedAt || 0) - (a.doneAt || a.updatedAt || 0));
  const st = publicStats();
  return {
    p: { name: profile.name, handle: socialMe && socialMe.handle, bio: profile.bio, color: profile.color, photo: myPublicPhoto() || (avatarMode() === "photo" ? profile.photoData : ""), stats: st },
    covers: done.slice(0, 4).map(g => gameCovers(g)[0]).filter(Boolean)
  };
}

/* =========================================================
   Conquistas detectadas das contas conectadas
   ========================================================= */
let steamAchRunning = false;
async function syncSteamAchievements(force) {
  if (!accounts.steam || steamAchRunning) return;
  if (!force && Date.now() - (accounts.steam.achSyncAt || 0) < 6 * 3600 * 1000) return;
  steamAchRunning = true;
  const todo = games.filter(g => g.sources && g.sources.steam && (g.sources.steam.minutes > 0) && (force || Date.now() - (g.sources.steam.achAt || 0) > 24 * 3600 * 1000))
    .sort((a, b) => (b.sources.steam.last || 0) - (a.sources.steam.last || 0)).slice(0, 60);
  let n = 0;
  const status = () => { const el = $("#acct-ach-status"); if (el) el.textContent = n < todo.length ? `Lendo suas conquistas da Steam… ${n} de ${todo.length}` : ""; };
  status();
  for (let i = 0; i < todo.length; i += 4) {
    await Promise.allSettled(todo.slice(i, i + 4).map(async g => {
      const id = g.sources.steam.id || g.steamId;
      try {
        const { steamid } = accounts.steam;
        const d = await getJSON(`https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?${await steamAuth()}&steamid=${steamid}&appid=${id}`);
        const list = (d.playerstats && d.playerstats.achievements) || [];
        g.sources.steam.ach = { done: list.filter(a => a.achieved).length, total: list.length };
      } catch (_) { g.sources.steam.ach = g.sources.steam.ach || { done: 0, total: 0 }; }
      g.sources.steam.achAt = Date.now();
      n++; status();
    }));
    if (currentView === "ach") renderTracked();
  }
  accounts.steam.achSyncAt = Date.now(); saveAccounts();
  store.save("backlog.games.v1", games); scheduleSync();
  steamAchRunning = false;
  if (currentView === "ach") renderTracked();
}
function accountAchItems() {
  const out = [];
  games.forEach(g => {
    const s = g.sources || {};
    ["psn", "xbox", "steam"].forEach(k => {
      const a = s[k] && s[k].ach;
      if (a && a.total > 0 && accounts[k]) out.push({ g, src: k, done: a.done, total: a.total, last: s[k].last || 0 });
    });
  });
  return out.sort((a, b) => b.last - a.last);
}
let achShowAll = false;
function accountAchHTML() {
  const linked = ["steam", "xbox", "psn"].filter(k => accounts[k]);
  if (!linked.length) return `<div class="panel ach-connect"><span class="field-label">Detectar suas conquistas</span>
    <p class="panel-note" style="margin:0 0 12px">Conecte Steam, Xbox ou PlayStation e o app mostra aqui o seu progresso real de cada jogo.</p>
    <button class="btn btn-ghost" id="ach-go-accts" style="width:100%">Conectar contas</button></div>`;
  const items = accountAchItems();
  const totalDone = items.reduce((a, x) => a + x.done, 0);
  const shown = achShowAll ? items : items.slice(0, 20);
  const SRC = { steam: "Steam", xbox: "Xbox", psn: "PlayStation" };
  return `<div class="section-label">Das suas contas <small>${items.length ? `${fmtN(totalDone)} desbloqueadas` : ""}</small></div>
    <p class="status-line" id="acct-ach-status" style="padding-top:0"></p>
    ${items.length ? `<ul class="rows">${shown.map((x, i) => `<li><button class="row tracked-row" data-ag="${esc(x.g.id)}" data-src="${x.src}">
      ${coverHTML(gameCovers(x.g), x.g.title, { plat: x.g.platform, steam: x.g.steamId })}
      <div><div class="row-title">${esc(x.g.title)}</div>
        <div class="row-sub">${x.done} de ${x.total} ${x.src === "psn" ? "troféus" : "conquistas"}, ${SRC[x.src]}</div>
        <div class="progress-track"><div style="width:${x.done / x.total * 100}%"></div></div></div>
      <span class="row-chev">${ICON.chev}</span></button></li>`).join("")}</ul>
      ${items.length > shown.length ? `<button class="link-btn" id="ach-more" style="margin:12px var(--gutter)">Ver todos os ${items.length} jogos</button>` : ""}`
    : `<p class="status-line" style="padding-top:0">Importe os jogos das suas contas em Ajustes > Contas de jogos para ver o progresso aqui.</p>`}`;
}

/* =========================================================
   Cronômetro de sessão
   O início fica salvo, então fechar o app não perde o tempo.
   ========================================================= */
let session = store.load("backlog.session.v1", null);          // { gameId, title, start }
const PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/></svg>';
const STOP = '<svg viewBox="0 0 24 24"><rect x="6.5" y="6.5" width="11" height="11" rx="2.2" fill="currentColor" stroke="none"/></svg>';
const fmtClock = ms => {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  return (h ? `${h}:${String(m).padStart(2, "0")}` : String(m)) + ":" + String(x).padStart(2, "0");
};
const fmtDur = min => { min = Math.max(0, Math.round(min)); const h = Math.floor(min / 60), m = min % 60; return h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`; };
const saveSession = () => store.save("backlog.session.v1", session);
const sessionGame = () => session && games.find(g => g.id === session.gameId);

function startSession(g) {
  if (session && session.gameId !== g.id && sessionGame()) {
    toast(`Antes, termine a sessão de ${session.title}`);
    openStopSession(() => openGame(g));
    return false;
  }
  session = { gameId: g.id, title: g.title, start: Date.now() };
  saveSession();
  if (g.status === "backlog" || g.status === "dropped") {
    logEvent(g, "status", { to: "playing" });
    g.status = "playing"; g.updatedAt = Date.now(); saveGames();
  }
  renderSessionBar(); renderLibrary();
  toast(`Cronômetro ligado. Bom jogo!`);
  return true;
}
function sessionBtnHTML(g) {
  const on = session && session.gameId === g.id;
  return `<button class="btn ${on ? "btn-primary sess-on" : "btn-ghost"} sess-btn" id="sess" data-gid="${esc(g.id)}">
    ${on ? STOP : PLAY}<span>${on ? `Parar sessão <b class="sess-clock" data-clock>${fmtClock(Date.now() - session.start)}</b>` : "Jogar agora"}</span></button>`;
}
function wireSessionBtn(root, g, back, onStart) {
  const b = root.querySelector("#sess");
  if (!b) return;
  b.onclick = () => {
    if (session && session.gameId === g.id) { openStopSession(back); return; }
    if (startSession(g)) { b.outerHTML = sessionBtnHTML(g); wireSessionBtn(root, g, back, onStart); onStart && onStart(); }
  };
}

/* Barrinha fixa enquanto o cronômetro roda */
const sbar = document.createElement("button");
sbar.className = "sbar"; sbar.id = "sbar"; sbar.hidden = true;
document.body.appendChild(sbar);
sbar.onclick = e => {
  const g = sessionGame();
  if (!g) return;
  if (e.target.closest("[data-sstop]")) openStopSession();
  else openGame(g);
};
function renderSessionBar() {
  const g = sessionGame();
  if (session && !g) { session = null; saveSession(); }
  sbar.hidden = !g;
  document.body.classList.toggle("has-sbar", !!g);
  if (!g) return;
  sbar.innerHTML = `<span class="sbar-cover">${coverHTML(gameCovers(g), g.title)}</span>
    <span class="sbar-text"><small><i class="sbar-dot"></i>Jogando agora</small><b>${esc(g.title)}</b></span>
    <span class="sbar-clock" data-clock>${fmtClock(Date.now() - session.start)}</span>
    <span class="sbar-stop" data-sstop role="button" aria-label="Parar sessão">${STOP}</span>`;
}
setInterval(() => {
  if (!session || document.hidden) return;
  const t = fmtClock(Date.now() - session.start);
  document.querySelectorAll("[data-clock]").forEach(el => { el.textContent = t; });
}, 1000);

function openStopSession(back) {
  const g = sessionGame();
  if (!g) { session = null; saveSession(); renderSessionBar(); return; }
  const min = Math.max(1, Math.round((Date.now() - session.start) / 60000));
  const h0 = Math.floor(min / 60), m0 = min % 60;
  showSheet(`
    <div class="sheet-top"><button class="icon-btn" data-back aria-label="Voltar">${back ? ICON.back : ICON.close}</button></div>
    <div class="hero">${coverHTML(gameCovers(g), g.title)}<div><h2 class="hero-title">${esc(g.title)}</h2>
      <div class="hero-sub">Sessão começou às ${new Date(session.start).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}${Date.now() - session.start > 86400000 ? `, ${fmtDay(session.start)}` : ""}</div></div></div>
    <div class="sess-big"><b>${fmtDur(min)}</b><span>de jogo nesta sessão</span></div>
    ${min > 360 ? `<p class="panel-note" style="margin-top:0">Esqueceu o cronômetro ligado? Ajuste o tempo antes de salvar.</p>` : ""}
    <div class="field"><span class="field-label">Tempo jogado</span>
      <div class="dur-row">
        <label class="dur"><input class="text-input" id="s-h" type="number" inputmode="numeric" min="0" max="99" value="${h0}"><span>h</span></label>
        <label class="dur"><input class="text-input" id="s-m" type="number" inputmode="numeric" min="0" max="59" value="${m0}"><span>min</span></label>
      </div>
      <p class="panel-note" id="s-total"></p>
    </div>
    <div class="actions">
      <button class="btn btn-primary" id="s-save">Somar às horas do jogo</button>
      <button class="btn btn-ghost" id="s-keep">${PLAY}Continuar jogando</button>
      <button class="link-btn" id="s-discard" style="justify-self:center;color:var(--accent-2)">Descartar esta sessão</button>
    </div>`, back);
  const hi = body.querySelector("#s-h"), mi = body.querySelector("#s-m"), tot = body.querySelector("#s-total");
  const minutes = () => Math.max(0, (parseInt(hi.value, 10) || 0) * 60 + (parseInt(mi.value, 10) || 0));
  const upd = () => { tot.textContent = `O jogo passa de ${fmtH(Number(g.hours) || 0)} h para ${fmtH((Number(g.hours) || 0) + minutes() / 60)} h.`; };
  hi.oninput = mi.oninput = upd; upd();
  const end = () => { session = null; saveSession(); renderSessionBar(); };
  body.querySelector("#s-save").onclick = () => {
    const m = minutes();
    if (!m) { toast("Coloque quanto tempo você jogou"); return; }
    g.hours = String(Math.round(((Number(g.hours) || 0) + m / 60) * 10) / 10);
    logEvent(g, "session", { min: m });
    g.updatedAt = Date.now();
    end(); saveGames(); renderLibrary();
    syncReview(g).catch(() => {});
    toast(`${fmtDur(m)} somados em ${g.title}`);
    back ? back() : closeSheet();
  };
  body.querySelector("#s-keep").onclick = () => back ? back() : closeSheet();
  const dc = body.querySelector("#s-discard");
  dc.onclick = () => {
    if (!dc.dataset.armed) { dc.dataset.armed = "1"; dc.textContent = "Toque de novo para descartar"; return; }
    end(); toast("Sessão descartada"); back ? back() : closeSheet();
  };
}

/* =========================================================
   Listas personalizadas
   ========================================================= */
let lists = store.load("backlog.lists.v1", []);
const saveLists = () => { store.save("backlog.lists.v1", lists); scheduleSync(); };
const LIST_ICO = '<svg viewBox="0 0 24 24"><path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.6" cy="6.5" r="1.2" fill="currentColor"/><circle cx="4.6" cy="12" r="1.2" fill="currentColor"/><circle cx="4.6" cy="17.5" r="1.2" fill="currentColor"/></svg>';
const UP = '<svg viewBox="0 0 24 24"><path d="m6 14 6-6 6 6"/></svg>';
const DOWN = '<svg viewBox="0 0 24 24"><path d="m6 10 6 6 6-6"/></svg>';
const listItemFrom = g => ({ key: keyOf(g.title), title: g.title, gid: g.id || null, cover: safeImg(g.coverRemote) || safeImg(toArr(g.coverAlts)[0]) || "" });
const listCovers = it => { const g = it.gid && games.find(x => x.id === it.gid); return g ? gameCovers(g) : [it.cover].filter(Boolean); };
const itemGame = it => (it.gid && games.find(x => x.id === it.gid)) || games.find(x => keyOf(x.title) === it.key);
function listStackHTML(items, coversOf) {
  const c = items.slice(0, 3);
  return `<span class="lstack">${c.length ? c.map(it => `<span>${coverHTML(coversOf(it), it.title)}</span>`).join("") : `<span class="lstack-empty">${LIST_ICO}</span>`}</span>`;
}
function touchList(l) { l.updatedAt = Date.now(); saveLists(); if (l.public) publishList(l).catch(() => {}); }

async function publishList(l) {
  if (!socialReady()) return;
  const path = `lists/${auth.uid}_${l.id}`;
  if (!l.public) return dbDel(path).catch(() => {});
  await dbPut(path, {
    uid: auth.uid, handle: socialMe.handle, name: l.name.slice(0, 60), desc: (l.desc || "").slice(0, 300), ranked: !!l.ranked,
    items: l.items.slice(0, 100).map(it => ({ key: it.key, title: it.title, cover: safeImg(it.cover) || (() => { const g = itemGame(it); return g ? safeImg(g.coverRemote) : ""; })() })),
    count: l.items.length, at: l.updatedAt || Date.now()
  });
}

function openLists(back) {
  listEditing = false;
  const sorted = [...lists].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  showSheet(`
    <div class="sheet-top"><button class="icon-btn" data-back aria-label="Voltar">${back ? ICON.back : ICON.close}</button>
      <button class="btn btn-primary btn-sm" id="l-new">${ICON.plus}Nova lista</button></div>
    <h2 class="hero-title" style="margin-top:18px">Minhas listas</h2>
    <p class="hero-sub">Monte listas do seu jeito, tipo “Melhores RPGs” ou “Para jogar com a namorada”, e publique no seu perfil se quiser.</p>
    ${sorted.length ? `<ul class="rows" style="padding:0">${sorted.map(l => `<li><button class="row list-row" data-lid="${esc(l.id)}">
        ${listStackHTML(l.items, listCovers)}
        <div><div class="row-title">${esc(l.name)}</div>
        <div class="row-sub">${l.items.length} ${l.items.length === 1 ? "jogo" : "jogos"}${l.public ? ", no seu perfil" : ", só você vê"}${l.ranked ? ", ranking" : ""}</div></div>
        <span class="row-chev">${ICON.chev}</span></button></li>`).join("")}</ul>`
    : `<div class="panel" style="text-align:center"><p class="hero-sub" style="margin:0 0 14px">Você ainda não tem listas.</p>
       <button class="btn btn-primary" id="l-new2">Criar minha primeira lista</button></div>`}`, back);
  const reopen = () => openLists(back);
  const nw = () => openListEditor(null, reopen);
  body.querySelector("#l-new").onclick = nw;
  const n2 = body.querySelector("#l-new2"); if (n2) n2.onclick = nw;
  body.querySelectorAll("[data-lid]").forEach(b => b.onclick = () => openList(lists.find(l => l.id === b.dataset.lid), reopen));
}

function openListEditor(l, back, withGame) {
  const isNew = !l;
  const d = l ? { ...l } : { name: "", desc: "", ranked: false, public: socialReady() };
  showSheet(`
    <div class="sheet-top"><button class="icon-btn" data-back aria-label="Voltar">${ICON.back}</button>
      ${isNew ? "" : `<button class="btn btn-danger" id="le-del">Apagar</button>`}</div>
    <h2 class="hero-title" style="margin-top:18px">${isNew ? "Nova lista" : "Editar lista"}</h2>
    <div class="field"><label class="field-label" for="le-name">Nome</label>
      <input class="text-input" id="le-name" maxlength="60" placeholder="Ex.: Meus 10 RPGs favoritos" value="${esc(d.name)}"></div>
    <div class="field"><label class="field-label" for="le-desc">Descrição <small class="count">opcional</small></label>
      <textarea class="review" id="le-desc" maxlength="300" style="min-height:90px" placeholder="Conte do que se trata a lista">${esc(d.desc || "")}</textarea></div>
    <div class="panel" style="display:grid;gap:16px">
      <div class="switch-row"><div><b>Ranking numerado</b><span>Mostra 1, 2, 3… e dá para mudar a ordem.</span></div>
        <button class="switch ${d.ranked ? "is-on" : ""}" id="le-rank" role="switch" aria-checked="${!!d.ranked}" aria-label="Ranking numerado"></button></div>
      ${socialReady() ? `<div class="switch-row"><div><b>Mostrar no meu perfil</b><span>Quem abrir seu perfil na Rede vê esta lista.</span></div>
        <button class="switch ${d.public ? "is-on" : ""}" id="le-pub" role="switch" aria-checked="${!!d.public}" aria-label="Mostrar no meu perfil"></button></div>`
      : `<p class="panel-note" style="margin:0">Entre na Rede para poder mostrar suas listas no perfil.</p>`}
    </div>
    <div class="actions"><button class="btn btn-primary" id="le-save">${isNew ? "Criar lista" : "Salvar"}</button></div>`, back);
  const sw = (id, key) => { const b = body.querySelector(id); if (b) b.onclick = () => { d[key] = !d[key]; b.classList.toggle("is-on", d[key]); b.setAttribute("aria-checked", d[key]); }; };
  sw("#le-rank", "ranked"); sw("#le-pub", "public");
  const name = body.querySelector("#le-name");
  if (isNew) setTimeout(() => name.focus(), 250);
  body.querySelector("#le-save").onclick = () => {
    const nm = name.value.trim();
    if (!nm) { toast("Dê um nome para a lista"); name.focus(); return; }
    const desc = body.querySelector("#le-desc").value.trim();
    let target = l;
    if (isNew) {
      target = { id: "l" + Date.now().toString(36), name: nm, desc, ranked: d.ranked, public: !!d.public && socialReady(), items: withGame ? [listItemFrom(withGame)] : [], createdAt: Date.now() };
      lists.push(target);
    } else Object.assign(l, { name: nm, desc, ranked: d.ranked, public: !!d.public && socialReady() });
    touchList(target);
    if (!target.public) publishList(target).catch(() => {});
    toast(isNew ? (withGame ? `Lista criada com ${withGame.title}` : "Lista criada") : "Lista salva");
    if (isNew && !withGame) openListPicker(target, () => openList(target, back));
    else if (withGame) back ? back() : closeSheet();
    else openList(target, back);
  };
  const del = body.querySelector("#le-del");
  if (del) del.onclick = () => {
    if (!del.dataset.armed) { del.dataset.armed = "1"; del.textContent = "Toque de novo para apagar"; return; }
    lists = lists.filter(x => x.id !== l.id);
    markDeleted(l.id); saveLists();
    if (socialReady()) dbDel(`lists/${auth.uid}_${l.id}`).catch(() => {});
    toast("Lista apagada");
    openLists();
  };
}

let listEditing = false;
function openList(l, back) {
  if (!l) { openLists(); return; }
  const self = () => openList(l, back);
  showSheet(`
    <div class="sheet-top"><button class="icon-btn" data-back aria-label="Voltar">${back ? ICON.back : ICON.close}</button>
      <button class="btn btn-ghost btn-sm" id="l-edit">${PENCIL}Detalhes</button></div>
    <h2 class="hero-title" style="margin-top:18px">${esc(l.name)}</h2>
    <p class="hero-sub">${l.desc ? esc(l.desc) + "<br>" : ""}${l.items.length} ${l.items.length === 1 ? "jogo" : "jogos"}${l.public ? ", aparece no seu perfil" : ", só você vê"}</p>
    <div class="actions two-btns" style="margin-top:14px">
      <button class="btn btn-primary" id="l-add">${ICON.plus}Adicionar</button>
      <button class="btn btn-ghost" id="l-share" ${l.items.length ? "" : "disabled"}>${SHARE}Compartilhar</button>
    </div>
    ${l.items.length > 1 ? `<div style="display:flex;justify-content:flex-end;margin-top:14px"><button class="link-btn" id="l-order" style="margin:0">${listEditing ? "Pronto" : l.ranked ? "Mudar a ordem" : "Organizar"}</button></div>` : ""}
    <ol class="rows lrows ${l.ranked ? "is-ranked" : ""}" style="padding:0">${l.items.map((it, i) => `<li class="lrow">
      ${l.ranked ? `<span class="lnum">${i + 1}</span>` : ""}
      <button class="row" data-li="${i}">${coverHTML(listCovers(it), it.title)}
        <div><div class="row-title">${esc(it.title)}</div><div class="row-sub">${(() => { const g = itemGame(it); return g ? esc(statusOf(g.status).label) + (g.rating ? " " + starsHTML(g.rating) : "") : "Fora da sua estante"; })()}</div></div></button>
      ${listEditing ? `<span class="lctl">
        <button class="icon-btn" data-up="${i}" ${i ? "" : "disabled"} aria-label="Subir">${UP}</button>
        <button class="icon-btn" data-down="${i}" ${i < l.items.length - 1 ? "" : "disabled"} aria-label="Descer">${DOWN}</button>
        <button class="icon-btn" data-rm="${i}" aria-label="Tirar da lista">${ICON.close}</button></span>` : ""}
    </li>`).join("")}</ol>
    ${!l.items.length ? `<p class="hero-sub" style="margin-top:18px">Lista vazia. Toque em “Adicionar”.</p>` : ""}`, back);
  body.querySelector("#l-edit").onclick = () => openListEditor(l, self);
  body.querySelector("#l-add").onclick = () => openListPicker(l, self);
  const sh = body.querySelector("#l-share");
  if (sh) sh.onclick = () => openShareCard({ kind: "list", list: { ...l, items: l.items.map(it => ({ ...it, covers: listCovers(it) })) }, by: null }, self);
  const ord = body.querySelector("#l-order");
  if (ord) ord.onclick = () => { listEditing = !listEditing; const y = body.scrollTop; self(); body.scrollTop = y; };
  const move = (i, j) => { const [x] = l.items.splice(i, 1); l.items.splice(j, 0, x); touchList(l); const y = body.scrollTop; self(); body.scrollTop = y; };
  body.querySelectorAll("[data-up]").forEach(b => b.onclick = () => move(+b.dataset.up, +b.dataset.up - 1));
  body.querySelectorAll("[data-down]").forEach(b => b.onclick = () => move(+b.dataset.down, +b.dataset.down + 1));
  body.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { l.items.splice(+b.dataset.rm, 1); touchList(l); const y = body.scrollTop; self(); body.scrollTop = y; });
  body.querySelectorAll("[data-li]").forEach(b => b.onclick = () => {
    if (listEditing) return;
    const it = l.items[+b.dataset.li], g = itemGame(it);
    g ? openGame(g, null, self) : openGame(null, { title: it.title, year: "", covers: [it.cover].filter(Boolean) }, self);
  });
}

function openListPicker(l, back) {
  let qtxt = "", online = [], onTok = 0;
  showSheet(`
    <div class="sheet-top"><button class="icon-btn" data-back aria-label="Voltar">${ICON.back}</button>
      <button class="btn btn-primary btn-sm" id="lp-done">Pronto</button></div>
    <h2 class="hero-title" style="margin-top:18px">Adicionar à lista</h2>
    <p class="hero-sub">${esc(l.name)}</p>
    <form class="searchbar" id="lp-f" autocomplete="off" style="margin:14px 0 0">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input id="lp-q" type="search" placeholder="Buscar na estante ou fora dela" enterkeyhint="search"></form>
    <div id="lp-list"></div>`, back);
  const box = body.querySelector("#lp-list");
  const has = key => l.items.some(it => it.key === key);
  const rowHTML = (key, title, covers, sub, attr) => `<li><button class="row pick-row ${has(key) ? "is-on" : ""}" ${attr}>
      ${coverHTML(covers, title)}<div><div class="row-title">${esc(title)}</div><div class="row-sub">${sub}</div></div>
      <span class="pick">${ICON.check}</span></button></li>`;
  const draw = () => {
    const nq = norm(qtxt);
    const mine = sortGames(games.filter(g => !nq || norm(g.title).includes(nq)));
    const ext = online.filter(r => !games.some(g => norm(g.title) === norm(r.title)));
    box.innerHTML = `${mine.length ? `<div class="section-label" style="margin:20px 0 4px">Da sua estante <small>${mine.length}</small></div>
      <ul class="rows" style="padding:0">${mine.slice(0, 200).map(g => rowHTML(keyOf(g.title), g.title, gameCovers(g), esc(statusOf(g.status).label), `data-pg="${esc(g.id)}"`)).join("")}</ul>` : ""}
      ${nq && ext.length ? `<div class="section-label" style="margin:20px 0 4px">Outros jogos</div>
      <ul class="rows" style="padding:0">${ext.map((r, i) => rowHTML(keyOf(r.title), r.title, r.covers || [], esc(r.year || r.source || ""), `data-po="${i}"`)).join("")}</ul>` : ""}
      ${!mine.length && !(nq && ext.length) ? `<p class="hero-sub" style="margin-top:18px">${nq ? "Buscando…" : "Sua estante está vazia. Busque um jogo acima."}</p>` : ""}`;
  };
  const toggle = it => {
    const i = l.items.findIndex(x => x.key === it.key);
    if (i >= 0) l.items.splice(i, 1); else l.items.push(it);
    touchList(l);
  };
  box.onclick = e => {
    const b = e.target.closest("[data-pg],[data-po]");
    if (!b) return;
    const it = b.dataset.pg ? listItemFrom(games.find(g => g.id === b.dataset.pg))
      : (r => ({ key: keyOf(r.title), title: r.title, gid: null, cover: safeImg((r.covers || [])[0]) || "" }))(online.filter(r => !games.some(g => norm(g.title) === norm(r.title)))[+b.dataset.po]);
    toggle(it);
    b.classList.toggle("is-on", has(it.key));
  };
  const qi = body.querySelector("#lp-q");
  let t;
  const runOnline = async () => {
    const tok = ++onTok;
    if (!qtxt.trim()) { online = []; return draw(); }
    try { const r = await searchGames(qtxt); if (tok === onTok) { online = r.slice(0, 10); draw(); } } catch (_) {}
  };
  qi.oninput = () => { qtxt = qi.value; draw(); clearTimeout(t); t = setTimeout(runOnline, 500); };
  body.querySelector("#lp-f").onsubmit = e => { e.preventDefault(); qi.blur(); clearTimeout(t); runOnline(); };
  body.querySelector("#lp-done").onclick = () => back ? back() : closeSheet();
  draw();
}

function openAddToList(g, back) {
  const key = keyOf(g.title);
  const draw = () => {
    showSheet(`
      <div class="sheet-top"><button class="icon-btn" data-back aria-label="Voltar">${ICON.back}</button></div>
      <h2 class="hero-title" style="margin-top:18px">Colocar em uma lista</h2>
      <p class="hero-sub">${esc(g.title)}</p>
      ${lists.length ? `<ul class="rows" style="padding:0">${lists.map(l => `<li><button class="row pick-row ${l.items.some(it => it.key === key) ? "is-on" : ""}" data-lid="${esc(l.id)}">
        ${listStackHTML(l.items, listCovers)}<div><div class="row-title">${esc(l.name)}</div><div class="row-sub">${l.items.length} ${l.items.length === 1 ? "jogo" : "jogos"}</div></div>
        <span class="pick">${ICON.check}</span></button></li>`).join("")}</ul>` : ""}
      <div class="actions"><button class="btn ${lists.length ? "btn-ghost" : "btn-primary"}" id="al-new">${ICON.plus}Nova lista com este jogo</button></div>`, back);
    body.querySelectorAll("[data-lid]").forEach(b => b.onclick = () => {
      const l = lists.find(x => x.id === b.dataset.lid);
      const i = l.items.findIndex(it => it.key === key);
      if (i >= 0) { l.items.splice(i, 1); toast(`Tirado de ${l.name}`); } else { l.items.push(listItemFrom(g)); toast(`Colocado em ${l.name}`); }
      touchList(l);
      b.classList.toggle("is-on", i < 0);
      const sub = b.querySelector(".row-sub"); if (sub) sub.textContent = `${l.items.length} ${l.items.length === 1 ? "jogo" : "jogos"}`;
    });
    body.querySelector("#al-new").onclick = () => openListEditor(null, () => openAddToList(g, back), g);
  };
  draw();
}

/* Lista de outra pessoa (só leitura) */
function openNetList(l, owner, back) {
  const self = () => openNetList(l, owner, back);
  const items = toArr(l.items);
  showSheet(`
    <div class="sheet-top"><button class="icon-btn" data-back aria-label="Voltar">${back ? ICON.back : ICON.close}</button></div>
    <h2 class="hero-title" style="margin-top:18px">${esc(l.name)}</h2>
    <p class="hero-sub">${l.desc ? esc(l.desc) + "<br>" : ""}Lista de @${esc(l.handle)}, ${items.length} ${items.length === 1 ? "jogo" : "jogos"}</p>
    <div class="actions two-btns" style="margin-top:14px">
      <button class="btn btn-ghost" id="nl-copy">${ICON.plus}Copiar lista</button>
      <button class="btn btn-ghost" id="nl-share">${SHARE}Compartilhar</button>
    </div>
    <ol class="rows lrows ${l.ranked ? "is-ranked" : ""}" style="padding:0">${items.map((it, i) => `<li class="lrow">
      ${l.ranked ? `<span class="lnum">${i + 1}</span>` : ""}
      <button class="row" data-ni="${i}">${coverHTML([safeImg(it.cover)].filter(Boolean), it.title)}
        <div><div class="row-title">${esc(it.title)}</div><div class="row-sub">${games.some(g => keyOf(g.title) === it.key) ? "Está na sua estante" : "Toque para ver e adicionar"}</div></div>
        <span class="row-chev">${ICON.chev}</span></button></li>`).join("")}</ol>`, back);
  body.querySelectorAll("[data-ni]").forEach(b => b.onclick = () => {
    const it = items[+b.dataset.ni], mine = games.find(g => keyOf(g.title) === it.key);
    mine ? openGame(mine, null, self) : openNetGame(it.key, it.title, safeImg(it.cover), self);
  });
  body.querySelector("#nl-copy").onclick = () => {
    const nl = { id: "l" + Date.now().toString(36), name: l.name, desc: l.desc ? `${l.desc}\n(lista de @${l.handle})` : `Lista de @${l.handle}`, ranked: !!l.ranked, public: false,
      items: items.map(it => { const g = games.find(x => keyOf(x.title) === it.key); return g ? listItemFrom(g) : { key: it.key, title: it.title, gid: null, cover: safeImg(it.cover) }; }), createdAt: Date.now() };
    lists.push(nl); touchList(nl);
    toast("Lista copiada para as suas listas");
  };
  body.querySelector("#nl-share").onclick = () => openShareCard({ kind: "list", list: { ...l, items: items.map(it => ({ ...it, covers: [safeImg(it.cover)].filter(Boolean) })) }, by: owner }, self);
}

/* Cartão de compartilhar da lista */
async function drawListCard(l, format, by) {
  const W = 1080, H = format === "post" ? 1350 : 1920;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  try { await Promise.all([document.fonts.load("900 90px Archivo"), document.fonts.load("600 36px Archivo")]); } catch (_) {}
  const c = cardColors();
  const cols = format === "post" ? 5 : 3, maxRows = format === "post" ? 2 : 3;
  const shown = toArr(l.items).slice(0, cols * maxRows);
  const imgs = await Promise.all(shown.map(it => firstImage(it.covers || [it.cover])));
  drawBackdrop(ctx, imgs.find(Boolean) || null, W, H);
  drawBrand(ctx, 72, 124, c);
  setFont(ctx, 800, 30); ctx.fillStyle = c.a; ctx.textAlign = "left";
  ctx.fillText(l.ranked ? "RANKING" : "LISTA", 72, 232);
  setFont(ctx, 900, format === "post" ? 84 : 100, "condensed"); ctx.fillStyle = "#F6F4EE";
  const lh = format === "post" ? 86 : 100;
  const tl = wrap(ctx, l.name, W - 144, 2);
  tl.forEach((s, i) => ctx.fillText(s, 72, 232 + lh + i * lh));
  let y = 232 + lh + (tl.length - 1) * lh + 20;
  if (l.desc && format !== "post") {
    setFont(ctx, 500, 36); ctx.fillStyle = "rgba(246,244,238,0.75)";
    const dl = wrap(ctx, l.desc.split("\n")[0], W - 144, 2);
    dl.forEach((s, i) => ctx.fillText(s, 72, y + 40 + i * 48)); y += 40 + dl.length * 48;
  }
  y += 50;
  const all = toArr(l.items);
  if (all.length <= (format === "post" ? 3 : 5)) {
    // Poucos jogos: uma linha grande por jogo, com capa, número e nome
    const bottom = H - 240, rowH = Math.min(format === "post" ? 300 : 330, (bottom - y) / all.length);
    const cw2 = (rowH - 26) / 1.4, ch2 = rowH - 26;
    const imgs2 = await Promise.all(all.map(it => firstImage(it.covers || [it.cover])));
    all.forEach((it, i) => {
      const yy = y + i * rowH;
      let x = 72;
      if (l.ranked) { setFont(ctx, 900, Math.min(150, rowH * .55), "extra-condensed"); ctx.fillStyle = c.a; ctx.textAlign = "center"; ctx.fillText(String(i + 1), 72 + 50, yy + ch2 / 2 + rowH * .2); ctx.textAlign = "left"; x += 120; }
      ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 30; ctx.shadowOffsetY = 14;
      ctx.fillStyle = "#1f1f22"; rr(ctx, x, yy, cw2, ch2, 16); ctx.fill(); ctx.restore();
      ctx.save(); rr(ctx, x, yy, cw2, ch2, 16); ctx.clip(); if (imgs2[i]) drawCover(ctx, imgs2[i], x, yy, cw2, ch2); ctx.restore();
      setFont(ctx, 900, Math.min(64, rowH * .2), "condensed"); ctx.fillStyle = "#F6F4EE";
      const tl2 = wrap(ctx, it.title, W - 72 - (x + cw2 + 36), 2);
      const fs = Math.min(64, rowH * .2);
      tl2.forEach((t, k) => ctx.fillText(t, x + cw2 + 36, yy + ch2 / 2 - (tl2.length - 1) * fs * .55 + k * fs * 1.05 + fs * .35));
    });
    if (by) {
      const yb = H - 150;
      ctx.strokeStyle = "rgba(246,244,238,0.15)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(72, yb - 36); ctx.lineTo(W - 72, yb - 36); ctx.stroke();
      setFont(ctx, 800, 38); ctx.fillStyle = "#F6F4EE"; ctx.fillText(`Lista de @${by.handle}`, 72, yb + 50);
    } else await drawFooter(ctx, W, H, c);
    return cv.toDataURL("image/png");
  }
  const gap = 24, cw = (W - 144 - gap * (cols - 1)) / cols, ch = cw * 1.4;
  shown.forEach((it, i) => {
    const x = 72 + (i % cols) * (cw + gap), yy = y + Math.floor(i / cols) * (ch + gap);
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 30; ctx.shadowOffsetY = 14;
    ctx.fillStyle = "#1f1f22"; rr(ctx, x, yy, cw, ch, 18); ctx.fill(); ctx.restore();
    ctx.save(); rr(ctx, x, yy, cw, ch, 18); ctx.clip();
    if (imgs[i]) drawCover(ctx, imgs[i], x, yy, cw, ch);
    else { setFont(ctx, 800, 30, "condensed"); ctx.fillStyle = "#8a877f"; wrap(ctx, it.title, cw - 30, 4).forEach((s, k) => ctx.fillText(s, x + 15, yy + 48 + k * 34)); }
    ctx.restore();
    if (l.ranked) {
      const r = format === "post" ? 30 : 38;
      ctx.fillStyle = c.a; ctx.beginPath(); ctx.arc(x + r + 10, yy + r + 10, r, 0, Math.PI * 2); ctx.fill();
      setFont(ctx, 900, r * 1.15, "condensed"); ctx.fillStyle = c.on; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String(i + 1), x + r + 10, yy + r + 12); ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    }
  });
  const rest = toArr(l.items).length - shown.length;
  if (rest > 0) {
    const yy = y + Math.ceil(shown.length / cols) * (ch + gap) + 24;
    setFont(ctx, 700, 34); ctx.fillStyle = "rgba(246,244,238,0.7)"; ctx.fillText(`e mais ${rest} ${rest === 1 ? "jogo" : "jogos"}`, 72, yy + 20);
  }
  if (by) {
    const yb = H - 150;
    ctx.strokeStyle = "rgba(246,244,238,0.15)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(72, yb - 36); ctx.lineTo(W - 72, yb - 36); ctx.stroke();
    setFont(ctx, 800, 38); ctx.fillStyle = "#F6F4EE"; ctx.fillText(`Lista de @${by.handle}`, 72, yb + 50);
  } else await drawFooter(ctx, W, H, c);
  return cv.toDataURL("image/png");
}

/* =========================================================
   Comentários nas avaliações
   ========================================================= */
let allComments = {};
const BUBBLE = '<svg viewBox="0 0 24 24"><path d="M5 18.5V7.5A2.5 2.5 0 0 1 7.5 5h9A2.5 2.5 0 0 1 19 7.5v6a2.5 2.5 0 0 1-2.5 2.5H9z"/></svg>';
const SEND = '<svg viewBox="0 0 24 24"><path d="M4.5 12 20 4.5 15.5 20l-3-6.5z" fill="currentColor" stroke="none"/></svg>';
const commentCount = rid => Object.values(allComments[rid] || {}).filter(c => c && c.uid && !blocked.includes(c.uid)).length;
async function loadComments() { try { allComments = (await dbGet("comments")) || {}; } catch (_) {} return allComments; }

async function openComments(rid, back) {
  const self = () => openComments(rid, back);
  showSheet(`<div class="sheet-top"><button class="icon-btn" data-back aria-label="Voltar">${back ? ICON.back : ICON.close}</button></div>
    <h2 class="hero-title" style="margin-top:18px">Comentários</h2><div id="cm">${skeletonRows(3)}</div>`, back, self);
  const box = body.querySelector("#cm");
  let r, cms, likes;
  try { [r, cms, likes] = await Promise.all([dbGet(`reviews/${rid}`), dbGet(`comments/${rid}`), loadLikes()]); }
  catch (_) { if (box.isConnected) box.innerHTML = `<p class="hero-sub">Não deu para abrir agora. Confira a internet.</p>`; return; }
  if (!box.isConnected) return;
  if (!r) { box.innerHTML = `<p class="hero-sub">Essa avaliação não existe mais.</p>`; return; }
  allComments[rid] = cms || {};
  const list = listOf(cms).sort((a, b) => a.at - b.at);
  const profs = new Map(await Promise.all([...new Set([r.uid, ...list.map(c => c.uid)])].map(async u => [u, await getProfile(u)])));
  if (!box.isConnected) return;
  const myReview = r.uid === auth.uid;
  box.innerHTML = `<div class="net-list">${postHTML({ id: rid, ...r }, profs.get(r.uid), likes, { noCmt: true })}</div>
    <div class="cm-list">${list.length ? list.map(c => { const p = profs.get(c.uid); return `<div class="cm" data-cid="${esc(c.id)}">
      <button class="cm-av" data-user="${esc(c.uid)}">${avatarFor(p || { handle: c.handle }, 34)}</button>
      <div class="cm-body"><div class="cm-head"><button data-user="${esc(c.uid)}"><b>${esc((p && p.name) || c.handle)}</b></button><span>@${esc(c.handle)}, ${ago(c.at)}</span></div>
        <p>${esc(c.text)}</p></div>
      <button class="icon-btn post-more" data-cmore="${esc(c.id)}" data-cuid="${esc(c.uid)}" aria-label="Opções do comentário">${DOTS}</button></div>`; }).join("")
    : `<p class="hero-sub cm-empty">Ninguém comentou ainda. Comece a conversa.</p>`}</div>
    <form class="cm-form" id="cm-f" autocomplete="off">
      <textarea class="text-input" id="cm-t" maxlength="500" rows="1" placeholder="${myReview ? "Responda quem comentou" : "Escreva um comentário"}"></textarea>
      <button class="cm-send" type="submit" aria-label="Enviar">${SEND}</button></form>`;
  wirePosts(box.querySelector(".net-list"), self);
  box.querySelectorAll(".cm [data-user]").forEach(b => b.onclick = () => openNetProfile(b.dataset.user, self));
  box.querySelectorAll("[data-cmore]").forEach(b => b.onclick = () => openCommentMenu(rid, b.dataset.cmore, b.dataset.cuid, myReview, self));
  const f = box.querySelector("#cm-f"), ta = box.querySelector("#cm-t");
  ta.oninput = () => { ta.style.height = "auto"; ta.style.height = Math.min(140, ta.scrollHeight + 2) + "px"; };
  f.onsubmit = async e => {
    e.preventDefault();
    const text = ta.value.trim();
    if (!text) return;
    const btn = f.querySelector("button"); btn.disabled = true;
    try { await dbPost(`comments/${rid}`, { uid: auth.uid, handle: socialMe.handle, text: text.slice(0, 500), at: Date.now() }); self(); setTimeout(() => { body.scrollTop = body.scrollHeight; }, 400); }
    catch (_) { toast("Não deu para comentar agora. Tente de novo."); btn.disabled = false; }
  };
}
function openCommentMenu(rid, cid, cuid, myReview, back) {
  const mine = cuid === auth.uid;
  showSheet(`<div class="sheet-top"><button class="icon-btn" data-back aria-label="Voltar">${ICON.back}</button></div>
    <div class="actions" style="margin-top:22px">
      <button class="btn btn-ghost" id="cmm-prof">Ver perfil</button>
      ${mine || myReview ? `<button class="btn btn-danger" id="cmm-del">Apagar comentário</button>` : ""}
      ${mine ? "" : `<span class="field-label" style="margin:14px 0 0">Denunciar este comentário</span>
      <div class="seg" id="cmm-rep">${["Spam", "Ofensivo ou com ódio", "Spoiler", "Outro motivo"].map(x => `<button class="chip" data-v="${x}">${x}</button>`).join("")}</div>
      <button class="btn btn-danger" id="cmm-block">Bloquear esta pessoa</button>`}
    </div>`, back);
  body.querySelector("#cmm-prof").onclick = () => openNetProfile(cuid, back);
  const d = body.querySelector("#cmm-del");
  if (d) d.onclick = async () => {
    try { await dbDel(`comments/${rid}/${cid}`); toast("Comentário apagado"); } catch (_) { toast("Não deu para apagar agora"); }
    back();
  };
  const rp = body.querySelector("#cmm-rep");
  if (rp) rp.onclick = async e => {
    const b = e.target.closest("[data-v]"); if (!b) return;
    try { await dbPost("reports", { by: auth.uid, uid: cuid, rid, cid, reason: b.dataset.v, at: Date.now() }); toast("Denúncia enviada. Obrigado por avisar."); }
    catch (_) { toast("Não deu para enviar a denúncia agora"); }
    back();
  };
  const bl = body.querySelector("#cmm-block");
  if (bl) bl.onclick = () => { if (!blocked.includes(cuid)) blocked.push(cuid); store.save("backlog.blocked.v1", blocked); toast("Pessoa bloqueada"); back(); };
}

/* =========================================================
   Comparar estantes
   ========================================================= */
function shelfPayload() {
  const items = {};
  games.forEach(g => {
    const k = keyOf(g.title);
    if (items[k]) return;
    const c = safeImg(g.coverRemote) || safeImg(toArr(g.coverAlts)[0]);
    items[k] = { t: g.title.slice(0, 120), s: g.status, r: clampRating(g.rating) || 0, h: Math.round((Number(g.hours) || 0) * 10) / 10, p: g.platform || "", c: c.length < 400 ? c : "" };
  });
  return { at: Date.now(), items };
}
async function publishShelf() {
  if (!socialReady()) return;
  if (profile.shelfPublic) await dbPut(`shelves/${auth.uid}`, shelfPayload());
  else await dbDel(`shelves/${auth.uid}`).catch(() => {});
}
async function openCompare(uid, p, back) {
  const self = () => openCompare(uid, p, back);
  if (!profile.shelfPublic) {
    showSheet(`<div class="sheet-top"><button class="icon-btn" data-back aria-label="Voltar">${ICON.back}</button></div>
      <h2 class="hero-title" style="margin-top:18px">Comparar estantes</h2>
      <p class="hero-sub">Para comparar com @${esc(p.handle)}, sua estante precisa ficar visível na Rede: quais jogos você tem, o status, a nota e as horas. Suas análises e o que não foi publicado continuam só com você.</p>
      <div class="actions"><button class="btn btn-primary" id="cp-on">Deixar visível e comparar</button></div>
      <p class="panel-note">Dá para esconder de novo quando quiser em Ajustes > Rede.</p>`, back);
    body.querySelector("#cp-on").onclick = async e => {
      e.currentTarget.disabled = true;
      profile.shelfPublic = true; saveProfile();
      try { await publishShelf(); await publishProfile(); self(); }
      catch (_) { toast("Não deu agora. Tente de novo."); e.currentTarget.disabled = false; }
    };
    return;
  }
  showSheet(`<div class="sheet-top"><button class="icon-btn" data-back aria-label="Voltar">${ICON.back}</button></div><div id="cp">${skeletonRows(4)}</div>`, back, self);
  const box = body.querySelector("#cp");
  let theirs;
  try { publishShelf().catch(() => {}); theirs = await dbGet(`shelves/${uid}`); }
  catch (_) { if (box.isConnected) box.innerHTML = `<p class="hero-sub">Não deu para comparar agora. Confira a internet.</p>`; return; }
  if (!box.isConnected) return;
  if (!theirs || !theirs.items) {
    box.innerHTML = `<h2 class="hero-title" style="margin-top:18px">Comparar estantes</h2>
      <p class="hero-sub">@${esc(p.handle)} ainda não deixou a estante visível para comparação. Quando deixar, a comparação aparece aqui.</p>`;
    return;
  }
  const me = new Map(); games.forEach(g => { const k = keyOf(g.title); if (!me.has(k)) me.set(k, g); });
  const them = new Map(Object.entries(theirs.items));
  const common = [...me.keys()].filter(k => them.has(k));
  const onlyMe = [...me.keys()].filter(k => !them.has(k));
  const onlyThem = [...them.keys()].filter(k => !me.has(k));
  const myS = publicStats();
  const tv = [...them.values()];
  const thS = { games: tv.length, done: tv.filter(x => x.s === "done").length, hours: Math.round(tv.reduce((a, x) => a + (x.h || 0), 0)) };
  const tr = tv.filter(x => x.r); thS.avg = tr.length ? Math.round(tr.reduce((a, x) => a + x.r, 0) / tr.length * 10) / 10 : 0;
  const bothRated = common.filter(k => me.get(k).rating && them.get(k).r);
  const match = bothRated.length >= 2 ? Math.round(100 - bothRated.reduce((a, k) => a + Math.abs(clampRating(me.get(k).rating) - them.get(k).r), 0) / bothRated.length / 4.5 * 100) : null;
  const bothDone = common.filter(k => me.get(k).status === "done" && them.get(k).s === "done").length;
  const diff = myS.done - thS.done;
  const verdict = diff === 0 ? `Empate: os dois zeraram ${myS.done} ${myS.done === 1 ? "jogo" : "jogos"}.`
    : diff > 0 ? `Você zerou ${diff} ${diff === 1 ? "jogo" : "jogos"} a mais que @${esc(p.handle)}.` : `@${esc(p.handle)} zerou ${-diff} ${diff === -1 ? "jogo" : "jogos"} a mais que você.`;
  const meP = { name: profile.name, handle: socialMe.handle, color: profile.color, photo: myPublicPhoto() };
  const row = (label, a, b, fmt = x => x) => `<div class="cmp-row"><b class="${a > b ? "is-win" : ""}">${fmt(a)}</b><span>${label}</span><b class="${b > a ? "is-win" : ""}">${fmt(b)}</b></div>`;
  let tab = "common";
  const pill = (s, r) => `<span class="cmp-pill" style="--c:${STATUS_HEX[s] || "#888"}">${esc(statusOf(s).label)}${r ? ` ${fmtH(r)}★` : ""}</span>`;
  const drawList = () => {
    const el = box.querySelector("#cp-list");
    const keys = tab === "common" ? common : tab === "me" ? onlyMe : onlyThem;
    el.innerHTML = keys.length ? `<ul class="rows" style="padding:0">${keys.slice(0, 300).map(k => {
      const g = me.get(k), t = them.get(k);
      const covers = g ? gameCovers(g) : [safeImg(t.c)].filter(Boolean);
      const title = g ? g.title : t.t;
      const sub = tab === "common" ? `<span class="cmp-pills"><small>Você</small>${pill(g.status, g.rating)}<small>@${esc(p.handle)}</small>${pill(t.s, t.r)}</span>`
        : tab === "me" ? pill(g.status, g.rating) : `${pill(t.s, t.r)}${t.h ? ` <small>${fmtH(t.h)} h</small>` : ""}`;
      return `<li><button class="row" data-ck="${esc(k)}">${coverHTML(covers, title)}<div><div class="row-title">${esc(title)}</div><div class="row-sub">${sub}</div></div>
        <span class="row-chev">${ICON.chev}</span></button></li>`; }).join("")}</ul>`
      : `<p class="hero-sub" style="margin-top:14px">${tab === "common" ? "Nenhum jogo em comum ainda." : tab === "me" ? `Você não tem nenhum jogo que @${esc(p.handle)} não tenha.` : `@${esc(p.handle)} não tem nenhum jogo que você não tenha.`}</p>`;
    el.querySelectorAll("[data-ck]").forEach(b => b.onclick = () => {
      const k = b.dataset.ck, g = me.get(k), t = them.get(k);
      g ? openGame(g, null, self) : openGame(null, { title: t.t, year: "", covers: [safeImg(t.c)].filter(Boolean) }, self);
    });
  };
  box.innerHTML = `
    <div class="cmp-head">
      <div>${avatarFor(meP, 64)}<b>Você</b></div><span class="cmp-vs">vs</span><div>${avatarFor(p, 64)}<b>@${esc(p.handle)}</b></div>
    </div>
    <p class="cmp-verdict">${verdict}</p>
    <div class="cmp-table">
      ${row("jogos", myS.games, thS.games)}${row("zerados", myS.done, thS.done)}${row("horas", myS.hours, thS.hours, x => `${fmtN(x)} h`)}${row("nota média", myS.avg, thS.avg, x => x ? fmtH(x) : "–")}
    </div>
    <div class="cmp-facts">
      <div><b>${common.length}</b><span>em comum</span></div>
      <div><b>${bothDone}</b><span>os dois zeraram</span></div>
      <div><b>${match === null ? "–" : match + "%"}</b><span>gosto parecido</span></div>
    </div>
    ${match === null ? `<p class="panel-note" style="text-align:center">O “gosto parecido” aparece quando vocês dois derem nota para pelo menos 2 jogos em comum.</p>` : ""}
    <div class="segmented" id="cp-seg" style="margin:20px 0 0">
      <button class="is-on" data-t="common">Em comum ${common.length}</button><button data-t="me">Só você ${onlyMe.length}</button><button data-t="them">Só @${esc(p.handle.length > 9 ? p.handle.slice(0, 8) + "…" : p.handle)} ${onlyThem.length}</button>
    </div>
    <div id="cp-list"></div>`;
  box.querySelector("#cp-seg").onclick = e => {
    const b = e.target.closest("[data-t]"); if (!b) return;
    tab = b.dataset.t; box.querySelectorAll("#cp-seg button").forEach(x => x.classList.toggle("is-on", x === b)); drawList();
  };
  drawList();
}

/* =========================================================
   Retrospectiva do ano (estilo stories)
   Libera em dezembro; antes disso dá para ver uma prévia.
   ========================================================= */
let genreCache = store.load("backlog.genres.v1", {});
const wrapReady = y => { const now = new Date(); return y < now.getFullYear() || (y === now.getFullYear() && now.getMonth() === 11); };
const MONTHS_FULL = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const SKIP_GENRES = /acesso antecipado|early access|gratuito|free to play|indie|casual|massively|multijogador/i;
async function gameGenres(g) {
  const k = keyOf(g.title);
  if (genreCache[k] && (genreCache[k].length || Date.now() - (genreCache[k + "@"] || 0) < 7 * 86400000)) return genreCache[k];
  let id = g.steamId || (g.sources && g.sources.steam && g.sources.steam.id);
  try {
    if (!id) {
      const r = await searchSteam(g.title);
      const hit = r.find(x => norm(x.title) === norm(g.title)) || r.find(x => norm(x.title).startsWith(norm(g.title)) || norm(g.title).startsWith(norm(x.title)));
      id = hit && hit.steamId;
    }
    let out = [];
    if (id) {
      const d = await getJSON(`https://store.steampowered.com/api/appdetails?appids=${id}&l=brazilian&cc=BR&filters=genres`);
      out = toArr(d && d[id] && d[id].data && d[id].data.genres).map(x => x.description).filter(Boolean);
    }
    genreCache[k] = out; genreCache[k + "@"] = Date.now();
    store.save("backlog.genres.v1", genreCache);
    return out;
  } catch (_) { return genreCache[k] || []; }
}
async function wrapData(y, onProgress) {
  const done = doneIn(y).sort((a, b) => a.doneAt - b.doneAt);
  const inYear = t => t && yearOf(t) === y;
  const months = Array(12).fill(0); done.forEach(g => months[new Date(g.doneAt).getMonth()]++);
  const topMonth = months.indexOf(Math.max(...months));
  const plats = {}; done.forEach(g => { const p = g.platform || ""; if (p) plats[p] = (plats[p] || 0) + 1; });
  const platList = Object.entries(plats).sort((a, b) => b[1] - a[1]);
  const hours = Math.round(done.reduce((a, g) => a + (Number(g.hours) || 0), 0));
  let sessionMin = 0, sessions = 0;
  games.forEach(g => toArr(g.history).forEach(e => { if (e.type === "session" && inYear(e.t)) { sessionMin += e.min || 0; sessions++; } }));
  const rated = done.filter(g => g.rating).sort((a, b) => b.rating - a.rating || (Number(b.hours) || 0) - (Number(a.hours) || 0));
  const timed = done.filter(g => Number(g.hours) > 0).sort((a, b) => Number(b.hours) - Number(a.hours));
  const added = games.filter(g => inYear(g.addedAt)).length;
  const dropped = games.filter(g => toArr(g.history).some(e => e.type === "status" && e.to === "dropped" && inYear(e.t))).length;
  // Gêneros dos jogos zerados (pela loja da Steam, quando acha o jogo)
  const genres = {};
  const pool = done.slice(-40);
  let i = 0, finished = 0;
  const worker = async () => { while (i < pool.length) { const g = pool[i++]; (await gameGenres(g)).filter(x => !SKIP_GENRES.test(x)).forEach(x => { genres[x] = (genres[x] || 0) + 1; }); finished++; onProgress && onProgress(finished / pool.length); } };
  await Promise.all([worker(), worker(), worker(), worker()]);
  const genreList = Object.entries(genres).sort((a, b) => b[1] - a[1]);
  const goal = (profile.goals || {})[y];
  return { y, done, months, topMonth, platList, hours, sessionMin, sessions, best: rated[0], longest: timed[0], fastest: timed.length > 1 ? timed[timed.length - 1] : null,
    added, dropped, genreList, goal, preview: !wrapReady(y) };
}

const WRAP_BG = [
  { bg: "#FFD21F", ink: "#0B0B0C", sub: "rgba(11,11,12,.72)" },
  { bg: "#F03A2E", ink: "#FFFFFF", sub: "rgba(255,255,255,.8)" },
  { bg: "#4C8DFF", ink: "#FFFFFF", sub: "rgba(255,255,255,.82)" },
  { bg: "#2FBF71", ink: "#06210F", sub: "rgba(6,33,15,.75)" },
  { bg: "#0B0B0C", ink: "#F6F4EE", sub: "rgba(246,244,238,.7)" },
  { bg: "#8B5CF6", ink: "#FFFFFF", sub: "rgba(255,255,255,.8)" }
];
async function drawWrapSlides(d) {
  const W = 1080, H = 1920;
  try { await Promise.all([document.fonts.load("900 300px Archivo"), document.fonts.load("600 40px Archivo"), document.fonts.load("800 40px Archivo")]); } catch (_) {}
  const c = cardColors();
  const imgCache = new Map();
  const imgOf = async g => { if (!g) return null; if (!imgCache.has(g.id)) imgCache.set(g.id, firstImage(gameCovers(g))); return imgCache.get(g.id); };
  const slides = [];
  const make = async (pal, fn) => {
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = pal.bg; ctx.fillRect(0, 0, W, H);
    // formas grandes ao fundo, para não ficar chapado
    ctx.save(); ctx.globalAlpha = .12; ctx.fillStyle = pal.ink;
    ctx.beginPath(); ctx.arc(W + 60, 300, 420, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(-120, H - 260, 360, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    // marca e ano
    ctx.save(); const bc = { ...c, a: pal.bg === "#FFD21F" ? "#0B0B0C" : c.a, t: pal.ink }; drawBrand(ctx, 72, 150, bc); ctx.restore();
    ctx.fillStyle = pal.ink; setFont(ctx, 900, 44, "condensed"); ctx.textAlign = "right"; ctx.fillText(`${d.y}${d.preview ? " · prévia" : ""}`, W - 72, 150); ctx.textAlign = "left";
    await fn(ctx, pal);
    slides.push(cv.toDataURL("image/jpeg", 0.9));
  };
  const label = (ctx, pal, t, y) => { setFont(ctx, 800, 50); ctx.fillStyle = pal.sub; ctx.textAlign = "left"; wrap(ctx, t, W - 144, 2).forEach((s, i) => ctx.fillText(s, 72, y + i * 62)); };
  const huge = (ctx, pal, t, y, size = 330) => { setFont(ctx, 900, size, "extra-condensed"); ctx.fillStyle = pal.ink; ctx.textAlign = "left"; let s = size; while (ctx.measureText(t).width > W - 144 && s > 90) { s -= 10; setFont(ctx, 900, s, "extra-condensed"); } ctx.fillText(t, 64, y); return s; };
  const text = (ctx, pal, t, y, size = 44, weight = 600, lines = 3, color) => { setFont(ctx, weight, size); ctx.fillStyle = color || pal.sub; ctx.textAlign = "left"; const ls = wrap(ctx, t, W - 144, lines); ls.forEach((s, i) => ctx.fillText(s, 72, y + i * size * 1.3)); return y + ls.length * size * 1.3; };
  const coverAt = async (ctx, g, x, y, w, h, rot = 0) => {
    const img = await imgOf(g);
    ctx.save(); ctx.translate(x + w / 2, y + h / 2); ctx.rotate(rot); ctx.translate(-w / 2, -h / 2);
    ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = 50; ctx.shadowOffsetY = 24;
    ctx.fillStyle = "#1f1f22"; rr(ctx, 0, 0, w, h, 26); ctx.fill(); ctx.shadowColor = "transparent";
    rr(ctx, 0, 0, w, h, 26); ctx.clip();
    if (img) drawCover(ctx, img, 0, 0, w, h);
    else { setFont(ctx, 900, Math.round(w / 7), "condensed"); ctx.fillStyle = "#8a877f"; wrap(ctx, g.title, w - 40, 4).forEach((s, i) => ctx.fillText(s, 20, 20 + w / 6 + i * w / 6.2)); }
    ctx.restore();
  };
  const starRow = (ctx, r, x, y, size, col, empty) => {
    for (let i = 1; i <= 5; i++) {
      const cx = x + (i - 1) * size * 1.25 + size / 2;
      ctx.fillStyle = empty; drawStar(ctx, cx, y, size / 2);
      const part = r >= i ? 1 : r >= i - .5 ? .5 : 0;
      if (part) { ctx.save(); ctx.beginPath(); ctx.rect(cx - size / 2 - 2, y - size, (size + 4) * part, size * 2); ctx.clip(); ctx.fillStyle = col; drawStar(ctx, cx, y, size / 2); ctx.restore(); }
    }
  };
  const n = d.done.length;

  // 1. Abertura
  await make(WRAP_BG[4], async (ctx, pal) => {
    const av = await avatarImage();
    drawAvatar(ctx, av, 72, 420, 150);
    label(ctx, pal, d.preview ? `Prévia do seu ano, ${profile.name || "jogador"}` : `Seu ano nos jogos, ${profile.name || "jogador"}`, 680);
    setFont(ctx, 900, 400, "extra-condensed"); ctx.fillStyle = c.a; ctx.fillText(String(d.y), 56, 1080);
    text(ctx, pal, d.preview ? `Isto é como seu ano está até agora. A retrospectiva completa libera em dezembro.` : `Bora ver tudo o que você zerou, jogou e avaliou.`, 1200, 46, 600, 4);
    text(ctx, pal, "Toque para avançar  →", H - 180, 38, 700, 1, c.a);
  });
  // 2. Zerados
  await make(WRAP_BG[0], async (ctx, pal) => {
    label(ctx, pal, d.preview ? "Até agora você zerou" : "Você zerou", 360);
    const s = huge(ctx, pal, String(n), 700);
    setFont(ctx, 800, 70, "condensed"); ctx.fillStyle = pal.ink; ctx.fillText(n === 1 ? "jogo" : "jogos", 72, 800);
    const shown = d.done.slice(-8).reverse();
    const cols = shown.length <= 3 ? Math.max(2, shown.length) : 4, gap = 22, cw = Math.min(380, (W - 144 - gap * (cols - 1)) / cols), ch = cw * 1.4;
    for (let i = 0; i < shown.length; i++) await coverAt(ctx, shown[i], 72 + (i % cols) * (cw + gap), 920 + Math.floor(i / cols) * (ch + gap), cw, ch, (i % 2 ? 1 : -1) * 0.025);
    if (n > 8) text(ctx, pal, `e mais ${n - 8}`, 900 + 2 * (ch + gap) + 40, 40, 800, 1, pal.ink);
    void s;
  });
  // 3. Horas
  if (d.hours || d.sessionMin) await make(WRAP_BG[1], async (ctx, pal) => {
    label(ctx, pal, "Nos jogos que você zerou, foram", 420);
    huge(ctx, pal, `${fmtN(d.hours)} h`, 760);
    let y = 860;
    const days = d.hours / 24;
    if (d.hours) y = text(ctx, pal, days >= 1 ? `Isso dá ${fmtH(Math.round(days * 10) / 10)} ${days < 2 ? "dia inteiro" : "dias inteiros"} sem parar.` : `Quase ${Math.max(1, Math.round(d.hours))} horas de pura gameplay.`, y, 50, 700, 3, pal.ink);
    if (d.sessionMin) text(ctx, pal, `O cronômetro registrou mais ${fmtDur(d.sessionMin)} em ${d.sessions} ${d.sessions === 1 ? "sessão" : "sessões"}.`, y + 40, 44, 600, 3);
    if (d.longest) {
      text(ctx, pal, "A maior jornada", 1280, 40, 800, 1);
      await coverAt(ctx, d.longest, 72, 1320, 230, 322);
      setFont(ctx, 900, 64, "condensed"); ctx.fillStyle = pal.ink; wrap(ctx, d.longest.title, W - 144 - 270, 3).forEach((s, i) => ctx.fillText(s, 340, 1400 + i * 66));
      setFont(ctx, 700, 44); ctx.fillStyle = pal.sub; ctx.fillText(`${fmtH(Number(d.longest.hours))} h`, 340, 1400 + Math.min(3, wrap(ctx, d.longest.title, W - 414, 3).length) * 66 + 10);
    }
  });
  // 4. Mês
  if (n >= 2) await make(WRAP_BG[2], async (ctx, pal) => {
    label(ctx, pal, "Seu mês mais forte foi", 420);
    huge(ctx, pal, MONTHS_FULL[d.topMonth], 700, 230);
    text(ctx, pal, `${d.months[d.topMonth]} ${d.months[d.topMonth] === 1 ? "jogo zerado" : "jogos zerados"} só nele.`, 800, 50, 700, 2, pal.ink);
    const max = Math.max(1, ...d.months), bw = (W - 144 - 11 * 16) / 12, base = 1560, hMax = 520;
    d.months.forEach((v, i) => {
      const x = 72 + i * (bw + 16), h = v ? Math.max(24, v / max * hMax) : 8;
      ctx.fillStyle = i === d.topMonth ? pal.ink : "rgba(255,255,255,.35)"; rr(ctx, x, base - h, bw, h, 14); ctx.fill();
      setFont(ctx, 800, 34); ctx.textAlign = "center"; ctx.fillStyle = pal.ink; ctx.fillText(MONTHS[i][0].toUpperCase(), x + bw / 2, base + 56);
      if (v) { ctx.fillStyle = i === d.topMonth ? pal.ink : pal.sub; ctx.fillText(String(v), x + bw / 2, base - h - 20); }
      ctx.textAlign = "left";
    });
  });
  // 5. Gênero
  if (d.genreList.length) await make(WRAP_BG[5], async (ctx, pal) => {
    label(ctx, pal, "Seu gênero favorito", 420);
    huge(ctx, pal, d.genreList[0][0], 690, 240);
    text(ctx, pal, `${d.genreList[0][1]} dos seus zerados ${d.genreList[0][1] === 1 ? "é" : "são"} desse gênero.`, 790, 50, 700, 2, pal.ink);
    const top = d.genreList.slice(0, 5), max = top[0][1];
    top.forEach(([gname, v], i) => {
      const y = 1040 + i * 130;
      setFont(ctx, 800, 44); ctx.fillStyle = pal.ink; ctx.fillText(`${i + 1}. ${gname}`, 72, y);
      ctx.fillStyle = "rgba(255,255,255,.22)"; rr(ctx, 72, y + 22, W - 144, 22, 11); ctx.fill();
      ctx.fillStyle = pal.ink; rr(ctx, 72, y + 22, Math.max(22, (W - 144) * v / max), 22, 11); ctx.fill();
    });
  });
  // 6. Plataforma
  if (d.platList.length) await make(WRAP_BG[3], async (ctx, pal) => {
    label(ctx, pal, "Você mais zerou no", 420);
    huge(ctx, pal, platLabel(d.platList[0][0]), 690, 240);
    text(ctx, pal, `${d.platList[0][1]} de ${n} ${n === 1 ? "jogo" : "jogos"}.`, 790, 50, 700, 2, pal.ink);
    d.platList.slice(0, 5).forEach(([p, v], i) => {
      const y = 1040 + i * 130;
      setFont(ctx, 800, 44); ctx.fillStyle = pal.ink; ctx.fillText(platLabel(p), 72, y);
      ctx.textAlign = "right"; ctx.fillText(String(v), W - 72, y); ctx.textAlign = "left";
      ctx.fillStyle = "rgba(6,33,15,.18)"; rr(ctx, 72, y + 22, W - 144, 22, 11); ctx.fill();
      ctx.fillStyle = pal.ink; rr(ctx, 72, y + 22, Math.max(22, (W - 144) * v / n), 22, 11); ctx.fill();
    });
  });
  // 7. Favorito
  if (d.best) await make(WRAP_BG[4], async (ctx, pal) => {
    const img = await imgOf(d.best);
    if (img) { drawBackdrop(ctx, img, W, H); ctx.save(); const bc = { ...c }; drawBrand(ctx, 72, 150, bc); ctx.restore(); setFont(ctx, 900, 44, "condensed"); ctx.fillStyle = pal.ink; ctx.textAlign = "right"; ctx.fillText(`${d.y}${d.preview ? " · prévia" : ""}`, W - 72, 150); ctx.textAlign = "left"; }
    label(ctx, pal, "Seu jogo favorito do ano", 330);
    await coverAt(ctx, d.best, (W - 560) / 2, 420, 560, 784);
    setFont(ctx, 900, 92, "condensed"); ctx.fillStyle = pal.ink; ctx.textAlign = "center";
    const tl = wrap(ctx, d.best.title, W - 144, 2); tl.forEach((s, i) => ctx.fillText(s, W / 2, 1340 + i * 92)); ctx.textAlign = "left";
    starRow(ctx, clampRating(d.best.rating), W / 2 - (5 * 72 * 1.25 - 72 * .25) / 2, 1340 + tl.length * 92 + 30, 72, c.a, "rgba(246,244,238,.2)");
    if (d.best.review) { setFont(ctx, 500, 40); ctx.fillStyle = pal.sub; ctx.textAlign = "center"; wrap(ctx, `“${d.best.review}”`, W - 200, 3).forEach((s, i) => ctx.fillText(s, W / 2, 1340 + tl.length * 92 + 150 + i * 54)); ctx.textAlign = "left"; }
  });
  // 8. Meta
  if (d.goal) await make(WRAP_BG[n >= d.goal.games ? 3 : 1], async (ctx, pal) => {
    label(ctx, pal, `Meta de ${d.y}`, 420);
    huge(ctx, pal, `${n}/${d.goal.games}`, 760);
    text(ctx, pal, n >= d.goal.games ? (n > d.goal.games ? `Meta batida e ainda passou ${n - d.goal.games}. Monstro!` : "Meta batida! Missão cumprida.") : d.preview ? `Faltam ${d.goal.games - n}. Ainda dá tempo!` : `Faltaram ${d.goal.games - n}. Ano que vem vai!`, 870, 56, 800, 3, pal.ink);
    ctx.fillStyle = "rgba(255,255,255,.25)"; rr(ctx, 72, 1100, W - 144, 40, 20); ctx.fill();
    ctx.fillStyle = pal.ink; rr(ctx, 72, 1100, Math.max(40, (W - 144) * Math.min(1, n / d.goal.games)), 40, 20); ctx.fill();
  });
  // 9. Resumo
  await make(WRAP_BG[4], async (ctx, pal) => {
    label(ctx, pal, d.preview ? `Meu ${d.y} até agora` : `Meu ${d.y} nos jogos`, 300);
    const box = (x, y, w, h, big, small, hi) => {
      ctx.fillStyle = hi ? c.a : "rgba(246,244,238,.08)"; rr(ctx, x, y, w, h, 30); ctx.fill();
      let s = 110; setFont(ctx, 900, s, "condensed"); while (ctx.measureText(big).width > w - 60 && s > 50) { s -= 6; setFont(ctx, 900, s, "condensed"); }
      ctx.fillStyle = hi ? c.on : pal.ink; ctx.fillText(big, x + 32, y + 40 + s * .85);
      setFont(ctx, 700, 34); ctx.fillStyle = hi ? c.on : pal.sub; ctx.fillText(small, x + 32, y + h - 36);
    };
    const bw = (W - 144 - 24) / 2, bh = 230;
    box(72, 360, bw, bh, String(n), n === 1 ? "jogo zerado" : "jogos zerados", true);
    box(72 + bw + 24, 360, bw, bh, `${fmtN(d.hours)} h`, "nos zerados");
    box(72, 360 + bh + 24, bw, bh, n >= 2 ? MONTHS_FULL[d.topMonth] : "–", "melhor mês");
    box(72 + bw + 24, 360 + bh + 24, bw, bh, d.genreList.length ? d.genreList[0][0] : d.platList.length ? platLabel(d.platList[0][0]) : "–", d.genreList.length ? "gênero favorito" : "plataforma");
    let y = 360 + 2 * (bh + 24) + 40;
    if (d.best) {
      setFont(ctx, 800, 36); ctx.fillStyle = pal.sub; ctx.fillText("Favorito do ano", 72, y + 20);
      await coverAt(ctx, d.best, 72, y + 50, 210, 294);
      setFont(ctx, 900, 60, "condensed"); ctx.fillStyle = pal.ink; const tl = wrap(ctx, d.best.title, W - 144 - 250, 3); tl.forEach((s, i) => ctx.fillText(s, 320, y + 130 + i * 62));
      starRow(ctx, clampRating(d.best.rating), 320, y + 130 + tl.length * 62 + 20, 44, c.a, "rgba(246,244,238,.2)");
      y += 380;
    }
    const sh = d.done.slice(-6).reverse(), cw = (W - 144 - 5 * 16) / 6;
    for (let i = 0; i < sh.length; i++) await coverAt(ctx, sh[i], 72 + i * (cw + 16), y + 20, cw, cw * 1.4);
    await drawFooter(ctx, W, H, c);
  });
  return slides;
}

let wrapEl = null, wrapState = null;
function closeWrap() {
  if (!wrapEl) return;
  clearTimeout(wrapState && wrapState.timer);
  wrapEl.remove(); wrapEl = null; wrapState = null;
  document.body.style.overflow = sheet.hidden ? "" : "hidden";
}
async function openWrap(year) {
  const y = year || new Date().getFullYear();
  if (!doneIn(y).length) {
    showSheet(`<div class="sheet-top"><button class="icon-btn" data-back aria-label="Fechar">${ICON.close}</button></div>
      <h2 class="hero-title" style="margin-top:18px">Retrospectiva de ${y}</h2>
      <p class="hero-sub">Ela aparece quando você tiver pelo menos um jogo zerado em ${y}. Marque um jogo como Zerado (com a data “Zerado em”) e volte aqui.</p>`);
    return;
  }
  closeWrap();
  wrapEl = document.createElement("div");
  wrapEl.className = "wrap";
  wrapEl.innerHTML = `<div class="wrap-load"><div class="wrap-spin"></div><b>Montando sua retrospectiva…</b><span id="wrap-pct">Juntando seus jogos de ${y}</span></div>`;
  document.body.appendChild(wrapEl);
  document.body.style.overflow = "hidden";
  const me = wrapEl;
  let slides;
  try {
    const d = await wrapData(y, f => { const el = me.querySelector("#wrap-pct"); if (el) el.textContent = `Descobrindo seus gêneros… ${Math.round(f * 100)}%`; });
    if (me !== wrapEl) return;
    me.querySelector("#wrap-pct").textContent = "Desenhando…";
    slides = await drawWrapSlides(d);
  } catch (_) { slides = null; }
  if (me !== wrapEl) return;
  if (!slides || !slides.length) { closeWrap(); toast("Não deu para montar a retrospectiva agora"); return; }
  if (wrapReady(y)) { profile.wrapSeen = { ...(profile.wrapSeen || {}), [y]: Date.now() }; store.save("backlog.profile.v1", profile); }
  wrapState = { i: 0, slides, y, timer: null, paused: false };
  me.innerHTML = `
    <div class="wrap-bars">${slides.map(() => `<span><i></i></span>`).join("")}</div>
    <button class="wrap-x" aria-label="Fechar">${ICON.close}</button>
    <div class="wrap-stage"><img alt="" id="wrap-img"></div>
    <div class="wrap-tap wrap-prev" aria-label="Anterior"></div><div class="wrap-tap wrap-next" aria-label="Próximo"></div>
    <div class="wrap-actions">
      <button class="btn btn-primary" id="wrap-share">${SHARE}Compartilhar</button>
      <button class="btn btn-ghost" id="wrap-save">Salvar</button>
    </div>`;
  const img = me.querySelector("#wrap-img"), bars = [...me.querySelectorAll(".wrap-bars span")];
  const DUR = 6500;
  const show = i => {
    const st = wrapState; if (!st) return;
    st.i = Math.max(0, Math.min(slides.length - 1, i));
    img.src = slides[st.i];
    bars.forEach((b, k) => { b.classList.toggle("is-done", k < st.i); b.classList.toggle("is-on", k === st.i); const bar = b.querySelector("i"); bar.style.animation = "none"; void bar.offsetWidth; bar.style.animation = ""; });
    clearTimeout(st.timer);
    if (st.i < slides.length - 1) st.timer = setTimeout(() => { if (wrapState === st && !st.paused) show(st.i + 1); }, DUR);
  };
  me.querySelector(".wrap-x").onclick = closeWrap;
  me.querySelector(".wrap-prev").onclick = () => show(wrapState.i - 1);
  me.querySelector(".wrap-next").onclick = () => { if (wrapState.i >= slides.length - 1) closeWrap(); else show(wrapState.i + 1); };
  const pause = on => { const st = wrapState; if (!st) return; st.paused = on; me.classList.toggle("is-paused", on); if (!on) show(st.i); else clearTimeout(st.timer); };
  let holdT;
  me.querySelectorAll(".wrap-tap").forEach(t => {
    t.addEventListener("pointerdown", () => { holdT = setTimeout(() => pause(true), 350); });
    t.addEventListener("pointerup", e => { clearTimeout(holdT); if (wrapState && wrapState.paused) { e.stopImmediatePropagation(); pause(false); t.dataset.skip = "1"; setTimeout(() => delete t.dataset.skip, 50); } });
    t.addEventListener("click", e => { if (t.dataset.skip) e.stopImmediatePropagation(); }, true);
  });
  me.querySelector("#wrap-share").onclick = async () => {
    const data = slides[wrapState.i];
    if (Native && Native.shareImage) { try { await callNative("shareImage", data, `Minha retrospectiva ${y} no Zerei`); } catch (_) { toast("Não deu para compartilhar agora"); } }
    else toast("Toque e segure na imagem para salvar ou compartilhar");
  };
  me.querySelector("#wrap-save").onclick = async () => {
    if (!(Native && Native.saveImage)) { toast("Toque e segure na imagem para salvar"); return; }
    try { await callNative("saveImage", slides[wrapState.i], `zerei-retrospectiva-${y}-${wrapState.i + 1}`); toast("Imagem salva em Imagens > Zerei"); }
    catch (_) { toast("Não deu para salvar agora"); }
  };
  show(0);
}
function wrapBannerHTML() {
  const now = new Date(), m = now.getMonth(), cy = now.getFullYear();
  const y = m === 11 ? cy : m === 0 ? cy - 1 : null;
  if (y === null || !doneIn(y).length) return "";
  return `<button class="wrap-banner" id="q-wrap"><span><small>${(profile.wrapSeen || {})[y] ? "Reveja" : "Novo"}</small><b>Sua retrospectiva de ${y} está pronta</b><i>${doneIn(y).length} zerados, veja seu ano nos jogos</i></span><span class="wb-year">${y}</span></button>`;
}

/* Botão voltar do Android */
window.__onBack = () => {
  if (themeDrawer) { closeThemeDrawer(); return true; }
  if (wrapEl) { closeWrap(); return true; }
  if (!sheet.hidden) { sheetBack ? sheetBack() : closeSheet(); return true; }
  if (currentView !== "library") { go("library"); return true; }
  return false;
};
document.addEventListener("keydown", e => { if (e.key === "Escape") window.__onBack(); });

/* Início */
if (window.__PREVIEW && !games.length) {
  games = window.__PREVIEW.seed.map((g, i) => ({ id: "ex" + i, cover: "", coverRemote: "", coverAlts: [], review: "", addedAt: 0, updatedAt: 10 - i, ...g }));
}
applyTheme();
renderLibrary();
renderSessionBar();
startCloud();
setTimeout(autoUpdateCheck, 2500);
setTimeout(checkNotifs, 4000);
// Jogos sem cópia local da capa: baixa em segundo plano, 2 de cada vez
setTimeout(ensureCovers, 1200);
setTimeout(loadWikiThumbs, 1500);
})();
