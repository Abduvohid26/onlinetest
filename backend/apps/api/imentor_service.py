"""iMentor testlarini imtihon sessiyasiga aylantirish (random tanlash + tarjima)."""
from __future__ import annotations

import random
from typing import Any

from apps.api.imentor_client import (
    DEFAULT_QUESTION_LIMIT_BOUNDS,
    IMentorApiError,
    IMENTOR_QUESTION_LIMIT_MAX,
    IMENTOR_QUESTION_LIMIT_MIN,
    imentor_catalog_departments,
    imentor_catalog_stats,
    imentor_collect_department_subjects,
    imentor_collect_tests_for_subject,
    imentor_configured,
    imentor_get_test,
    imentor_published_test_count,
    imentor_stats,
    parse_question_limit_bounds,
    validate_question_limit_value,
)
from apps.api.services import exam_questions_add_translations


def question_limit_bounds() -> dict[str, int]:
    """API catalog/tests stats dan yoki default 10–30."""
    if not imentor_configured():
        return dict(DEFAULT_QUESTION_LIMIT_BOUNDS)
    for loader in (imentor_catalog_stats, imentor_stats):
        try:
            return parse_question_limit_bounds(loader())
        except IMentorApiError:
            continue
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


def _derive_department_code(subject_code: str) -> str:
    """Katalog fan kodi: kafedra__fan → kafedra."""
    code = str(subject_code or "").strip()
    if "__" in code:
        return code.split("__", 1)[0]
    return code


def _subject_context(subject_code: str) -> dict[str, Any]:
    """Fan/kafedra konteksti — registry yoki katalog kodidan."""
    token = str(subject_code or "").strip()
    idx = _subject_stats_index()
    row = idx.get(token) or idx.get(token.lower()) or idx.get(token.upper())
    if row:
        dept = str(row.get("department_code") or "").strip() or _derive_department_code(token)
        return {
            "subject_code": str(row.get("subject_code") or token),
            "department_code": dept,
            "syllabus_id": int(row.get("syllabus_id") or 0) or None,
            "test_count": int(row.get("test_count") or 0),
        }
    dept = _derive_department_code(token)
    return {
        "subject_code": token,
        "department_code": dept,
        "syllabus_id": None,
        "test_count": 0,
    }


def _build_subject_registry() -> dict[str, dict]:
    """Katalog (nomlar) + test stats (test_count) birlashtirilgan reestr."""
    canonical: dict[str, dict] = {}

    def ensure(code: str, **fields: Any) -> None:
        c = str(code or "").strip()
        if not c:
            return
        row = canonical.setdefault(
            c,
            {
                "subject_code": c,
                "subject_name": c,
                "department_code": "",
                "department_name": "",
                "syllabus_id": 0,
                "test_count": 0,
                "questions_total": 0,
            },
        )
        for key, val in fields.items():
            if val is not None and val != "":
                row[key] = val

    if imentor_configured():
        try:
            cat = imentor_catalog_stats()
            for row in cat.get("by_subject") or []:
                if not isinstance(row, dict):
                    continue
                ensure(
                    str(row.get("subject_code") or ""),
                    subject_name=row.get("subject_name"),
                    department_code=row.get("department_code"),
                    department_name=row.get("department_name"),
                    syllabus_id=int(row.get("id") or 0),
                )
        except IMentorApiError:
            pass

        try:
            stats = imentor_stats()
            for row in stats.get("by_subject") or []:
                if not isinstance(row, dict):
                    continue
                code = str(row.get("subject_code") or "").strip()
                if not code:
                    continue
                ensure(
                    code,
                    subject_name=row.get("subject_name"),
                    department_code=row.get("department_code"),
                    department_name=row.get("department_name"),
                    test_count=int(row.get("test_count") or 0),
                    questions_total=int(row.get("questions_total") or 0),
                )
                canonical[code]["test_count"] = int(row.get("test_count") or 0)
                canonical[code]["questions_total"] = int(row.get("questions_total") or 0)
        except IMentorApiError:
            pass

        # Legacy: testlar kafedra kodi (akusherlik-va-ginekologiya) ostida, katalog fanlari __ bilan
        legacy_tests: dict[str, int] = {}
        for code, row in canonical.items():
            tc = int(row.get("test_count") or 0)
            if tc < 1:
                continue
            dept_key = str(row.get("department_code") or "").strip() or code
            if "__" not in code:
                legacy_tests[dept_key] = max(legacy_tests.get(dept_key, 0), tc)
        for code, row in canonical.items():
            dept = str(row.get("department_code") or "").strip() or _derive_department_code(code)
            if dept in legacy_tests:
                row["test_count"] = max(int(row.get("test_count") or 0), legacy_tests[dept])
                if not row.get("department_code"):
                    row["department_code"] = dept

    return canonical


