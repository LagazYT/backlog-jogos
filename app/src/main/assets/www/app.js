(() => {
"use strict";

/* =========================================================
   Ponte com o Android (downloads nativos, sem bloqueio CORS)
   No navegador, cai para fetch() comum.
   ========================================================= */
const Native = window.AndroidBridge || null;
const pending = {};
let seq = 0;
window.__nativeCb = (id, ok, payload) => {
  const p = pending[id];
  delete pending[id];
  if (!p) return;
  ok ? p.res(payload) : p.rej(new Error(payload || "falha"));
};
function callNative(method, ...args) {
  return new Promise((res, rej) => {
    const id = "c" + (++seq);
    pending[id] = { res, rej };
    try { Native[method](...args, id); } catch (e) { delete pending[id]; rej(e); }
  });
}
async function getJSON(url) {
  if (Native) return JSON.parse(await callNative("httpGet", url));
  const r = await fetch(url);
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}
/* Baixa a primeira URL de capa que responder com uma imagem válida.
   No Android salva no armazenamento do app e devolve file://… */
async function downloadCover(urls, key) {
  const list = (Array.isArray(urls) ? urls : [urls]).filter(Boolean);
  if (!Native) {
    for (const u of list) { if (await imageLoads(u)) return u; }
    return null;
  }
  for (const u of list) {
    try { return await callNative("downloadImage", u, key); } catch (_) { /* tenta a próxima */ }
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
   Dados
   ========================================================= */
const STATUSES = [
  { id: "playing", label: "Jogando", color: "var(--s-playing)" },
  { id: "backlog", label: "Quero jogar", color: "var(--s-backlog)" },
  { id: "done", label: "Zerado", color: "var(--s-done)" },
  { id: "dropped", label: "Abandonado", color: "var(--s-dropped)" }
];
const PLATFORMS = ["PC", "Xbox", "PlayStation", "Switch", "Switch 2"];
const statusOf = id => STATUSES.find(s => s.id === id) || STATUSES[1];

const store = {
  load(k, fallback) { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch (_) { return fallback; } },
  save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }
};
let games = store.load("backlog.games.v1", []);
let popularCovers = store.load("backlog.popularCovers.v1", {});
const saveGames = () => store.save("backlog.games.v1", games);

const norm = s => (s || "").toLowerCase()
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/\((\d{4} )?video game\)/g, "")
  .replace(/[™®©:'’!.,\-–—]/g, " ")
  .replace(/\s+/g, " ").trim();
const cleanWikiTitle = t => t.replace(/\s*\((\d{4} )?video game\)$/i, "").trim();
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtH = h => (Math.round(h * 10) / 10).toString().replace(".", ",");
const findPopular = title => {
  const n = norm(title);
  return POPULAR_GAMES.find(p => norm(p.title) === n || norm(p.wiki) === n);
};

/* =========================================================
   Fontes de busca: Wikipédia (capas de caixa, todas as
   plataformas) + Steam (catálogo de PC)
   ========================================================= */
const WIKI = "https://en.wikipedia.org/w/api.php?";

async function searchWiki(q) {
  const url = WIKI + new URLSearchParams({
    action: "query", format: "json", origin: "*",
    generator: "search", gsrsearch: `${q} hastemplate:"Infobox video game"`, gsrlimit: "14",
    prop: "pageimages|description", piprop: "thumbnail", pithumbsize: "600", pilicense: "any"
  });
  const d = await getJSON(url);
  return Object.values(d.query?.pages || {})
    .sort((a, b) => a.index - b.index)
    .map(p => ({
      key: "w" + p.pageid,
      title: cleanWikiTitle(p.title),
      wiki: p.title,
      year: ((p.description || "").match(/\b(19[7-9]\d|20\d\d)\b/) || [])[0] || "",
      covers: p.thumbnail ? [p.thumbnail.source] : [],
      source: "Wikipédia"
    }));
}

function steamCovers(id) {
  const a = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${id}/`;
  const c = `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/`;
  return [a + "library_600x900_2x.jpg", c + "library_600x900_2x.jpg", a + "library_600x900.jpg", a + "header.jpg"];
}
async function searchSteam(q) {
  const d = await getJSON(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(q)}&l=portuguese&cc=BR`);
  return (d.items || []).filter(i => i.type === "app").map(i => ({
    key: "s" + i.id, title: i.name, year: "", steamId: i.id,
    covers: steamCovers(i.id), source: "Steam"
  }));
}

async function searchGames(q) {
  if (window.__PREVIEW) { // prévia web: sem acesso à internet, busca na lista local
    const nq = norm(q);
    return POPULAR_GAMES.filter(p => norm(p.title).includes(nq))
      .map(p => ({ key: p.wiki, title: p.title, wiki: p.wiki, year: String(p.year), covers: [], source: "Prévia" }));
  }
  const [w, s] = await Promise.allSettled([searchWiki(q), searchSteam(q)]);
  const wiki = w.status === "fulfilled" ? w.value : [];
  const steam = s.status === "fulfilled" ? s.value : [];
  if (w.status === "rejected" && s.status === "rejected") throw new Error("offline");

  // Junta os resultados do mesmo jogo: capa de caixa da Wikipédia primeiro,
  // capa vertical da Steam como alternativa.
  const byName = new Map(wiki.map(r => [norm(r.title), r]));
  const merged = [...wiki];
  for (const r of steam) {
    const twin = byName.get(norm(r.title));
    if (twin) { twin.covers.push(...r.covers); twin.steamId = r.steamId; }
    else merged.push(r);
  }
  const nq = norm(q);
  const score = r => { const n = norm(r.title); return n === nq ? 0 : n.startsWith(nq) ? 1 : n.includes(nq) ? 2 : 3; };
  return merged
    .map((r, i) => ({ r, i }))
    .sort((a, b) => score(a.r) - score(b.r) || a.i - b.i)
    .map(x => x.r)
    .slice(0, 20);
}

/* =========================================================
   Componentes
   ========================================================= */
const $ = s => document.querySelector(s);
const STAR = '<svg viewBox="0 0 24 24"><path d="M12 2.8l2.75 5.86 6.4.77-4.72 4.4 1.24 6.33L12 17.03l-5.67 3.13 1.24-6.33-4.72-4.4 6.4-.77z"/></svg>';
const PLUS = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
const CLOSE = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const BACK = '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>';

function coverHTML(src, title, fallbacks) {
  const fb = `<div class="cover-fallback">${esc(title)}</div>`;
  if (!src) return `<div class="cover">${fb}</div>`;
  const alts = (fallbacks || []).filter(u => u !== src);
  // Wikimedia libera CORS: assim dá para ler a cor da capa no canvas
  const co = /upload\.wikimedia\.org/.test(src) ? ' crossorigin="anonymous"' : "";
  return `<div class="cover">${fb}<img src="${esc(src)}" alt="" loading="lazy" decoding="async"${co}
    data-alts="${esc(alts.join("|"))}" onerror="window.__coverErr(this)"></div>`;
}
window.__coverErr = img => {
  const alts = (img.dataset.alts || "").split("|").filter(Boolean);
  if (alts.length) { img.dataset.alts = alts.slice(1).join("|"); img.src = alts[0]; }
  else img.remove();
};

function barsHTML(p, max) {
  const row = (h, color) => `<div class="bar-row">
      <div class="track"><div class="fill" style="width:${Math.max(3, (h / max) * 100)}%;background:${color}"></div></div>
      <div class="hours">${fmtH(h)} <small>h</small></div></div>`;
  return `<div class="bars">${row(p.main, "var(--t-main)")}${row(p.extra, "var(--t-extra)")}${row(p.full, "var(--t-full)")}</div>`;
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("is-on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("is-on"), 2200);
}

/* =========================================================
   Navegação
   ========================================================= */
let currentView = "library";
function go(view) {
  currentView = view;
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("is-active", v.id === "view-" + view));
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("is-active", t.dataset.view === view));
  window.scrollTo(0, 0);
  if (view === "hltb") renderHltb();
  if (view === "search") setTimeout(() => $("#search-input").focus(), 50);
}
document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => go(t.dataset.view)));
document.addEventListener("click", e => {
  const g = e.target.closest("[data-goto]");
  if (g) go(g.dataset.goto);
});

