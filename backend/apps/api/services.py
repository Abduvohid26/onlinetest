"""Imtihon yordamchi funksiyalar (Express server.ts mantiqining Python porti)."""
from __future__ import annotations

import hashlib
import hmac
import json
import random
import re
import secrets
from datetime import datetime, timezone
from typing import Any

from django.conf import settings
from django.db import transaction
from django.utils import timezone as dj_tz

from apps.core.models import Group, ResultIdCounter
from apps.api.view_utils import safe_json_loads


def shuffle_in_place(arr: list) -> list:
    for i in range(len(arr) - 1, 0, -1):
        j = random.randint(0, i)
        arr[i], arr[j] = arr[j], arr[i]
    return arr


def build_student_question_list(full: list[dict]) -> list[dict]:
    out = []
    for q in full:
        opts = list(q.get("options") or [])
        shuffle_in_place(opts)
        out.append({"id": q["id"], "text": q["text"], "options": opts})
    return out


def build_fallback_ai_summary(questions: list[dict], answers: dict[str, str]) -> dict:
    items = []
    for q in questions:
        qid = q["id"]
        st = answers.get(str(qid), "") or ""
        ok = st == q.get("correctAnswer")
        items.append(
            {
                "questionId": qid,
                "isCorrect": ok,
                "commentCorrect": "Javob to'g'ri tanlangan." if ok else "",
                "whyStudentWrong": (
                    "" if ok
                    else 'Tanlangan javob ("' + (st or "bo'sh") + '") savolning to\'g\'ri yechimi bilan mos kelmaydi.'
                ),
                "whyCorrectIsRight": (
                    "" if ok
                    else 'To\'g\'ri javob "' + str(q.get("correctAnswer") or "") + '" -- savol mazmuniga mos yagona aniq variant.'
                ),
            }
        )
    return {
        "overview": "Quyida har bir savol bo'yicha avtomatik tekshiruv natijalari ko'rsatilgan.",
        "items": items,
        "source": "fallback",
    }


def next_result_public_id() -> str:
    year = datetime.now(timezone.utc).year
    with transaction.atomic():
        c, _ = ResultIdCounter.objects.select_for_update().get_or_create(
            pk=1, defaults={"next_num": 37923423}
        )
        c.next_num += 1
        c.save(update_fields=["next_num"])
        n = c.next_num
    return f"FJSTI_{str(n).zfill(8)}_{year}"


def integrity_code(result_id: str, completed_at: str, score: int, total: int, secret: str) -> str:
    msg = f"{result_id}|{completed_at}|{score}|{total}|{secret}"
    return hmac.new(
        settings.JWT_SECRET.encode(),
        msg.encode(),
        hashlib.sha256,
    ).hexdigest()[:24].upper()


def assert_safe_result_public_id(rid: str) -> bool:
    return bool(rid and len(rid) <= 80 and re.match(r"^FJSTI_[0-9]{8}_20[0-9]{2}$", rid))


def public_base_url(request) -> str:
    if settings.PUBLIC_APP_URL:
        return settings.PUBLIC_APP_URL.rstrip("/")
    host = request.META.get("HTTP_HOST", "127.0.0.1:8000")
    xf = request.META.get("HTTP_X_FORWARDED_PROTO", "http")
    proto = xf.split(",")[0].strip() if isinstance(xf, str) else "http"
    return f"{proto}://{host}"


