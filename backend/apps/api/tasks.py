"""Background AI tasklari (Celery).

Broker yo'q bo'lsa settings.CELERY_TASK_ALWAYS_EAGER=True — bu yerdagi task'lar
web jarayonida sync ishlaydi (eski xulq). Worker bor bo'lsa, AI chaqiruvlari web
worker thread'larini band qilmaydi.

Task'lar SOF (pure) bo'lishi kerak: faqat AI hisob-kitobi, DB yozuv yo'q.
Auth/validatsiya/DB ishlari view ichida qoladi.
"""
from __future__ import annotations

import os

from celery import shared_task

# Object nomi (Vision) -> violation turi. _helpers'dagi xarita bilan bir xil.
_FORBIDDEN_OBJECT_MAP = {
    "cell_phone": "FORBIDDEN_OBJECT_CELL_PHONE",
    "cellphone": "FORBIDDEN_OBJECT_CELL_PHONE",
    "phone": "FORBIDDEN_OBJECT_CELL_PHONE",
    "mobile": "FORBIDDEN_OBJECT_CELL_PHONE",
    "smartphone": "FORBIDDEN_OBJECT_CELL_PHONE",
    "tablet": "FORBIDDEN_OBJECT_CELL_PHONE",
    "iphone": "FORBIDDEN_OBJECT_CELL_PHONE",
    "android": "FORBIDDEN_OBJECT_CELL_PHONE",
    "laptop": "FORBIDDEN_OBJECT_LAPTOP",
    "computer": "FORBIDDEN_OBJECT_LAPTOP",
    "notebook_computer": "FORBIDDEN_OBJECT_LAPTOP",
    "book": "FORBIDDEN_OBJECT_BOOK",
    "notes": "FORBIDDEN_OBJECT_BOOK",
    "notebook": "FORBIDDEN_OBJECT_BOOK",
    "paper": "FORBIDDEN_OBJECT_BOOK",
    "notepad": "FORBIDDEN_OBJECT_BOOK",
    "copybook": "FORBIDDEN_OBJECT_BOOK",
    "textbook": "FORBIDDEN_OBJECT_BOOK",
    "cheat_sheet": "FORBIDDEN_OBJECT_BOOK",
}


def run_proctor_analysis(frame_b64: str, enrich_objects: bool = False) -> dict:
    """Bitta kadrni tahlil qiladi (sof AI mantiq, DB'siz).

    Qaytadi: {"violations": [...], "face_count": int, "skipped": bool,
              "method": str|None, "code": str|None}
    """
    from apps.api.face_embedding import analyze_proctor_frame_local
    from apps.api.gemini_tools import analyze_proctor_frame

    result = analyze_proctor_frame_local(frame_b64)
    if not result.get("ok"):
        code = result.get("code", "FACE_ENGINE_UNAVAILABLE")
        # Zaxira: OpenAI/Gemini Vision (telefon/kitob aniqlash)
        ai = analyze_proctor_frame(frame_b64)
        if ai.get("ok"):
            face_count = int(ai.get("face_count") or 0)
            violations: list[str] = []
            if face_count == 0:
                violations.append("FACE_NOT_VISIBLE")
            elif face_count >= 2:
                violations.append("MULTIPLE_FACES")
            for obj in ai.get("forbidden_objects") or []:
                key = str(obj).lower().strip().replace(" ", "_").replace("-", "_")
                vtype = _FORBIDDEN_OBJECT_MAP.get(key) or _FORBIDDEN_OBJECT_MAP.get(
                    key.replace("_", "")
                )
                if vtype and vtype not in violations:
                    violations.append(vtype)
            if bool(ai.get("looking_away")) and face_count == 1:
                violations.append("GAZE_AWAY_UP")
            return {
                "violations": violations,
                "face_count": face_count,
                "skipped": False,
                "method": "openai_vision",
                "code": None,
            }
        return {
            "violations": [],
            "face_count": 0,
            "skipped": True,
            "method": None,
            "code": code,
        }

    violations = list(result.get("violations") or [])
    face_count = int(result.get("face_count") or 0)

    # Lokal OpenCV faqat yuzni biladi — telefon/kitob/noutbuk uchun Vision kerak.
    if enrich_objects:
        ai = analyze_proctor_frame(frame_b64)
        if ai.get("ok"):
            seen = set(violations)
            for obj in ai.get("forbidden_objects") or []:
                key = str(obj).lower().strip().replace(" ", "_").replace("-", "_")
                vtype = _FORBIDDEN_OBJECT_MAP.get(key) or _FORBIDDEN_OBJECT_MAP.get(
                    key.replace("_", "")
                )
                if vtype and vtype not in seen:
                    violations.append(vtype)
                    seen.add(vtype)

    return {
        "violations": violations,
        "face_count": face_count,
        "skipped": False,
        "method": (
            f"{result.get('method')}+vision_objects" if enrich_objects else result.get("method")
        ),
        "code": None,
    }