/* =========================================================
   Biblioteca
   ========================================================= */
let libFilter = "all";
function renderLibrary() {
  const counts = { all: games.length };
  STATUSES.forEach(s => counts[s.id] = games.filter(g => g.status === s.id).length);

  $("#lib-filters").innerHTML = [{ id: "all", label: "Todos" }, ...STATUSES]
    .map(s => `<button class="chip ${libFilter === s.id ? "is-on" : ""}" data-f="${s.id}">${s.label} <span class="count">${counts[s.id]}</span></button>`)
    .join("");

  const done = counts.done;
  const hours = games.reduce((a, g) => a + (Number(g.hours) || 0), 0);
  $("#lib-summary").innerHTML = games.length
    ? `<b>${games.length}</b> ${games.length === 1 ? "jogo" : "jogos"} na estante, <b>${done}</b> ${done === 1 ? "zerado" : "zerados"} e <b>${fmtH(hours)} h</b> registradas.`
    : "";

  const list = games
    .filter(g => libFilter === "all" || g.status === libFilter)
    .sort((a, b) => {
      const order = { playing: 0, backlog: 1, done: 2, dropped: 3 };
      return order[a.status] - order[b.status] || b.updatedAt - a.updatedAt;
    });

  $("#lib-empty").hidden = games.length > 0;
  $("#lib-filters").hidden = games.length === 0;
  $("#lib-grid").innerHTML = list.map(g => {
    const st = statusOf(g.status);
    const stars = g.rating ? `<span class="minstars">${"★".repeat(g.rating)}</span>` : "";
    return `<button class="case" data-id="${g.id}">
      ${coverHTML(g.cover, g.title, g.coverRemote ? [g.coverRemote] : [])}
      <div class="case-meta">
        <div class="case-title">${esc(g.title)}</div>
        <div class="case-sub"><span class="pip" style="background:${st.color}"></span>${esc(g.platform || st.label)} ${stars}</div>
      </div></button>`;
  }).join("") || (games.length ? `<p class="status-line" style="grid-column:1/-1;padding:8px 0">Nenhum jogo com esse status.</p>` : "");
}
$("#lib-filters").addEventListener("click", e => {
  const c = e.target.closest("[data-f]");
  if (!c) return;
  libFilter = c.dataset.f;
  renderLibrary();
});
$("#lib-grid").addEventListener("click", e => {
  const c = e.target.closest("[data-id]");
  if (c) openGame(games.find(g => g.id === c.dataset.id));
});

