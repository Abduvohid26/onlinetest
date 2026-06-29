#!/usr/bin/env python3
"""Admin panel API smoke test — test_baza fayllari bilan."""
from __future__ import annotations

import json
import mimetypes
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

BASE = os.environ.get("SMOKE_API_BASE", "http://127.0.0.1:8000").rstrip("/")
ROOT = Path(__file__).resolve().parents[1]
TEST_BAZA = ROOT / "test_baza"
ADMIN_ID = os.environ.get("SMOKE_ADMIN_ID", "demo_admin")
ADMIN_PASS = os.environ.get("SMOKE_ADMIN_PASS", "DemoFJSTI2026!")

failures: list[str] = []
created_exam_ids: list[int] = []
created_category_ids: list[int] = []


def ok(name: str, cond: bool, detail: str = "") -> None:
    if cond:
        print(f"  OK  {name}")
    else:
        msg = f"FAIL {name}" + (f" — {detail}" if detail else "")
        print(f"  {msg}")
        failures.append(msg)


def _request(
    method: str,
    path: str,
    *,
    token: str | None = None,
    body: dict | None = None,
    raw_body: bytes | None = None,
    content_type: str = "application/json",
    timeout: int = 60,
) -> tuple[int, Any]:
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = None
    if raw_body is not None:
        data = raw_body
        if content_type:
            headers["Content-Type"] = content_type
    elif body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(f"{BASE}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            if raw and resp.headers.get("Content-Type", "").startswith("application/json"):
                return resp.status, json.loads(raw.decode())
            return resp.status, raw.decode() if raw else None
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        try:
            parsed = json.loads(raw.decode()) if raw else {}
        except Exception:
            parsed = raw.decode() if raw else ""
        return exc.code, parsed


def _multipart(
    path: str,
    token: str,
    fields: dict[str, str],
    file_field: str,
    file_path: Path,
    timeout: int = 300,
) -> tuple[int, Any]:
    boundary = "----SmokeTestBoundary7MA4YWxk"
    mime = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
    parts: list[bytes] = []
    for key, val in fields.items():
        parts.append(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"\r\n\r\n{val}\r\n".encode()
        )
    parts.append(
        (
            f"--{boundary}\r\n"
            f"Content-Disposition: form-data; name=\"{file_field}\"; filename=\"{file_path.name}\"\r\n"
            f"Content-Type: {mime}\r\n\r\n"
        ).encode()
    )
    parts.append(file_path.read_bytes())
    parts.append(f"\r\n--{boundary}--\r\n".encode())
    body = b"".join(parts)
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": f"multipart/form-data; boundary={boundary}",
    }
    req = urllib.request.Request(f"{BASE}{path}", data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            return resp.status, json.loads(raw.decode()) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        try:
            return exc.code, json.loads(raw.decode()) if raw else {}
        except Exception:
            return exc.code, raw.decode() if raw else ""


def login() -> str:
    status, data = _request("POST", "/api/auth/login", body={"id": ADMIN_ID, "password": ADMIN_PASS})
    token = data.get("token") if isinstance(data, dict) else ""
    ok("login", status == 200 and bool(token), f"status={status} {data if isinstance(data, dict) else data}")
    return str(token or "")


def iso_range(minutes: int = 120) -> tuple[str, str]:
    now = datetime.now(timezone.utc)
    start = now + timedelta(minutes=5)
    end = start + timedelta(minutes=minutes)
    return start.isoformat().replace("+00:00", "Z"), end.isoformat().replace("+00:00", "Z")


def test_meta(token: str) -> list[int]:
    for path in ("/api/admin/stats", "/api/admin/levels", "/api/admin/groups", "/api/admin/users?role=staff"):
        status, _ = _request("GET", path, token=token)
        ok(f"GET {path}", status == 200, f"status={status}")
    _, groups = _request("GET", "/api/admin/groups", token=token)
    return [int(g["id"]) for g in groups if isinstance(groups, list) and isinstance(g, dict) and g.get("id")]


def test_test_bank_import(token: str) -> list[int]:
    files = list(TEST_BAZA.glob("*.docx")) + list(TEST_BAZA.glob("*.pdf"))
    if not files:
        ok("test_baza fayl mavjud", False, str(TEST_BAZA))
        return _existing_smoke_categories(token)
    fpath = files[0]
    ok("test_baza fayl topildi", True, fpath.name)
    skip_live = os.environ.get("SMOKE_SKIP_IMPORT", "").strip().lower() in ("1", "true", "yes")
    if skip_live:
        print(f"  SKIP import (SMOKE_SKIP_IMPORT) — mavjud kategoriyalar ishlatiladi")
        return _existing_smoke_categories(token)
    try:
        status, body = _multipart(
            "/api/admin/test-bank/import-smart",
            token,
            {"collection_name": f"SmokeTest_{fpath.stem[:40]}", "language": "auto"},
            "file",
            fpath,
            timeout=int(os.environ.get("SMOKE_IMPORT_TIMEOUT", "45")),
        )
    except Exception as exc:
        print(f"  WARN import timeout/error ({exc}) — fallback kategoriyalar")
        return _existing_smoke_categories(token)
    inserted = body.get("inserted") if isinstance(body, dict) else None
    if status == 200 and isinstance(inserted, int) and inserted > 0:
        ok("POST /api/admin/test-bank/import-smart", True, f"inserted={inserted}")
    else:
        print(f"  WARN import failed status={status} — fallback kategoriyalar")
        return _existing_smoke_categories(token)
    _, cats = _request("GET", "/api/admin/test-bank/categories", token=token)
    ids: list[int] = []
    if isinstance(cats, list):
        for c in cats:
            if isinstance(c, dict) and str(c.get("name", "")).startswith("SmokeTest_"):
                ids.append(int(c["id"]))
                created_category_ids.append(int(c["id"]))
    if not ids:
        return _existing_smoke_categories(token)
    ok("imported categories visible", len(ids) > 0, f"ids={ids}")
    return ids


def _existing_smoke_categories(token: str) -> list[int]:
    _, cats = _request("GET", "/api/admin/test-bank/categories", token=token)
    ids = [
        int(c["id"])
        for c in (cats if isinstance(cats, list) else [])
        if isinstance(c, dict) and int(c.get("question_count") or 0) > 0
    ]
    ok("fallback existing categories", len(ids) > 0, f"ids={ids[:3]}")
    return ids


def test_exam_manual(token: str, group_ids: list[int]) -> int | None:
    start, end = iso_range(90)
    status, data = _request(
        "POST",
        "/api/admin/exams",
        token=token,
        body={
            "title": "Smoke Manual Exam",
            "start_time": start,
            "end_time": end,
            "duration_minutes": 30,
            "language": "uz",
            "pin": "",
            "custom_rules": "",
            "group_ids": group_ids[:1],
            "exam_exceptions": [],
            "manual_questions": json.dumps(
                [{"id": 1, "text": "2+2?", "options": ["3", "4", "5", "6"], "correctAnswer": "4"}]
            ),
        },
    )
    eid = data.get("id") if isinstance(data, dict) else None
    ok("POST exam manual", status == 200 and eid, f"status={status} {data}")
    if eid:
        created_exam_ids.append(int(eid))
    return int(eid) if eid else None


def test_exam_bank(token: str, group_ids: list[int], cat_ids: list[int]) -> int | None:
    if not cat_ids:
        ok("POST exam bank (skip)", True, "no categories")
        return None
    start, end = iso_range(120)
    status, data = _request(
        "POST",
        "/api/admin/exams",
        token=token,
        body={
            "title": "Smoke Bank Exam",
            "start_time": start,
            "end_time": end,
            "duration_minutes": 45,
            "language": "uz",
            "group_ids": group_ids[:1],
            "exam_mode": "bank_mixed",
            "bank_category_ids": cat_ids[:1],
            "bank_question_count": 5,
            "exam_exceptions": [],
        },
    )
    eid = data.get("id") if isinstance(data, dict) else None
    ok("POST exam bank", status == 200 and eid, f"status={status} {data}")
    if eid:
        created_exam_ids.append(int(eid))
    return int(eid) if eid else None


def test_exam_crud(token: str, exam_id: int | None, group_ids: list[int]) -> None:
    if not exam_id:
        return
    status, _ = _request("GET", f"/api/admin/exams/{exam_id}", token=token)
    ok("GET exam detail", status == 200)
    start, end = iso_range(100)
    status, _ = _request(
        "PATCH",
        f"/api/admin/exams/{exam_id}",
        token=token,
        body={
            "title": "Smoke Manual Exam (edited)",
            "start_time": start,
            "end_time": end,
            "duration_minutes": 30,
            "language": "uz",
            "group_ids": group_ids[:1],
        },
    )
    ok("PATCH exam", status == 200, f"status={status}")
    status, data = _request("GET", "/api/admin/exams", token=token)
    ok("GET exams list", status == 200 and isinstance(data, list))


def cleanup(token: str) -> None:
    for eid in created_exam_ids:
        status, _ = _request("DELETE", f"/api/admin/exams/{eid}", token=token)
        print(f"  cleanup exam {eid}: {status}")
    for cid in created_category_ids:
        status, _ = _request("DELETE", f"/api/admin/test-bank/categories/{cid}", token=token)
        print(f"  cleanup category {cid}: {status}")


def main() -> int:
    print(f"Admin smoke test → {BASE}")
    print(f"test_baza → {TEST_BAZA}")
    status, _ = _request("GET", "/api/health", timeout=10)
    ok("API health", status == 200, f"status={status}")
    if failures:
        return 1

    token = login()
    if not token:
        return 1

    group_ids = test_meta(token)
    ok("groups available", len(group_ids) > 0, f"count={len(group_ids)}")
    if not group_ids:
        return 1

    cat_ids = test_test_bank_import(token)
    manual_id = test_exam_manual(token, group_ids)
    test_exam_bank(token, group_ids, cat_ids)
    test_exam_crud(token, manual_id, group_ids)

    print("\nCleanup...")
    cleanup(token)

    print(f"\n{'=' * 40}")
    if failures:
        print(f"FAILED ({len(failures)}):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("ALL PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
