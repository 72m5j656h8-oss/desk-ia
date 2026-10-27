import json, os, wave
import numpy as np
from scipy import signal

SR = 44100; FPS = 30
D = os.path.dirname(os.path.abspath(__file__))
LINES = [
    dict(text="Questo è un conto demo. E parte da zero.", key="zero.", shot="spin"),
    dict(text="Ogni giorno opero sul Nasdaq, con una sola strategia e il rischio sempre uguale.", key="strategia", shot="med"),
    dict(text="Ogni trade lo pubblico qui, dopo la chiusura. Anche quelli che vanno male.", key="male.", shot="close"),
    dict(text="E ogni domenica, il report con i numeri veri.", key="veri.", shot="screens"),
    dict(text="Niente screenshot scelti, niente promesse.", key="promesse.", shot="close"),
    dict(text="Vediamo insieme se il metodo regge. Questo è Conto Zero.", key="Zero.", shot="end"),
]


def read(p):
    with wave.open(p) as w:
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768


def lp(x, f):
    b, a = signal.butter(2, f / (SR / 2)); return signal.lfilter(b, a, x)


def main():
    clips = [read(f"{D}/b{i + 1}.wav") for i in range(6)]
    starts = []; t = 0.6
    gaps = [0.55, 0.45, 0.45, 0.4, 0.45, 0]
    for i, c in enumerate(clips):
        starts.append(t); t += len(c) / SR + gaps[i]
    total = t + 2.4
    n = int(total * SR)
    voice = np.zeros(n)
    ev = []
    for l, c, s in zip(LINES, clips, starts):
        c = c / (np.abs(c).max() + 1e-6) * 0.92
        i0 = int(s * SR); voice[i0:i0 + len(c)] += c
        hop = SR // FPS
        env = [float(np.sqrt(np.mean(c[k * hop:(k + 1) * hop] ** 2) + 1e-9)) for k in range(int(np.ceil(len(c) / hop)))]
        m = max(env)
        ev.append(dict(l, start=s, end=s + len(c) / SR, env=[round(v / m, 3) for v in env]))
    # music bed: dark pad + soft pulse, 84 bpm, A minor
    tt = np.arange(n) / SR
    chords = [(220.0, 261.63, 329.63), (174.61, 220.0, 261.63), (196.0, 246.94, 293.66), (164.81, 207.65, 246.94)]
    bar = 4 * 60 / 84
    pad = np.zeros(n)
    for k in range(int(total / bar) + 1):
        a, b = int(k * bar * SR), int(min(n, (k + 1) * bar * SR + SR * 0.5))
        seg = tt[a:b] - k * bar
        env = np.minimum(1, seg / 0.6) * np.exp(-np.maximum(0, seg - bar) / 0.3)
        for f in chords[k % 4]:
            pad[a:b] += (np.sin(2 * np.pi * f / 2 * seg) + 0.3 * np.sin(2 * np.pi * f * seg)) * env * 0.12
    pulse = np.zeros(n); beat = 60 / 84
    for k in range(int(total / beat)):
        s = int(k * beat * SR); L = int(0.25 * SR); x = np.arange(L) / SR
        kick = np.sin(2 * np.pi * (55 + 60 * np.exp(-x / 0.03)) * x) * np.exp(-x / 0.12)
        pulse[s:s + L] += kick[:n - s] * 0.5
    music = lp(pad, 1800) + pulse
    music /= np.abs(music).max() + 1e-6
    duck = 1 - 0.6 * np.clip(lp(np.abs(voice), 4) / 0.04, 0, 1)
    mvol = np.full(n, 0.22); end_logo = ev[-1]["end"]
    mvol[int(end_logo * SR):] = 0.38
    mix = voice + music * mvol * duck
    # logo hit
    s = int((end_logo - 0.35) * SR); L = int(1.2 * SR); x = np.arange(L) / SR
    rng = np.random.default_rng(2)
    b, a = signal.butter(2, [300 / (SR / 2), 5000 / (SR / 2)], "band")
    wh = signal.lfilter(b, a, rng.standard_normal(L)) * np.sin(np.pi * np.minimum(1, x / 0.4) / 2) * np.exp(-np.maximum(0, x - 0.4) / 0.2) * 0.25
    hit = np.sin(2 * np.pi * 50 * x) * np.exp(-x / 0.35) * 0.6 * (x > 0.35)
    mix[s:s + L] += (wh + hit)[:n - s]
    f = int(1.2 * SR); mix[-f:] *= np.linspace(1, 0, f)
    mix /= max(1, np.abs(mix).max() / 0.95)
    with wave.open(f"{D}/intro_mix.wav", "w") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((mix * 32767).astype(np.int16).tobytes())
    json.dump(dict(events=ev, total=total, fps=FPS), open(f"{D}/../talk.json", "w"), ensure_ascii=False)
    print("total", round(total, 2), [round(e["start"], 2) for e in ev])


main()
