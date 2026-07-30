"""E2E: admin imtihon yaratadi -> talaba topshiradi -> natijada API izohi va MANBA bormi.

Faqat HTTP API orqali ishlaydi (ichki funksiyalar chaqirilmaydi), shuning uchun
haqiqiy talaba oqimini tekshiradi: savol generatsiyasi, javob sizib chiqmasligi,
baholash, izoh manbasi va manbalar (references) natija sahifasigacha yetishi.

Ishga tushirish (stack ko'tarilgan bo'lsin):
    docker compose up -d
    python3 scripts/e2e_exam_flow.py                  # http://127.0.0.1:8080
    E2E_BASE_URL=http://127.0.0.1:8099 python3 scripts/e2e_exam_flow.py

Eslatma: iMentor testlarining bir qismida `references` umuman yo'q — skript
manbali testga tushgunicha bir necha imtihon yaratib ko'radi.
"""
import os
import json
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("E2E_BASE_URL", "http://127.0.0.1:8080").rstrip("/")
ADMIN = ("demo_admin", "DemoFJSTI2026!")
STUDENT = ("demo_student", "DemoFJSTI2026!")

FAILS: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> bool:
    mark = "OK  " if cond else "XATO"
    print(f"  [{mark}] {name}" + (f" — {detail}" if detail else ""))
    if not cond:
        FAILS.append(name)
    return cond


def call(method, path, token=None, body=None, headers=None):
    url = f"{BASE}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.status, json.loads(raw)
        except Exception:
            return e.status, {"raw": raw[:400]}


def login(user, pw):
    st, d = call("POST", "/api/auth/login", body={"id": user, "password": pw})
    if st != 200 or not d or not d.get("token"):
        print(f"  login yiqildi ({user}): {st} {d}")
        sys.exit(1)
    return d["token"], d.get("user") or {}


print("1) Kirish")
admin_tok, admin_u = login(*ADMIN)
stud_tok, stud_u = login(*STUDENT)
check("admin va talaba kirdi", bool(admin_tok and stud_tok), f"talaba={stud_u.get('id')}")
group_id = stud_u.get("group_id")
check("talabaning guruhi bor", bool(group_id), f"group_id={group_id}")

print("\n2) iMentor fanlari")
st, subs = call("GET", "/api/admin/imentor/subjects", admin_tok)
if st != 200 or not subs:
    st, subs = call("GET", "/api/admin/imentor/subjects/", admin_tok)
rows = subs.get("subjects") if isinstance(subs, dict) else subs
check("fanlar ro'yxati olindi", bool(rows), f"status={st} n={len(rows or [])}")
if not rows:
    print("  javob:", json.dumps(subs, ensure_ascii=False)[:400])
    sys.exit(1)
subject_code = (rows[0] or {}).get("subject_code") or (rows[0] or {}).get("code")
print(f"  tanlandi: {subject_code}")

print("\n3) Imtihon yaratish (imentor_mixed)")
from datetime import datetime, timedelta, timezone

now = datetime.now(timezone.utc)
payload = {
    "title": f"E2E manba testi {int(now.timestamp())}",
    "start_time": (now - timedelta(minutes=5)).isoformat(),
    "end_time": (now + timedelta(hours=3)).isoformat(),
    "duration_minutes": 60,
    "exam_mode": "imentor_mixed",
    "language": "uz",
    "imentor_subject_codes": [subject_code],
    "bank_question_count": 10,
    "group_ids": [group_id],
}
# iMentor testlarining bir qismida `references` umuman yo'q (yangi testlar).
# Quvurni isbotlash uchun manbali testga tushgunimizcha imtihon yaratamiz.
exam_id = None
stored = []
for attempt in range(1, 8):
    payload["title"] = f"E2E manba testi {int(now.timestamp())}-{attempt}"
    st, created = call("POST", "/api/admin/exams", admin_tok, payload)
    if st not in (200, 201):
        print(f"  yaratish yiqildi: {st} {json.dumps(created, ensure_ascii=False)[:400]}")
        sys.exit(1)
    eid = created.get("id") or (created.get("exam") or {}).get("id")
    st, detail = call("GET", f"/api/admin/exams/{eid}", admin_tok)
    qs_raw = (detail or {}).get("questions_json") or "[]"
    qlist = json.loads(qs_raw) if isinstance(qs_raw, str) else (qs_raw or [])
    refs = sum(1 for q in qlist if q.get("references"))
    print(f"  urinish {attempt}: exam_id={eid} savol={len(qlist)} manbali={refs}")
    exam_id, stored = eid, qlist
    if refs:
        break