def parse_pdf_questions(file_obj) -> list[dict]:
    """
    PDF dan savollarni ajratadi.
    Qo'llab-quvvatlangan formatlar:
    - 1. Savol / 1) Savol
    - Variantlar: A) B) C) D) yoki a. b. c. d. yoki 1) 2) 3) 4)
    - Javob kaliti hujjat oxirida ham bo'lishi mumkin
    """
    from pypdf import PdfReader
    from io import BytesIO
    from apps.api.gemini_tools import parse_flexible_questionnaire, detect_question_language

    raw = file_obj.read()
    reader = PdfReader(BytesIO(raw))
    text = ""
    for page in reader.pages:
        text += (page.extract_text() or "") + "\n"

    if not text.strip():
        return []

    # Aqlli parser ishlatamiz (zero token cost)
    try:
        src_lang = detect_question_language(text)
        parsed = parse_flexible_questionnaire(text, src_lang)
        return [
            {
                "id": i + 1,
                "text": q["text"],
                "options": q["options"],
                "correctAnswer": q["correctAnswer"],
            }
            for i, q in enumerate(parsed)
        ]
    except Exception:
        pass

    # Oddiy fallback
    questions = []
    blocks = re.split(r"(?m)(?=^\s*\d{1,3}[.)]\s+\S)", text)
    for block in blocks:
        b = block.strip()
        if not b or len(b) < 15:
            continue
        lines = [x.strip() for x in b.split("\n") if x.strip()]
        if not lines:
            continue
        q_text = re.sub(r"^\d+[.)]\s*", "", lines[0]).strip()
        options: list[str] = []
        for line in lines[1:]:
            # A) / a) / A. / 1) / 1. formatlar
            m = re.match(r"^([A-Ja-j]|\d{1,2})[).:\-]\s+(.+)$", line)
            if m:
                options.append(m.group(2).strip())
        if len(options) < 2:
            continue
        while len(options) < 4:
            options.append(f"Variant {len(options) + 1}")
        questions.append({
            "id": len(questions) + 1,
            "text": q_text or f"Savol {len(questions) + 1}",
            "options": options[:10],
            "correctAnswer": options[0],
        })
    return questions


def extract_text_from_bank_upload(raw: bytes, filename: str) -> str:
    """Test bazasiga AI import: PDF, DOCX yoki oddiy matn."""
    name = (filename or "").lower()
    if name.endswith(".pdf"):
        if len(raw) < 5 or not raw.startswith(b"%PDF"):
            raise ValueError("Yaroqsiz yoki buzilgan PDF fayl")
        from io import BytesIO

        from pypdf import PdfReader

        reader = PdfReader(BytesIO(raw))
        page_count = len(reader.pages)
        max_pages = 15
        if page_count > max_pages:
            raise ValueError(
                f"PDF juda katta ({page_count} bet). Hozircha maksimal {max_pages} betni import qiling."
            )
        parts = []
        for page in reader.pages:
            parts.append(page.extract_text() or "")
        return "\n".join(parts)
    if name.endswith(".docx"):
        from io import BytesIO

        from docx import Document

        doc = Document(BytesIO(raw))
        return "\n".join(p.text for p in doc.paragraphs if p.text.strip())
    if name.endswith(".doc"):
        # Eski .doc -- to'liq qo'llab-quvvatlanmaydi; UTF-8 matn sifatida urinib ko'ramiz
        try:
            return raw.decode("utf-8", errors="replace")
        except Exception:
            raise ValueError(
                ".doc faylini Word orqali .docx ga saqlab, qayta yuklang (yoki PDF)."
            )
    return raw.decode("utf-8", errors="replace")


def filter_bank_questions_for_group(qs, group: Group | None):
    """Talaba guruhi bo'yicha test bazasi savollarini filtrlash."""
    from django.db.models import Q

    if group is None:
        return qs
    pt = (group.program_track or "bachelor").lower()
    if pt == "residency":
        return qs.filter(Q(category__program_track__in=("residency", "any")))
    if pt == "master":
        return qs.filter(Q(category__program_track__in=("master", "any")))
    q = Q(category__program_track__in=("bachelor", "any"))
    qs2 = qs.filter(q)
    ay = group.academic_year
    if ay is not None:
        qs2 = qs2.filter(
            Q(category__academic_year__isnull=True) | Q(category__academic_year=ay)
        )
    return qs2