/* =========================================================
   Busca
   ========================================================= */
let lastResults = [];
let searchToken = 0;
async function runSearch(q) {
  q = q.trim();
  const status = $("#search-status"), list = $("#search-results");
  if (q.length < 2) { status.textContent = ""; list.innerHTML = ""; return; }
  const token = ++searchToken;
  status.textContent = "";
  list.innerHTML = Array.from({ length: 5 }, () =>
    `<li class="result skeleton"><div class="cover"></div><div><div class="bar" style="width:70%"></div><div class="bar" style="width:35%"></div></div><span></span></li>`).join("");
  try {
    const res = await searchGames(q);
    if (token !== searchToken) return;
    lastResults = res;
    status.textContent = res.length ? "" : `Nenhum jogo encontrado para “${q}”. Confira a grafia ou tente o nome em inglês.`;
    list.innerHTML = res.map((r, i) => {
      const added = games.some(g => norm(g.title) === norm(r.title));
      const sub = [r.year, r.source].filter(Boolean).join(", ");
      return `<li class="result" data-i="${i}">
        ${coverHTML(r.covers[0], r.title, r.covers)}
        <div><div class="result-title">${esc(r.title)}</div><div class="result-sub">${esc(sub)}</div></div>
        <span class="result-add ${added ? "is-added" : ""}" aria-label="${added ? "Já está na biblioteca" : "Adicionar"}">${added ? CHECK : PLUS}</span>
      </li>`;
    }).join("");
  } catch (_) {
    if (token !== searchToken) return;
    list.innerHTML = "";
    status.textContent = "Sem conexão com a internet. Conecte-se e tente de novo.";
  }
}
let debounce;
$("#search-input").addEventListener("input", e => {
  clearTimeout(debounce);
  debounce = setTimeout(() => runSearch(e.target.value), 380);
});
$("#search-form").addEventListener("submit", e => {
  e.preventDefault();
  clearTimeout(debounce);
  $("#search-input").blur();
  runSearch($("#search-input").value);
});
$("#search-results").addEventListener("click", e => {
  const li = e.target.closest("[data-i]");
  if (!li) return;
  const r = lastResults[+li.dataset.i];
  const existing = games.find(g => norm(g.title) === norm(r.title));
  existing ? openGame(existing) : openGame(null, r);
});

