"""iMentor tashqi test bazasi HTTP klienti (X-Api-Key)."""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


class IMentorApiError(Exception):
    def __init__(self, message: str, *, status: int | None = None):
        super().__init__(message)
        self.status = status


IMENTOR_QUESTION_LIMIT_MIN = 10
IMENTOR_QUESTION_LIMIT_MAX = 30
DEFAULT_QUESTION_LIMIT_BOUNDS = {"min": IMENTOR_QUESTION_LIMIT_MIN, "max": IMENTOR_QUESTION_LIMIT_MAX}


def parse_question_limit_bounds(data: dict | None) -> dict[str, int]:
    raw = (data or {}).get("question_limit_bounds")
    if not isinstance(raw, dict):
        return dict(DEFAULT_QUESTION_LIMIT_BOUNDS)
    try:
        lo = int(raw.get("min", IMENTOR_QUESTION_LIMIT_MIN))
        hi = int(raw.get("max", IMENTOR_QUESTION_LIMIT_MAX))
    except (TypeError, ValueError):
        return dict(DEFAULT_QUESTION_LIMIT_BOUNDS)
    if lo > hi:
        lo, hi = hi, lo
    return {"min": lo, "max": hi}


def validate_question_limit_value(value: int, *, bounds: dict[str, int] | None = None) -> int:
    """10–30 oralig'ida question_limit; 0 = cheklovsiz (bazadagi barcha savollar)."""
    b = bounds or DEFAULT_QUESTION_LIMIT_BOUNDS
    lo, hi = int(b["min"]), int(b["max"])
    if value == 0:
        return 0
    if value < lo or value > hi:
        raise IMentorApiError(
            f"question_limit {lo} dan {hi} gacha bo'lishi kerak.",
            status=400,
        )
    return value


def imentor_base_url() -> str:
    return (os.environ.get("IMENTOR_API_BASE_URL") or "https://imentor.devflix.uz/api").rstrip("/")


def imentor_api_key() -> str:
    return (os.environ.get("IMENTOR_API_KEY") or "").strip()


def imentor_configured() -> bool:
    return bool(imentor_api_key())


def imentor_request(path: str, *, params: dict[str, Any] | None = None, timeout: int = 30) -> Any:
    key = imentor_api_key()
    if not key:
        raise IMentorApiError("IMENTOR_API_KEY sozlanmagan", status=403)

    base = imentor_base_url()
    url = f"{base}/{path.lstrip('/')}"
    if params:
        q = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None and v != ""})
        if q:
            url = f"{url}?{q}"

    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "X-Api-Key": key,
            "User-Agent": "FJSTI-OnlineTest/1.0",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as ex:
        detail = ""
        try:
            detail = ex.read().decode("utf-8", errors="replace")[:500]
        except Exception:
            pass
        raise IMentorApiError(
            f"iMentor API {ex.code}: {detail or ex.reason}",
            status=ex.code,
        ) from ex
    except urllib.error.URLError as ex:
        raise IMentorApiError(f"iMentor ulanish xatosi: {ex.reason}") from ex


def imentor_stats() -> dict:
    data = imentor_request("/v1/external/tests/stats/")
    return data if isinstance(data, dict) else {}


def imentor_catalog_stats() -> dict:
    data = imentor_request("/v1/external/catalog/stats/")
    return data if isinstance(data, dict) else {}


def imentor_catalog_departments() -> dict:
    data = imentor_request("/v1/external/catalog/departments/")
    return data if isinstance(data, dict) else {"count": 0, "results": []}


def imentor_catalog_department_subjects(
    department_code: str,
    *,
    page: int = 1,
    page_size: int = 200,
) -> dict:
    code = urllib.parse.quote(str(department_code or "").strip(), safe="")
    data = imentor_request(
        f"/v1/external/catalog/departments/{code}/subjects/",
        params={"page": page, "page_size": min(200, max(1, page_size))},
    )
    return data if isinstance(data, dict) else {"count": 0, "results": []}


def imentor_collect_department_subjects(department_code: str, *, max_pages: int = 10) -> tuple[dict, list[dict]]:
    """Kafedra fanlari (sahifalab) + department meta."""
    dept_meta: dict = {}
    out: list[dict] = []
    page = 1
    while page <= max_pages:
        data = imentor_catalog_department_subjects(department_code, page=page, page_size=200)
        if isinstance(data.get("department"), dict):
            dept_meta = data["department"]
        batch = data.get("results") or []
        if not isinstance(batch, list) or not batch:
            break
        out.extend([b for b in batch if isinstance(b, dict)])
        count = int(data.get("count") or 0)
        page_size = int(data.get("page_size") or 200)
        if len(out) >= count or len(batch) < page_size:
            break
        page += 1
    return dept_meta, out