def _coerce_exam_options(opts_raw: list, opts_en: list) -> list[str]:
    """Bo'sh yoki yaroqsiz variantlarni EN zaxirasiga yoki A–E yorliqlariga almashtiradi."""
    letters = ("A", "B", "C", "D", "E")
    opts = [str(x).strip() for x in (opts_raw or []) if str(x).strip()]
    if len(opts) < 2:
        opts = [str(x).strip() for x in (opts_en or []) if str(x).strip()]
    if len(opts) < 2:
        n = max(2, min(5, len(opts_raw or opts_en or [1, 2])))
        opts = [f"{letters[i]}) Variant" for i in range(n)]
    out: list[str] = []
    for i, o in enumerate(opts[:5]):
        if len(o) == 1 and o.upper() in letters:
            out.append(f"{o.upper()}) {o.upper()}")
        else:
            out.append(o)
    return out


def resolve_student_exam_language(request, exam) -> str:
    """Imtihon `auto` bo'lsa — talaba UI tili (header/body), aks holda imtihon tili."""
    exam_lang = (getattr(exam, "language", None) or "uz").lower()
    if exam_lang in ("uz", "ru", "en"):
        return exam_lang
    header = str(request.META.get("HTTP_X_STUDENT_LANG") or "").lower().strip()[:2]
    if header in ("uz", "ru", "en"):
        return header
    body = getattr(request, "data", None)
    if isinstance(body, dict):
        for key in ("student_lang", "lang"):
            sl = str(body.get(key) or "").lower().strip()[:2]
            if sl in ("uz", "ru", "en"):
                return sl
    return "uz"


def effective_exam_language(exam, student_lang: str) -> str:
    exam_lang = (getattr(exam, "language", None) or "uz").lower()
    if exam_lang == "auto":
        return student_lang if student_lang in ("uz", "ru", "en") else "uz"
    return exam_lang if exam_lang in ("uz", "ru", "en") else "uz"


def localize_exam_question(q: dict, lang: str) -> dict:
    """Ko'p tilli savol dict → bitta til (talaba ko'radi)."""
    lang = (lang or "uz").lower()
    opts_en = q.get("options") or []
    if not isinstance(opts_en, list):
        opts_en = []
    if lang == "en":
        text = (q.get("text_en") or q.get("text") or "").strip()
        opts = q.get("options_en") if isinstance(q.get("options_en"), list) else opts_en
        ca = (q.get("correct_answer_en") or q.get("correctAnswer") or "").strip()
    elif lang == "ru":
        text = (q.get("text_ru") or q.get("text") or "").strip()
        opts = q.get("options_ru") if isinstance(q.get("options_ru"), list) else opts_en
        ca = (q.get("correct_answer_ru") or q.get("correctAnswer") or "").strip()
    else:
        text = (q.get("text_uz") or q.get("text") or "").strip()
        opts = q.get("options_uz") if isinstance(q.get("options_uz"), list) else opts_en
        ca = (q.get("correct_answer_uz") or q.get("correctAnswer") or "").strip()
    opts = _coerce_exam_options(
        [str(x) for x in opts] if isinstance(opts, list) else [],
        [str(x) for x in opts_en],
    )
    ca = str(ca or "").strip()
    if ca not in opts:
        for o in opts:
            if ca and (ca in o or o.endswith(ca)):
                ca = o
                break
        else:
            ca = opts[0] if opts else ca
    out = dict(q)
    out["text"] = text
    out["options"] = opts
    out["correctAnswer"] = ca
    return out


