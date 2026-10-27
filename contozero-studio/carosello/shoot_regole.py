import asyncio, os, threading, http.server, functools
from playwright.async_api import async_playwright
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def serve():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=BASE); h.log_message = lambda *a: None
    http.server.ThreadingHTTPServer(("127.0.0.1", 8767), h).serve_forever()
async def main():
    threading.Thread(target=serve, daemon=True).start()
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={"width": 1080, "height": 1350})
        await pg.goto("http://127.0.0.1:8767/carosello/regole.html"); await pg.wait_for_function("window.READY"); await pg.evaluate("document.fonts.ready")
        os.makedirs(f"{BASE}/carosello/out", exist_ok=True)
        for i in range(1, 5):
            await pg.locator(f"#s{i}").screenshot(path=f"{BASE}/carosello/out/regole_{i}.png")
        await b.close()
asyncio.run(main())
