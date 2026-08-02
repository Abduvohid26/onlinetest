#!/usr/bin/env bash
# Butun talabalar kontingentini (data/talablar kotingenti/*.xlsx) import qiladi.
#
# Har bir fayl uchun --level-name / --intake-year quyidagicha hisoblangan
# (formulasi: current_level = ay_start - intake_year + 1, bunda ay_start —
# 1-sentyabrgacha o'tgan yil, 1-sentyabrdan keyin joriy yil — batafsili
# docs/KAFEDRA_HIERARCHY_PLAN.md §6.2). Ushbu qiymatlar 2026-08-02 holatiga
# (ay_start=2025) mos — agar sana o'zgargan bo'lsa --intake-year larni qayta
# hisoblang yoki shu faylni yangilang.
#
# Ishlatilishi:
#   ./scripts/import_full_kontingent.sh              # dry-run, hammasi
#   ./scripts/import_full_kontingent.sh --apply       # haqiqatan yozadi
#
# Talab: backend/.venv faollashtirilgan bo'lishi kerak (yoki venv/bin/python
# to'g'ridan-to'g'ri PATH'da bo'lsin), DATABASE_URL server muhitida
# sozlangan bo'lishi kerak (bu skript uni o'zgartirmaydi).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$ROOT_DIR/backend"
DATA_DIR="$ROOT_DIR/data/talablar kotingenti"

APPLY_FLAG=""
if [[ "${1:-}" == "--apply" ]]; then
    APPLY_FLAG="--apply"
    echo ">>> APPLY rejimi: ma'lumotlar HAQIQATAN bazaga yoziladi."
else
    echo ">>> DRY-RUN rejimi (hech narsa yozilmaydi). Yozish uchun: $0 --apply"
fi
echo

cd "$BACKEND_DIR"

run_import() {
    local file="$1" sheet="$2" level_name="$3" intake_year="$4"
    echo "===================================================================="
    echo "Fayl: $file  |  Sheet: $sheet  |  Kurs: ${level_name:-<faylda>}  |  Qabul yili: $intake_year"
    echo "===================================================================="
    python3 manage.py import_students \
        --file "$DATA_DIR/$file" \
        --sheet "$sheet" \
        ${level_name:+--level-name "$level_name"} \
        --intake-year "$intake_year" \
        $APPLY_FLAG
    echo
}

# 1-kurs: "Kurs" ustuni yo'q -> --level-name majburiy.
run_import "1-kurs.xlsx" "Talabalar" "1-kurs" 2025

# 2-kurs: "Kurs" ustuni bor (faylning o'zidan olinadi) -> --level-name shart emas,
# lekin baribir mos kelsa xato bermaydi (agar faylda Kurs ustuni bo'lsa, u ustunga
# ustunlik beriladi).
run_import "2-kurs.xlsx" "Talabalar" "" 2024

# 3-kurs.xlsx: ATAYLAB O'TKAZIB YUBORILDI.
#   - "xalqaro" sheet: 256 qatorning barchasi bo'sh (faqat shablon, real ma'lumot yo'q).
#   - "Talabalar" sheet: 1073 ta real talaba bor, LEKIN "Guruh" ustuni umuman yo'q —
#     qaysi guruhga tegishli ekanligini fayldan aniqlab bo'lmaydi.
#   Bu faylni import qilishdan oldin qo'lda hal qilish kerak: yo alohida
#   guruh-ro'yxati manbasi topiladi, yoki har bir talaba uchun guruh qo'lda belgilanadi.
echo "===================================================================="
echo "OGOHLANTIRISH: 3-kurs.xlsx O'TKAZIB YUBORILDI"
echo "  - 'xalqaro' sheet: 256 qator, barchasi bo'sh (shablon)."
echo "  - 'Talabalar' sheet: 1073 ta real talaba bor, lekin 'Guruh' ustuni YO'Q."
echo "  Bu faylni alohida, qo'lda tekshirib import qilish kerak bo'ladi."
echo "===================================================================="
echo

# 4-kurslar: "Kurs" ustuni bor.
run_import "4 kurslar.xlsx" "Talabalar" "" 2022

# 5-kurslar: "Kurs" ustuni yo'q -> --level-name majburiy.
run_import "5 kurslar.xlsx" "Talabalar" "5-kurs" 2021

echo "===================================================================="
echo "TUGADI. Yuqoridagi har bir bo'limdagi NATIJA qatorini tekshiring."
echo "Diqqat: 3-kurs.xlsx hali import qilinmadi — yuqoridagi ogohlantirishga qarang."
echo "===================================================================="
