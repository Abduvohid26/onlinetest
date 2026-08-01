#!/usr/bin/env python3
"""
ISHLAB CHIQARISH zanjirini aynan takrorlab, sezgirlik sozlamalarini solishtiradi.

Zanjir (frontend'dagi bilan bir xil):
    Silero VAD
      -> gisterezis (SPEECH_START_PROB / SPEECH_STOP_PROB)
      -> SPEECH_MIN_FRAMES uzluksiz tasdiqlash
      -> ContinuousSignalTracker(400ms grace)
      -> kichik chip (speechMs >= 900) / rasmiy (speechMs >= 2500)

Sezgirlikni o'zgartirishdan OLDIN shu skriptni ishga tushiring — chegarani
"his bilan" emas, o'lchov bilan tanlang.

    python3 fetch_audio.py
    ./venv/bin/python verify_chain.py
    ./venv/bin/python verify_chain.py --grid
"""
from __future__ import annotations

import argparse
import glob
import os
import wave

import numpy as np
import onnxruntime as ort

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
CTX, WIN, SR = 64, 512, 16000
FRAME_MS = WIN / SR * 1000  # 32ms
POLL_MS = 200  # ExamRoom audio loop
GRACE_MS = 600  # ContinuousSignalTracker (speech) — ExamRoom
CONFIRM_MS = 800  # TALK_SIGNAL_CONFIRM_MS
FORMAL_MS = 2500  # TALK_SIGNAL_ESCALATE_MS


def read(p: str) -> np.ndarray:
    with wave.open(p) as w:
        return np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768.0


def make_probs(sess: ort.InferenceSession):
    def probs(pcm: np.ndarray) -> np.ndarray:
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


def rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(x**2)) + 1e-9)


def scale(x: np.ndarray, t: float) -> np.ndarray:
    return x * (t / rms(x))


def run_chain(p: np.ndarray, start: float, stop: float, min_frames: int):
    """-> (chip chiqdimi, rasmiy berildimi)"""
    speaking, run_len, confirmed = False, 0, False
    confirmed_at = []
    for x in p:
        speaking = (x >= stop) if speaking else (x >= start)
        if speaking:
            run_len += 1
            if run_len >= min_frames:
                confirmed = True
        else:
            run_len = 0
            confirmed = False
        confirmed_at.append(confirmed)

    chip = formal = False
    cont_ms = 0.0
    last_true_t = None
    t = 0.0
    while t < len(confirmed_at) * FRAME_MS:
        idx = min(int(t / FRAME_MS), len(confirmed_at) - 1)
        active = confirmed_at[idx]
        if active:
            if last_true_t is None or (t - last_true_t) > GRACE_MS:
                cont_ms = 0.0
            cont_ms += POLL_MS
            last_true_t = t
        elif last_true_t is not None and (t - last_true_t) > GRACE_MS:
            cont_ms = 0.0
            last_true_t = None
        if cont_ms >= CONFIRM_MS:
            chip = True
        if cont_ms >= FORMAL_MS:
            formal = True
        t += POLL_MS
    return chip, formal


def score_cfg(cache: dict, cfg: tuple[float, float, int]) -> dict:
    """
    Ball: nutq recall (rasmiy) yuqori, shovqin FP (chip/rasmiy) past.
    Imtihon uchun: jim/uzoq nutq ham ushlanishi kerak; FP rasmiy = eng yomon.
    """
    rows = {}
    for k, probs_list in cache.items():
        res = [run_chain(p, *cfg) for p in probs_list]
        chip = sum(r[0] for r in res) / len(res) * 100
        form = sum(r[1] for r in res) / len(res) * 100
        rows[k] = (chip, form)

    speech_keys = [k for k in rows if k != "MAISHIY SHOVQIN"]
    speech_formal = float(np.mean([rows[k][1] for k in speech_keys]))
    speech_chip = float(np.mean([rows[k][0] for k in speech_keys]))
    quiet_formal = rows.get("ovoz juda jim", (0, 0))[1]
    mix_formal = rows.get("ovoz+shovqin SNR5", rows.get("ovoz+shovqin", (0, 0)))[1]
    noise_chip = rows["MAISHIY SHOVQIN"][0]
    noise_formal = rows["MAISHIY SHOVQIN"][1]

    # Og'irlik: FP rasmiy juda qimmat; jim nutq recall muhim; chip FP ham jarima.
    score = (
        0.28 * speech_formal
        + 0.22 * quiet_formal
        + 0.18 * mix_formal
        + 0.12 * speech_chip
        - 1.80 * noise_formal
        - 0.55 * noise_chip
    )
    return {
        "score": score,
        "speech_formal": speech_formal,
        "quiet_formal": quiet_formal,
        "mix_formal": mix_formal,
        "noise_chip": noise_chip,
        "noise_formal": noise_formal,
        "rows": rows,
    }


