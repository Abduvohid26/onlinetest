"""Admin/staff qayta imkoniyat berish — bitta umumiy oqim."""
from __future__ import annotations

from apps.api.proctor_ban_reason import clear_exam_ban_state
from apps.api.proctor_exam_retake import (
    grant_bonus_retakes,
    notify_exam_retake,
    reset_fields_for_exam_retake,
    violation_retakes_remaining,
)
from apps.core.models import Exam, StudentExam


def apply_admin_granted_retake(
    se: StudentExam,
    exam: Exam,
    *,
    bonus_retakes: int = 0,
    reset_usage: bool = True,
    reset_session: bool = True,
    notify_reason: str = "Administrator qayta imkoniyat berdi",
) -> dict:
    """
    Sessiyani Pending qiladi (ixtiyoriy), ban tozalaydi, counter reset/bonus,
    talabaga WS orqali xabar yuboradi.
    """
    if reset_usage:
        se.technical_retakes_used = 0
        se.identity_retakes_used = 0
    if bonus_retakes > 0:
        grant_bonus_retakes(se, amount=bonus_retakes)

    update_fields: list[str] = []
    if reset_session:
        update_fields = reset_fields_for_exam_retake(se)
        clear_exam_ban_state(se)
        update_fields = list(
            dict.fromkeys(
                update_fields
                + [
                    "ban_reason",
                    "technical_retakes_used",
                    "identity_retakes_used",
                    "bonus_technical_retakes",
                ]
            )
        )
        se.save(update_fields=update_fields)
    else:
        update_fields = ["technical_retakes_used", "identity_retakes_used", "bonus_technical_retakes"]
        se.save(update_fields=list(dict.fromkeys(update_fields)))

    remaining = violation_retakes_remaining(se, exam)
    notify_exam_retake(
        str(se.student_id),
        se.id,
        se.exam_id,
        remaining=remaining,
        reason=notify_reason,
        retakes_used=int(getattr(se, "technical_retakes_used", 0) or 0),
    )
    return {
        "success": True,
        "retakes_remaining": remaining,
        "violation_retakes_remaining": remaining,
        "technical_retakes_remaining": remaining,
        "technical_retakes_used": int(getattr(se, "technical_retakes_used", 0) or 0),
        "bonus_technical_retakes": int(getattr(se, "bonus_technical_retakes", 0) or 0),
        "student_exam_id": se.id,
        "exam_id": se.exam_id,
        "status": se.status,
    }
