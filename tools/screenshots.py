"""Tira prints do app com dados reais (capas, jogadores agora, conquistas) para o README.
Roda no GitHub Actions: python tools/screenshots.py"""
import json, os, threading, http.server, functools, urllib.request
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WWW = os.path.join(ROOT, "app/src/main/assets/www")
OUT = os.path.join(ROOT, "docs")
os.makedirs(OUT, exist_ok=True)

srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8799), functools.partial(http.server.SimpleHTTPRequestHandler, directory=WWW))
threading.Thread(target=srv.serve_forever, daemon=True).start()

UA = "BacklogApp/1.0 (Android; screenshots do README)"
def fetch(url):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Cookie": "birthtime=470682001; wants_mature_content=1"})
        with urllib.request.urlopen(req, timeout=20) as r:
            return [True, r.read().decode("utf-8", "replace")]
    except Exception as e:
        return [False, str(e)]
def check_image(url):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status == 200 and r.headers.get("Content-Type", "").startswith("image/")
    except Exception:
        return False

BRIDGE = """
window.AndroidBridge = {
  httpGet(url, id) { window.pyFetch(url).then(r => window.__nativeCb(id, r[0], r[1])); },
  downloadImage(url, key, id) { window.pyCheck(url).then(ok => window.__nativeCb(id, ok, ok ? url : 'sem imagem')); },
  googleSignIn(c, id) { window.__nativeCb(id, false, 'cancelado'); },
  httpRequest(m, u, b, c, id) { window.__nativeCb(id, false, 'offline'); },
  deleteFile() {}, isSystemDark() { return true; }, setBars() {}, share() {}, clearCovers() {}
};
"""
def steam(i): return f"https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/{i}/library_600x900_2x.jpg"
SEED = [
  ("Elden Ring", 1245620, "PlayStation", "playing", 0, "64", ""),
  ("Cyberpunk 2077", 1091500, "PC", "playing", 0, "38", ""),
  ("Hollow Knight", 367520, "Switch", "done", 5, "41", "Mapa enorme, chefes incríveis e uma trilha sonora que não sai da cabeça."),
  ("Red Dead Redemption 2", 1174180, "Xbox", "done", 5, "72", "A melhor história de faroeste que já joguei."),
  ("God of War", 1593500, "PC", "done", 4, "26", ""),
  ("Celeste", 504230, "Switch", "done", 4, "11", ""),
  ("Baldur's Gate 3", 1086940, "PC", "backlog", 0, "", ""),
  ("The Witcher 3: Wild Hunt", 292030, "PlayStation", "backlog", 0, "", ""),
  ("Control", 870780, "PC", "dropped", 3, "6", ""),
]
games = [{"id": f"g{i}", "title": t, "year": "", "wiki": "", "steamId": sid, "cover": "", "coverRemote": steam(sid), "coverAlts": [],
          "platform": p, "status": st, "rating": r, "review": rev, "hours": h, "addedAt": 0, "updatedAt": 100 - i}
         for i, (t, sid, p, st, r, h, rev) in enumerate(SEED)]
PROFILE = {"name": "Lagaz", "bio": "Zerando o backlog um jogo por vez", "color": "#FFD21F", "usePhoto": False,
           "favPlatform": "PC", "favGame": "g3", "at": 1}

def seed_script(mode):
    return f"""
    localStorage.setItem('backlog.games.v1', {json.dumps(json.dumps(games))});
    localStorage.setItem('backlog.profile.v1', {json.dumps(json.dumps(PROFILE))});
    localStorage.setItem('backlog.settings.v1', {json.dumps(json.dumps({"mode": mode, "theme": "arcade"}))});
    localStorage.setItem('backlog.achDone.1245620', '[]');
    """

shots = []
with sync_playwright() as p:
    b = p.chromium.launch()
    for mode in ("dark", "light"):
        ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=3, locale="pt-BR")
        ctx.expose_function("pyFetch", fetch)
        ctx.expose_function("pyCheck", check_image)
        ctx.add_init_script(BRIDGE)
        ctx.route("**/firebase-config.js", lambda r: r.fulfill(status=200, content_type="application/javascript",
                  body='window.FIREBASE={apiKey:"x",webClientId:"x",databaseURL:"https://x.firebaseio.com"};'))
        page = ctx.new_page()
        page.goto("http://127.0.0.1:8799/index.html")
        page.evaluate(seed_script(mode))
        page.reload(); page.wait_for_timeout(5000)
        def shot(name):
            path = os.path.join(OUT, f"{name}.png"); page.screenshot(path=path); shots.append(name); print("ok", name)
        if mode == "light":
            shot("biblioteca-claro"); ctx.close(); continue
        shot("biblioteca")
        page.click("#lib-grid [data-id='g2']"); page.wait_for_timeout(2500); shot("jogo")
        page.evaluate("window.__onBack()"); page.wait_for_timeout(400)
        page.click(".tab[data-view=search]"); page.fill("#search-input", "zelda"); page.wait_for_timeout(5000); shot("busca")
        page.click(".tab[data-view=explore]"); page.wait_for_timeout(9000); shot("em-alta")
        page.click("[data-seg=hltb]"); page.wait_for_timeout(5000); shot("tempo")
        page.click(".tab[data-view=ach]"); page.fill("#ach-input", "elden ring"); page.wait_for_timeout(4000)
        page.click("#ach-results [data-i='0']"); page.wait_for_timeout(5000)
        for i in range(4):
            page.locator(".ach").nth(i * 2).click(); page.wait_for_timeout(250)
        page.evaluate("document.querySelector('#sheet-body').scrollTo(0,0)"); page.wait_for_timeout(1200); shot("conquistas")
        page.evaluate("window.__onBack()"); page.wait_for_timeout(400)
        page.click(".tab[data-view=library]"); page.click("#avatar-btn"); page.wait_for_timeout(2500); shot("perfil")
        page.evaluate("window.__onBack()"); page.wait_for_timeout(400)
        page.click(".tab[data-view=settings]"); page.wait_for_timeout(800); shot("ajustes")
        ctx.close()
    b.close()

# Banner com quatro telas lado a lado
names = ["biblioteca", "em-alta", "conquistas", "perfil"]
W, H, gap, pad = 390, 844, 40, 60
canvas = Image.new("RGB", (pad * 2 + W * 4 + gap * 3, H + pad * 2 + 40), (11, 11, 12))
d = ImageDraw.Draw(canvas)
d.rectangle([0, canvas.height - 40, canvas.width, canvas.height], fill=(255, 210, 31))
d.rectangle([0, canvas.height - 52, canvas.width, canvas.height - 40], fill=(240, 58, 46))
for i, n in enumerate(names):
    im = Image.open(os.path.join(OUT, f"{n}.png")).resize((W, H), Image.LANCZOS)
    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, W, H], 36, fill=255)
    x = pad + i * (W + gap); y = pad - (18 if i % 2 else 0)
    ImageDraw.Draw(canvas).rounded_rectangle([x - 6, y - 6, x + W + 6, y + H + 6], 42, fill=(42, 42, 46))
    canvas.paste(im, (x, y), mask)
canvas.save(os.path.join(OUT, "banner.png"), optimize=True)
# Versões menores para a tabela do README
for n in shots:
    im = Image.open(os.path.join(OUT, f"{n}.png"))
    im.resize((390 * 2, 844 * 2), Image.LANCZOS).save(os.path.join(OUT, f"{n}.png"), optimize=True)
print("pronto", shots)
