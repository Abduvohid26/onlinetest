"""E2E: imtihon sozlamalari — PIN yo'q, profil default, vaqt mantiqi, ovoz toggle.

Ishga tushirish (stack ko'tarilgan bo'lsin):
    python3 scripts/e2e_exam_settings.py
    E2E_BASE_URL=http://127.0.0.1:8099 python3 scripts/e2e_exam_settings.py
"""
import os
import json, sys, urllib.error, urllib.request
from datetime import datetime, timedelta, timezone

BASE = os.environ.get("E2E_BASE_URL", "http://127.0.0.1:8080").rstrip("/")
FAILS = []

def check(name, cond, detail=""):
    print(f"  [{'OK  ' if cond else 'XATO'}] {name}" + (f" — {detail}" if detail else ""))
    if not cond: FAILS.append(name)

def call(method, path, token=None, body=None, headers=None):
    req = urllib.request.Request(f"{BASE}{path}",
        data=json.dumps(body).encode() if body is not None else None, method=method)
    req.add_header("Content-Type", "application/json")
    if token: req.add_header("Authorization", f"Bearer {token}")
    for k, v in (headers or {}).items(): req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            raw = r.read().decode(); return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try: return e.status, json.loads(raw)
        except Exception: return e.status, {"raw": raw[:300]}

def login(u, p):
    st, d = call("POST", "/api/auth/login", body={"id": u, "password": p})
    if st != 200: print("login yiqildi", st, d); sys.exit(1)
    return d["token"], d.get("user") or {}

admin_tok, _ = login("demo_admin", "DemoFJSTI2026!")
stud_tok, stud = login("demo_student", "DemoFJSTI2026!")
gid = stud.get("group_id")
now = datetime.now(timezone.utc)

st, subs = call("GET", "/api/admin/imentor/subjects", admin_tok)
rows = subs.get("subjects") if isinstance(subs, dict) else subs
subject = (rows[0] or {}).get("subject_code")

def payload(**over):
    p = {
        "title": f"4ish {int(now.timestamp())}",
        "start_time": (now - timedelta(minutes=5)).isoformat(),
        "end_time": (now + timedelta(hours=3)).isoformat(),
        "duration_minutes": 60,
        "exam_mode": "imentor_mixed", "language": "uz",
        "imentor_subject_codes": [subject], "bank_question_count": 10,
        "group_ids": [gid],
    }
    p.update(over); return p

print("\n1) PIN olib tashlandi")
st, created = call("POST", "/api/admin/exams", admin_tok, payload())
exam_id = created.get("id") if st in (200, 201) else None
check("PIN'siz imtihon yaratildi", bool(exam_id), f"status={st}")
st, detail = call("GET", f"/api/admin/exams/{exam_id}", admin_tok)
check("detail javobida 'pin' maydoni yo'q", "pin" not in (detail or {}), str(list((detail or {}).keys())[:6]))

st, lst = call("GET", "/api/student/exams", stud_tok)
row = next((r for r in (lst or []) if r.get("id") == exam_id), None)
check("talaba ro'yxatida 'has_pin' yo'q", row is not None and "has_pin" not in row)

st, _ = call("POST", f"/api/student/exams/{exam_id}/verify-pin", stud_tok, {"pin": "1"})
check("verify-pin endpointi o'chirilgan", st == 404, f"status={st}")

print("\n2) Qoidalar profili — har doim standart")
check("profil standart", (detail or {}).get("proctor_profile") == "standard",
      str((detail or {}).get("proctor_profile")))
st, _ = call("PATCH", f"/api/admin/exams/{exam_id}", admin_tok,
             {**payload(), "proctor_profile": "strict"})
st, d2 = call("GET", f"/api/admin/exams/{exam_id}", admin_tok)
check("'strict' yuborilsa ham standart qoladi", d2.get("proctor_profile") == "standard",
      str(d2.get("proctor_profile")))

print("\n3) Vaqt mantiqi")
st, r = call("POST", "/api/admin/exams", admin_tok,
             payload(start_time=(now + timedelta(hours=2)).isoformat(),
                     end_time=(now + timedelta(hours=1)).isoformat()))
check("yaratish: tugash < boshlanish rad etiladi", st == 400, f"status={st}")

st, r = call("POST", "/api/admin/exams", admin_tok, payload(duration_minutes=600))
check("yaratish: davomiylik > oyna rad etiladi", st == 400, f"status={st}")

st, r = call("POST", "/api/admin/exams", admin_tok, payload(duration_minutes=0))
check("yaratish: davomiylik 0 rad etiladi", st == 400, f"status={st}")

st, r = call("PATCH", f"/api/admin/exams/{exam_id}", admin_tok,
             {**payload(), "end_time": (now - timedelta(hours=1)).isoformat()})
check("TAHRIRLASH: tugash < boshlanish rad etiladi", st == 400, f"status={st}")

st, r = call("PATCH", f"/api/admin/exams/{exam_id}", admin_tok,
             {**payload(), "duration_minutes": 600})
check("TAHRIRLASH: davomiylik > oyna rad etiladi", st == 400, f"status={st}")

print("\n4) Tashqi ovoz sozlamasi")
check("default YOQILGAN", (detail or {}).get("ambient_audio_enabled") is True,
      str((detail or {}).get("ambient_audio_enabled")))

st, off = call("POST", "/api/admin/exams", admin_tok,
               payload(ambient_audio_enabled=False, title=f"ovozsiz {int(now.timestamp())}"))
off_id = off.get("id")
st, d3 = call("GET", f"/api/admin/exams/{off_id}", admin_tok)
check("o'chirib yaratish ishlaydi", d3.get("ambient_audio_enabled") is False,
      str(d3.get("ambient_audio_enabled")))

st, _ = call("PATCH", f"/api/admin/exams/{off_id}", admin_tok,
             {**payload(), "ambient_audio_enabled": True})
st, d4 = call("GET", f"/api/admin/exams/{off_id}", admin_tok)
check("tahrirlab qayta yoqish ishlaydi", d4.get("ambient_audio_enabled") is True)

print("\n5) Talaba oqimi (PIN'siz start)")
# ALOHIDA imtihon: yuqorida off_id qayta YOQILGAN edi, shu sabab yangisini
# ovozi o'chirilgan holda yaratamiz.
st, fresh = call("POST", "/api/admin/exams", admin_tok,
                 payload(ambient_audio_enabled=False, title=f"student oqimi {int(now.timestamp())}"))
fresh_id = fresh.get("id")
DEV = {"X-Device-Fingerprint": "e2e-4tasks-dev"}
st, started = call("POST", f"/api/student/exams/{fresh_id}/start", stud_tok, {},
                   headers={**DEV, "X-Student-Lang": "uz"})
check("PIN yubormasdan start ishlaydi", st == 200, f"status={st} {str(started)[:120]}")
if st == 200:
    ex = started.get("exam") or {}
    check("start javobida 'pin' yo'q", "pin" not in ex and "has_pin" not in ex)
    check("ovoz sozlamasi talabaga uzatiladi",
          ex.get("ambient_audio_enabled") is False, str(ex.get("ambient_audio_enabled")))
    check("submission_deadline berilgan", bool(ex.get("submission_deadline")))

print("\n" + "=" * 56)
if FAILS:
    print(f"YIQILGAN ({len(FAILS)}):"); [print("  -", f) for f in FAILS]; sys.exit(1)
print("BARCHA TEKSHIRUVLAR O'TDI")
