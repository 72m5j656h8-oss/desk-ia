import json, os, subprocess, wave
import numpy as np
from scipy import signal
from script import LINES

SR = 44100
FPS = 30
BASE = os.path.dirname(os.path.abspath(__file__))
TTS = "/home/claude/tts"
OUT = os.path.join(BASE, "audio"); os.makedirs(OUT, exist_ok=True)
VOICE = {"w": (1.0, 1.0, "preserved"), "c": (0.95, 0.84, "shifted")}
GAP = 0.28
LEAD = 0.4


def read(p):
    with wave.open(p) as w:
        a = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    return a


def tts(i, who, text):
    ls, pitch, formant = VOICE[who]
    raw = f"{OUT}/raw_{i:02d}.wav"; fin = f"{OUT}/line_{i:02d}.wav"
    subprocess.run([f"{TTS}/piper/piper", "--model", f"{TTS}/voice/it-riccardo_fasol-x-low.onnx", "--length_scale", str(ls),
                    "--output_file", raw], input=text.encode(), check=True, capture_output=True)
    af = (f"aresample={SR},rubberband=pitch={pitch}:formant={formant},highpass=f=80,"
          "equalizer=f=3000:t=q:w=1:g=3,acompressor=threshold=0.1:ratio=3,"
          "silenceremove=start_periods=1:start_threshold=0.01,areverse,silenceremove=start_periods=1:start_threshold=0.01,areverse")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", raw, "-af", af, "-ac", "1", "-ar", str(SR), fin], check=True)
    a = read(fin)
    return a / (np.abs(a).max() + 1e-6) * 0.9


def lowpass(x, f):
    b, a = signal.butter(2, f / (SR / 2)); return signal.lfilter(b, a, x)


def room_tone(n):
    """restaurant ambience: murmur + occasional cutlery clinks"""
    rng = np.random.default_rng(3)
    x = rng.standard_normal(n)
    b, a = signal.butter(2, [200 / (SR / 2), 900 / (SR / 2)], "band")
    mur = signal.lfilter(b, a, x)
    mod = lowpass(np.abs(rng.standard_normal(n)), 3) * 4
    out = mur * (0.4 + mod) * 0.05
    for _ in range(int(n / SR * 1.2)):
        s = rng.integers(0, n - SR // 4)
        tt = np.arange(int(0.15 * SR)) / SR
        f = rng.uniform(2500, 5000)
        out[s:s + len(tt)] += np.sin(2 * np.pi * f * tt) * np.exp(-tt / 0.02) * rng.uniform(0.01, 0.04)
    return out


def whoosh(d=0.6):
    rng = np.random.default_rng(1); n = int(d * SR)
    b, a = signal.butter(2, [400 / (SR / 2), 4000 / (SR / 2)], "band")
    x = signal.lfilter(b, a, rng.standard_normal(n))
    return x * np.sin(np.pi * np.arange(n) / n) ** 2 * 0.25


def tick(n_ticks=4):
    out = np.zeros(int((n_ticks * 0.25 + 0.2) * SR))
    for k in range(n_ticks):
        s = int(k * 0.25 * SR); tt = np.arange(int(0.05 * SR)) / SR
        out[s:s + len(tt)] += np.sin(2 * np.pi * 1800 * tt) * np.exp(-tt / 0.008) * 0.35
    return out


def main():
    clips = [tts(i, l["who"], l["text"]) for i, l in enumerate(LINES)]
    t = LEAD; events = []
    for i, (l, a) in enumerate(zip(LINES, clips)):
        pre = 0.5 if l["shot"] == "card" else 0
        if l["shot"] == "cam":
            pre = 0.3
        t += pre
        d = len(a) / SR
        hop = SR // FPS
        env = [float(np.sqrt(np.mean(a[k * hop:(k + 1) * hop] ** 2) + 1e-9)) for k in range(int(np.ceil(len(a) / hop)))]
        m = max(env)
        events.append(dict(l, start=t, end=t + d, env=[round(v / m, 3) for v in env], pre=pre))
        t += d + GAP + (0.35 if l["shot"] == "card" else 0)
    total = t + 1.2
    n = int(total * SR)
    mix = room_tone(n)
    for e, a in zip(events, clips):
        s = int(e["start"] * SR); mix[s:s + len(a)] += a
        if e["shot"] == "card":
            w = whoosh(); s2 = int((e["start"] - 0.5) * SR); mix[s2:s2 + len(w)] += w
            tk = tick(); s3 = int(e["end"] * SR); mix[s3:s3 + len(tk)] += tk[:n - s3]
    f = int(0.3 * SR); mix[-f:] *= np.linspace(1, 0, f)
    mix /= max(1, np.abs(mix).max() / 0.95)
    with wave.open(f"{OUT}/mix.wav", "w") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((mix * 32767).astype(np.int16).tobytes())
    json.dump(dict(events=events, total=total, fps=FPS), open(f"{BASE}/timeline.json", "w"), ensure_ascii=False)
    print("total", round(total, 1))


if __name__ == "__main__":
    main()
