"""Copertine TikTok: python3 cover.py <lista.json>   lista = [{"out":"x.png","r":"📰 LA SETTIMANA","t":"Titolo con *parola*","p":"win"}, ...]
Pose: crossed (default) · win (target) · loss (stop) · think (posizione aperta) · shrug (nessun setup) · point (lezione/report)"""
import asyncio, os, sys, json, threading, http.server, functools, urllib.parse
from playwright.async_api import async_playwright
BASE = os.path.dirname(os.path.abspath(__file__)); PORT = 8767
def serve():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=BASE); h.log_message = lambda *a: None
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), h).serve_forever()
async def main():
    items = json.load(open(sys.argv[1])); threading.Thread(target=serve, daemon=True).start()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        for it in items:
            pg = await b.new_page(viewport={"width": 1080, "height": 1920})
            q = urllib.parse.urlencode({k: v for k, v in it.items() if k != "out"})
            await pg.goto(f"http://127.0.0.1:{PORT}/trader.html?shot=cover&{q}")
            await pg.wait_for_function("window.READY === true", timeout=60000); await pg.evaluate("document.fonts.ready")
            await pg.evaluate("renderAt(0)"); await pg.screenshot(path=it["out"], type="png"); await pg.close(); print("ok", it["out"])
        await b.close()
asyncio.run(main())
