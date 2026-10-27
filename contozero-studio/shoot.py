"""Render trader.html shots: python3 shoot.py <shot> <w> <h> <out> [t]  |  intro video: python3 shoot.py intro 1080 1920 out.mp4 video"""
import asyncio, os, sys, threading, http.server, functools, subprocess
from playwright.async_api import async_playwright

BASE = os.path.dirname(os.path.abspath(__file__))
PORT = 8766


def serve():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=BASE)
    h.log_message = lambda *a: None
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), h).serve_forever()


async def main():
    shot, w, h, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
    extra = sys.argv[5] if len(sys.argv) > 5 else "0"
    threading.Thread(target=serve, daemon=True).start()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        pg = await b.new_page(viewport={"width": w, "height": h})
        pg.on("pageerror", lambda e: print("pageerror:", e))
        await pg.goto(f"http://127.0.0.1:{PORT}/{shot}.html" if shot in ("notrade",) or shot.startswith("reel") else f"http://127.0.0.1:{PORT}/trader.html?shot={shot}")
        await pg.wait_for_function("window.READY === true", timeout=60000)
        await pg.evaluate("document.fonts.ready")
        if extra == "video":
            import json
            fps = 30; dur = json.load(open(os.path.join(BASE, f"{shot}/tl.json" if shot.startswith("reel") else "notrade/notrade.json" if shot == "notrade" else "talk.json")))["total"] if shot in ("talk", "notrade") or shot.startswith("reel") else 6.0
            ff = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", str(fps), "-c:v", "mjpeg", "-i", "-",
                                   *(["-i", os.path.join(BASE, shot, "mix.wav") if shot.startswith("reel") else os.path.join(BASE, "notrade", "mix.wav") if shot == "notrade" else os.path.join(BASE, "voce", "intro_mix.wav")] if shot in ("talk", "notrade") or shot.startswith("reel") else ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"]), "-c:v", "libx264", "-crf", "19", "-pix_fmt", "yuv420p",
                                   "-c:a", "aac", "-shortest", "-movflags", "+faststart", out], stdin=subprocess.PIPE)
            for i in range(int(fps * dur)):
                await pg.evaluate(f"renderAt({i / fps})")
                ff.stdin.write(await pg.screenshot(type="jpeg", quality=93))
            ff.stdin.close(); ff.wait()
        else:
            for k, tt in enumerate(extra.split(",")):
                await pg.evaluate(f"renderAt({float(tt)})")
                await pg.screenshot(path=out.replace(".png", f"_{k}.png") if "," in extra else out, type="png")
        await b.close()
    print("ok", out)

asyncio.run(main())