def exam_question_with_translations(q: dict, tr: dict, source_lang: str) -> dict:
    """Bitta savol + AI tarjima natijasini imtihon JSON formatiga birlashtiradi."""
    tr = tr or {}
    src = (source_lang or "uz").lower()
    out = {
        "id": q.get("id"),
        "text": q.get("text"),
        "options": list(q.get("options") or []),
        "correctAnswer": q.get("correctAnswer"),
    }

    def _lst(key: str, fallback: list) -> list:
        v = tr.get(key)
        return list(v) if isinstance(v, list) else list(fallback)

    if src == "en":
        out.update(
            {
                "text_en": out["text"],
                "text_uz": str(tr.get("text_uz") or ""),
                "text_ru": str(tr.get("text_ru") or ""),
                "options_en": out["options"],
                "options_uz": _lst("options_uz", out["options"]),
                "options_ru": _lst("options_ru", out["options"]),
                "correct_answer_en": out["correctAnswer"],
                "correct_answer_uz": str(tr.get("correct_answer_uz") or ""),
                "correct_answer_ru": str(tr.get("correct_answer_ru") or ""),
            }
        )
    elif src == "ru":
        out.update(
            {
                "text_ru": out["text"],
                "text_uz": str(tr.get("text_uz") or ""),
                "text_en": str(tr.get("text_en") or ""),
                "options_ru": out["options"],
                "options_uz": _lst("options_uz", out["options"]),
                "options_en": _lst("options_en", out["options"]),
                "correct_answer_ru": out["correctAnswer"],
                "correct_answer_uz": str(tr.get("correct_answer_uz") or ""),
                "correct_answer_en": str(tr.get("correct_answer_en") or ""),
            }
        )
    else:
        out.update(
            {
                "text_uz": out["text"],
                "text_ru": str(tr.get("text_ru") or ""),
                "text_en": str(tr.get("text_en") or ""),
                "options_uz": out["options"],
                "options_ru": _lst("options_ru", out["options"]),
                "options_en": _lst("options_en", out["options"]),
                "correct_answer_uz": out["correctAnswer"],
                "correct_answer_ru": str(tr.get("correct_answer_ru") or ""),
                "correct_answer_en": str(tr.get("correct_answer_en") or ""),
            }
        )
    return out


def exam_questions_add_translations(questions: list[dict], source_language: str | None = None) -> list[dict]:
    """Manual/PDF savollarini UZ+RU+EN ga tarjima qilib saqlash (imtihon yaratish — auto til)."""
    if not questions:
        return []
    from apps.api.gemini_tools import detect_question_language, translate_questions_batch

    src = (source_language or "").lower()
    if src not in ("uz", "ru", "en"):
        sample = " ".join(str(q.get("text") or "") for q in questions[:8])
        src = detect_question_language(sample)
    payload = [
        {
            "text": str(q.get("text") or ""),
            "options": list(q.get("options") or []),
            "correctAnswer": str(q.get("correctAnswer") or ""),
        }
        for q in questions
    ]
    try:
        translations = translate_questions_batch(payload, src)
    except Exception:
        translations = [{} for _ in questions]
    return [
        exam_question_with_translations(q, translations[i] if i < len(translations) else {}, src)
        for i, q in enumerate(questions)
    ]


def apply_exam_language_to_questions(full: list[dict], exam_lang: str, student_lang: str) -> list[dict]:
    if (exam_lang or "uz").lower() != "auto":
        return full
    return [localize_exam_question(q, student_lang) for q in full]


def bank_row_to_exam_dict(row, exam_lang: str) -> dict:
    """TestBankQuestion qatoridan imtihon tili bo'yicha savol dict (to'g'ri javob bilan)."""
    opts_en = safe_json_loads(row.options_json, [])
    exam_lang = (exam_lang or "uz").lower()
    if exam_lang == "en":
        text, opts, ca = row.text, list(opts_en), row.correct_answer
    elif exam_lang == "ru":
        opts = safe_json_loads(getattr(row, "options_ru_json", None) or "[]", [])
        text = (getattr(row, "text_ru", None) or "").strip() or row.text
        if not any(str(x).strip() for x in opts):
            opts = list(opts_en)
        ca = (getattr(row, "correct_answer_ru", None) or "").strip() or row.correct_answer
    else:
        opts = safe_json_loads(getattr(row, "options_uz_json", None) or "[]", [])
        text = (getattr(row, "text_uz", None) or "").strip() or row.text
        if not any(str(x).strip() for x in opts):
            opts = list(opts_en)
        ca = (getattr(row, "correct_answer_uz", None) or "").strip() or row.correct_answer
    opts = _coerce_exam_options(opts, opts_en)
    ca = str(ca or "").strip()
    if ca not in opts:
        for o in opts:
            if ca and (ca in o or o.endswith(ca)):
                ca = o
                break
        else:
            ca = opts[0]
    return {"text": text, "options": opts, "correctAnswer": ca}
