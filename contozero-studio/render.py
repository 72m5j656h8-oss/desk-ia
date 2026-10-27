"""Render scene.html frame by frame with headless Chromium and encode to MP4."""
import asyncio, json, os, subprocess, sys, threading, http.server, functools
from playwright.async_api import async_playwright

BASE = os.path.dirname(os.path.abspath(__file__))
TL = json.load(open(os.path.join(BASE, "timeline.json")))
FPS = TL["fps"]
PORT = 8765


def serve():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=BASE)
    h.log_message = lambda *a: None
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), h).serve_forever()


async def main():
    threading.Thread(target=serve, daemon=True).start()
    mode = sys.argv[1] if len(sys.argv) > 1 else "video"
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        pg = await b.new_page(viewport={"width": 1080, "height": 1920})
        pg.on("console", lambda m: print("console:", m.text) if m.type in ("error", "warning") else None)
        pg.on("pageerror", lambda e: print("pageerror:", e))
        await pg.goto(f"http://127.0.0.1:{PORT}/scene.html")
        await pg.wait_for_function("window.READY === true", timeout=60000)
        await pg.evaluate("document.fonts.ready")
        if mode == "stills":
            os.makedirs(os.path.join(BASE, "preview"), exist_ok=True)
            for t in map(float, sys.argv[2:]):
                await pg.evaluate(f"renderAt({t})")
                await pg.screenshot(path=os.path.join(BASE, "preview", f"s_{t:05.1f}.jpg"), type="jpeg", quality=85)
            await b.close(); return
        n = int(TL["total"] * FPS)
        out = os.path.join(BASE, "sala_piena_ep01.mp4")
        ff = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", str(FPS), "-c:v", "mjpeg", "-i", "-",
                               "-i", os.path.join(BASE, "audio", "mix.wav"), "-c:v", "libx264", "-preset", "medium", "-crf", "20",
                               "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", out],
                              stdin=subprocess.PIPE)
        for i in range(n):
            await pg.evaluate(f"renderAt({i / FPS})")
            ff.stdin.write(await pg.screenshot(type="jpeg", quality=93))
            if i % 60 == 0:
                print(f"{i}/{n}", flush=True)
        ff.stdin.close(); ff.wait()
        await b.close()
        print("done", out)


asyncio.run(main())
