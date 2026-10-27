"""Split one voice file into lines by pauses, build timeline json + music mix.
usage: python3 reelbuild.py <dir> <lines.json>   (lines.json: [{"text":..,"key":..}, ...])"""
import json, os, sys, wave
import numpy as np
from scipy import signal

SR = 44100; FPS = 30
D = sys.argv[1]
LINES = json.load(open(sys.argv[2]))


def read(p):
    with wave.open(p) as w:
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768


def lp(x, f):
    b, a = signal.butter(2, f / (SR / 2)); return signal.lfilter(b, a, x)


v = read(f"{D}/full.wav")
hop = int(SR * 0.01)
rms = np.array([np.sqrt(np.mean(v[i:i + hop] ** 2)) for i in range(0, len(v) - hop, hop)])
thr = max(0.012, np.percentile(rms, 30) * 0.6)
quiet = rms < thr
# find gaps
gaps = []; i = 0
while i < len(quiet):
    if quiet[i]:
        j = i
        while j < len(quiet) and quiet[j]: j += 1
        if (j - i) * 0.01 >= 0.18: gaps.append(((i + j) / 2 * 0.01, (j - i) * 0.01, i * 0.01, j * 0.01))
        i = j
    else: i += 1
# speech bounds
nz = np.where(~quiet)[0]; s0, s1 = nz[0] * 0.01, nz[-1] * 0.01 + 0.01
inner = [g for g in gaps if s0 + 0.3 < g[0] < s1 - 0.3]
n = len(LINES)
chars = np.cumsum([len(l["text"]) for l in LINES]); chars = chars / chars[-1]
targets = [s0 + (s1 - s0) * c for c in chars[:-1]]
# DP: choose n-1 gaps (ordered) minimizing distance to targets, weighted by gap length
G = len(inner)
INF = 1e9
cost = [[INF] * (G + 1) for _ in range(n)]
back = [[-1] * (G + 1) for _ in range(n)]
for g in range(G + 1): cost[0][g] = 0 if g == 0 else INF
cost[0][0] = 0
# cost[k][g]: k gaps chosen, last chosen index g-1 (g=0 means none)
best = {}
def solve():
    from functools import lru_cache
    @lru_cache(None)
    def f(k, start):
        if k == n - 1: return (0.0, ())
        res = (INF, ())
        for g in range(start, G):
            c = abs(inner[g][0] - targets[k]) - 0.6 * inner[g][1]
            sub = f(k + 1, g + 1)
            if c + sub[0] < res[0]: res = (c + sub[0], (g,) + sub[1])
        return res
    return f(0, 0)
_, pick = solve()
if os.environ.get("CUTS"):
    want = [float(x) for x in os.environ["CUTS"].split(",")]
    pick = tuple(min(range(G), key=lambda g: abs(inner[g][2] - w)) for w in want)
if len(pick) != n - 1:
    raise SystemExit(f"split failed: {len(inner)} gaps for {n} lines")
cuts = [s0] + [x for g in pick for x in (inner[g][2], inner[g][3])] + [s1]
segs = [(cuts[2 * k], cuts[2 * k + 1]) for k in range(n)]
LEAD = 0.5
total = LEAD + len(v) / SR - s0 + 1.6
N = int(total * SR)
voice = np.zeros(N)
seg = v[int(s0 * SR):]
seg = seg / (np.abs(seg).max() + 1e-6) * 0.92
voice[int(LEAD * SR):int(LEAD * SR) + len(seg)] = seg[:N - int(LEAD * SR)]
ev = []
for l, (a, b) in zip(LINES, segs):
    st = LEAD + a - s0; en = LEAD + b - s0
    x = voice[int(st * SR):int(en * SR)]
    h = SR // FPS
    env = [float(np.sqrt(np.mean(x[k * h:(k + 1) * h] ** 2) + 1e-9)) for k in range(int(np.ceil(len(x) / h)))]
    m = max(env)
    ev.append(dict(l, start=round(st, 3), end=round(en, 3), env=[round(e / m, 3) for e in env]))
tt = np.arange(N) / SR
chords = [(220.0, 261.63, 329.63), (174.61, 220.0, 261.63), (196.0, 246.94, 293.66), (164.81, 207.65, 246.94)]
bar = 4 * 60 / 84; pad = np.zeros(N)
for k in range(int(total / bar) + 1):
    a, b = int(k * bar * SR), int(min(N, (k + 1) * bar * SR + SR * 0.5))
    sg = tt[a:b] - k * bar
    e = np.minimum(1, sg / 0.6) * np.exp(-np.maximum(0, sg - bar) / 0.3)
    for f in chords[k % 4]:
        pad[a:b] += (np.sin(2 * np.pi * f / 2 * sg) + 0.3 * np.sin(2 * np.pi * f * sg)) * e * 0.12
pulse = np.zeros(N); beat = 60 / 84
for k in range(int(total / beat)):
    s = int(k * beat * SR); L = int(0.25 * SR); x = np.arange(L) / SR
    pulse[s:s + L] += (np.sin(2 * np.pi * (55 + 60 * np.exp(-x / 0.03)) * x) * np.exp(-x / 0.12))[:N - s] * 0.5
music = lp(pad, 1800) + pulse; music /= np.abs(music).max() + 1e-6
duck = 1 - 0.6 * np.clip(lp(np.abs(voice), 4) / 0.04, 0, 1)
mix = voice + music * 0.2 * duck
f = int(1.0 * SR); mix[-f:] *= np.linspace(1, 0, f)
mix /= max(1, np.abs(mix).max() / 0.95)
with wave.open(f"{D}/mix.wav", "w") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((mix * 32767).astype(np.int16).tobytes())
json.dump(dict(events=ev, total=total, fps=FPS), open(f"{D}/tl.json", "w"), ensure_ascii=False)
for e in ev: print(round(e["start"], 2), round(e["end"], 2), e["text"][:50])
print("total", round(total, 2))
