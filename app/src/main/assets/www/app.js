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
const saveGames = () => { store.save("backlog.games.v1", games); scheduleSync(); };
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
    light: { a: "#0FB5A6", a2: "#E0287F", at: "#0B7F75", on: "#FFFFFF", on2: "#FFFFFF" } }
};
function resolvedMode() {
  if (settings.mode !== "system") return settings.mode;
  try { if (Native && Native.isSystemDark) return Native.isSystemDark() ? "dark" : "light"; } catch (_) {}
  return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
function applyTheme() {
  const mode = resolvedMode();
  const t = (THEMES[settings.theme] || THEMES.arcade)[mode];
  const r = document.documentElement;
  r.dataset.mode = mode;
  r.style.setProperty("--accent", t.a);
  r.style.setProperty("--accent-2", t.a2);
  r.style.setProperty("--accent-text", t.at);
  r.style.setProperty("--on-accent", t.on);
  r.style.setProperty("--on-accent-2", t.on2);
  const bg = getComputedStyle(r).getPropertyValue("--bg").trim();
  try { Native && Native.setBars && Native.setBars(bg, mode === "light"); } catch (_) {}
}
window.__onSystemTheme = () => { if (settings.mode === "system") applyTheme(); };
matchMedia("(prefers-color-scheme: light)").addEventListener?.("change", window.__onSystemTheme);

/* =========================================================
   Dados auxiliares
   ========================================================= */
const STATUSES = [
  { id: "playing", label: "Jogando",     color: "var(--accent-2)" },
  { id: "backlog", label: "Quero jogar", color: "var(--faint)" },
  { id: "done",    label: "Zerado",      color: "var(--accent)" },
  { id: "dropped", label: "Abandonado",  color: "var(--bg-3)" }
];
const PLATFORMS = ["PC", "Xbox", "PlayStation", "Switch", "Switch 2"];
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
const steamCovers = id => [steamBase(id) + "library_600x900_2x.jpg", steamBase(id) + "library_600x900.jpg"];
const steamHeader = id => steamBase(id) + "header.jpg";
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
function coverHTML(urls, title, opts = {}) {
  const list = (Array.isArray(urls) ? urls : [urls]).filter(Boolean);
  const fb = `<div class="cover-fallback">${esc(title)}</div>`;
  const wikiAttr = opts.wiki ? ` data-wiki="${esc(opts.wiki)}"` : "";
  if (!list.length) return `<div class="cover"${wikiAttr}>${fb}</div>`;
  const co = /upload\.wikimedia\.org/.test(list[0]) ? ' crossorigin="anonymous"' : "";
  return `<div class="cover"${wikiAttr}>${fb}<img src="${esc(list[0])}" alt="" decoding="async"${co}
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
  if (view === "ach") renderTracked();
  if (view === "settings") renderSettings();
}
document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => go(t.dataset.view)));
document.addEventListener("click", e => { const g = e.target.closest("[data-goto]"); if (g) go(g.dataset.goto); });

/* =========================================================
   Biblioteca
   ========================================================= */
let libFilter = "all";
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
        ${coverHTML(gameCovers(g), g.title)}
        <div class="case-title">${esc(g.title)}</div>
        <div class="case-sub">${esc(platLabel(g.platform))}${g.hours ? `, ${fmtH(g.hours)} h` : ""}</div>
      </button>`).join("")}</div>` : "";

  $("#lib-filters").innerHTML = [{ id: "all", label: "Todos" }, ...STATUSES]
    .map(s => `<button class="chip ${libFilter === s.id ? "is-on" : ""}" data-f="${s.id}">${s.label} <span class="count">${counts[s.id]}</span></button>`)
    .join("");

  const list = sortGames(games.filter(g => libFilter === "all" ? g.status !== "playing" || !playing.length : g.status === libFilter));
  const shelfLabel = libFilter === "all" && playing.length ? `<div class="section-label" style="grid-column:1/-1;margin:6px 0 0">Na estante <small>${list.length}</small></div>` : "";
  $("#lib-grid").innerHTML = games.length ? shelfLabel + (list.map(g => {
    const st = statusOf(g.status);
    const stars = g.rating ? `<span class="minstars">${"★".repeat(g.rating)}</span>` : "";
    return `<button class="case" data-id="${g.id}">
      ${coverHTML(gameCovers(g), g.title)}
      <div class="case-title">${esc(g.title)}</div>
      <div class="case-sub"><span class="pip" style="background:${st.color}"></span>${esc(platLabel(g.platform) || st.label)} ${stars}</div>
    </button>`;
  }).join("") || `<p class="status-line" style="grid-column:1/-1;padding:0">Nenhum jogo com esse status.</p>`) : "";
}
$("#lib-filters").addEventListener("click", e => {
  const c = e.target.closest("[data-f]");
  if (c) { libFilter = c.dataset.f; renderLibrary(); }
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
        ${coverHTML(r.covers, r.title)}
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

let playersCache = store.load("backlog.players.v1", { at: 0, data: {} });
let trendingLoading = false;
async function renderTrending() {
  const list = $("#trending-list");
  const fresh = Date.now() - playersCache.at < 10 * 60 * 1000 && Object.keys(playersCache.data).length;
  if (fresh) return drawTrending();
  if (Object.keys(playersCache.data).length) drawTrending(); else list.innerHTML = skeletonRows(6);
  if (trendingLoading) return;
  trendingLoading = true;
  const withSteam = POPULAR_GAMES.filter(p => p.steam);
  const results = await Promise.allSettled(withSteam.map(p =>
    getJSON(`https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${p.steam}`)
      .then(d => [p.steam, d.response?.player_count ?? 0])));
  trendingLoading = false;
  const data = {};
  results.forEach(r => { if (r.status === "fulfilled") data[r.value[0]] = r.value[1]; });
  if (Object.keys(data).length) {
    playersCache = { at: Date.now(), data };
    store.save("backlog.players.v1", playersCache);
    drawTrending();
  } else if (!Object.keys(playersCache.data).length) {
    list.innerHTML = "";
    $("#explore-trending .lede").textContent = window.__PREVIEW
      ? "Na prévia não há conexão com a Steam. No app instalado, esta lista mostra quantas pessoas estão jogando agora."
      : "Sem conexão com a Steam agora. Conecte-se à internet e abra a aba de novo.";
  }
}
function drawTrending() {
  const data = playersCache.data;
  const ranked = POPULAR_GAMES.filter(p => p.steam && data[p.steam] > 0).sort((a, b) => data[b.steam] - data[a.steam]);
  $("#trending-list").innerHTML = ranked.map((p, i) => `<li><button class="row rank-row" data-p="${POPULAR_GAMES.indexOf(p)}">
      <span class="rank">${i + 1}</span>
      ${coverHTML(popCovers(p), p.title, { ck: popKey(p), wiki: p.wiki })}
      <div>
        <div class="row-title">${esc(p.title)}</div>
        <div class="row-sub"><span class="live">${fmtN(data[p.steam])} jogando agora</span></div>
      </div>
      <span class="pill">${fmtH(p.main)} h</span>
    </button></li>`).join("");
}
$("#trending-list").addEventListener("click", e => {
  const b = e.target.closest("[data-p]");
  if (b) openPopular(POPULAR_GAMES[+b.dataset.p]);
});

let hltbSort = "popular";
function renderHltb() {
  $("#hltb-sort").innerHTML = [["popular", "Mais jogados"], ["short", "Mais curtos"], ["long", "Mais longos"]]
    .map(([id, l]) => `<button class="chip ${hltbSort === id ? "is-on" : ""}" data-s="${id}">${l}</button>`).join("");
  const list = POPULAR_GAMES.map((p, i) => ({ p, i }));
  if (hltbSort === "short") list.sort((a, b) => a.p.main - b.p.main);
  if (hltbSort === "long") list.sort((a, b) => b.p.main - a.p.main);
  const max = Math.max(...POPULAR_GAMES.map(p => p.full));
  $("#hltb-list").innerHTML = list.map(({ p, i }) => `<li><button class="hltb-item" data-p="${i}">
      ${coverHTML(popCovers(p), p.title, { ck: popKey(p), wiki: p.wiki })}
      <div>
        <div class="hltb-title">${esc(p.title)}</div>
        <div class="hltb-sub">${p.year}, ${esc(p.genre)}</div>
        ${barsHTML(p, max)}
      </div></button></li>`).join("");
}
$("#hltb-sort").addEventListener("click", e => {
  const c = e.target.closest("[data-s]");
  if (c) { hltbSort = c.dataset.s; renderHltb(); }
});
$("#hltb-list").addEventListener("click", e => {
  const b = e.target.closest("[data-p]");
  if (b) openPopular(POPULAR_GAMES[+b.dataset.p]);
});

/* =========================================================
   Folha (tela por cima) com voltar
   ========================================================= */
const sheet = $("#sheet"), body = $("#sheet-body");
let sheetBack = null;

function showSheet(html, back) {
  sheetBack = back || null;
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
    sheetBack = null;
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
  const pop = findPopular(draft.title, draft.wiki);
  const covers = isNew ? draft.covers : gameCovers(game);
  const steamId = draft.steamId || (pop && pop.steam);

  showSheet(`
    <div class="sheet-top">
      <button class="icon-btn" data-back aria-label="Voltar">${back ? ICON.back : ICON.close}</button>
      ${isNew ? "" : `<button class="btn btn-danger" id="del">Remover</button>`}
    </div>
    <div class="hero">
      ${coverHTML(covers, draft.title)}
      <div>
        <h2 class="hero-title">${esc(draft.title)}</h2>
        <div class="hero-sub">${esc(draft.year || "")}</div>
        ${isNew ? "" : `<button class="link-btn" id="swap">Trocar capa</button>`}
      </div>
    </div>

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
      <div class="stars" id="f-stars">${[1, 2, 3, 4, 5].map(n =>
        `<button class="star ${draft.rating >= n ? "is-on" : ""}" data-v="${n}" aria-label="${n} de 5">${ICON.star}</button>`).join("")}</div>
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

    <div class="field">
      <label class="field-label" for="f-review">Sua análise</label>
      <textarea class="review" id="f-review" placeholder="O que achou da história, da jogabilidade, do final…">${esc(draft.review)}</textarea>
    </div>

    ${pop ? `<div class="panel">
      <span class="field-label">Tempo médio para zerar</span>
      ${barsHTML(pop, pop.full)}
      <p class="panel-note" id="compare" hidden></p>
    </div>` : ""}

    <div class="actions">
      <button class="btn btn-primary" id="save">${isNew ? "Adicionar à biblioteca" : "Salvar alterações"}</button>
      ${isNew ? "" : `<button class="btn btn-ghost" id="see-ach">${ICON.trophy}Ver conquistas</button>`}
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
    compare();
  });
  body.querySelector("#f-stars").addEventListener("click", e => {
    const b = e.target.closest("[data-v]");
    if (!b) return;
    const n = +b.dataset.v;
    draft.rating = draft.rating === n ? 0 : n;
    body.querySelectorAll(".star").forEach(s => s.classList.toggle("is-on", +s.dataset.v <= draft.rating));
  });
  const hoursInput = body.querySelector("#f-hours");
  hoursInput.addEventListener("input", () => { draft.hours = hoursInput.value; compare(); });
  body.querySelectorAll("[data-step]").forEach(b => b.addEventListener("click", () => {
    const v = Math.max(0, (parseFloat(hoursInput.value) || 0) + +b.dataset.step);
    hoursInput.value = v; draft.hours = String(v); compare();
  }));
  body.querySelector("#f-review").addEventListener("input", e => draft.review = e.target.value);

  body.querySelector("#save").addEventListener("click", () => {
    if (!draft.platform) { toast("Escolha a plataforma em que você jogou"); return; }
    if (isNew) {
      const g = {
        id: "g" + Date.now().toString(36), title: draft.title, year: draft.year, wiki: draft.wiki || "",
        steamId: steamId || null, cover: "", coverRemote: draft.covers[0] || "", coverAlts: draft.covers.slice(1),
        platform: draft.platform, status: draft.status, rating: draft.rating, review: draft.review.trim(),
        hours: draft.hours, addedAt: Date.now(), updatedAt: Date.now()
      };
      games.push(g);
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
      Object.assign(game, { platform: draft.platform, status: draft.status, rating: draft.rating,
        review: draft.review.trim(), hours: draft.hours, updatedAt: Date.now() });
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
  if (seeAch) seeAch.addEventListener("click", () => openAchievementsFor(draft.title, steamId, () => openGame(game, null, back)));
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

let achFilter = "all", achSort = "default";
async function openAchievements(appid, title, back) {
  showSheet(`
    <div class="sheet-top"><button class="icon-btn" data-back aria-label="${back ? "Voltar" : "Fechar"}">${back ? ICON.back : ICON.close}</button></div>
    <div class="banner">${coverHTML([steamHeader(appid)], "").replace('class="cover"', 'class="cover" style="aspect-ratio:auto;height:100%;border-radius:0"')}</div>
    <div class="ach-head">
      <h2 class="hero-title">${esc(title)}</h2>
      <div id="ach-body"><ul class="ach-list">${skeletonRows(6)}</ul></div>
    </div>`, back);

  let list;
  try { list = await fetchAchievements(appid); }
  catch (_) {
    const el = body.querySelector("#ach-body");
    if (el) el.innerHTML = `<p class="hero-sub">Não foi possível carregar as conquistas. Verifique a internet e tente de novo.</p>`;
    return;
  }
  const el = body.querySelector("#ach-body");
  if (!el) return;
  if (!list.length) {
    el.innerHTML = `<p class="hero-sub">Esse jogo não tem conquistas na Steam.</p>`;
    return;
  }
  const done = achDone(appid);
  const draw = () => {
    const n = list.filter(a => done.has(a.id)).length;
    let items = list.filter(a => achFilter === "all" || (achFilter === "done" ? done.has(a.id) : !done.has(a.id)));
    if (achSort === "rare") items = [...items].sort((a, b) => a.pct - b.pct);
    if (achSort === "common") items = [...items].sort((a, b) => b.pct - a.pct);
    el.innerHTML = `
      <div class="progress-big"><b>${n}/${list.length}</b><span>conquistas, ${Math.round(n / list.length * 100)}%</span></div>
      <div class="progress-track"><div style="width:${n / list.length * 100}%"></div></div>
      <div class="chips" style="padding-left:0;padding-right:0" id="ach-filter">
        ${[["all", "Todas", list.length], ["todo", "Faltando", list.length - n], ["done", "Conquistadas", n]].map(([id, l, c]) =>
          `<button class="chip ${achFilter === id ? "is-on" : ""}" data-af="${id}">${l} <span class="count">${c}</span></button>`).join("")}
        ${[["default", "Ordem do jogo"], ["common", "Mais comuns"], ["rare", "Mais raras"]].map(([id, l]) =>
          `<button class="chip ${achSort === id ? "is-on" : ""}" data-as="${id}">${l}</button>`).join("")}
      </div>
      <ul class="ach-list">${items.map(a => {
        const r = a.pct < 5 ? ["r-ultra", "Ultra rara"] : a.pct < 20 ? ["r-rare", "Rara"] : ["r-common", "Comum"];
        return `<li><button class="ach ${done.has(a.id) ? "is-done" : ""}" data-a="${esc(a.id)}">
          <div class="ach-icon">${a.icon ? `<img src="${esc(a.icon)}" alt="" loading="lazy">` : ""}</div>
          <div>
            <div class="ach-name">${esc(a.name)}</div>
            ${a.desc ? `<div class="ach-desc">${esc(a.desc)}</div>` : ""}
            <div class="ach-meta"><span class="rarity ${r[0]}">${r[1]}</span>${a.hidden ? `<span class="rarity r-common">Secreta</span>` : ""}<span>${fmtH(a.pct)}% dos jogadores</span></div>
          </div>
          <span class="check" aria-label="Marcar como conquistada">${ICON.check}</span>
        </button></li>`;
      }).join("") || `<p class="hero-sub">Nada aqui ainda.</p>`}</ul>`;
    updateTracked(appid, title, list.length, n);
  };
  draw();
  el.addEventListener("click", e => {
    const f = e.target.closest("[data-af]"), s = e.target.closest("[data-as]"), a = e.target.closest("[data-a]");
    if (f) { achFilter = f.dataset.af; draw(); }
    else if (s) { achSort = s.dataset.as; draw(); }
    else if (a) {
      const id = a.dataset.a;
      done.has(id) ? done.delete(id) : done.add(id);
      saveAchDone(appid, done);
      const y = body.scrollTop;
      draw();
      body.scrollTop = y;
    }
  });
}

/* Aba Conquistas */
let achResults = [], achToken = 0;
function renderTracked() {
  const box = $("#ach-tracked");
  if ($("#ach-input").value.trim().length >= 2) { box.innerHTML = ""; return; }
  box.innerHTML = tracked.length ? `
    <div class="section-label">Acompanhando <small>${tracked.length}</small></div>
    <ul class="rows">${tracked.map((t, i) => `<li><button class="row tracked-row" data-t="${i}">
        ${coverHTML(steamCovers(t.appid).concat(steamHeader(t.appid)), t.title)}
        <div><div class="row-title">${esc(t.title)}</div>
          <div class="row-sub">${t.done} de ${t.total} conquistas</div>
          <div class="progress-track"><div style="width:${t.total ? t.done / t.total * 100 : 0}%"></div></div></div>
        <span class="row-chev">${ICON.chev}</span></button></li>`).join("")}</ul>`
    : `<div class="empty"><p class="empty-title">Acompanhe suas conquistas</p>
       <p class="empty-text">Busque um jogo da Steam para ver todas as conquistas, quantos jogadores têm cada uma e marcar as que você já fez.</p></div>`;
}
$("#ach-tracked").addEventListener("click", e => {
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
    <div class="group">
      <h2 class="group-title">Aparência</h2>
      <div class="card-list">
        <div class="setting">
          <div class="setting-name">Modo</div>
          <div class="segmented">${segBtns("mode", [["dark", "Escuro"], ["light", "Claro"], ["system", "Do sistema"]])}</div>
        </div>
        <div class="setting">
          <div class="setting-name">Tema</div>
          <div class="themes">${Object.entries(THEMES).map(([id, t]) => {
            const c = t[resolvedMode()];
            return `<button class="theme-card ${settings.theme === id ? "is-on" : ""}" data-set="theme" data-val="${id}">
              <div class="swatch"><span style="background:${resolvedMode() === "light" ? "#121212" : "#0B0B0C"}"></span><span style="background:${c.a}"></span><span style="background:${c.a2}"></span></div>
              <div class="theme-name">${t.name}</div><div class="theme-desc">${t.desc}</div></button>`;
          }).join("")}</div>
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
    <p class="about">Backlog ${esc(APP.tag)}. Capas da Wikipédia e da Steam. Conquistas e jogadores agora vêm da Steam.</p>`;
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
  if (Native && Native.share) { Native.share(data, "Backup do Backlog"); return; }
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
    if (!d || d.app !== "backlog" || !Array.isArray(d.games)) { toast("Esse texto não é um backup do Backlog"); return; }
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
  return { v: 1, updatedAt: Date.now(), games: games.map(g => ({ ...g, cover: "" })), achievements, tracked, profile, deleted };
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
  store.save("backlog.games.v1", games);
  store.save("backlog.deleted.v1", deleted);
  store.save("backlog.achTracked.v1", tracked);
  store.save("backlog.profile.v1", profile);
}
function ensureCovers() {
  games.filter(g => !g.cover && (g.coverRemote || toArr(g.coverAlts).length)).forEach(g =>
    downloadCover(gameCovers(g), "cover_" + g.id).then(l => { if (l) { g.cover = l; store.save("backlog.games.v1", games); } }));
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
function startCloud() { if (cloudReady && auth) fullSync(); }

/* --- Avatar --- */
function renderAvatarButton() {
  const el = $("#lib-count");
  if (!el) return;
  el.innerHTML = `<button class="avatar-btn" id="avatar-btn" aria-label="Seu perfil">${avatarHTML(40)}${auth ? `<i class="sync-dot ${sync.error ? "is-err" : ""}"></i>` : ""}</button>`;
  el.querySelector("button").onclick = () => openProfile();
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
          <div><b>Conta Google</b><span id="acct-status">${auth ? syncLine() : "Salva na nuvem e sincroniza entre celulares."}</span></div>
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
        : `
          <button class="btn btn-google" disabled>${GOOGLE_G}Entrar com Google</button>
          <p class="panel-note" style="margin:0">O login com Google ainda não foi ativado nesta versão. Enquanto isso, o perfil offline guarda tudo neste celular.</p>`}
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
        </form>` : ""}
    </div>`);

  // Nome e frase entram no perfil na hora; o salvamento espera a pessoa parar de digitar
  let t;
  const later = () => { clearTimeout(t); t = setTimeout(saveProfile, 500); };
  body.querySelector("#p-name").addEventListener("input", e => { profile.name = e.target.value.trim(); later(); });
  body.querySelector("#p-bio").addEventListener("input", e => { profile.bio = e.target.value.trim(); later(); });

  const refresh = () => { const y = body.scrollTop; openProfile(); body.scrollTop = y; };
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
  return String(body || "").split(/\n\s*(Co-Authored-By|Claude-Session)/i)[0].trim();
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
  if (res === "permission") toast("Permita instalar apps do Backlog e toque em Instalar de novo");
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

/* Botão voltar do Android */
window.__onBack = () => {
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
startCloud();
setTimeout(autoUpdateCheck, 2500);
// Jogos antigos sem cópia local da capa: baixa agora em segundo plano
games.filter(g => !g.cover && (g.coverRemote || (g.coverAlts || []).length)).forEach(g =>
  downloadCover(gameCovers(g), "cover_" + g.id).then(l => { if (l) { g.cover = l; saveGames(); } }));
setTimeout(loadWikiThumbs, 1500);
})();
