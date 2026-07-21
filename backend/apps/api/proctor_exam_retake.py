"""Qoidabuzarlik limitiga yetganda avtomatik qayta topshirish (barcha 29 tur)."""
from __future__ import annotations

from apps.core.models import Exam, StudentExam

from apps.api.proctor_ban_reason import (
    BAN_REASON_RETAKE_EXHAUSTED,
    apply_exam_ban,
)

IDENTITY_VIOLATION_TYPE = "IDENTITY_SUBSTITUTION"


def violation_retakes_budget(se: StudentExam, exam: Exam) -> int:
    allowed = max(0, int(getattr(exam, "technical_retakes_allowed", 3) or 0))
    bonus = max(0, int(getattr(se, "bonus_technical_retakes", 0) or 0))
    return allowed + bonus


def violation_retakes_remaining(se: StudentExam, exam: Exam) -> int:
    used = max(0, int(getattr(se, "technical_retakes_used", 0) or 0))
    return max(0, violation_retakes_budget(se, exam) - used)


def identity_retakes_budget(exam: Exam) -> int:
    return max(0, int(getattr(exam, "identity_retakes_allowed", 1) or 0))


def identity_retakes_remaining(se: StudentExam, exam: Exam) -> int:
    used = max(0, int(getattr(se, "identity_retakes_used", 0) or 0))
    return max(0, identity_retakes_budget(exam) - used)


def reset_fields_for_exam_retake(se: StudentExam) -> list[str]:
    """Sessiyani tozalab Pending holatiga qaytaradi."""
    se.status = "Pending"
    se.answers_json = ""
    se.score = None
    se.draft_answers_json = "{}"
    se.draft_flagged_json = "[]"
    se.draft_updated_at = None
    se.proctor_official_warnings = 0
    se.proctor_last_warning_at = None
    se.proctor_last_frame_at = None
    se.started_at = None
    se.completed_at = None
    se.device_fingerprint = ""
    se.device_bound_at = None
    se.session_signing_key = ""
    se.session_request_seq = 1
    se.session_challenge = ""
    se.device_session_token = ""
    se.identity_verified_at = None
    update_fields = [
        "status",
        "answers_json",
        "score",
        "draft_answers_json",
        "draft_flagged_json",
        "draft_updated_at",
        "proctor_official_warnings",
        "proctor_last_warning_at",
        "proctor_last_frame_at",
        "started_at",
        "completed_at",
        "device_fingerprint",
        "device_bound_at",
        "session_signing_key",
        "session_request_seq",
        "session_challenge",
        "device_session_token",
        "identity_verified_at",
    ]
    exam = getattr(se, "exam", None)
    if exam is None:
        exam = Exam.objects.filter(pk=se.exam_id).first()
    if exam and exam.exam_mode in ("bank_mixed", "imentor_mixed"):
        se.session_questions_json = None
        update_fields.append("session_questions_json")
    return update_fields


def _retake_response(
    *,
    reason_text: str,
    violations_count: int,
    retakes_remaining: int,
    retakes_used: int,
    identity_retake: bool,
) -> dict:
    return {
        "banned": False,
        "examRetake": True,
        "technicalRetake": True,
        "identityRetake": identity_retake,
        "retakesRemaining": retakes_remaining,
        "technicalRetakesRemaining": retakes_remaining,
        "retakesUsed": retakes_used,
        "technicalRetakesUsed": retakes_used,
        "violationsCount": violations_count,
        "warningNumber": 0,
        "violationReason": reason_text,
        "isFinalWarning": False,
        "warningSuppressed": False,
        "officialWarnings": 0,
    }


def _ban_after_retake_response(
    *,
    reason_text: str,
    violations_count: int,
    retakes_used: int,
    identity_retake: bool,
    ban_reason: str = BAN_REASON_RETAKE_EXHAUSTED,
    official_warnings: int = 3,
) -> dict:
    """Oxirgi qayta topshirish sarflanganda — ban javobi."""
    return {
        "banned": True,
        "banReason": ban_reason,
        "examRetake": False,
        "technicalRetake": False,
        "identityRetake": identity_retake,
        "retakesRemaining": 0,
        "technicalRetakesRemaining": 0,
        "retakesUsed": retakes_used,
        "technicalRetakesUsed": retakes_used,
        "violationsCount": violations_count,
        "warningNumber": official_warnings,
        "violationReason": reason_text,
        "isFinalWarning": False,
        "warningSuppressed": False,
        "officialWarnings": official_warnings,
        "retakeExhausted": True,
    }


