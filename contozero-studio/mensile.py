"""Monthly report: from the month's numbers, write the script AND the video config.
usage:
  python3 mensile.py <reelMx>            -> reads <dir>/data.json, writes <dir>/copione.txt, lines.json, cfg.json
  (Salvatore records copione.txt on ElevenLabs -> full.wav)
  python3 reelbuild.py <dir> <dir>/lines.json && python3 edu.py <dir> && python3 shoot.py <dir> 1080 1920 out.mp4 video
  python3 mensile.py <reelMx> --preview  -> also writes a fake tl.json (no audio) to check frames

data.json = {"mese": "novembre", "anno": 2026, "saldo_inizio": 98004.11, "saldo_fine": 99500.00,
             "trades": [{"data": "2026-11-03", "r": 2, "eur": 1960.0}, {"data": "2026-11-04", "r": -1, "eur": -990.0}, ...],
             "giorni_senza_trade": 9, "lezione": "frase finale scritta da Salvatore o da Claude"}
r = result in R (+2 target, -1 stop, 0 pareggio). eur = profit/loss in euro from MT5.
"""
import json, sys, datetime as dt

D = sys.argv[1]
X = json.load(open(f"{D}/data.json"))
T = X["trades"]
n = len(T); win = sum(1 for t in T if t["r"] > 0); loss = sum(1 for t in T if t["r"] < 0)
R = sum(t["r"] for t in T); eur = sum(t["eur"] for t in T)
s0, s1 = X["saldo_inizio"], X["saldo_fine"]
pct = (s1 - s0) / s0 * 100
wr = (win / n * 100) if n else 0
# equity curve + max drawdown
eq = [s0]
for t in T: eq.append(eq[-1] + t["eur"])
peak, mdd = eq[0], 0.0
for v in eq:
    peak = max(peak, v); mdd = max(mdd, (peak - v) / peak * 100)
# weeks
wk = {}
for t in T:
    d = dt.date.fromisoformat(t["data"]); k = d.isocalendar()[1]; wk.setdefault(k, 0); wk[k] += t["r"]
best = max(wk.items(), key=lambda kv: kv[1]) if wk else None
worst = min(wk.items(), key=lambda kv: kv[1]) if wk else None


def num(x, dec=0):
    s = f"{abs(x):,.{dec}f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return s


def words_pct(p):
    a = round(abs(p), 1); i = int(a); d = int(round((a - i) * 10))
    return f"{i} virgola {d} per cento" if d else f"{i} per cento"


sign = "più" if pct >= 0 else "meno"
mese = X["mese"]
lines = [
    (f"Report di {mese}. Un mese intero, numeri veri, presi dal conto.", "veri,"),
    (f"Il conto ha iniziato il mese a {num(s0)} euro. E l'ha chiuso a {num(s1)}.", num(s1) + "."),
    (f"In tutto, {n} trade. {win} vinti, {loss} persi. E {X.get('giorni_senza_trade', 0)} giorni in cui non sono entrato.", "vinti,"),
    (f"Il risultato in R è {'più' if R >= 0 else 'meno'} {abs(R):g}. Cioè {sign} {words_pct(pct)} sul conto.", "R"),
    (f"Il momento peggiore del mese? Drawdown massimo: {words_pct(mdd)}.", "peggiore"),
    (f"{X.get('lezione', 'La lezione del mese: le regole contano più del risultato.')}", "lezione"),
    ("Il mese prossimo si riparte. Stesse regole, stesso rischio.", "regole,"),
    ("Secondo te il prossimo mese chiudo in positivo? Sì o no?", "positivo?"),
]
open(f"{D}/copione.txt", "w").write("\n\n".join(l for l, _ in lines) + "\n")
json.dump([{"text": t, "key": k} for t, k in lines], open(f"{D}/lines.json", "w"), ensure_ascii=False)

