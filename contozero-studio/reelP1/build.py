import json, subprocess, os, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

STUDIO = "/home/claude/desk-ia/contozero-studio"
REC = "/home/claude/rec/rec.mp4"
OUT = "/home/claude/promo"
W, H = 1080, 1920
FB = f"{STUDIO}/lib/Poppins-Bold.ttf"
ORANGE, GREEN, RED, NAVY = (242, 169, 59), (47, 208, 138), (255, 90, 106), (11, 16, 32)
font = lambda s: ImageFont.truetype(FB, s)

tl = json.load(open(f"{STUDIO}/reelP1/tl.json"))
ev = tl["events"]; total = tl["total"]
starts = [0.0] + [e["start"] for e in ev[1:]]
ends = starts[1:] + [total]

CAPS = [
    "Perché due trader vedono due *trend* diversi?",
    "Perché la struttura la disegnano *a occhio*",
    "L'indicatore la segna *da solo*",
    "Dove sei su *ogni timeframe*",
    "Solo candele *chiuse*",
    "Non quando entrare: *dove sei*",
    "Come averlo?",
    "Te lo mando *gratis*",
]

def rich(draw, x, y, text, f, maxw, center=True):
    # word wrap with *highlight* words in orange pill
    words = text.split(" ")
    lines, cur = [], []
    for w in words:
        test = " ".join([c.replace("*", "") for c in cur + [w]])
        if draw.textlength(test, font=f) > maxw and cur:
            lines.append(cur); cur = [w]
        else:
            cur.append(w)
    lines.append(cur)
    lh = f.size * 1.25
    hl = False
    for i, ln in enumerate(lines):
        plain = " ".join(c.replace("*", "") for c in ln)
        lw = draw.textlength(plain, font=f)
        cx = x - lw / 2 if center else x
        cy = y + i * lh
        for w in ln:
            if w.startswith("*"): hl = True
            word = w.replace("*", "")
            ww = draw.textlength(word, font=f)
            if hl:
                cx += 10
                draw.rounded_rectangle([cx - 8, cy + 4, cx + ww + 8, cy + f.size * 1.18], 12, fill=ORANGE)
                draw.text((cx, cy), word, font=f, fill=NAVY)
            else:
                draw.text((cx, cy), word, font=f, fill="white", stroke_width=3, stroke_fill=(0, 0, 0))
            was = hl
            if w.endswith("*") or (w.count("*") == 2): hl = False
            cx += ww + (10 if was else 0) + draw.textlength(" ", font=f)
    return y + len(lines) * lh

def caption_png(i, extra=None):
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W, 400], fill=(11, 16, 32, 235))
    d.text((W / 2, 70), "@contozero.trading", font=font(34), fill=(255, 255, 255, 200), anchor="mm")
    rich(d, W / 2, 125, CAPS[i], font(70), 980)
    if extra: extra(d)
    p = f"{OUT}/cap{i}.png"; im.save(p); return p

def run(cmd):
    subprocess.run(cmd, check=True)

CROP = "crop=1170:2080:0:160,scale=1080:1920,fps=30"

def seg_rec(name, src_s, src_len, dur, overlays=(), dark=False, pre=""):
    k = dur / src_len
    vf = f"[0:v]trim=start={src_s}:duration={src_len},setpts=(PTS-STARTPTS)*{k:.5f},{CROP}"
    if dark: vf += ",eq=brightness=-0.25"
    vf += pre + "[b]"
    inputs = ["-i", REC]
    chain = vf; last = "b"
    for j, (png, t0, t1) in enumerate(overlays):
        inputs += ["-i", png]
        en = f":enable='between(t,{t0},{t1})'" if t0 is not None else ""
        chain += f";[{last}][{j+1}:v]overlay=0:0{en}[o{j}]"; last = f"o{j}"
    run(["ffmpeg", "-loglevel", "error", "-y", *inputs, "-filter_complex", chain, "-map", f"[{last}]",
         "-t", f"{dur:.3f}", "-r", "30", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", f"{OUT}/{name}.mp4"])

def seg_img(name, png, dur):
    run(["ffmpeg", "-loglevel", "error", "-y", "-loop", "1", "-i", png, "-t", f"{dur:.3f}", "-r", "30",
         "-vf", "scale=1080:1920,format=yuv420p", "-c:v", "libx264", "-crf", "18", f"{OUT}/{name}.mp4"])

def frame(t):
    p = f"{OUT}/fr_{t}.png"
    run(["ffmpeg", "-loglevel", "error", "-y", "-ss", str(t), "-i", REC, "-frames:v", "1", p])
    return Image.open(p).convert("RGB").crop((0, 160, 1170, 2240)).resize((W, H))

d = [ends[i] - starts[i] for i in range(8)]

# ---- S0/S1: split screen hook ----
base = frame(40)
chart = base.crop((0, 400, W, 1400))  # chart area without table
half = chart.crop((270, 0, 270 + 540, 1000))
random.seed(3)
def split(lines):
    im = Image.new("RGB", (W, H), NAVY)
    im.paste(base.filter(ImageFilter.GaussianBlur(18)).point(lambda v: v * 0.45))
    for k, (lab, col) in enumerate([("TRADER A: LONG", GREEN), ("TRADER B: SHORT", RED)]):
        x0 = k * 540
        im.paste(half, (x0, 520))
        dd = ImageDraw.Draw(im)
        dd.rounded_rectangle([x0 + 40, 440, x0 + 500, 510], 14, fill=col)
        dd.text((x0 + 270, 476), lab, font=font(36), fill=NAVY, anchor="mm")
        if lines:
            pts = []
            if k == 0:  # rising wobbly line
                for s in range(12):
                    pts.append((x0 + 30 + s * 42 + random.randint(-6, 6), 1400 - s * 55 + random.randint(-25, 25)))
            else:
                for s in range(12):
                    pts.append((x0 + 30 + s * 42 + random.randint(-6, 6), 700 + s * 50 + random.randint(-25, 25)))
            dd.line(pts, fill=col, width=9, joint="curve")
    dd = ImageDraw.Draw(im)
    dd.line([(540, 440), (540, 1520)], fill="white", width=6)
    dd.text((W / 2, 1640), "stesso grafico", font=font(46), fill="white", anchor="mm")
    return im
for i, ln in [(0, False), (1, True)]:
    im = split(ln)
    cap = Image.open(caption_png(i))
    im.paste(cap, (0, 0), cap)
    im.save(f"{OUT}/s{i}.png")
    seg_img(f"v{i}", f"{OUT}/s{i}.png", d[i])

# ---- S2: 4H/1H recording ----
def circle_png(name, cx, cy, r, col, label=None, lx=None, ly=None):
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0)); dd = ImageDraw.Draw(im)
    dd.ellipse([cx - r, cy - r, cx + r, cy + r], outline=col, width=9)
    if label:
        f = font(40); tw = dd.textlength(label, font=f)
        dd.rounded_rectangle([lx, ly, lx + tw + 36, ly + 62], 12, fill=col)
        dd.text((lx + 18, ly + 6), label, font=f, fill=NAVY)
    p = f"{OUT}/{name}.png"; im.save(p); return p
