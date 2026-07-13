"""iMentor testlarini imtihon sessiyasiga aylantirish (random tanlash + tarjima)."""
from __future__ import annotations

import random
from typing import Any

from apps.api.imentor_client import (
    IMentorApiError,
    imentor_collect_tests_for_subject,
    imentor_configured,
    imentor_get_test,
    imentor_stats,
)
from apps.api.services import exam_questions_add_translations, shuffle_in_place


def subjects_from_stats() -> list[dict]:
    """Admin UI uchun fanlar ro'yxati."""
    if not imentor_configured():
        return []
    try:
        stats = imentor_stats()
    except IMentorApiError:
        return []
    rows = stats.get("by_subject") or []
    if not isinstance(rows, list):
        return []
    out: list[dict] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        code = str(row.get("subject_code") or row.get("code") or "").strip()
        if not code:
            continue
        out.append(
            {
                "subject_code": code,
                "subject_name": str(row.get("subject_name") or row.get("name") or code).strip(),
                "test_count": int(row.get("test_count") or row.get("count") or 0),
                "questions_total": int(row.get("questions_total") or 0),
            }
        )
    out.sort(key=lambda x: (x["subject_name"].lower(), x["subject_code"]))
    return out


def _transform_imentor_questions(raw_questions: list[dict], *, limit: int = 0) -> list[dict]:
    out: list[dict] = []
    for i, q in enumerate(raw_questions):
        if not isinstance(q, dict):
            continue
        opts = [str(o).strip() for o in (q.get("options") or []) if str(o).strip()]
        if not opts:
            continue
        try:
            idx = int(q.get("correctOptionIndex", 0))
        except (TypeError, ValueError):
            idx = 0
        if idx < 0 or idx >= len(opts):
            idx = 0
        text = str(q.get("question") or "").strip()
        if not text:
            continue
        out.append(
            {
                "id": len(out) + 1,
                "text": text,
                "options": opts,
                "correctAnswer": opts[idx],
            }
        )
    if limit and len(out) > limit:
        shuffle_in_place(out)
        out = out[:limit]
        for j, qd in enumerate(out):
            qd["id"] = j + 1
    return out


def fetch_random_imentor_questions(
    subject_codes: list[str],
    *,
    max_questions: int = 0,
    source_language: str = "uz",
    add_translations: bool = True,
) -> tuple[list[dict], dict[str, Any]]:
    """
    Tanlangan fanlardan tasodifiy bitta test tanlab savollarni qaytaradi.
    max_questions=0 bo'lsa testdagi barcha savollar olinadi.
    """
    codes = [str(c).strip().upper() for c in subject_codes if str(c).strip()]
    if not codes:
        raise IMentorApiError("Kamida bitta fan tanlanishi kerak")

    pool: list[dict] = []
    for code in codes:
        try:
            pool.extend(imentor_collect_tests_for_subject(code))
        except IMentorApiError:
            continue

    if not pool:
        raise IMentorApiError(
            "Tanlangan fanlarda e'lon qilingan test topilmadi (1 soat kutish talabi bo'lishi mumkin)"
        )

    pick = random.choice(pool)
    test_id = int(pick.get("id") or 0)
    if not test_id:
        raise IMentorApiError("Test ID noto'g'ri")

    detail = imentor_get_test(test_id)
    payload = detail.get("payload") if isinstance(detail.get("payload"), dict) else {}
    raw_qs = payload.get("questions") or []
    if not isinstance(raw_qs, list) or not raw_qs:
        raise IMentorApiError("Testda savollar yo'q")

    limit = max(1, int(max_questions)) if max_questions else 0
    questions = _transform_imentor_questions(raw_qs, limit=limit)
    if not questions:
        raise IMentorApiError("Testdan foydali savol ajratib bo'lmadi")

    if add_translations:
        questions = exam_questions_add_translations(questions, source_language)

    meta = {
        "imentor_test_id": test_id,
        "imentor_topic": str(detail.get("topic") or pick.get("topic") or ""),
        "subject_code": str(detail.get("subject_code") or pick.get("subject_code") or ""),
        "subject_name": str(detail.get("subject_name") or pick.get("subject_name") or ""),
        "question_count": len(questions),
        "verification_code": str(detail.get("verification_code") or pick.get("verification_code") or ""),
    }
    return questions, meta


def validate_imentor_subjects(subject_codes: list[str]) -> tuple[bool, str, int]:
    """Imtihon yaratishda: fanlar mavjudligi va kamida bitta test borligini tekshirish."""
    if not imentor_configured():
        return False, "iMentor API kaliti sozlanmagan (IMENTOR_API_KEY)", 0
    codes = [str(c).strip().upper() for c in subject_codes if str(c).strip()]
    if not codes:
        return False, "Kamida bitta fan tanlang", 0
    stats_rows = {r["subject_code"]: r for r in subjects_from_stats()}
    total_tests = 0
    for code in codes:
        row = stats_rows.get(code)
        if not row:
            return False, f"Fan topilmadi yoki test yo'q: {code}", 0
        total_tests += int(row.get("test_count") or 0)
    if total_tests < 1:
        return False, "Tanlangan fanlarda e'lon qilingan test yo'q", 0
    return True, "", total_tests
