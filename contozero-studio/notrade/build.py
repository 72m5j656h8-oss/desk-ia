import json, os, wave
import numpy as np
from scipy import signal

SR = 44100; FPS = 30
D = os.path.dirname(os.path.abspath(__file__))
LINES = [
    dict(text="Oggi non ho fatto nessun trade. E va benissimo così.", key="nessun"),
    dict(text="Stamattina il Nasdaq è sceso sotto i minimi della sessione asiatica…", key="minimi"),
    dict(text="…ma solo con uno spike. Nessuna candela ha chiuso sotto il livello.", key="spike."),
    dict(text="Poi è risalito e si è preso anche i massimi. Stessa cosa: solo uno spike.", key="massimi."),
    dict(text="Le mie regole chiedono una conferma precisa. Oggi non c'era.", key="conferma"),
    dict(text="Entrare lo stesso avrebbe voluto dire tirare a indovinare.", key="indovinare."),
    dict(text="Anche non entrare è una decisione. E nel report conta come le altre.", key="decisione."),
    dict(text="Ci vediamo domani alle nove.", key="domani"),
]


def read(p):
    with wave.open(p) as w:
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768


def lp(x, f):
    b, a = signal.butter(2, f / (SR / 2)); return signal.lfilter(b, a, x)


clips = [read(f"{D}/b{i + 1}.wav") for i in range(len(LINES))]
starts = []; t = 0.5
for i, c in enumerate(clips):
    starts.append(t); t += len(c) / SR + (0.45 if i != 5 else 0.7)
total = t + 1.6
n = int(total * SR)
voice = np.zeros(n); ev = []
for l, c, s in zip(LINES, clips, starts):
    c = c / (np.abs(c).max() + 1e-6) * 0.92
    i0 = int(s * SR); voice[i0:i0 + len(c)] += c
    hop = SR // FPS
    env = [float(np.sqrt(np.mean(c[k * hop:(k + 1) * hop] ** 2) + 1e-9)) for k in range(int(np.ceil(len(c) / hop)))]
    m = max(env)
    ev.append(dict(l, start=s, end=s + len(c) / SR, env=[round(v / m, 3) for v in env]))
tt = np.arange(n) / SR
chords = [(220.0, 261.63, 329.63), (174.61, 220.0, 261.63), (196.0, 246.94, 293.66), (164.81, 207.65, 246.94)]
bar = 4 * 60 / 84; pad = np.zeros(n)
for k in range(int(total / bar) + 1):
    a, b = int(k * bar * SR), int(min(n, (k + 1) * bar * SR + SR * 0.5))
    seg = tt[a:b] - k * bar
    env = np.minimum(1, seg / 0.6) * np.exp(-np.maximum(0, seg - bar) / 0.3)
    for f in chords[k % 4]:
        pad[a:b] += (np.sin(2 * np.pi * f / 2 * seg) + 0.3 * np.sin(2 * np.pi * f * seg)) * env * 0.12
pulse = np.zeros(n); beat = 60 / 84
for k in range(int(total / beat)):
    s = int(k * beat * SR); L = int(0.25 * SR); x = np.arange(L) / SR
    pulse[s:s + L] += (np.sin(2 * np.pi * (55 + 60 * np.exp(-x / 0.03)) * x) * np.exp(-x / 0.12))[:n - s] * 0.5
music = lp(pad, 1800) + pulse; music /= np.abs(music).max() + 1e-6
duck = 1 - 0.6 * np.clip(lp(np.abs(voice), 4) / 0.04, 0, 1)
mix = voice + music * 0.2 * duck
# stamp thud at line 7 start + soft pops at spike highlights
def thud(at, amp=0.7):
    s = int(at * SR); L = int(0.5 * SR); x = np.arange(L) / SR
    rng = np.random.default_rng(4)
    y = (np.sin(2 * np.pi * 70 * x) * np.exp(-x / 0.12) + lp(rng.standard_normal(L), 900) * np.exp(-x / 0.03) * 0.6) * amp
    mix[s:s + L] += y[:n - s]
def pop(at):
    s = int(at * SR); L = int(0.12 * SR); x = np.arange(L) / SR
    mix[s:s + L] += (np.sin(2 * np.pi * (900 - 500 * x / 0.12) * x) * np.exp(-x / 0.03) * 0.25)[:n - s]
thud(ev[6]["start"] - 0.25)
pop(ev[2]["start"] + 0.3); pop(ev[3]["start"] + 2.0)
f = int(1.0 * SR); mix[-f:] *= np.linspace(1, 0, f)
mix /= max(1, np.abs(mix).max() / 0.95)
with wave.open(f"{D}/mix.wav", "w") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((mix * 32767).astype(np.int16).tobytes())
json.dump(dict(events=ev, total=total, fps=FPS), open(f"{D}/notrade.json", "w"), ensure_ascii=False)
print("total", round(total, 2), [round(e["start"], 1) for e in ev])