check("imtihon yaratildi", bool(exam_id), f"exam_id={exam_id}")
check(
    "savollar YARATISHDA saqlandi (har talabaga jonli so'rov ketmasin)",
    len(stored) > 0,
    f"saqlangan={len(stored)}",
)
with_refs = sum(1 for q in stored if q.get("references"))
with_expl = sum(1 for q in stored if q.get("explanation"))
check("saqlangan savollarda API izohi bor", with_expl > 0, f"{with_expl}/{len(stored)}")
check("saqlangan savollarda MANBA bor", with_refs > 0, f"{with_refs}/{len(stored)}")

print("\n4) Talaba imtihonni boshlaydi")
DEV_FP = "e2e-device-fingerprint-0001"
st, started = call("POST", f"/api/student/exams/{exam_id}/start", stud_tok, {"pin": ""},
                   headers={"X-Device-Fingerprint": DEV_FP, "X-Student-Lang": "uz"})
if st != 200:
    print(f"  start yiqildi: {st} {json.dumps(started, ensure_ascii=False)[:500]}")
    sys.exit(1)
DEV_TOKEN = started.get("deviceToken") or ""
SESS = {"X-Device-Fingerprint": DEV_FP}
if DEV_TOKEN:
    SESS["X-Device-Session-Token"] = DEV_TOKEN
exam_obj = started.get("exam") or {}
questions = exam_obj.get("questions") or []
check("savollar berildi", len(questions) > 0, f"n={len(questions)}")

leaked = [k for k in (questions[0] or {}) if k in ("correctAnswer", "explanation", "references", "optionExplanations")]
check("javob/izoh/manba talabaga SIZIB CHIQMAYDI", not leaked, f"sizgan={leaked or 'yo`q'}")

print("\n5) Javoblar va topshirish")
answers = {str(q["id"]): (q.get("options") or ["?"])[0] for q in questions}
st, result = call(
    "POST", f"/api/student/exams/{exam_id}/submit", stud_tok,
    {"answers": answers, "flaggedQuestions": []},
    headers={"X-Student-Lang": "uz", **SESS},
)
if st != 200:
    print(f"  submit yiqildi: {st} {json.dumps(result, ensure_ascii=False)[:500]}")
    sys.exit(1)
check("topshirildi", bool(result.get("result_public_id")),
      f"ball={result.get('score')}/{result.get('total')}")
check("tahlil manbasi API", result.get("ai_summary_source") == "api",
      f"source={result.get('ai_summary_source')}")

per_q = result.get("questions") or []
api_items = sum(1 for q in per_q if q.get("explanationSource") == "api")
ref_items = sum(1 for q in per_q if q.get("references"))
check("submit javobida API izohli savollar bor", api_items > 0, f"{api_items}/{len(per_q)}")
check("submit javobida MANBALAR bor", ref_items > 0, f"{ref_items}/{len(per_q)}")

print("\n6) Natija sahifasi (talaba qayta ochganda)")
st, results = call("GET", "/api/student/results", stud_tok)
row = None
if isinstance(results, list):
    row = next((r for r in results if r.get("exam_id") == exam_id), None)
check("natijalar ro'yxatida bor", bool(row), f"status={st}")

rid = result.get("result_public_id")
st, detail_res = call("GET", f"/api/student/results/{rid}", stud_tok)
if st != 200:
    st, detail_res = call("GET", f"/api/student/results/{exam_id}", stud_tok)
dq = (detail_res or {}).get("questions") or []
if dq:
    dref = sum(1 for q in dq if q.get("references"))
    check("natija sahifasida MANBALAR bor", dref > 0, f"{dref}/{len(dq)}")

print("\n7) Ochiq tekshiruv sahifasi (QR)")
k = result.get("verify_secret")
st, pub = call("GET", f"/api/public/verify-result/{rid}?k={k}")
pq = (pub or {}).get("questions") or []
if pq:
    pref = sum(1 for q in pq if q.get("references"))
    check("ochiq sahifada MANBALAR bor", pref > 0, f"{pref}/{len(pq)}")
else:
    check("ochiq sahifa ochildi", st == 200, f"status={st}")

print("\n8) Namuna — talaba ko'radigan manba")
sample = next((q for q in per_q if q.get("references")), None)
if sample:
    print(f"   Savol: {str(sample.get('text'))[:70]}...")
    print(f"   Izoh:  {str(sample.get('whyCorrectIsRight') or sample.get('commentCorrect'))[:90]}")
    for i, r in enumerate(sample["references"], 1):
        print(f"     [{i}] {r.get('title')}")
        print(f"         {r.get('publisher','')} · {r.get('year','')} · {r.get('url','')[:60]}")
else:
    print("   (manbali savol topilmadi)")

print("\n" + "=" * 60)
if FAILS:
    print(f"YIQILGAN TEKSHIRUVLAR ({len(FAILS)}):")
    for f in FAILS:
        print("  -", f)
    sys.exit(1)
print("BARCHA E2E TEKSHIRUVLAR O'TDI")