/* =========================================================
   Tempo para zerar
   ========================================================= */
let hltbSort = "popular";
let hltbCoversLoading = false;
function renderHltb() {
  $("#hltb-sort").innerHTML = [["popular", "Mais jogados"], ["short", "Mais curtos"], ["long", "Mais longos"]]
    .map(([id, l]) => `<button class="chip ${hltbSort === id ? "is-on" : ""}" data-s="${id}">${l}</button>`).join("");
  const list = POPULAR_GAMES.map((p, i) => ({ ...p, i }));
  if (hltbSort === "short") list.sort((a, b) => a.main - b.main);
  if (hltbSort === "long") list.sort((a, b) => b.main - a.main);
  const max = Math.max(...POPULAR_GAMES.map(p => p.full));
  $("#hltb-list").innerHTML = list.map(p => `<li><button class="hltb-item" data-p="${p.i}">
      ${coverHTML(popularCovers[p.wiki], p.title)}
      <div>
        <div class="hltb-title">${esc(p.title)}</div>
        <div class="hltb-sub">${p.year}, ${esc(p.genre)}</div>
        ${barsHTML(p, max)}
      </div></button></li>`).join("");
  loadPopularCovers();
}
$("#hltb-sort").addEventListener("click", e => {
  const c = e.target.closest("[data-s]");
  if (c) { hltbSort = c.dataset.s; renderHltb(); }
});
$("#hltb-list").addEventListener("click", e => {
  const b = e.target.closest("[data-p]");
  if (b) openPopular(POPULAR_GAMES[+b.dataset.p]);
});

async function loadPopularCovers() {
  const missing = POPULAR_GAMES.filter(p => !popularCovers[p.wiki]);
  if (!missing.length || hltbCoversLoading) return;
  hltbCoversLoading = true;
  try {
    const url = WIKI + new URLSearchParams({
      action: "query", format: "json", origin: "*", redirects: "1",
      titles: missing.map(p => p.wiki).join("|"),
      prop: "pageimages", piprop: "thumbnail", pithumbsize: "500", pilicense: "any"
    });
    const d = await getJSON(url);
    const alias = {};
    (d.query?.normalized || []).forEach(n => alias[n.to] = n.from);
    (d.query?.redirects || []).forEach(n => alias[n.to] = alias[n.from] || n.from);
    const pages = Object.values(d.query?.pages || {});
    await Promise.all(pages.map(async pg => {
      if (!pg.thumbnail) return;
      const wikiTitle = POPULAR_GAMES.some(p => p.wiki === pg.title) ? pg.title : alias[pg.title];
      if (!wikiTitle) return;
      const local = await downloadCover(pg.thumbnail.source, "pop_" + norm(wikiTitle).replace(/\s/g, "_"));
      if (local) popularCovers[wikiTitle] = local;
    }));
    store.save("backlog.popularCovers.v1", popularCovers);
    if (currentView === "hltb") {
      // Atualiza só as capas, sem redesenhar a lista inteira
      document.querySelectorAll("#hltb-list [data-p]").forEach(b => {
        const p = POPULAR_GAMES[+b.dataset.p];
        const cov = b.querySelector(".cover");
        if (popularCovers[p.wiki] && !cov.querySelector("img")) cov.outerHTML = coverHTML(popularCovers[p.wiki], p.title);
      });
    }
  } catch (_) { /* sem internet: fica a capa tipográfica */ }
  hltbCoversLoading = false;
}