@shared_task(name="proctor.analyze_frame", bind=True, max_retries=0)
def analyze_proctor_frame_task(self, frame_b64: str, enrich_objects: bool = False) -> dict:
    return run_proctor_analysis(frame_b64, enrich_objects)


def run_identity_compare(live_b64: str, profile_b64: str) -> dict:
    """Yuz solishtirish (sof AI mantiq). compare_faces natijasini qaytaradi."""
    from apps.api.gemini_tools import compare_faces

    return compare_faces(live_b64, profile_b64)


@shared_task(name="identity.compare_faces", bind=True, max_retries=0)
def identity_compare_task(self, live_b64: str, profile_b64: str) -> dict:
    return run_identity_compare(live_b64, profile_b64)


# ---------------------------------------------------------------------------
# Stale-session sweep (Celery beat) — bu yerdan pastda "sof, DB'siz" konventsiya
# ataylab buziladi: bu task server tomonidan mustaqil ravishda "o'lik" (kamera
# oqimi uzilgan, lekin client hech qachon PROCTOR_FEED_LOST deb report qilmagan)
# sessiyalarni aniqlab, ViolationLog yozadi va ogohlantirish/ban qo'llaydi —
# client javobsiz qolsa ham (brauzer muzlab qolgan, tarmoq so'rovlari
# to'sib qo'yilgan va h.k.) proctoring enforcement davom etishi uchun.
# ---------------------------------------------------------------------------

def run_sweep_stale_sessions() -> dict:
    from datetime import timedelta

    from django.db.models import F, Q
    from django.utils import timezone as dj_tz

    from apps.api.proctor_config import max_warnings_before_ban
    from apps.api.proctor_escalation import apply_official_warning_or_ban
    from apps.core.models import StudentExam, ViolationLog

    gap = max(40, int(os.environ.get("PROCTOR_LIVENESS_MAX_GAP_SECONDS", "75")))
    startup_grace = max(gap, int(os.environ.get("PROCTOR_SWEEP_STARTUP_GRACE_SECONDS", str(gap))))
    relog_minutes = max(1, int(os.environ.get("PROCTOR_SWEEP_RELOG_MINUTES", "5")))
    max_warnings = max_warnings_before_ban()
    auto_ban = (os.environ.get("PROCTOR_AUTO_BAN_NON_IDENTITY") or "1").strip().lower() in (
        "1", "true", "yes",
    )
    global_ban = (os.environ.get("VAC_GLOBAL_ACCOUNT_BAN") or "0").strip().lower() in (
        "1", "true", "yes",
    )

    now = dj_tz.now()
    stale_cutoff = now - timedelta(seconds=gap)
    startup_cutoff = now - timedelta(seconds=startup_grace)

    # "In Progress" sessiya, va: (a) kadr kelgan lekin 'gap' sekunddan beri
    # yangilanmagan (va joriy urinishga tegishli — eski attempt'dan qolgan
    # timestamp bo'lmasin), YOKI (b) hech qachon kadr kelmagan lekin
    # 'startup_grace'dan beri boshlangan.
    candidates = StudentExam.objects.filter(status="In Progress").filter(
        Q(
            proctor_last_frame_at__isnull=False,
            proctor_last_frame_at__lt=stale_cutoff,
            proctor_last_frame_at__gte=F("started_at"),
        )
        | (
            Q(started_at__isnull=False, started_at__lt=startup_cutoff)
            & (Q(proctor_last_frame_at__isnull=True) | Q(proctor_last_frame_at__lt=F("started_at")))
        )
    )

    checked = 0
    flagged = 0
    for se in candidates.select_related("student", "exam").iterator():
        checked += 1
        already_flagged_recently = ViolationLog.objects.filter(
            student_id=se.student_id,
            exam_id=se.exam_id,
            violation_type="PROCTOR_FEED_LOST",
            timestamp__gte=now - timedelta(minutes=relog_minutes),
        ).exists()
        if already_flagged_recently:
            continue  # uzilish davom etmoqda — har sweep tikida qayta ogohlantirilmaydi

        ViolationLog.objects.create(
            student_id=se.student_id,
            exam_id=se.exam_id,
            violation_type="PROCTOR_FEED_LOST",
            timestamp=now,
            screenshot_url="",
        )
        logs_qs = ViolationLog.objects.filter(student_id=se.student_id, exam_id=se.exam_id)
        if se.started_at:
            logs_qs = logs_qs.filter(timestamp__gte=se.started_at)
        cnt_all = logs_qs.count()
        result = apply_official_warning_or_ban(
            se,
            student_id=str(se.student_id),
            student_name=getattr(se.student, "name", str(se.student_id)),
            exam_id=se.exam_id,
            reason_text="Kamera oqimi to'xtab qoldi (server aniqladi)",
            violations_count=cnt_all,
            max_warnings_before_ban=max_warnings,
            auto_ban=auto_ban,
            global_account_ban=global_ban,
            exam=se.exam,
            violation_type="PROCTOR_FEED_LOST",
        )
        if result.get("examRetake") or result.get("technicalRetake"):
            from apps.api.proctor_exam_retake import notify_exam_retake

            if not result.get("banned"):
                notify_exam_retake(
                    str(se.student_id),
                    se.id,
                    se.exam_id,
                    remaining=int(result.get("retakesRemaining") or result.get("technicalRetakesRemaining") or 0),
                    reason="Kamera oqimi to'xtab qoldi (server aniqladi)",
                    retakes_used=int(result.get("retakesUsed") or result.get("technicalRetakesUsed") or 0),
                )
        flagged += 1

    return {"checked": checked, "flagged": flagged}


