#!/usr/bin/env python3
"""Chuquroq VAD tahlil: misslar, edge FP, grace/confirm sweep."""
from __future__ import annotations

import glob
import os
import wave
from collections import defaultdict

import numpy as np
import onnxruntime as ort

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
CTX, WIN, SR = 64, 512, 16000
FRAME_MS = WIN / SR * 1000
POLL_MS = 200


def read(p):
    with wave.open(p) as w:
        return np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768.0


def probs_fn(sess):
    def probs(pcm):
        st = np.zeros((2, 1, 128), np.float32)
        sr = np.array(SR, np.int64)
        ctx = np.zeros(CTX, np.float32)
        out = []
        for i in range(0, len(pcm) - WIN + 1, WIN):
            c = pcm[i : i + WIN]
            x = np.concatenate([ctx, c]).reshape(1, -1).astype(np.float32)
            p, st = sess.run(None, {"input": x, "state": st, "sr": sr})
            ctx = c[-CTX:]
            out.append(float(p[0][0]))
        return np.array(out)

    return probs


def rms(x):
    return float(np.sqrt(np.mean(x**2)) + 1e-9)


def scale(x, t):
    return x * (t / rms(x))


def confirmed_mask(p, start, stop, min_frames):
    speaking, run_len, confirmed = False, 0, False
    out = []
    for x in p:
        speaking = (x >= stop) if speaking else (x >= start)
        if speaking:
            run_len += 1
            if run_len >= min_frames:
                confirmed = True
        else:
            run_len = 0
            confirmed = False
        out.append(confirmed)
    return out


def chain(confirmed_at, grace_ms, confirm_ms, formal_ms):
    chip = formal = False
    cont_ms = 0.0
    last_true_t = None
    t = 0.0
    while t < len(confirmed_at) * FRAME_MS:
        idx = min(int(t / FRAME_MS), len(confirmed_at) - 1)
        active = confirmed_at[idx]
        if active:
            if last_true_t is None or (t - last_true_t) > grace_ms:
                cont_ms = 0.0
            cont_ms += POLL_MS
            last_true_t = t
        elif last_true_t is not None and (t - last_true_t) > grace_ms:
            cont_ms = 0.0
            last_true_t = None
        if cont_ms >= confirm_ms:
            chip = True
        if cont_ms >= formal_ms:
            formal = True
        t += POLL_MS
    return chip, formal, cont_ms