/* =========================================================
   Folha de detalhe
   ========================================================= */
const sheet = $("#sheet"), body = $("#sheet-body");
let sheetStack = [];

function showSheet(html) {
  body.innerHTML = html;
  sheet.hidden = false;
  body.scrollTop = 0;
  sheet.classList.remove("is-closing");
  document.body.style.overflow = "hidden";
  const img = body.querySelector(".hero img");
  if (img) tintFrom(img);
  else body.style.setProperty("--tint", "38, 43, 56");
}
function closeSheet() {
  if (sheet.hidden) return;
  sheet.classList.add("is-closing");
  setTimeout(() => {
    sheet.hidden = true;
    sheet.classList.remove("is-closing");
    document.body.style.overflow = "";
    body.innerHTML = "";
    sheetStack = [];
  }, 190);
}
sheet.addEventListener("click", e => { if (e.target.closest("[data-close]")) closeSheet(); });

/* Pega a cor média da capa para tingir o fundo do detalhe */
function tintFrom(img) {
  const apply = () => {
    try {
      const c = document.createElement("canvas");
      c.width = c.height = 16;
      const x = c.getContext("2d", { willReadFrequently: true });
      x.drawImage(img, 0, 0, 16, 16);
      const d = x.getImageData(0, 0, 16, 16).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
        const w = 1 + (mx - mn) / 40; // dá mais peso às cores saturadas
        r += d[i] * w; g += d[i + 1] * w; b += d[i + 2] * w; n += w;
      }
      r /= n; g /= n; b /= n;
      // Escurece para manter o texto legível
      const k = 0.55;
      body.style.setProperty("--tint", `${Math.round(r * k)}, ${Math.round(g * k)}, ${Math.round(b * k)}`);
    } catch (_) { body.style.setProperty("--tint", "38, 43, 56"); }
  };
  img.complete && img.naturalWidth ? apply() : img.addEventListener("load", apply, { once: true });
}

