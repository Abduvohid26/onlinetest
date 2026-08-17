#!/usr/bin/env python
"""Butun talabalar kontingentini bitta buyruq bilan import qiladi.

Konteyner ichida (yoki manage.py bilan bir papkada) ishlatish:

  python kontingent.py                 # dry-run, hech narsa yozilmaydi
  python kontingent.py --apply         # haqiqatan bazaga yozadi (talabalar)
  python kontingent.py --apply --photos   # talabalar + rasmlar (profile_image)
  python kontingent.py --data-dir /app/data/talablar_kotingenti --apply

Excel fayllar default holatda shu skriptga nisbatan `../data/talablar kotingenti/`
papkasida qidiriladi (repo tuzilishi: backend/kontingent.py va data/talablar
kotingenti/ bir xil ildizda). Agar fayllar boshqa joyda bo'lsa --data-dir bilan
ko'rsating.

3-kurs.xlsx ATAYLAB o'tkazib yuboriladi — "Talabalar" sheet'da "Guruh" ustuni
yo'q, qo'lda hal qilinishi kerak (docs/KAFEDRA_HIERARCHY_PLAN.md §6.1 ga qarang).
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "exam_platform.settings")

BACKEND_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND_DIR))

import django  # noqa: E402

django.setup()

from django.core.management import call_command  # noqa: E402

# (fayl nomi, sheet, --level-name yoki None agar faylda "Kurs" ustuni bo'lsa, intake_year)
# intake_year qiymatlari 2026-08-02 holatiga (joriy o'quv yili boshi = 2025) mos
# hisoblangan — docs/KAFEDRA_HIERARCHY_PLAN.md §6.2 dagi formulaga qarang.
FILES = [
    ("1-kurs.xlsx", "Talabalar", "1-kurs", 2025),
    ("2-kurs.xlsx", "Talabalar", None, 2024),
    ("3-kurs.xlsx", "Talabalar", "3-kurs", 2023),
    ("4 kurslar.xlsx", "Talabalar", None, 2022),
    ("5 kurslar.xlsx", "Talabalar", "5-kurs", 2021),
]

SKIPPED_NOTE = ""


def default_data_dir() -> Path:
    return BACKEND_DIR.parent / "data" / "talablar kotingenti"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Haqiqatan saqlash (default: dry-run)")
    parser.add_argument(
        "--photos",
        action="store_true",
        help="Talabalardan keyin har fayl uchun seed_student_photos ni ham ishga tushiradi",
    )
    parser.add_argument(
        "--data-dir",
        default="",
        help="Excel fayllar joylashgan papka (default: ../data/talablar kotingenti)",
    )
    args = parser.parse_args()

    data_dir = Path(args.data_dir) if args.data_dir else default_data_dir()
    if not data_dir.is_dir():
        print(f"XATO: papka topilmadi: {data_dir}")
        print("Excel fayllarni shu papkaga joylashtiring yoki --data-dir bilan ko'rsating.")
        return 1

    if args.apply:
        print(">>> APPLY rejimi: ma'lumotlar HAQIQATAN bazaga yoziladi.\n")
    else:
        print(">>> DRY-RUN rejimi (hech narsa yozilmaydi). Yozish uchun: --apply\n")

    missing = []
    for filename, _sheet, _level, _intake in FILES:
        if not (data_dir / filename).is_file():
            missing.append(filename)
    if missing:
        print(f"XATO: quyidagi fayllar topilmadi ({data_dir} ichida): {missing}")
        return 1

    for filename, sheet, level_name, intake_year in FILES:
        print("=" * 70)
        print(f"Fayl: {filename}  |  Sheet: {sheet}  |  Kurs: {level_name or '<faylda>'}  |  Qabul yili: {intake_year}")
        print("=" * 70)
        kwargs = {
            "file": str(data_dir / filename),
            "sheet": sheet,
            "intake_year": intake_year,
            "apply": args.apply,
        }
        if level_name:
            kwargs["level_name"] = level_name
        call_command("import_students", **kwargs)
        print()

        if args.photos:
            print(f"--- Rasmlar: {filename} ---")
            call_command(
                "seed_student_photos",
                file=str(data_dir / filename),
                apply=args.apply,
            )
            print()

    print("=" * 70)
    print(SKIPPED_NOTE)
    print("=" * 70)
    print("\nTUGADI. Yuqoridagi har bir bo'limdagi NATIJA qatorini tekshiring.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
