"""iMentor testlarini imtihon sessiyasiga aylantirish (random tanlash + tarjima)."""
from __future__ import annotations

import random
from typing import Any

from apps.api.imentor_client import (
    DEFAULT_QUESTION_LIMIT_BOUNDS,
    IMentorApiError,
    IMENTOR_QUESTION_LIMIT_MAX,
    IMENTOR_QUESTION_LIMIT_MIN,
    imentor_collect_tests_for_subject,
    imentor_configured,
    imentor_get_test,
    imentor_stats,
    parse_question_limit_bounds,
    validate_question_limit_value,
)
from apps.api.services import exam_questions_add_translations


def question_limit_bounds() -> dict[str, int]:
    """API stats dan yoki default 10–30."""
    if not imentor_configured():
        return dict(DEFAULT_QUESTION_LIMIT_BOUNDS)
    try:
        stats = imentor_stats()
        return parse_question_limit_bounds(stats)
    except IMentorApiError:
        return dict(DEFAULT_QUESTION_LIMIT_BOUNDS)


def normalize_exam_question_count(raw: int | str | None, *, bounds: dict[str, int] | None = None) -> int:
    """
    Imtihon yaratish: 0 = testdagi barcha savollar; aks holda bounds ichida (odatda 10–30).
    """
    b = bounds or DEFAULT_QUESTION_LIMIT_BOUNDS
    lo, hi = int(b["min"]), int(b["max"])
    try:
        n = int(raw) if raw is not None and str(raw).strip() != "" else 0
    except (TypeError, ValueError):
        n = 0
    if n == 0:
        return 0
    if n < lo or n > hi:
        raise IMentorApiError(
            f"Savollar soni {lo} dan {hi} gacha bo'lishi kerak (0 = testdagi barcha savollar).",
            status=400,
        )
    return n


def subjects_from_stats() -> list[dict]:
    """Admin UI uchun fanlar ro'yxati."""
    if not imentor_configured():
        return []
    try:
        stats = imentor_stats()
    except IMentorApiError:
        return []
    bounds = parse_question_limit_bounds(stats)
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


def _transform_imentor_questions(raw_questions: list[dict]) -> list[dict]:
    out: list[dict] = []
    for q in raw_questions:
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
    max_questions=0 bo'lsa API detail cheklovsiz (bazadagi barcha savollar).
    max_questions>0 bo'lsa question_limit=10..30 API ga uzatiladi.
    """
    bounds = question_limit_bounds()
    question_limit = validate_question_limit_value(int(max_questions or 0), bounds=bounds)

    codes = [str(c).strip().upper() for c in subject_codes if str(c).strip()]
    if not codes:
        raise IMentorApiError("Kamida bitta fan tanlanishi kerak")

    list_min = question_limit if question_limit else IMENTOR_QUESTION_LIMIT_MIN
    list_max = IMENTOR_QUESTION_LIMIT_MAX

    pool: list[dict] = []
    for code in codes:
        try:
            pool.extend(
                imentor_collect_tests_for_subject(
                    code,
                    min_questions=list_min,
                    max_questions=list_max,
                )
            )
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

    detail = imentor_get_test(
        test_id,
        question_limit=question_limit if question_limit else None,
    )
    payload = detail.get("payload") if isinstance(detail.get("payload"), dict) else {}
    raw_qs = payload.get("questions") or []
    if not isinstance(raw_qs, list) or not raw_qs:
        raise IMentorApiError("Testda savollar yo'q")

    questions = _transform_imentor_questions(raw_qs)
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
        "question_limit": int(detail.get("question_limit") or question_limit or 0),
        "question_count_available": int(
            detail.get("question_count_available") or detail.get("question_count") or pick.get("question_count") or 0
        ),
        "question_count_returned": int(detail.get("question_count_returned") or len(questions)),
        "question_limit_bounds": parse_question_limit_bounds(detail),
        "verification_code": str(detail.get("verification_code") or pick.get("verification_code") or ""),
        "document_id": str(detail.get("document_id") or pick.get("document_id") or ""),
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