def exam_retakes_exhausted(se: StudentExam, exam: Exam) -> bool:
    """Berilgan qayta topshirishni resume qilib bo'lmaydimi (start bloklanadi).

    MUHIM: hisoblagich (technical/identity_retakes_used) retake BERILGANDA oshiriladi,
    va `..._remaining()` max(0, ...) bilan cheklangan (hech qachon manfiy emas). Shu sabab
    "remaining == 0" ni "tugagan" deb hisoblab bo'lmaydi — yangi berilgan (lekin hali
    resume qilinmagan) identity retake uchun ham remaining == 0 bo'ladi; aks holda talaba
    berilgan retake'ni hech qachon resume qila olmasdi. To'g'ri mezon: `used > budget`,
    ya'ni admin ruxsatni keyin kamaytirgan va talaba allaqachon ko'proq retake ishlatib
    qo'ygan. Oddiy oqimda `used <= budget` (grant paytida remaining > 0 tekshiriladi), shu
    sabab Pending sessiya doim resume qilinadi; keyingi qoidabuzarlik try_apply_exam_retake
    ichida (remaining <= 0) ban qiladi.
    """
    v_used = max(0, int(getattr(se, "technical_retakes_used", 0) or 0))
    id_used = max(0, int(getattr(se, "identity_retakes_used", 0) or 0))
    if v_used > violation_retakes_budget(se, exam):
        return True
    if id_used > identity_retakes_budget(exam):
        return True
    return False


def try_apply_exam_retake(
    se: StudentExam,
    exam: Exam,
    *,
    reason_text: str,
    violations_count: int,
    violation_type: str,
) -> dict | None:
    """Ban o'rniga qayta topshirish. Imkon yo'q bo'lsa None (keyin ban)."""
    vtype = str(violation_type or "").strip()
    if vtype == IDENTITY_VIOLATION_TYPE:
        if identity_retakes_remaining(se, exam) <= 0:
            return None
        se.identity_retakes_used = int(getattr(se, "identity_retakes_used", 0) or 0) + 1
        remaining = identity_retakes_remaining(se, exam)
        used = se.identity_retakes_used
        update_fields = reset_fields_for_exam_retake(se)
        update_fields.append("identity_retakes_used")
        se.save(update_fields=list(dict.fromkeys(update_fields)))
        return _retake_response(
            reason_text=reason_text,
            violations_count=violations_count,
            retakes_remaining=remaining,
            retakes_used=used,
            identity_retake=True,
        )

    if violation_retakes_remaining(se, exam) <= 0:
        return None

    se.technical_retakes_used = int(getattr(se, "technical_retakes_used", 0) or 0) + 1
    remaining = violation_retakes_remaining(se, exam)
    used = se.technical_retakes_used
    if remaining <= 0:
        apply_exam_ban(se, BAN_REASON_RETAKE_EXHAUSTED, extra_fields=["technical_retakes_used"])
        se.save(update_fields=["status", "ban_reason", "technical_retakes_used"])
        return _ban_after_retake_response(
            reason_text=reason_text,
            violations_count=violations_count,
            retakes_used=used,
            identity_retake=False,
            ban_reason=BAN_REASON_RETAKE_EXHAUSTED,
        )
    update_fields = reset_fields_for_exam_retake(se)
    update_fields.append("technical_retakes_used")
    se.save(update_fields=list(dict.fromkeys(update_fields)))
    return _retake_response(
        reason_text=reason_text,
        violations_count=violations_count,
        retakes_remaining=remaining,
        retakes_used=used,
        identity_retake=False,
    )


def notify_exam_retake(
    student_id: str,
    student_exam_id: int,
    exam_id: int,
    *,
    remaining: int,
    reason: str,
    retakes_used: int = 0,
    identity_retake: bool = False,
) -> None:
    try:
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer

        layer = get_channel_layer()
        if layer:
            async_to_sync(layer.group_send)(
                f"exam_{exam_id}",
                {
                    "type": "exam.exam_retake",
                    "student_id": str(student_id),
                    "student_exam_id": student_exam_id,
                    "exam_id": exam_id,
                    "retakes_remaining": remaining,
                    "technical_retakes_remaining": remaining,
                    "retakes_used": retakes_used,
                    "reason": reason,
                    "identity_retake": identity_retake,
                },
            )
    except Exception:
        pass


def grant_bonus_retakes(se: StudentExam, *, amount: int = 3) -> int:
    se.bonus_technical_retakes = int(getattr(se, "bonus_technical_retakes", 0) or 0) + max(1, amount)
    return se.bonus_technical_retakes
