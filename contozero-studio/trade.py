"""Trade-of-the-day reel from a short config.
usage: python3 trade.py <dir>   (reads <dir>/cfg.json + <dir>/tl.json, writes <dir>.html)

All chart coordinates are in the iPhone screenshot's 924-wide space (what you read off the image:
x 0..924, y 0..2000). The page maps them automatically.

cfg = {
 "badge": "TRADE DEL GIORNO", "sub": "NAS100 · 15m · 3 nov",
 "charts": [ {"img": "path/to/screenshot.png", "crop": [y0, y1],          # vertical crop in 924-space (full width)
              "from": 0, "to": 2,                                        # visible from line 0 to the start of line 2 (to omitted = end)
              "mask": [[x0,y0,x1,y1], ...],                              # grey boxes to hide levels (open trades!)
              "reveal": [[line, at, x], ...] } ],                        # left-to-right reveal: at line/at seconds the chart shows up to x (omit = fully visible)
 "ov": [ {"l": 1, "at": 0.5, "to": 3, "svg": "<rect ... />"} , ...],      # SVG overlays in 924-space; "to" = line index where it fades (omit = stays)
 "stamp": [ {"l": 2, "at": 0.3, "to": 3, "text": "STOP", "sub": "−1R", "color": "#ff5a6a", "y": 900} ],
 "cards": [ {"l": 4, "at": 0.3, "to": 5, "html": "<div class='t'>…</div>…", "color": "#ff5a6a"} ],
 "hook": ["IERI", "<span class='r'>STOP ❌</span>"],                       # big text over line 0
 "open": 6,                                                              # line from which "posizione aperta · non è un segnale" shows (omit = never)
 "wait": 5,                                                              # line showing "⏳ aspetto la mia conferma…" (omit = never)
 "follow": "SEGUI per l'esito domani", "q": ["SÌ", "NO"]
}
SVG helpers available inside "svg": classes .lbl (34px bold label). Colors: #F2A93B amber, #2fd08a green, #ff5a6a red, #5b8cff blue, #0b1020 navy.
Snippets: python3 trade.py --snip  prints ready-made label/line/arrow/circle snippets.
"""
import json, sys

SNIP = """
<!-- vertical time line with label -->
<line x1="X" x2="X" y1="0" y2="2000" stroke="#2fd08a" stroke-width="5"/><rect x="X-130" y="Y" width="260" height="46" rx="9" fill="#2fd08a"/><text x="X" y="Y+33" text-anchor="middle" class="lbl" fill="#0b1020">15:30 WALL ST</text>
<!-- horizontal level with label -->
<line x1="X0" x2="760" y1="Y" y2="Y" stroke="#F2A93B" stroke-width="5" stroke-dasharray="14 9"/><rect x="X0+10" y="Y+10" width="210" height="46" rx="9" fill="#F2A93B"/><text x="X0+115" y="Y+43" text-anchor="middle" class="lbl" fill="#0b1020">minimi Asia</text>
<!-- dashed box (Asia session) -->
<rect x="X0" y="Y0" width="W" height="H" fill="none" stroke="#F2A93B" stroke-width="6" stroke-dasharray="16 9" rx="5"/>
<!-- circle highlight -->
<circle cx="X" cy="Y" r="70" fill="none" stroke="#ff5a6a" stroke-width="8"/>
<!-- arrow (needs marker ar=red, ag=green) -->
<path d="M X0 Y0 L X1 Y1" stroke="#ff5a6a" stroke-width="10" stroke-linecap="round" marker-end="url(#ar)"/>
"""
if sys.argv[1] == "--snip":
    print(SNIP); sys.exit()

D = sys.argv[1]
C = json.load(open(f"{D}/cfg.json"))
P = dict(x=40, y=170, w=1000, h=1000)  # panel on the 1080x1920 page

charts_svg = []
for i, ch in enumerate(C["charts"]):
    y0, y1 = ch["crop"]
    masks = "".join(f'<rect x="{a}" y="{b}" width="{c-a}" height="{d-b}" fill="#a0a0a0"/>' for a, b, c, d in ch.get("mask", []))
    cover = f'<rect id="cov{i}" x="0" y="{y0}" width="760" height="{y1-y0}" fill="#a0a0a0"/>' if ch.get("reveal") else ""
    charts_svg.append(f'<div id="ch{i}" style="position:absolute;inset:0;opacity:0"><svg viewBox="0 {y0} 924 {y1-y0}" preserveAspectRatio="none" width="1000" height="1000">'
                      f'<image href="{ch["img"]}" x="0" y="0" width="924" height="2000" preserveAspectRatio="none"/>{masks}{cover}'
                      f'<g class="ovs" data-ch="{i}"></g></svg></div>')