/* --- Jogo da biblioteca (editar) ou resultado da busca (adicionar) --- */
function openGame(game, result) {
  const isNew = !game;
  const draft = isNew
    ? { title: result.title, year: result.year, covers: result.covers, wiki: result.wiki, steamId: result.steamId,
        platform: "", status: "backlog", rating: 0, review: "", hours: "" }
    : { ...game };
  const pop = findPopular(draft.title) || (draft.wiki && POPULAR_GAMES.find(p => p.wiki === draft.wiki));
  const coverSrc = isNew ? draft.covers[0] : draft.cover;
  const coverAlts = isNew ? draft.covers : [draft.coverRemote];

  const render = () => {
    showSheet(`
      <div class="sheet-top">
        <button class="icon-btn" data-close aria-label="Fechar">${CLOSE}</button>
        ${isNew ? "" : `<button class="btn btn-danger" id="del">Remover</button>`}
      </div>
      <div class="hero">
        ${coverHTML(coverSrc, draft.title, coverAlts)}
        <div>
          <h2 class="hero-title">${esc(draft.title)}</h2>
          <div class="hero-sub">${esc(draft.year || "")}</div>
          ${isNew ? "" : `<button class="cover-swap" id="swap">Trocar capa</button>`}
        </div>
      </div>

      <div class="field">
        <span class="field-label">Onde você jogou</span>
        <div class="seg" id="f-platform">${PLATFORMS.map(p =>
          `<button class="chip ${draft.platform === p ? "is-on" : ""}" data-v="${p}">${p === "Switch" ? "Switch 1" : p}</button>`).join("")}</div>
      </div>

      <div class="field">
        <span class="field-label">Status</span>
        <div class="seg" id="f-status">${STATUSES.map(s =>
          `<button class="chip ${draft.status === s.id ? "is-on" : ""}" data-v="${s.id}"><span class="pip" style="background:${s.color}"></span>${s.label}</button>`).join("")}</div>
      </div>

      <div class="field">
        <span class="field-label">Sua nota</span>
        <div class="stars" id="f-stars">${[1, 2, 3, 4, 5].map(n =>
          `<button class="star ${draft.rating >= n ? "is-on" : ""}" data-v="${n}" aria-label="${n} ${n === 1 ? "estrela" : "estrelas"}">${STAR}</button>`).join("")}</div>
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

      ${pop ? `<div class="estimate">
        <span class="field-label">Tempo médio para zerar</span>
        ${barsHTML(pop, pop.full)}
        <p class="estimate-you" id="compare"></p>
      </div>` : ""}

      <div class="actions">
        <button class="btn btn-primary" id="save">${isNew ? "Adicionar à biblioteca" : "Salvar alterações"}</button>
      </div>`);

    const compare = () => {
      const el = body.querySelector("#compare");
      if (!el) return;
      const h = parseFloat(draft.hours);
      if (draft.status !== "done" || !h) { el.textContent = ""; return; }
      const diff = h - pop.main;
      el.textContent = Math.abs(diff) < 1
        ? `Você zerou em ${fmtH(h)} h, bem na média da história principal.`
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
      draft.rating = draft.rating === n ? 0 : n; // tocar de novo na mesma estrela limpa a nota
      body.querySelectorAll(".star").forEach(s => s.classList.toggle("is-on", +s.dataset.v <= draft.rating));
    });
    const hoursInput = body.querySelector("#f-hours");
    hoursInput.addEventListener("input", () => { draft.hours = hoursInput.value; compare(); });
    body.querySelectorAll("[data-step]").forEach(b => b.addEventListener("click", () => {
      const v = Math.max(0, (parseFloat(hoursInput.value) || 0) + +b.dataset.step);
      hoursInput.value = v; draft.hours = String(v); compare();
    }));
    body.querySelector("#f-review").addEventListener("input", e => draft.review = e.target.value);

    body.querySelector("#save").addEventListener("click", async e => {
      const btn = e.currentTarget;
      if (!draft.platform) { toast("Escolha a plataforma em que você jogou"); return; }
      btn.disabled = true;
      if (isNew) {
        btn.textContent = "Baixando a capa…";
        const id = "g" + Date.now().toString(36);
        const local = await downloadCover(draft.covers, "cover_" + id);
        games.push({
          id, title: draft.title, year: draft.year, wiki: draft.wiki || "", steamId: draft.steamId || null,
          cover: local || "", coverRemote: draft.covers[0] || "",
          platform: draft.platform, status: draft.status, rating: draft.rating,
          review: draft.review.trim(), hours: draft.hours, addedAt: Date.now(), updatedAt: Date.now()
        });
        saveGames();
        toast(local ? "Adicionado à biblioteca" : "Adicionado. A capa não pôde ser baixada agora.");
        refreshSearchMarks();
      } else {
        Object.assign(game, {
          platform: draft.platform, status: draft.status, rating: draft.rating,
          review: draft.review.trim(), hours: draft.hours, updatedAt: Date.now()
        });
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
        games = games.filter(g => g.id !== game.id);
        saveGames();
        if (Native && game.cover && game.cover.startsWith("file:")) Native.deleteFile(game.cover);
        renderLibrary();
        refreshSearchMarks();
        closeSheet();
        toast("Removido da biblioteca");
      });
    }
    const swap = body.querySelector("#swap");
    if (swap) swap.addEventListener("click", () => openCoverPicker(game));
  };
  render();
}

function refreshSearchMarks() {
  document.querySelectorAll("#search-results [data-i]").forEach(li => {
    const r = lastResults[+li.dataset.i];
    const added = games.some(g => norm(g.title) === norm(r.title));
    const b = li.querySelector(".result-add");
    b.classList.toggle("is-added", added);
    b.innerHTML = added ? CHECK : PLUS;
  });
}

