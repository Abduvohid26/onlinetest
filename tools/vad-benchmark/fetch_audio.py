#!/usr/bin/env python3
"""
REAL audio yuklab olish — VAD benchmark uchun.

Nima yuklanadi:
  1. Silero VAD modeli (2.3MB, MIT)                    -> silero_vad.onnx
  2. ESC-50 maishiy shovqinlari (CC BY-NC 3.0)         -> wav16/noise/
  3. LibriSpeech dev-clean real nutqi (CC BY 4.0)      -> wav16/speech/

Hammasi 16 kHz mono WAV ga o'giriladi (Silero VAD talabi) va 5 soniyaga kesiladi.

Ishlatish:
    python3 fetch_audio.py            # hammasini yuklaydi (~400MB vaqtinchalik)
    python3 fetch_audio.py --keep     # librispeech.tar.gz ni o'chirmaydi

Talab: ffmpeg, curl (yoki internet orqali urllib), ~1GB bo'sh joy.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import csv
import os
import shutil
import subprocess
import sys
import tarfile
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_URL = "https://raw.githubusercontent.com/snakers4/silero-vad/master/src/silero_vad/data/silero_vad.onnx"
ESC50_AUDIO = "https://github.com/karolpiczak/ESC-50/raw/master/audio/"
LIBRISPEECH = "https://www.openslr.org/resources/12/dev-clean.tar.gz"

# Imtihon xonasida realistik uchraydigan maishiy shovqinlar.
NOISE_CATS = [
    "vacuum_cleaner", "washing_machine", "keyboard_typing", "mouse_click",
    "door_wood_knock", "door_wood_creaks", "can_opening", "clock_tick",
    "clock_alarm", "glass_breaking", "engine", "car_horn", "siren", "footsteps",
    "drinking_sipping", "toilet_flush", "pouring_water", "water_drops", "wind",
    "rain", "crackling_fire", "clapping", "brushing_teeth", "helicopter", "train",
]
# Inson chiqaradigan, LEKIN nutq bo'lmagan tovushlar — eng qiyin chegara holatlar.
EDGE_CATS = ["breathing", "coughing", "laughing", "sneezing", "snoring", "crying_baby"]
PER_CAT = 4

def sh(*args: str) -> None:
    subprocess.run(args, check=True, capture_output=True)

def download(url: str, dest: str) -> None:
    if os.path.exists(dest) and os.path.getsize(dest) > 10_000:
        return
    print(f"  yuklanmoqda: {os.path.basename(dest)}", flush=True)
    urllib.request.urlretrieve(url, dest)

def to_wav16(src: str, dst: str) -> None:
    """16 kHz mono WAV, birinchi 5 soniya."""
    sh("ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", src,
       "-ac", "1", "-ar", "16000", "-t", "5", "-c:a", "pcm_s16le", dst)

def fetch_noise(work: str) -> None:
    out = os.path.join(work, "wav16", "noise")
    os.makedirs(out, exist_ok=True)
    raw = os.path.join(work, "raw_noise")
    os.makedirs(raw, exist_ok=True)

    with open(os.path.join(HERE, "esc50.csv")) as f:
        rows = list(csv.DictReader(f))
    by_cat: dict[str, list[str]] = {}
    for r in rows:
        by_cat.setdefault(r["category"], []).append(r["filename"])

    jobs = [(c, fn) for c in NOISE_CATS + EDGE_CATS for fn in by_cat[c][:PER_CAT]]
    print(f"ESC-50 maishiy shovqin: {len(jobs)} fayl")

    def one(job: tuple[str, str]) -> str | None:
        cat, fn = job
        dst = os.path.join(out, f"{cat}__{fn}")
        if os.path.exists(dst):
            return None
        tmp = os.path.join(raw, fn)
        try:
            download(ESC50_AUDIO + fn, tmp)
            to_wav16(tmp, dst)
        except Exception as e:  # noqa: BLE001 - bitta fayl tushmasa benchmark davom etsin
            return f"{fn}: {e}"
        return None

    with concurrent.futures.ThreadPoolExecutor(12) as ex:
        fails = [f for f in ex.map(one, jobs) if f]
    shutil.rmtree(raw, ignore_errors=True)
    if fails:
        print(f"  ogohlantirish: {len(fails)} fayl tushmadi")

def fetch_speech(work: str, keep: bool) -> None:
    out = os.path.join(work, "wav16", "speech")
    os.makedirs(out, exist_ok=True)
    tgz = os.path.join(work, "librispeech-dev-clean.tar.gz")
    download(LIBRISPEECH, tgz)

    print("LibriSpeech: so'zlovchilar bo'yicha 2 tadan klip ajratilmoqda")
    raw = os.path.join(work, "raw_speech")
    os.makedirs(raw, exist_ok=True)
    per_speaker: dict[str, int] = {}
    with tarfile.open(tgz) as tf:
        for m in tf:
            if not m.name.endswith(".flac"):
                continue
            parts = m.name.split("/")
            spk = parts[2] if len(parts) > 2 else ""
            if not spk or per_speaker.get(spk, 0) >= 2:
                continue
            per_speaker[spk] = per_speaker.get(spk, 0) + 1
            tf.extract(m, raw)
            src = os.path.join(raw, m.name)
            to_wav16(src, os.path.join(out, os.path.basename(m.name).replace(".flac", ".wav")))
    print(f"  {len(per_speaker)} so'zlovchi, {sum(per_speaker.values())} klip")
    shutil.rmtree(raw, ignore_errors=True)
    if not keep:
        os.remove(tgz)

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default=os.path.join(HERE, "data"))
    ap.add_argument("--keep", action="store_true", help="librispeech arxivini saqlash")
    args = ap.parse_args()

    if not shutil.which("ffmpeg"):
        print("ffmpeg topilmadi — o'rnating: apt install ffmpeg", file=sys.stderr)
        return 1
    os.makedirs(args.work, exist_ok=True)

    print("Silero VAD modeli")
    download(MODEL_URL, os.path.join(args.work, "silero_vad.onnx"))
    fetch_noise(args.work)
    fetch_speech(args.work, args.keep)

    n = len(os.listdir(os.path.join(args.work, "wav16", "noise")))
    s = len(os.listdir(os.path.join(args.work, "wav16", "speech")))
    print(f"\nTayyor: {s} nutq + {n} shovqin fayli -> {args.work}/wav16")
    print("Endi: python3 silero_bench.py")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
