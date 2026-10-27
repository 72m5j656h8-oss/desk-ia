import asyncio, os, sys
from playwright.async_api import async_playwright

HTML = """<html><body style='margin:0'><canvas id=c width=200 height=200></canvas><script>
const gl=document.getElementById('c').getContext('webgl2');
document.title = gl ? ('ok '+gl.getParameter(gl.RENDERER)) : 'nogl';
</script></body></html>"""


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        pg = await b.new_page()
        await pg.set_content(HTML)
        print(await pg.title())
        await b.close()

asyncio.run(main())