def _subject_stats_index(rows: list[dict] | None = None) -> dict[str, dict]:
    """subject_code ni case-insensitive qidirish."""
    if rows is not None:
        idx: dict[str, dict] = {}
        for row in rows:
            code = str(row.get("subject_code") or "").strip()
            if not code:
                continue
            idx[code] = row
            idx[code.lower()] = row
            idx[code.upper()] = row
        return idx

    idx = {}
    for code, row in _build_subject_registry().items():
        idx[code] = row
        idx[code.lower()] = row
        idx[code.upper()] = row
    return idx


def departments_from_catalog() -> list[dict]:
    """Admin UI 1-qadam: kafedralar."""
    if not imentor_configured():
        return []
    try:
        data = imentor_catalog_departments()
    except IMentorApiError:
        return []
    rows = data.get("results") or []
    if not isinstance(rows, list):
        return []
    out: list[dict] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        code = str(row.get("code") or "").strip()
        if not code:
            continue
        out.append(
            {
                "code": code,
                "name": str(row.get("name") or code).strip(),
                "sort_order": int(row.get("sort_order") or 0),
                "subjects_count": int(row.get("subjects_count") or 0),
            }
        )
    out.sort(key=lambda x: (x["sort_order"], x["name"].lower()))
    return out


def _normalize_catalog_variants(row: dict) -> list[dict]:
    """Katalog variants[] → UI uchun {label, topics[{code, title}]}."""
    out: list[dict] = []
    raw_variants = row.get("variants")
    if not isinstance(raw_variants, list):
        labels = row.get("variant_labels") or []
        if isinstance(labels, list):
            for lab in labels:
                label = str(lab or "").strip()
                if label:
                    out.append({"label": label, "topics": []})
        return out
    for var in raw_variants:
        if not isinstance(var, dict):
            continue
        label = str(var.get("label") or "").strip()
        if not label:
            continue
        topics: list[dict] = []
        for t in var.get("topics") or []:
            if not isinstance(t, dict):
                continue
            tid = str(t.get("id") or "").strip()
            title = str(t.get("title") or tid).strip()
            if not tid:
                continue
            topics.append({"code": tid.lower(), "id": tid, "title": title})
        out.append(
            {
                "label": label,
                "file_name": str(var.get("file_name") or "").strip(),
                "topics": topics,
            }
        )
    return out


