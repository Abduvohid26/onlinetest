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


def validate_exam_answers(questions: list[dict], answers: dict) -> dict[str, str]:
    """Savol ID va variantlar bo‘yicha javoblarni tekshiradi; normallashtirilgan dict qaytaradi."""
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
        if val and val not in opts:
            raise ValueError(f"Invalid answer for question {qid}")
        out[qid] = val
    return out