@shared_task(name="proctor.sweep_stale_sessions", bind=True, max_retries=0)
def sweep_stale_sessions(self) -> dict:
    return run_sweep_stale_sessions()


def run_finalize_ended_exams() -> dict:
    """Vaqti tugagan imtihonlarni avtomatik yakunlaydi (davriy beat task).

    Har bir tugagan imtihon uchun, unga tayinlangan guruh(lar)dagi har bir talaba:
      - "In Progress" (kirib tugatmagan)  → draft javoblar bilan ballanadi (Completed).
      - "Pending" (retake berilgan, lekin oyna ochiq ekan qaytmagan) → "Failed"
        (oldingi urinish yiqilgan hisoblanadi).
      - Umuman kirmagan (sessiya yo'q) → "Failed" + started_at=None (KELMAGAN/absent).
      - Completed/Banned/Failed → allaqachon yakuniy, tegilmaydi (idempotent).
    """
    from datetime import timedelta

    from django.utils import timezone as dj_tz

    from apps.api.services import finalize_student_exam_session, safe_json_loads
    from apps.core.models import AppUser, Exam, ExamGroup, StudentExam

    now = dj_tz.now()
    # Faqat yaqinda tugagan imtihonlarni skan qilamiz (eski imtihonlar qayta-qayta
    # aylanmasin). Idempotent — yakuniy sessiyalar o'tkazib yuboriladi.
    lookback_days = max(1, int(os.environ.get("EXAM_FINALIZE_LOOKBACK_DAYS", "3")))
    window_start = now - timedelta(days=lookback_days)
    exams = Exam.objects.filter(end_time__isnull=False, end_time__lt=now, end_time__gte=window_start)

    finalized = 0
    absent = 0
    for exam in exams.iterator():
        group_ids = list(
            ExamGroup.objects.filter(exam_id=exam.id).values_list("group_id", flat=True)
        )
        if not group_ids:
            continue
        student_ids = list(
            AppUser.objects.filter(role="student", group_id__in=group_ids).values_list(
                "id", flat=True
            )
        )
        if not student_ids:
            continue
        ses_by_student = {
            se.student_id: se
            for se in StudentExam.objects.filter(exam_id=exam.id, student_id__in=student_ids)
        }
        for sid in student_ids:
            se = ses_by_student.get(sid)
            if se is None:
                # Umuman kirmagan — KELMAGAN (absent). started_at=None bilan ajratiladi.
                StudentExam.objects.create(
                    student_id=sid,
                    exam_id=exam.id,
                    status="Failed",
                    score=None,
                    started_at=None,
                )
                absent += 1
                continue
            status = (se.status or "").strip()
            if status == "In Progress":
                answers = safe_json_loads(se.draft_answers_json, {})
                flagged = safe_json_loads(se.draft_flagged_json, [])
                try:
                    finalize_student_exam_session(se, exam, answers, flagged)
                    finalized += 1
                except Exception:  # noqa: BLE001 — bitta sessiya xatosi butun taskni buzmasin
                    continue
            elif status == "Pending":
                # Retake berilgan, lekin imtihon vaqti tugaguncha qaytmadi — yiqilgan.
                se.status = "Failed"
                se.save(update_fields=["status"])
                finalized += 1
            # Completed / Banned / Failed → yakuniy, tegilmaydi.

    return {"finalized": finalized, "absent": absent}


@shared_task(name="exam.finalize_ended_exams", bind=True, max_retries=0)
def finalize_ended_exams(self) -> dict:
    return run_finalize_ended_exams()