def subjects_for_department(department_code: str) -> tuple[dict | None, list[dict]]:
    """Admin UI 2-qadam: kafedra fanlari + variants/topics + e'lon qilingan test soni."""
    code = str(department_code or "").strip()
    if not code or not imentor_configured():
        return None, []
    try:
        dept_meta, catalog_rows = imentor_collect_department_subjects(code)
    except IMentorApiError:
        return None, []

    test_idx = _subject_stats_index()
    dept_tests = 0
    try:
        dept_tests = imentor_published_test_count(subject_code=code, department_code=code)
    except IMentorApiError:
        dept_tests = 0
    out: list[dict] = []
    for row in catalog_rows:
        if not isinstance(row, dict):
            continue
        subj_code = str(row.get("subject_code") or "").strip()
        if not subj_code:
            continue
        stats_row = test_idx.get(subj_code) or test_idx.get(subj_code.lower()) or {}
        syllabus_id = int(row.get("id") or stats_row.get("syllabus_id") or 0) or None
        dept_code = str(row.get("department_code") or dept_meta.get("code") or code).strip()
        variants = _normalize_catalog_variants(row)
        variant_labels = [v["label"] for v in variants]
        if not variant_labels:
            raw_labels = row.get("variant_labels") or []
            if isinstance(raw_labels, list):
                variant_labels = [str(x).strip() for x in raw_labels if str(x).strip()]
        stats_count = int(stats_row.get("test_count") or 0)
        # Per-subject list API faqat stats bo'sh bo'lsa — tezlik uchun.
        api_count = 0
        if stats_count < 1:
            try:
                api_count = imentor_published_test_count(
                    subject_code=subj_code,
                    syllabus_id=syllabus_id,
                    department_code=dept_code,
                )
            except IMentorApiError:
                api_count = 0
        test_count = max(stats_count, api_count, dept_tests if "__" not in subj_code else 0)
        # Katalog fanlari uchun department legacy testlarini ham hisobga olish
        if "__" in subj_code and dept_tests > 0 and stats_count < 1 and api_count < 1:
            test_count = max(test_count, dept_tests)
        out.append(
            {
                "id": syllabus_id or int(row.get("id") or 0),
                "subject_code": subj_code,
                "subject_name": str(row.get("subject_name") or subj_code).strip(),
                "department_code": dept_code,
                "department_name": str(row.get("department_name") or dept_meta.get("name") or "").strip(),
                "instruction_language": str(row.get("instruction_language") or "").strip(),
                "variants_count": int(row.get("variants_count") or len(variants) or 0),
                "topics_count": int(
                    row.get("topics_count")
                    or sum(len(v.get("topics") or []) for v in variants)
                    or 0
                ),
                "variant_labels": variant_labels,
                "variants": variants,
                "syllabus_id": syllabus_id or int(row.get("id") or 0),
                "test_count": test_count,
                "questions_total": int(stats_row.get("questions_total") or 0),
            }
        )
    out.sort(key=lambda x: (x["subject_name"].lower(), x["subject_code"]))
    department = None
    if dept_meta:
        department = {
            "code": str(dept_meta.get("code") or code).strip(),
            "name": str(dept_meta.get("name") or code).strip(),
            "sort_order": int(dept_meta.get("sort_order") or 0),
        }
    elif catalog_rows:
        department = {"code": code, "name": code, "sort_order": 0}
    return department, out


def parse_imentor_selection(raw: Any) -> dict[str, Any]:
    """
    Imtihon konfiguratsiyasi:
      ["code"] yoki [{"subject_code","variant_label","topic_code"}]
    """
    codes: list[str] = []
    variant_label = ""
    topic_code = ""
    if isinstance(raw, dict) and "subject_codes" in raw:
        for c in raw.get("subject_codes") or []:
            token = str(c or "").strip()
            if token:
                codes.append(token)
        variant_label = str(raw.get("variant_label") or "").strip()
        topic_code = str(raw.get("topic_code") or "").strip().lower()
        return {
            "subject_codes": codes,
            "variant_label": variant_label,
            "topic_code": topic_code,
        }
    if not isinstance(raw, list):
        return {"subject_codes": [], "variant_label": "", "topic_code": ""}
    for item in raw:
        if isinstance(item, str):
            token = item.strip()
            if token:
                codes.append(token)
        elif isinstance(item, dict):
            token = str(item.get("subject_code") or "").strip()
            if token:
                codes.append(token)
            if not variant_label:
                variant_label = str(item.get("variant_label") or "").strip()
            if not topic_code:
                topic_code = str(item.get("topic_code") or "").strip().lower()
    return {
        "subject_codes": codes,
        "variant_label": variant_label,
        "topic_code": topic_code,
    }


def dump_imentor_selection(
    subject_codes: list[str],
    *,
    variant_label: str | None = None,
    topic_code: str | None = None,
) -> list:
    """Saqlash uchun JSON-serializable selection."""
    v = str(variant_label or "").strip()
    t = str(topic_code or "").strip().lower()
    if not v and not t:
        return list(subject_codes)
    return [
        {
            "subject_code": code,
            "variant_label": v,
            "topic_code": t,
        }
        for code in subject_codes
        if str(code).strip()
    ]


def subjects_from_stats() -> list[dict]:
    """Eski endpoint: barcha fanlar (katalog + test_count)."""
    if not imentor_configured():
        return []
    registry = _build_subject_registry()
    out = list(registry.values())
    out.sort(key=lambda x: (x.get("department_name", "").lower(), x["subject_name"].lower(), x["subject_code"]))
    return out