def print_table(label: str, rows: dict) -> None:
    print(f"\n{label}")
    print(f"  {'holat':<22} {'kichik chip':>12} {'RASMIY':>10}")
    for k, (chip, form) in rows.items():
        print(f"  {k:<22} {chip:11.1f}% {form:9.1f}%")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--grid", action="store_true", help="parametr panjarasini qidiradi")
    args = ap.parse_args()

    model = os.path.join(DATA, "silero_vad.onnx")
    if not os.path.exists(model):
        print("model topilmadi — avval fetch_audio.py")
        return 1
    sess = ort.InferenceSession(model, providers=["CPUExecutionProvider"])
    probs = make_probs(sess)

    speech = sorted(glob.glob(os.path.join(DATA, "wav16/speech/*.wav")))
    noise = sorted(glob.glob(os.path.join(DATA, "wav16/noise/*.wav")))
    if not speech or not noise:
        print("audio topilmadi — avval fetch_audio.py")
        return 1

    room = read(next(f for f in noise if "vacuum" in f))
    sets: dict[str, list[np.ndarray]] = {
        "ovoz normal": [scale(read(f), 0.06) for f in speech],
        "ovoz uzoq": [scale(read(f), 0.03) for f in speech],
        "ovoz juda jim": [scale(read(f), 0.012) for f in speech],
    }
    mix = []
    for s in sets["ovoz normal"]:
        n = np.tile(room, int(len(s) / len(room)) + 2)[: len(s)]
        mix.append(s + scale(n.copy(), 0.06 / (10 ** (5 / 20))))
    sets["ovoz+shovqin SNR5"] = mix
    sets["MAISHIY SHOVQIN"] = [scale(read(f), 0.08) for f in noise]

    print(
        f"zanjir: grace={GRACE_MS}ms confirm={CONFIRM_MS}ms formal={FORMAL_MS}ms | "
        f"{len(speech)} nutq, {len(noise)} shovqin",
        flush=True,
    )
    print("ehtimolliklar...", flush=True)
    cache = {k: [probs(c) for c in v] for k, v in sets.items()}

    named = [
        ("PUBLIC default (0.50/0.35, 250ms≈8)", (0.50, 0.35, 8)),
        ("CURRENT prod (0.33/0.24, 256ms≈8)", (0.33, 0.24, 8)),
        ("Oldingi prod (0.55/0.40, 256ms≈8)", (0.55, 0.40, 8)),
        ("OLD too-strict (0.78/0.55, 512ms≈16)", (0.78, 0.55, 16)),
        ("Old bench (0.70/0.50, 384ms≈12)", (0.70, 0.50, 12)),
        ("Whisper-style (0.50/0.35, 320ms≈10)", (0.50, 0.35, 10)),
        ("Soft (0.50/0.35, 192ms≈6)", (0.50, 0.35, 6)),
        ("Mid+ (0.60/0.42, 320ms≈10)", (0.60, 0.42, 10)),
    ]

    ranked = []
    for label, cfg in named:
        m = score_cfg(cache, cfg)
        ranked.append((m["score"], label, cfg, m))
        print_table(
            f"{label}  score={m['score']:.1f}  "
            f"(FP chip={m['noise_chip']:.1f}% formal={m['noise_formal']:.1f}%)",
            m["rows"],
        )

    if args.grid:
        print("\n=== GRID SEARCH ===", flush=True)
        starts = [0.50, 0.52, 0.55, 0.58, 0.60, 0.62, 0.65, 0.70, 0.75, 0.78]
        frames = [6, 8, 9, 10, 12, 14, 16]
        best = []
        for start in starts:
            for delta in (0.12, 0.15, 0.18, 0.20, 0.23):
                stop = round(start - delta, 3)
                if stop < 0.25:
                    continue
                for mf in frames:
                    cfg = (start, stop, mf)
                    m = score_cfg(cache, cfg)
                    # Hard constraint: rasmiy FP ≤ 1.5%, chip FP ≤ 4%
                    if m["noise_formal"] > 1.5 or m["noise_chip"] > 4.0:
                        continue
                    # Hard: jim nutq formal ≥ 90%, SNR5 formal ≥ 95%
                    if m["quiet_formal"] < 90.0 or m["mix_formal"] < 95.0:
                        continue
                    best.append((m["score"], cfg, m))
        best.sort(reverse=True, key=lambda x: x[0])
        print(f"filtrdan o'tgan: {len(best)} ta")
        print(f"{'score':>7} {'start':>6} {'stop':>6} {'mf':>3} {'quietF':>7} {'mixF':>6} {'fpC':>6} {'fpF':>6}")
        for sc, cfg, m in best[:25]:
            print(
                f"{sc:7.1f} {cfg[0]:6.2f} {cfg[1]:6.2f} {cfg[2]:3d} "
                f"{m['quiet_formal']:6.1f}% {m['mix_formal']:5.1f}% "
                f"{m['noise_chip']:5.1f}% {m['noise_formal']:5.1f}%"
            )
        if best:
            winner = best[0]
            print(
                f"\n>>> ENG YAXSHI: start={winner[1][0]} stop={winner[1][1]} "
                f"min_frames={winner[1][2]}  (~{winner[1][2]*32}ms)  score={winner[0]:.1f}"
            )
            ranked.append((winner[0], "GRID WINNER", winner[1], winner[2]))

    ranked.sort(reverse=True, key=lambda x: x[0])
    print("\n=== REYTING (yuqoridan pastga) ===")
    for sc, label, cfg, m in ranked[:12]:
        print(
            f"  {sc:6.1f}  {label:<42} "
            f"fpC={m['noise_chip']:.1f}% fpF={m['noise_formal']:.1f}% "
            f"quietF={m['quiet_formal']:.1f}%"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