def main():
    sess = ort.InferenceSession(os.path.join(DATA, "silero_vad.onnx"), providers=["CPUExecutionProvider"])
    probs = probs_fn(sess)
    speech = sorted(glob.glob(os.path.join(DATA, "wav16/speech/*.wav")))
    noise = sorted(glob.glob(os.path.join(DATA, "wav16/noise/*.wav")))

    # --- Miss analysis @ public defaults ---
    cfg = (0.50, 0.35, 8)
    print("=== CHIP MISS @ 0.50/0.35/8, grace400, confirm900 ===")
    misses = []
    for f in speech:
        p = probs(scale(read(f), 0.06))
        mask = confirmed_mask(p, *cfg)
        chip, formal, peak = chain(mask, 400, 900, 2500)
        if not chip:
            misses.append((os.path.basename(f), float(p.max()), float(p.mean()), peak))
    print(f"misses: {len(misses)}/{len(speech)}")
    for m in misses[:15]:
        print(f"  {m[0]} maxP={m[1]:.3f} meanP={m[2]:.3f} peakCont={m[3]:.0f}ms")

    # Quiet misses
    print("\n=== QUIET (rms0.012) CHIP MISS ===")
    qmiss = 0
    for f in speech:
        p = probs(scale(read(f), 0.012))
        chip, _, _ = chain(confirmed_mask(p, *cfg), 400, 900, 2500)
        if not chip:
            qmiss += 1
    print(f"quiet misses: {qmiss}/{len(speech)}")

    # Current prod misses
    print("\n=== CURRENT PROD 0.78/0.55/16 CHIP MISS ===")
    for lvl, name in [(0.06, "normal"), (0.012, "quiet")]:
        miss = 0
        for f in speech:
            p = probs(scale(read(f), lvl))
            chip, _, _ = chain(confirmed_mask(p, 0.78, 0.55, 16), 400, 900, 2500)
            if not chip:
                miss += 1
        print(f"  {name}: {miss}/{len(speech)} miss")

    # Edge categories max prob
    print("\n=== EDGE / NOISE max Silero prob (scale 0.08) ===")
    by_cat = defaultdict(list)
    for f in noise:
        cat = os.path.basename(f).split("__")[0]
        p = probs(scale(read(f), 0.08))
        by_cat[cat].append(float(p.max()))
    for cat in sorted(by_cat, key=lambda c: -max(by_cat[c])):
        mx = max(by_cat[cat])
        mn = min(by_cat[cat])
        flag = "!!" if mx >= 0.45 else (" ?" if mx >= 0.30 else "  ")
        print(f"  {flag} {cat:<20} max={mx:.3f} min={mn:.3f}")

    # Grace / confirm sweep with public VAD
    print("\n=== GRACE×CONFIRM sweep (VAD 0.50/0.35/8) — speech chip% / formal% / noise chip% ===")
    speech_p = [probs(scale(read(f), 0.06)) for f in speech]
    noise_p = [probs(scale(read(f), 0.08)) for f in noise]
    speech_m = [confirmed_mask(p, *cfg) for p in speech_p]
    noise_m = [confirmed_mask(p, *cfg) for p in noise_p]
    for grace in (300, 400, 500, 600, 700, 900):
        for confirm in (600, 800, 900, 1100):
            formal = 2500
            sc = sum(chain(m, grace, confirm, formal)[0] for m in speech_m) / len(speech_m) * 100
            sf = sum(chain(m, grace, confirm, formal)[1] for m in speech_m) / len(speech_m) * 100
            nc = sum(chain(m, grace, confirm, formal)[0] for m in noise_m) / len(noise_m) * 100
            nf = sum(chain(m, grace, confirm, formal)[1] for m in noise_m) / len(noise_m) * 100
            print(f"  g={grace:<3} c={confirm:<4}  speech chip={sc:5.1f}% formal={sf:5.1f}%  noise chip={nc:4.1f}% formal={nf:4.1f}%")

    # Soft VAD + production chain
    print("\n=== Soft VAD configs @ grace500 confirm800 formal2500 ===")
    for label, c in [
        ("public 0.50/0.35/8", (0.50, 0.35, 8)),
        ("soft 0.50/0.35/6", (0.50, 0.35, 6)),
        ("mid 0.55/0.40/8", (0.55, 0.40, 8)),
        ("mid 0.55/0.38/8", (0.55, 0.38, 8)),
        ("prod 0.78/0.55/16", (0.78, 0.55, 16)),
    ]:
        sm = [confirmed_mask(p, *c) for p in speech_p]
        nm = [confirmed_mask(p, *c) for p in noise_p]
        # also quiet
        quiet_p = [probs(scale(read(f), 0.012)) for f in speech]
        qm = [confirmed_mask(p, *c) for p in quiet_p]
        sc = sum(chain(m, 500, 800, 2500)[0] for m in sm) / len(sm) * 100
        qc = sum(chain(m, 500, 800, 2500)[0] for m in qm) / len(qm) * 100
        sf = sum(chain(m, 500, 800, 2500)[1] for m in sm) / len(sm) * 100
        nc = sum(chain(m, 500, 800, 2500)[0] for m in nm) / len(nm) * 100
        print(f"  {label:<22} speechChip={sc:5.1f}% quietChip={qc:5.1f}% formal={sf:5.1f}% noiseChip={nc:4.1f}%")

    # Continuous talk simulation: stitch 3 speech clips (almost continuous)
    print("\n=== STITCHED continuous talk (3×5s) formal hit? ===")
    for label, c in [
        ("public 0.50/0.35/8", (0.50, 0.35, 8)),
        ("prod 0.78/0.55/16", (0.78, 0.55, 16)),
    ]:
        hits = 0
        for i in range(0, 30, 3):
            pcm = np.concatenate([scale(read(speech[j]), 0.06) for j in range(i, i + 3)])
            p = probs(pcm)
            chip, formal, peak = chain(confirmed_mask(p, *c), 500, 800, 2500)
            hits += int(formal)
        print(f"  {label}: formal {hits}/10 stitched clips, grace500")


if __name__ == "__main__":
    main()