seg_rec("v2", 33.0, 11.0, d[2], [(caption_png(2), None, None)])

# ---- S3: table montage ----
tfs = [("W", 1.0), ("D", 5.0), ("H4", 11.0), ("H1", 40.0), ("M15", 58.0), ("M5", 78.0), ("M1", 95.0)]
sl = d[3] / len(tfs)
parts = []
for j, (lab, t) in enumerate(tfs):
    capi = Image.open(caption_png(3)).copy()
    dd = ImageDraw.Draw(capi)
    dd.rounded_rectangle([W / 2 - 150, 430, W / 2 + 150, 540], 20, fill=ORANGE)
    dd.text((W / 2, 485), lab, font=font(80), fill=NAVY, anchor="mm")
    pth = f"{OUT}/cap3_{j}.png"; capi.save(pth)
    vf = (f"[0:v]trim=start={t}:duration={sl + 0.2},setpts=PTS-STARTPTS,{CROP},split[a][b];"
          f"[a]boxblur=20:2,eq=brightness=-0.3[bg];[b]crop=555:460:310:1405,scale=1040:-2[tb];"
          f"[bg][tb]overlay=20:700[m];[m][1:v]overlay=0:0[o]")
    run(["ffmpeg", "-loglevel", "error", "-y", "-i", REC, "-i", pth, "-filter_complex", vf, "-map", "[o]",
         "-t", f"{sl:.3f}", "-r", "30", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", f"{OUT}/v3_{j}.mp4"])
    parts.append(f"{OUT}/v3_{j}.mp4")
with open(f"{OUT}/l3.txt", "w") as fh:
    fh.write("".join(f"file '{p}'\n" for p in parts))
run(["ffmpeg", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", f"{OUT}/l3.txt", "-c", "copy", f"{OUT}/v3.mp4"])

# ---- S4, S5 ----
seg_rec("v4", 55.0, 7.0, d[4], [(caption_png(4), None, None)])
seg_rec("v5", 73.0, 7.0, d[5], [(caption_png(5), None, None)])

# ---- S6: CTA steps ----
s6 = starts[6]
steps = [("1", "Link in bio", 26.0), ("2", "Abbonati a TradingView\n(15 $ di sconto)", 27.6), ("3", "Scrivimi il tuo\nnome utente", 31.0)]
ovs = [(caption_png(6), None, None)]
for k, (n, txt, at) in enumerate(steps):
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0)); dd = ImageDraw.Draw(im)
    y = 560 + k * 330
    dd.rounded_rectangle([70, y, W - 70, y + 270], 30, fill=(11, 16, 32, 235), outline=ORANGE, width=6)
    dd.ellipse([110, y + 65, 250, y + 205], fill=ORANGE)
    dd.text((180, y + 135), n, font=font(90), fill=NAVY, anchor="mm")
    dd.multiline_text((290, y + 135), txt, font=font(56), fill="white", anchor="lm", spacing=8)
    p = f"{OUT}/step{k}.png"; im.save(p)
    ovs.append((p, round(at - s6, 2), 99))
seg_rec("v6", 90.0, 17.0, d[6], ovs, dark=True)

# ---- S7: end card ----
seg_img("v7", f"{OUT}/end.png", d[7])

with open(f"{OUT}/all.txt", "w") as fh:
    fh.write("".join(f"file '{OUT}/v{i}.mp4'\n" for i in range(8)))
run(["ffmpeg", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", f"{OUT}/all.txt",
     "-i", f"{STUDIO}/reelP1/mix.wav", "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-crf", "19",
     "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-movflags", "+faststart", f"{OUT}/promo.mp4"])
print("ok", sum(d))