# overlays are placed in every chart svg whose window they fall in; simplest: put them in a global layer per chart index
ov_html = []
for k, o in enumerate(C.get("ov", [])):
    ov_html.append((o.get("ch", None), f'<g id="ov{k}" opacity="0">{o["svg"]}</g>'))

stamps = "".join(
    f'<div class="stamp" id="st{k}" style="top:{170 + s.get("y", 450)}px;--c:{s.get("color", "#ff5a6a")}"><div class="a" style="font-size:{120 if len(s['text']) <= 8 else max(64, int(960 / len(s['text'])))}px">{s["text"]}</div><div class="b">{s.get("sub", "")}</div></div>'
    for k, s in enumerate(C.get("stamp", [])))
cards = "".join(f'<div class="card" id="cd{k}" style="--c:{c.get("color", "#F2A93B")}">{c["html"]}</div>' for k, c in enumerate(C.get("cards", [])))
q = C.get("q", ["SÌ", "NO"])
hook = "".join(f"<div>{h}</div>" for h in C.get("hook", []))

html = f"""<!doctype html><html><head><meta charset="utf-8"><style>
@font-face {{ font-family: Pop; src: url(lib/Poppins-Bold.ttf); font-weight: 700; }}
@font-face {{ font-family: PopR; src: url(carosello/Poppins-Regular.ttf); font-weight: 400; }}
html, body {{ margin: 0; width: 1080px; height: 1920px; overflow: hidden; background: #0b1020; font-family: Pop, sans-serif; }}
iframe {{ position: absolute; inset: 0; width: 1080px; height: 1920px; border: 0; }}
#head {{ position: absolute; top: 70px; left: 40px; right: 40px; display: flex; justify-content: space-between; align-items: center; }}
#head .b {{ background: #F2A93B; color: #0b1020; font-size: 34px; padding: 8px 20px 10px; border-radius: 12px; box-shadow: 0 5px 0 #8a5a12; }}
#head .m {{ color: #cfd6ea; font: 400 28px PopR; background: rgba(11,16,32,.75); padding: 8px 16px; border-radius: 10px; }}
#panel {{ position: absolute; left: 40px; top: 170px; width: 1000px; height: 1000px; border-radius: 26px; overflow: hidden; box-shadow: 0 18px 50px rgba(0,0,0,.55), 0 0 0 3px #26304f; background: #a0a0a0; }}
#panel > svg {{ position: absolute; inset: 0; }}
.lbl {{ font: 700 30px Pop; }}
#cap {{ position: absolute; left: 50px; right: 50px; top: 1210px; text-align: center; font-size: 72px; line-height: 1.12; color: #fff; -webkit-text-stroke: 3px #0b1020; paint-order: stroke fill; text-shadow: 0 5px 0 #0b1020, 0 0 18px rgba(0,0,0,.8); }}
#cap .k {{ background: #F2A93B; color: #0b1020; -webkit-text-stroke: 0; text-shadow: none; padding: 0 14px 4px; border-radius: 14px; display: inline-block; transform: rotate(-2deg); box-shadow: 0 6px 0 #8a5a12; }}
.stamp {{ position: absolute; left: 0; right: 0; text-align: center; opacity: 0; }}
.stamp > div {{ display: block; }}
.stamp .a {{ display: inline-block; font: 700 120px/1.05 Pop; color: var(--c); background: rgba(11,16,32,.88); border: 12px solid var(--c); border-radius: 26px; padding: 6px 40px 0; transform: rotate(-8deg); }}
.stamp .b {{ font: 700 56px Pop; color: #fff; margin-top: -10px; -webkit-text-stroke: 4px #0b1020; paint-order: stroke fill; transform: rotate(-8deg); }}
.card {{ position: absolute; left: 110px; right: 110px; top: 420px; background: rgba(11,16,32,.95); border: 3px solid var(--c); border-radius: 24px; padding: 26px 34px; color: #eef1f8; font: 700 46px Pop; display: grid; gap: 16px; opacity: 0; }}
.card .t {{ font: 700 30px Pop; color: var(--c); letter-spacing: 1px; }}
.g {{ color: #2fd08a; }} .r {{ color: #ff5a6a; }} .a2 {{ color: #F2A93B; }}
#wait {{ position: absolute; left: 0; right: 0; top: 720px; text-align: center; opacity: 0; }}
#wait span {{ display: inline-block; background: rgba(11,16,32,.93); color: #fff; font: 700 46px Pop; padding: 18px 34px; border-radius: 20px; border: 3px solid #26304f; }}
#open {{ position: absolute; left: 0; right: 0; top: 1110px; text-align: center; opacity: 0; }}
#open span {{ display: inline-block; background: #0b1020; color: #F2A93B; font: 700 34px Pop; padding: 10px 24px 12px; border-radius: 14px; border: 3px solid #F2A93B; }}
#wm {{ position: absolute; right: 190px; top: 186px; color: rgba(255,255,255,.85); font: 700 26px Pop; background: rgba(11,16,32,.6); padding: 6px 14px; border-radius: 10px; }}
#hook {{ position: absolute; left: 0; right: 0; top: 360px; text-align: center; color: #fff; font: 700 120px/1.04 Pop; -webkit-text-stroke: 5px #0b1020; paint-order: stroke fill; text-shadow: 0 10px 0 #0b1020, 0 0 50px rgba(0,0,0,.9); }}
#hook .r {{ color: #ff5a6a; }} #hook .g {{ color: #2fd08a; }} #hook .a {{ color: #F2A93B; }}
#q {{ position: absolute; left: 0; right: 0; top: 360px; text-align: center; font: 700 200px/1 Pop; opacity: 0; -webkit-text-stroke: 7px #0b1020; paint-order: stroke fill; text-shadow: 0 12px 0 #0b1020, 0 0 60px rgba(0,0,0,.9); }}
#q .y {{ color: #2fd08a; }} #q .n {{ color: #ff5a6a; }} #q .o {{ color: #fff; font-size: 110px; }}
#follow {{ position: absolute; left: 0; right: 0; top: 960px; text-align: center; opacity: 0; }}
#follow span {{ display: inline-block; background: #F2A93B; color: #0b1020; font: 700 50px Pop; padding: 14px 30px 18px; border-radius: 20px; box-shadow: 0 8px 0 #8a5a12; }}
</style></head><body>
<iframe id="tr" src="trader.html?shot=pip&tl={D}/tl.json"></iframe>
<div id="head"><span class="b">{C.get("badge", "TRADE DEL GIORNO")}</span><span class="m">{C.get("sub", "")}</span></div>
<div id="panel">{"".join(charts_svg)}</div>
{stamps}{cards}
<div id="wait"><span id="waittx">⏳ aspetto la mia conferma</span></div>
<div id="open"><span>posizione aperta · non è un segnale</span></div>
<div id="wm">@contozero.trading</div>
<div id="follow"><span>{C.get("follow", "SEGUI per l'esito domani")}</span></div>
<div id="q"><div><span class="y">{q[0]}</span><span class="o"> o </span><span class="n">{q[1]}</span></div></div>
<div id="cap"></div>
<div id="hook">{hook}</div>
<script>
const C = {json.dumps(C, ensure_ascii=False)};
const OV = {json.dumps([h for _, h in ov_html], ensure_ascii=False)};
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v)), ease = u => {{ u = clamp(u); return u * u * (3 - 2 * u); }};
const $ = id => document.getElementById(id);
let TL;
// overlays go into the svg of the chart visible at their line
function chartAt(l) {{ let k = 0; C.charts.forEach((c, i) => {{ if (l >= (c.from || 0) && (c.to == null || l < c.to)) k = i; }}); return k; }}
const NS = 'http://www.w3.org/2000/svg';
(C.ov || []).forEach((o, k) => {{
  const host = document.querySelector(`.ovs[data-ch="${{o.ch != null ? o.ch : chartAt(o.l)}}"]`);
  const g = document.createElementNS(NS, 'g'); g.innerHTML = OV[k].replace(/^<g id="ov\\d+" opacity="0">|<\\/g>$/g, ''); g.id = 'ov' + k; g.setAttribute('opacity', 0); host.appendChild(g);
}});
document.querySelectorAll('#panel svg').forEach(s => {{ const d = document.createElementNS(NS, 'defs');
  d.innerHTML = '<marker id="ar" markerWidth="5" markerHeight="5" refX="2.5" refY="2.5" orient="auto"><path d="M0,0 L5,2.5 L0,5 z" fill="#ff5a6a"/></marker><marker id="ag" markerWidth="5" markerHeight="5" refX="2.5" refY="2.5" orient="auto"><path d="M0,0 L5,2.5 L0,5 z" fill="#2fd08a"/></marker>'; s.prepend(d); }});
window.renderAt = function (t) {{
  $('tr').contentWindow.renderAt(t);
  const E = TL.events, N = E.length, s = i => i >= N ? TL.total : E[i].start, L = N - 1;
  const win = (l, at, to) => Math.min(clamp((t - s(l) - (at || 0)) / 0.3), to == null ? 1 : clamp((s(to) - 0.1 - t) / 0.3));
  C.charts.forEach((c, i) => {{
    const a = Math.min(clamp((t - s(c.from || 0) + 0.3) / 0.4), c.to == null ? 1 : clamp((s(c.to) - 0.1 - t) / 0.4));
    $('ch' + i).style.opacity = i == 0 && !(c.from) ? (c.to == null ? 1 : clamp((s(c.to) - 0.1 - t) / 0.4)) : a;
    if (c.reveal) {{ let x = 0; for (const [l, at, xx] of c.reveal) {{ const u = ease((t - s(l) - at) / 1.3); x = x + (xx - x) * u; }}
      const r = $('cov' + i); r.setAttribute('x', x); r.setAttribute('width', Math.max(0, 760 - x)); }}
  }});
  (C.ov || []).forEach((o, k) => $('ov' + k).setAttribute('opacity', win(o.l, o.at, o.to)));
  (C.stamp || []).forEach((o, k) => {{ const a = Math.min(clamp((t - s(o.l) - (o.at || 0)) / 0.18), o.to == null ? 1 : clamp((s(o.to) + 0.2 - t) / 0.3));
    const e = $('st' + k); e.style.opacity = a; e.style.transform = `scale(${{1.5 - 0.5 * ease(a)}})`; }});
  (C.cards || []).forEach((o, k) => $('cd' + k).style.opacity = win(o.l, o.at, o.to));
  $('hook').style.opacity = C.hook ? (t < E[0].end ? 1 : clamp(1 - (t - E[0].end) / 0.3)) : 0;
  if (C.wait != null) {{ $('wait').style.opacity = win(C.wait, 0.6, C.wait + 1); $('waittx').textContent = '⏳ aspetto la mia conferma' + '.'.repeat(Math.floor(t * 3) % 4); }}
  if (C.open != null) $('open').style.opacity = clamp((t - s(C.open) - 0.5) / 0.3);
  const qa = clamp((t - E[L].start - (E[L].end - E[L].start) * 0.5) / 0.25); $('q').style.opacity = qa;
  $('q').style.transform = `scale(${{qa ? 1 + 0.04 * Math.sin(t * 6) : 1}})`;
  $('follow').style.opacity = clamp((t - s(L - 1) - 1.0) / 0.3);
  const cur = E.find(x => t >= x.start && t <= x.end + 0.15); let html = '';
  if (cur) {{
    const words = cur.text.split(' '), chunks = []; let c = [];
    for (const w of words) {{ c.push(w); if (c.join(' ').length > 16 || (/[.,!?…:]$/.test(w) && c.length > 1)) {{ chunks.push(c); c = []; }} }}
    if (c.length) chunks.push(c);
    const tot = cur.text.length; let acc = 0; const u = (t - cur.start) / (cur.end - cur.start); let pick = chunks[chunks.length - 1];
    for (const ch of chunks) {{ acc += ch.join(' ').length + 1; if (u < acc / tot) {{ pick = ch; break; }} }}
    html = pick.map(w => w === cur.key ? `<span class="k">${{w}}</span>` : w).join(' ');
  }}
  if ($('cap').innerHTML !== html) $('cap').innerHTML = html;
}};
(async () => {{
  TL = await (await fetch('{D}/tl.json')).json();
  await new Promise(r => {{ const f = $('tr'); const chk = () => (f.contentWindow && f.contentWindow.READY) ? r() : setTimeout(chk, 100); chk(); }});
  await document.fonts.ready; window.READY = true;
}})();
</script></body></html>"""
open(f"{D}.html", "w").write(html)
print("ok", f"{D}.html")