/* --- Trocar capa: mostra todas as capas encontradas para o título --- */
async function openCoverPicker(game) {
  showSheet(`
    <div class="sheet-top"><button class="icon-btn" id="pick-back" aria-label="Voltar">${BACK}</button></div>
    <div class="field" style="margin-top:14px">
      <h2 class="hero-title">Escolha a capa</h2>
      <p class="hero-sub">${esc(game.title)}</p>
    </div>
    <div class="picker" id="picker"><p class="status-line" style="grid-column:1/-1;padding:0">Procurando capas…</p></div>`);
  body.querySelector("#pick-back").addEventListener("click", () => openGame(game));

  let options = [];
  try {
    const res = await searchGames(game.title);
    const nt = norm(game.title);
    const close = res.filter(r => norm(r.title) === nt || norm(r.title).includes(nt) || nt.includes(norm(r.title)));
    (close.length ? close : res.slice(0, 6)).forEach(r => r.covers.forEach((u, i) => {
      if (u.includes("header.jpg")) return;           // capa horizontal, não serve
      if (u.includes("cloudflare") && i > 0) return;  // evita duplicata do mesmo arquivo
      options.push({ url: u, src: r.source, title: r.title });
    }));
  } catch (_) { /* sem rede */ }

  const pk = body.querySelector("#picker");
  if (!pk) return;
  if (!options.length) { pk.innerHTML = `<p class="status-line" style="grid-column:1/-1;padding:0">Nenhuma outra capa encontrada. Verifique a conexão.</p>`; return; }
  pk.innerHTML = options.map((o, i) => `<button data-o="${i}" class="${o.url === game.coverRemote ? "is-current" : ""}">
      ${coverHTML(o.url, o.title)}<div class="picker-src">${esc(o.src)}</div></button>`).join("");
  pk.addEventListener("click", async e => {
    const b = e.target.closest("[data-o]");
    if (!b) return;
    const o = options[+b.dataset.o];
    toast("Baixando a capa…");
    const local = await downloadCover(o.url, "cover_" + game.id + "_" + Date.now().toString(36));
    if (!local) { toast("Essa capa não está disponível. Escolha outra."); return; }
    if (Native && game.cover && game.cover.startsWith("file:")) Native.deleteFile(game.cover);
    game.cover = local; game.coverRemote = o.url; game.updatedAt = Date.now();
    saveGames();
    renderLibrary();
    toast("Capa atualizada");
    openGame(game);
  });
}

/* --- Jogo da lista de tempo para zerar --- */
function openPopular(p) {
  const existing = games.find(g => norm(g.title) === norm(p.title) || g.wiki === p.wiki);
  showSheet(`
    <div class="sheet-top"><button class="icon-btn" data-close aria-label="Fechar">${CLOSE}</button></div>
    <div class="hero">
      ${coverHTML(popularCovers[p.wiki], p.title)}
      <div>
        <h2 class="hero-title">${esc(p.title)}</h2>
        <div class="hero-sub">${p.year}, ${esc(p.genre)}<br>${p.platforms.map(x => x === "Switch" ? "Switch 1" : x).join(", ")}</div>
      </div>
    </div>
    <div class="field">
      <span class="field-label">Tempo médio para zerar</span>
      <div class="legend" style="padding:0 0 10px"><span><i class="dot d-main"></i>História</span><span><i class="dot d-extra"></i>+ Extras</span><span><i class="dot d-full"></i>100%</span></div>
      ${barsHTML(p, p.full)}
    </div>
    <div class="actions">
      <button class="btn ${existing ? "btn-ghost" : "btn-primary"}" id="pop-add">${existing ? "Abrir na biblioteca" : "Adicionar à biblioteca"}</button>
    </div>`);
  body.querySelector("#pop-add").addEventListener("click", () => {
    if (existing) return openGame(existing);
    openGame(null, { title: p.title, year: String(p.year), wiki: p.wiki, covers: popularCovers[p.wiki] ? [popularCovers[p.wiki]] : [] });
  });
}

/* Botão voltar do Android */
window.__onBack = () => {
  if (!sheet.hidden) { closeSheet(); return true; }
  if (currentView !== "library") { go("library"); return true; }
  return false;
};
document.addEventListener("keydown", e => { if (e.key === "Escape") window.__onBack(); });

if (window.__PREVIEW && !games.length) {
  games = window.__PREVIEW.seed.map((g, i) => ({ id: "ex" + i, cover: "", coverRemote: "", review: "", addedAt: 0, updatedAt: 10 - i, ...g }));
}
renderLibrary();
})();