def resolve_imentor_subject_codes(subject_codes: list[str]) -> list[str]:
    """Frontend/API dan kelgan kodlarni canonical subject_code ga aylantirish."""
    out: list[str] = []
    seen: set[str] = set()
    for raw in subject_codes:
        token = str(raw or "").strip()
        if not token:
            continue
        ctx = _subject_context(token)
        canonical = str(ctx["subject_code"]).strip()
        if canonical and canonical not in seen:
            seen.add(canonical)
            out.append(canonical)
    if not out:
        raise IMentorApiError("Kamida bitta fan tanlanishi kerak", status=400)
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
    source_language: str | None = None,
    add_translations: bool = True,
    variant_label: str | None = None,
    topic_code: str | None = None,
) -> tuple[list[dict], dict[str, Any]]:
    """
    Tanlangan fanlardan tasodifiy bitta test tanlab savollarni qaytaradi.
    max_questions=0 bo'lsa API detail cheklovsiz (bazadagi barcha savollar).
    max_questions>0 bo'lsa question_limit=10..30 API ga uzatiladi.
    variant_label / topic_code — ixtiyoriy filtrlash (katalog 4–6 qadam).
    """
    bounds = question_limit_bounds()
    question_limit = validate_question_limit_value(int(max_questions or 0), bounds=bounds)
    v_label = str(variant_label or "").strip() or None
    t_code = str(topic_code or "").strip().lower() or None

    try:
        codes = resolve_imentor_subject_codes(subject_codes)
    except IMentorApiError:
        raise

    # Ro'yxat: kamida 10 savolli testlar (API qoidasi). question_limit faqat detail uchun.
    list_min = IMENTOR_QUESTION_LIMIT_MIN
    list_max = IMENTOR_QUESTION_LIMIT_MAX

    pool: list[dict] = []
    for code in codes:
        ctx = _subject_context(code)
        syllabus_id = ctx.get("syllabus_id")
        department_code = str(ctx.get("department_code") or "").strip() or None
        try:
            batch = imentor_collect_tests_for_subject(
                code,
                syllabus_id=syllabus_id,
                department_code=department_code,
                variant_label=v_label,
                topic_code=t_code,
                min_questions=list_min,
                max_questions=list_max,
            )
            if not batch:
                batch = imentor_collect_tests_for_subject(
                    code,
                    syllabus_id=syllabus_id,
                    department_code=department_code,
                    variant_label=v_label,
                    topic_code=t_code,
                    min_questions=None,
                    max_questions=None,
                )
            pool.extend(batch)
        except IMentorApiError:
            continue

    if not pool:
        raise IMentorApiError(
            "Tanlangan fan/yo'nalish/mavzuda e'lon qilingan test topilmadi "
            "(1 soat kutish talabi bo'lishi mumkin)"
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
        "department_code": str(detail.get("department_code") or pick.get("department_code") or ""),
        "department_name": str(detail.get("department_name") or pick.get("department_name") or ""),
        "variant_label": str(detail.get("variant_label") or pick.get("variant_label") or v_label or ""),
        "topic_code": str(detail.get("topic_code") or pick.get("topic_code") or t_code or ""),
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


def validate_imentor_subjects(
    subject_codes: list[str],
    *,
    variant_label: str | None = None,
    topic_code: str | None = None,
) -> tuple[bool, str, int]:
    """Imtihon yaratishda: fanlar mavjudligi va kamida bitta test borligini tekshirish."""
    if not imentor_configured():
        return False, "iMentor API kaliti sozlanmagan (IMENTOR_API_KEY)", 0
    try:
        resolved = resolve_imentor_subject_codes(subject_codes)
    except IMentorApiError as ex:
        return False, str(ex), 0
    v_label = str(variant_label or "").strip() or None
    t_code = str(topic_code or "").strip().lower() or None
    total_tests = 0
    for code in resolved:
        ctx = _subject_context(code)
        department_code = str(ctx.get("department_code") or "").strip() or None
        syllabus_id = ctx.get("syllabus_id")
        total_tests += max(
            0 if (v_label or t_code) else int(ctx.get("test_count") or 0),
            imentor_published_test_count(
                subject_code=code,
                syllabus_id=syllabus_id,
                department_code=department_code,
                variant_label=v_label,
                topic_code=t_code,
            ),
        )
    if total_tests < 1:
        return False, "Tanlangan fan/yo'nalish/mavzuda e'lon qilingan test yo'q (yangi testlar 1 soatdan keyin)", 0
    return True, "", total_tests
