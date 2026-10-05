"""Original chiptune score for the CodeCritter launch video (replaces the licensed stock track).

    .venv\\Scripts\\python.exe -m pip install numpy scipy
    .venv\\Scripts\\python.exe tools\\chiptune.py <video-in.mp4> <video-out.mp4> [--wav out.wav] [--plot out.png]

Square (25%/12.5% pulse), triangle and noise channels, 12 bars at ~137 BPM in C major, sized so that it ends
exactly with the video (21.066 s). The original SFX hits (tools/launch-sfx.json, files from
brag-output/composition/assets/sfx) are mixed on top at their original times; if the files are missing,
simple synthesised hits are used instead. The mix is mastered to about -14 LUFS (ffmpeg loudnorm), then muxed
onto the untouched video stream (AAC 160k). Everything is synthesised here, so there is nothing to credit.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 48000
ROOT = Path(__file__).resolve().parent.parent
SFX_DIR = ROOT / "brag-output" / "composition" / "assets" / "sfx"
SFX_PLAN = Path(__file__).with_name("launch-sfx.json")

BARS = 12
BEATS = BARS * 4


def hz(m: float) -> float:
    return 440.0 * 2 ** ((m - 69) / 12)


def pulse(f: np.ndarray | float, n: int, duty: float, vib: float = 0.0) -> np.ndarray:
    t = np.arange(n) / SR
    fr = f * (1 + vib * np.sin(2 * np.pi * 5.5 * t)) if vib else f
    ph = np.cumsum(np.full(n, fr) if np.isscalar(fr) else fr) / SR
    return np.where((ph % 1.0) < duty, 1.0, -1.0)


def tri(f: float, n: int) -> np.ndarray:
    ph = (np.arange(n) * f / SR) % 1.0
    return 4 * np.abs(ph - 0.5) - 1


def env(n: int, a: float, d: float, s: float, r: float, gate: int) -> np.ndarray:
    e = np.zeros(n)
    na, nd = int(a * SR), int(d * SR)
    g = min(gate, n)
    t = np.arange(g)
    e[:g] = np.where(t < na, t / max(na, 1), np.where(t < na + nd, 1 - (1 - s) * (t - na) / max(nd, 1), s))
    nr = n - g
    if nr > 0:
        last = e[g - 1] if g else 0
        e[g:] = last * np.maximum(0, 1 - np.arange(nr) / max(int(r * SR), 1))
    return e


# ---------------------------------------------------------------- score (C major, 8th-note grid)
CHORDS = {"C": (60, 64, 67), "G": (55, 59, 62), "Am": (57, 60, 64), "F": (53, 57, 60), "Em": (52, 55, 59)}
ROOT_OF = {"C": 36, "G": 43, "Am": 45, "F": 41, "Em": 40}
N = None
PROG = ["C", "G", "C", "G", "Am", "F", "F", "G", "C", "C", "C", "C"]  # per bar, bars 1..12
# lead: 8 eighth-notes per bar, bars 3..12 (bars 1-2 are the arp/drum intro)
LEAD = {
    3: [76, 76, 79, 76, 72, 76, 79, N],
    4: [74, 74, 79, 74, 71, 74, 79, N],
    5: [76, 76, 81, 76, 72, 76, 81, 79],
    6: [81, 79, 77, 76, 77, 79, 81, N],
    7: [77, 81, 84, 81, 77, 81, 84, 81],
    8: [79, 83, 86, 83, 79, 83, 86, 83],
    9: [84, 83, 81, 79, 76, 79, 72, 76],
    10: [79, N, 76, N, 74, N, 79, N],
    11: [76, 76, 79, 76, 72, 76, 79, 84],
    12: [84, N, N, N, N, N, N, N],
}


def build_music(bpm: float, total: float) -> np.ndarray:
    beat = 60.0 / bpm
    eighth = beat / 2
    n_tot = int(total * SR)
    lead = np.zeros(n_tot)
    arp = np.zeros(n_tot)
    bass = np.zeros(n_tot)
    drums = np.zeros(n_tot)
    rng = np.random.default_rng(7)

    def add(buf: np.ndarray, start: float, x: np.ndarray) -> None:
        i = int(start * SR)
        if i >= n_tot:
            return
        x = x[: n_tot - i]
        buf[i : i + len(x)] += x

    for bar in range(1, BARS + 1):
        t0 = (bar - 1) * 4 * beat
        chord = PROG[bar - 1]
        tones = CHORDS[chord]
        last = bar == BARS
        # arpeggio: 16th notes, up-up-down pattern, 12.5% pulse
        for s in range(16):
            if last and s >= 2:
                break
            m = [tones[0], tones[1], tones[2], tones[1]][s % 4] + 12 + (12 if (s // 4) % 2 else 0)
            dur = beat / 4
            n = int(dur * 1.6 * SR)
            x = pulse(hz(m), n, 0.125) * env(n, 0.002, 0.05, 0.25, 0.04, int(dur * 0.8 * SR))
            add(arp, t0 + s * dur, x)
        # bass: triangle, root/octave eighths
        r = ROOT_OF[chord]
        for s in range(8):
            if last and s >= 1:
                break
            m = r + (12 if s % 4 == 3 else 0) + (7 if s in (2, 6) and chord != "F" else 0)
            n = int(eighth * 1.1 * SR)
            x = tri(hz(m), n) * env(n, 0.003, 0.02, 0.85, 0.03, int(eighth * 0.85 * SR))
            add(bass, t0 + s * eighth, x)
        # lead
        if bar in LEAD:
            for s, m in enumerate(LEAD[bar]):
                if m is None:
                    continue
                long = last
                dur = eighth * (8 if long else 1)
                n = int((dur * (1.0 if long else 1.15) + 0.05) * SR)
                x = pulse(hz(m), n, 0.25, vib=0.004) * env(n, 0.003, 0.06, 0.65, 0.05, int(dur * (0.95 if long else 0.8) * SR))
                add(lead, t0 + s * eighth, x)
        # drums
        for b in range(4):
            tb = t0 + b * beat
            if last and b > 0:
                break
            if b in (0, 2) or (bar >= 7 and b == 3 and bar % 2 == 0):
                n = int(0.16 * SR)
                t = np.arange(n) / SR
                f = 50 + 110 * np.exp(-t * 40)
                x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 18)
                add(drums, tb, 0.9 * x)
            if b in (1, 3) and bar >= 2:
                n = int(0.14 * SR)
                t = np.arange(n) / SR
                x = rng.uniform(-1, 1, n) * np.exp(-t * 28) + 0.4 * np.sin(2 * np.pi * 190 * t) * np.exp(-t * 40)
                add(drums, tb, 0.55 * x)
        for h in range(8):
            if last and h > 0:
                break
            n = int(0.04 * SR)
            t = np.arange(n) / SR
            x = rng.uniform(-1, 1, n) * np.exp(-t * (90 if h % 2 else 60))
            add(drums, t0 + h * eighth, (0.22 if h % 2 else 0.30) * x)

    mix = 0.30 * lead + 0.13 * arp + 0.34 * bass + 0.40 * drums
    # soften the square edges a touch (like a real console's output filter)
    lp = signal.butter(2, 7000, "low", fs=SR, output="sos")
    return signal.sosfilt(lp, mix)


# ---------------------------------------------------------------- SFX
def load_ogg(path: Path) -> np.ndarray:
    r = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
        capture_output=True,
        check=True,
    )
    return np.frombuffer(r.stdout, dtype=np.float32).astype(np.float64)


def synth_hit(name: str) -> np.ndarray:
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(abs(hash(name)) % 2**32)
    if "keypress" in name or "click" in name:
        m = int(0.03 * SR)
        return np.pad(rng.uniform(-1, 1, m) * np.exp(-np.arange(m) / SR * 160), (0, n - m))
    if "Bell" in name or "bong" in name:
        return sum(np.sin(2 * np.pi * f * t) * np.exp(-t * d) for f, d in ((660, 5), (990, 7), (1320, 9)))
    return np.sin(2 * np.pi * (70 + 90 * np.exp(-t * 30)) * t) * np.exp(-t * 14)


def build_sfx(total: float) -> np.ndarray:
    out = np.zeros(int(total * SR))
    plan = json.loads(SFX_PLAN.read_text())
    cache: dict[str, np.ndarray] = {}
    have = SFX_DIR.exists()
    for s in plan:
        name = s["src"]
        if name not in cache:
            p = SFX_DIR / name
            cache[name] = load_ogg(p) if have and p.exists() else synth_hit(name)
        x = cache[name][: int(s["dur"] * SR)].copy()
        if not len(x):
            continue
        fade = min(len(x), int(0.02 * SR))
        x[-fade:] *= np.linspace(1, 0, fade)
        peak = np.max(np.abs(x)) or 1.0
        x = x / peak * s["vol"] * 0.8
        i = int(s["at"] * SR)
        seg = x[: len(out) - i]
        out[i : i + len(seg)] += seg
    return out


# ---------------------------------------------------------------- master + mux
def ff(args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(["ffmpeg", "-hide_banner", "-y", *args], capture_output=True, text=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("video_in")
    ap.add_argument("video_out")
    ap.add_argument("--wav")
    ap.add_argument("--plot")
    a = ap.parse_args()
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=duration", "-of", "csv=p=0", a.video_in],
        capture_output=True,
        text=True,
        check=True,
    )
    total = float(probe.stdout.strip())
    bpm = BEATS / total * 60.0
    print(f"video {total:.3f}s -> {BARS} bars at {bpm:.1f} BPM")
    music = build_music(bpm, total)
    music = music / (np.max(np.abs(music)) or 1) * 0.55
    sfx = build_sfx(total)
    mix = music + 0.9 * sfx
    # fades: 0.3 s in, 1.6 s out; the end-card bell rings into the fade
    n = len(mix)
    fi, fo = int(0.3 * SR), int(1.6 * SR)
    mix[:fi] *= np.linspace(0, 1, fi)
    mix[-fo:] *= np.linspace(1, 0, fo) ** 1.5
    tmp = Path(a.wav or a.video_out).with_suffix(".raw.wav")
    wavfile.write(tmp, SR, (np.clip(mix, -1, 1) * 32767).astype(np.int16))
    mastered = tmp.with_suffix(".master.wav")
    r = ff(["-i", str(tmp), "-af", f"loudnorm=I=-14:TP=-1.5:LRA=7,apad=whole_dur={total + 0.5}", "-ar", str(SR), "-ac", "2", str(mastered)])
    if r.returncode:
        sys.exit(r.stderr)
    r = ff(["-i", a.video_in, "-i", str(mastered), "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-t", f"{total:.3f}", "-movflags", "+faststart", a.video_out])
    if r.returncode:
        sys.exit(r.stderr)
    if a.wav:
        mastered.replace(a.wav)
    else:
        mastered.unlink()
    tmp.unlink()
    if a.plot:
        plot(a.wav or a.video_out, a.plot)


def plot(path: str, out: str) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    wav = path
    if not path.endswith(".wav"):
        wav = out + ".tmp.wav"
        ff(["-i", path, "-vn", "-ac", "1", wav])
    sr, x = wavfile.read(wav)
    x = x.astype(np.float64) / 32768
    if x.ndim > 1:
        x = x.mean(1)
    fig, ax = plt.subplots(2, 1, figsize=(12, 6))
    ax[0].plot(np.arange(len(x)) / sr, x, lw=0.3)
    ax[0].set_title("waveform")
    ax[1].specgram(x, NFFT=2048, Fs=sr, noverlap=1024, cmap="magma")
    ax[1].set_ylim(0, 12000)
    fig.tight_layout()
    fig.savefig(out, dpi=90)


if __name__ == "__main__":
    main()