def imentor_list_tests(
    *,
    subject_code: str | None = None,
    syllabus_id: int | None = None,
    department_code: str | None = None,
    page: int = 1,
    page_size: int = 50,
    min_questions: int | None = None,
    max_questions: int | None = None,
) -> dict:
    params: dict[str, Any] = {"page": page, "page_size": min(200, max(1, page_size))}
    if subject_code:
        params["subject_code"] = subject_code
    if syllabus_id is not None and int(syllabus_id) > 0:
        params["syllabus_id"] = int(syllabus_id)
    if department_code:
        params["department_code"] = department_code
    if min_questions is not None:
        params["min_questions"] = int(min_questions)
    if max_questions is not None:
        params["max_questions"] = int(max_questions)
    data = imentor_request("/v1/external/tests/", params=params)
    return data if isinstance(data, dict) else {"count": 0, "results": []}


def imentor_published_test_count(
    *,
    subject_code: str | None = None,
    syllabus_id: int | None = None,
    department_code: str | None = None,
) -> int:
    """E'lon qilingan testlar soni (savol chegarasisiz — faqat count)."""
    best = 0
    queries: list[dict[str, Any]] = []
    if subject_code:
        queries.append({"subject_code": subject_code})
    if syllabus_id:
        queries.append({"syllabus_id": syllabus_id})
    if department_code:
        queries.append({"department_code": department_code})
        queries.append({"subject_code": department_code})
    if not queries:
        return _imentor_global_published_count()
    for kwargs in queries:
        try:
            data = imentor_list_tests(**kwargs, page=1, page_size=1)
            best = max(best, int(data.get("count") or 0))
        except IMentorApiError:
            continue
    return best


def _imentor_global_published_count() -> int:
    """Jami e'lon qilingan testlar (admin banner uchun — filterisiz)."""
    try:
        data = imentor_list_tests(page=1, page_size=1)
        n = int(data.get("count") or 0)
        if n > 0:
            return n
    except IMentorApiError:
        pass
    for loader in (imentor_stats, imentor_catalog_stats):
        try:
            stats = loader()
        except IMentorApiError:
            continue
        if not isinstance(stats, dict):
            continue
        for key in (
            "published_tests",
            "published_count",
            "tests_published",
            "total_published",
            "test_count",
            "total_tests",
            "count",
        ):
            try:
                n = int(stats.get(key) or 0)
            except (TypeError, ValueError):
                n = 0
            if n > 0:
                return n
        rows = stats.get("by_subject") or []
        if isinstance(rows, list):
            total = 0
            for row in rows:
                if not isinstance(row, dict):
                    continue
                try:
                    total += int(row.get("test_count") or 0)
                except (TypeError, ValueError):
                    continue
            if total > 0:
                return total
    return 0


def imentor_collect_tests_for_subject(
    subject_code: str,
    *,
    syllabus_id: int | None = None,
    department_code: str | None = None,
    max_pages: int = 10,
    min_questions: int | None = IMENTOR_QUESTION_LIMIT_MIN,
    max_questions: int | None = None,
) -> list[dict]:
    """Fan bo'yicha e'lon qilingan testlar (subject_code va/yoki syllabus_id)."""
    seen: set[int] = set()
    out: list[dict] = []

    def collect(**list_kwargs: Any) -> None:
        nonlocal out
        page = 1
        while page <= max_pages:
            data = imentor_list_tests(
                page=page,
                page_size=200,
                min_questions=min_questions,
                max_questions=max_questions,
                **list_kwargs,
            )
            batch = data.get("results") or []
            if not isinstance(batch, list) or not batch:
                break
            for row in batch:
                if not isinstance(row, dict):
                    continue
                tid = int(row.get("id") or 0)
                if tid and tid not in seen:
                    seen.add(tid)
                    out.append(row)
            count = int(data.get("count") or 0)
            page_size = int(data.get("page_size") or 200)
            if len(seen) >= count or len(batch) < page_size:
                break
            page += 1

    code = str(subject_code or "").strip()
    dept = str(department_code or "").strip()
    # Avval kafedra (legacy testlar ko'pincha shu yerda), keyin katalog fan kodi.
    if dept:
        collect(department_code=dept)
        if dept != code:
            collect(subject_code=dept)
    if code:
        collect(subject_code=code)
    sid = int(syllabus_id) if syllabus_id else 0
    if sid > 0:
        collect(syllabus_id=sid)
    return out


def imentor_get_test(test_id: int, *, question_limit: int | None = None) -> dict:
    params: dict[str, Any] | None = None
    if question_limit is not None and int(question_limit) > 0:
        params = {"question_limit": int(question_limit)}
    data = imentor_request(f"/v1/external/tests/{int(test_id)}/", params=params)
    return data if isinstance(data, dict) else {}
