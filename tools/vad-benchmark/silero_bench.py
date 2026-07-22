#!/usr/bin/env python3
"""
Silero VAD ni REAL audio ustida o'lchash (odam ovozi vs maishiy shovqin).

Avval `python3 fetch_audio.py` ishga tushiring — u modelni va real audioni yuklaydi.

Ishlatish:
    python3 -m venv venv && ./venv/bin/pip install onnxruntime numpy
    ./venv/bin/python silero_bench.py

Natijalar: docs/VAD_BENCHMARK.md
"""
from __future__ import annotations

import argparse
import glob
import os
import wave

import numpy as np
import onnxruntime as ort

HERE = os.path.dirname(os.path.abspath(__file__))
CTX, WIN, SR = 64, 512, 16000

# Qaror: 5 soniyalik klipda kamida 0.5s (≈16 kadr) nutq bo'lsa — "gapiryapti".
PROB_THRESHOLD = 0.5
FRAMES_NEEDED = 16


def read(path: str) -> np.ndarray:
    with wave.open(path) as w:
        assert w.getframerate() == SR and w.getnchannels() == 1, f"16kHz mono kerak: {path}"
        return np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768.0


def make_probs(sess: ort.InferenceSession):
    def probs(pcm: np.ndarray) -> np.ndarray:
        state = np.zeros((2, 1, 128), np.float32)
        sr = np.array(SR, dtype=np.int64)
        # KONTEKST MAJBURIY: v5 modeli oldingi kadrdan 64 sample kutadi. Busiz
        # model toza nutqda ham ~0.00 qaytaradi (shu xato benchmark paytida topilgan).
        ctx = np.zeros(CTX, np.float32)
        out = []
        for i in range(0, len(pcm) - WIN + 1, WIN):
            chunk = pcm[i:i + WIN]
            x = np.concatenate([ctx, chunk]).reshape(1, -1).astype(np.float32)
            p, state = sess.run(None, {"input": x, "state": state, "sr": sr})
            ctx = chunk[-CTX:]
            out.append(float(p[0][0]))
        return np.array(out)
    return probs


def rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(x ** 2)) + 1e-9)


def scale(x: np.ndarray, target: float) -> np.ndarray:
    return x * (target / rms(x))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default=os.path.join(HERE, "data"))
    args = ap.parse_args()

    model = os.path.join(args.work, "silero_vad.onnx")
    sess = ort.InferenceSession(model, providers=["CPUExecutionProvider"])
    probs = make_probs(sess)

    def detected(pcm: np.ndarray) -> bool:
        return int((probs(pcm) >= PROB_THRESHOLD).sum()) >= FRAMES_NEEDED

    speech = sorted(glob.glob(os.path.join(args.work, "wav16/speech/*.wav")))
    noise = sorted(glob.glob(os.path.join(args.work, "wav16/noise/*.wav")))
    if not speech or not noise:
        print("audio topilmadi — avval fetch_audio.py ni ishga tushiring")
        return 1

    print(f"=== ODAM OVOZI aniqlanishi ({len(speech)} fayl, LibriSpeech) ===")
    for name, lvl in [("normal balandlik", 0.06), ("uzoqroq", 0.03), ("juda uzoq/jim", 0.012)]:
        hits = sum(detected(scale(read(f), lvl)) for f in speech)
        print(f"  {name:<18} {hits}/{len(speech)} = {hits / len(speech) * 100:5.1f}%")

    room = read(next(f for f in noise if "vacuum" in f))
    print("\n=== ODAM OVOZI + xona shovqini ===")
    for snr in [10, 5, 0, -5]:
        hits = 0
        for f in speech:
            s = scale(read(f), 0.06)
            n = np.tile(room, int(len(s) / len(room)) + 2)[:len(s)]
            hits += detected(s + scale(n.copy(), 0.06 / (10 ** (snr / 20))))
        print(f"  SNR {snr:>3} dB          {hits}/{len(speech)} = {hits / len(speech) * 100:5.1f}%")

    print("\n=== MAISHIY SHOVQIN (soxta ijobiy bo'lmasligi kerak) ===")
    cats: dict[str, list[int]] = {}
    for f in noise:
        cat = os.path.basename(f).split("__")[0]
        cats.setdefault(cat, []).append(int(detected(scale(read(f), 0.08))))
    for cat in sorted(cats, key=lambda c: -sum(cats[c])):
        hit = sum(cats[cat])
        print(f"  {'XX SOXTA' if hit else '  ok    '} {cat:<20} {hit}/{len(cats[cat])}")
    tot = sum(sum(v) for v in cats.values())
    n = sum(len(v) for v in cats.values())
    print(f"\nSOXTA IJOBIY: {tot}/{n} = {tot / n * 100:.1f}%")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