# equity svg
W, H = 860, 360
lo, hi = min(eq), max(eq); span = (hi - lo) or 1
pts = " ".join(f"{20 + i * (W - 40) / max(1, len(eq) - 1):.0f},{H - 30 - (v - lo) / span * (H - 70):.0f}" for i, v in enumerate(eq))
col = "#2fd08a" if s1 >= s0 else "#ff5a6a"
eqsvg = (f"<svg viewBox='0 0 {W} {H}' style='width:100%'><line x1='20' x2='{W-20}' y1='{H - 30 - (s0 - lo) / span * (H - 70):.0f}' y2='{H - 30 - (s0 - lo) / span * (H - 70):.0f}' "
         f"stroke='#26304f' stroke-width='4' stroke-dasharray='12 8'/><polyline points='{pts}' fill='none' stroke='{col}' stroke-width='10' stroke-linejoin='round' stroke-linecap='round'/></svg>")
dots = "".join(f"<div class='dt {'w' if t['r'] > 0 else 'l' if t['r'] < 0 else ''}' data-at='{0.4 + i * 0.12:.2f}'>{'✓' if t['r'] > 0 else '✗' if t['r'] < 0 else '='}</div>" for i, t in enumerate(T))
pc = "g" if pct >= 0 else "r"
cfg = {
    "rubric": "REPORT", "sub": f"report di {mese} {X.get('anno', '')}", "follow": "SEGUI per il prossimo report",
    "css": ".dots{display:flex;flex-wrap:wrap;gap:14px;justify-content:center}.dt{width:86px;height:86px;border-radius:50%;display:flex;align-items:center;justify-content:center;font:700 44px Pop;background:#1b2238;border:4px solid #26304f}.dt.w{background:#2fd08a;border-color:#2fd08a;color:#0b1020}.dt.l{background:#ff5a6a;border-color:#ff5a6a;color:#0b1020}",
    "scenes": [
        f"<div class='emo'>📊</div><div class='big c'>Report di<br><span class='a'>{mese}</span></div><div class='mid c' data-at='1.8'>un mese intero · numeri veri</div>",
        f"<div class='sm c'>saldo</div><div class='mid c'>{num(s0)} €</div><div class='big c {pc}' data-at='2.0' style='font-size:120px'>→ {num(s1)} €</div>",
        f"<div class='mid c'>{n} trade</div><div class='dots'>{dots}</div><div class='mid c' data-at='2.6'><span class='g'>{win} vinti</span> · <span class='r'>{loss} persi</span> · {X.get('giorni_senza_trade', 0)} giorni fermo</div>",
        f"{eqsvg}<div class='big c {pc}' data-at='1.2'>{'+' if R >= 0 else '−'}{abs(R):g}R · {'+' if pct >= 0 else '−'}{num(pct, 1)}%</div>",
        f"<div class='emo'>📉</div><div class='mid c'>drawdown massimo</div><div class='big c r' style='font-size:140px'>−{num(mdd, 1)}%</div>",
        f"<div class='emo'>📝</div><div class='mid c'>{X.get('lezione', 'Le regole contano più del risultato.')}</div>",
        "<div class='emo'>🔁</div><div class='mid c'>prossimo mese</div><div class='big c g'>stesse regole<br>stesso rischio</div>",
        "<div class='mid c'>Chiudo il prossimo<br>mese in positivo?</div>",
    ],
}
json.dump(cfg, open(f"{D}/cfg.json", "w"), ensure_ascii=False, indent=1)
print(open(f"{D}/copione.txt").read())
print(f"trade {n} · win {win} ({wr:.0f}%) · R {R:+g} · {pct:+.2f}% · maxDD {mdd:.2f}% · settimane R {wk}")
if "--preview" in sys.argv:
    ev, t = [], 0.5
    for txt, k in lines:
        d = max(2.0, len(txt) / 16); ev.append(dict(text=txt, key=k, start=round(t, 2), end=round(t + d, 2), env=[0.5] * int(d * 30))); t += d + 0.35
    json.dump(dict(events=ev, total=t + 1.5, fps=30), open(f"{D}/tl.json", "w"), ensure_ascii=False)
