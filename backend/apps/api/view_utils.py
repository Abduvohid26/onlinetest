"""API yordamchilari."""
from __future__ import annotations

import json
from datetime import datetime

from django.utils import timezone as dj_tz


def parse_iso_datetime(s) -> datetime | None:
    if s is None:
        return None
    if isinstance(s, datetime):
        dt = s
    else:
        t = str(s).strip()
        if t.endswith("Z"):
            t = t[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(t)
        except ValueError:
            return None
    if dj_tz.is_naive(dt):
        dt = dj_tz.make_aware(dt, dj_tz.get_current_timezone())
    return dt


def safe_json_loads(raw: str, default):
    try:
        return json.loads(raw or "")
    except Exception:
        return default


def norm_answers(answers: dict) -> dict[str, str]:
    out: dict[str, str] = {}
    if not isinstance(answers, dict):
        return out
    for k, v in answers.items():
        out[str(k)] = "" if v is None else str(v)
    return out


PROFILE_IMAGE_MAX_B64 = 2 * 1024 * 1024  # ~1.5 MB rasm


def validate_profile_image_b64(value) -> str | None:
    """None = OK; string = xato xabari."""
    if value in (None, ""):
        return None
    s = str(value)
    if len(s) < 50:
        return "Profile image too small"
    if len(s) > PROFILE_IMAGE_MAX_B64:
        return f"Profile image too large (max {PROFILE_IMAGE_MAX_B64 // 1024}KB base64)"
    return None


def match_exam_option(value: str, options: list[str]) -> str | None:
    """
    Javobni variantlardan biriga moslaydi; mos kelmasa None.

    Aynan mos kelishi shart emas: bo‘shliq va registr farqi kechiriladi. Sabab —
    frontend variantlarni ko‘rsatishdan oldin `.trim()` qiladi, import qilingan
    savollarda esa variantlar chetida bo‘shliq/yangi qator qolib ketishi mumkin.
    Bunday farq talabaning javobini "noto‘g‘ri" qilib qo‘ymasligi kerak.

    Qaytariladigan qiymat — DOIM variantning kanonik (savoldagi) ko‘rinishi, chunki
    baholash `correctAnswer` bilan aynan solishtiradi.
    """
    if value in options:
        return value
    stripped = value.strip()
    for o in options:
        if o.strip() == stripped:
            return o
    folded = stripped.casefold()
    for o in options:
        if o.strip().casefold() == folded:
            return o
    return None


def validate_exam_answers(
    questions: list[dict], answers: dict, *, strict: bool = True
) -> dict[str, str]:
    """
    Savol ID va variantlar bo‘yicha javoblarni tekshiradi; normallashtirilgan dict qaytaradi.

    `strict=True`  — mos kelmagan javobda ValueError (til aniqlashda kerak: qaysi til
                     variantlari javoblarga mos kelishini shu xato bilan tanlaymiz).
    `strict=False` — mos kelmagan javob TASHLAB YUBORILADI (javobsiz hisoblanadi),
                     lekin imtihonni topshirishga TO‘SQINLIK QILMAYDI.

    Nega bardoshli rejim kerak: ilgari submit qat'iy rejimda ishlardi va bitta
    mos kelmagan javob 400 xato qaytarardi — talaba imtihonni UMUMAN yakunlay
    olmay qolardi ("Invalid answer for question 1"). Bir savolning texnik
    nomuvofiqligi butun imtihonni qulflab qo‘yishi mumkin emas.
    """
    if not isinstance(answers, dict):
        raise ValueError("Invalid answers format")
    q_by_id = {str(q.get("id")): q for q in questions if q.get("id") is not None}
    out: dict[str, str] = {}
    for k, v in answers.items():
        qid = str(k)
        if qid not in q_by_id:
            continue
        q = q_by_id[qid]
        opts = [str(o) for o in (q.get("options") or [])]
        val = "" if v is None else str(v).strip()
        if not val:
            out[qid] = ""
            continue
        match = match_exam_option(val, opts)
        if match is None:
            if strict:
                raise ValueError(f"Invalid answer for question {qid}")
            continue
        out[qid] = match
    return out
