"""Rasmiy ogohlantirish/ban eskalatsiyasi — HTTP so'rov (student_violations) va
server-side stale-session sweep (tasks.sweep_stale_sessions) ikkalasi ham shu
yerdagi umumiy mantiqni chaqiradi, shunda ikki joyda ban qoidalari
(MAX_WARNINGS_BEFORE_BAN va h.k.) mos kelmasligi xavfi yo'q.

HMAC/device/dedupe/hardened-risk kabi HTTP-ga xos tekshiruvlar bu yerda yo'q —
ular chaqiruvchi tomonda (agar kerak bo'lsa) hal qilinadi.
"""
from __future__ import annotations

from apps.core.models import AppUser, Exam, StudentExam
from django.utils import timezone as dj_tz

from apps.api.proctor_exam_retake import try_apply_exam_retake, notify_exam_retake
from apps.api.proctor_ban_reason import BAN_REASON_VIOLATION_LIMIT, apply_exam_ban


def notify_banned(
    student_id: str,
    student_name: str,
    student_exam_id: int,
    exam_id: int,
    reason: str,
    violations_count: int,
) -> None:
    """Ban bo'lganda WebSocket orqali exam group'ga xabar yuborish."""
    try:
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer

        layer = get_channel_layer()
        if layer:
            async_to_sync(layer.group_send)(
                f"exam_{exam_id}",
                {
                    "type": "exam.student_banned",
                    "student_id": student_id,
                    "student_name": student_name,
                    "student_exam_id": student_exam_id,
                    "exam_id": exam_id,
                    "reason": reason,
                    "violations_count": violations_count,
                },
            )
    except Exception:
        pass  # WS xatosi ban jarayonini to'xtatmasin


def apply_official_warning_or_ban(
    se: StudentExam,
    *,
    student_id: str,
    student_name: str,
    exam_id: int,
    reason_text: str,
    violations_count: int,
    # DIQQAT: standart qiymat `None`. Ilgari bu yerda qattiq `3` turardi va
    # `PROCTOR_MAX_WARNINGS_BEFORE_BAN` boshqa qiymatga sozlangan bo'lsa,
    # argumentni uzatishni unutgan chaqiruvchi jimgina 3 ni ishlatib yuborardi —
    # ya'ni ban chegarasi joyiga qarab har xil bo'lib qolishi mumkin edi.
    # Endi berilmasa yagona manbadan (`proctor_config`) o'qiladi.
    max_warnings_before_ban: int | None = None,
    auto_ban: bool = True,
    global_account_ban: bool = False,
    exam: Exam | None = None,
    violation_type: str | None = None,
) -> dict:
    """`se.proctor_official_warnings`ni oshiradi; `max_warnings_before_ban`ga
    yetganda ban qiladi (yoki `auto_ban=False` bo'lsa inson tekshiruviga yuboradi).
    `se`ni saqlaydi. `student_violations()`ning oddiy (non-hardened,
    non-instant-ban) javob shakliga mos dict qaytaradi."""
    if max_warnings_before_ban is None:
        from apps.api.proctor_config import max_warnings_before_ban as _cfg_max

        max_warnings_before_ban = _cfg_max()

    se.proctor_official_warnings = int(se.proctor_official_warnings or 0) + 1
    se.proctor_last_warning_at = dj_tz.now()

    if se.proctor_official_warnings >= max_warnings_before_ban:
        if not auto_ban:
            se.proctor_official_warnings = max_warnings_before_ban
            se.save(update_fields=["proctor_official_warnings", "proctor_last_warning_at"])
            return {
                "banned": False,
                "requiresHumanReview": True,
                "reviewReason": "WARNINGS_LIMIT",
                "violationsCount": violations_count,
                "warningNumber": max_warnings_before_ban,
                "violationReason": reason_text,
                "isFinalWarning": True,
                "warningSuppressed": False,
                "officialWarnings": max_warnings_before_ban,
            }
        if exam is None:
            exam = Exam.objects.filter(pk=exam_id).first()
        if exam and violation_type:
            retake_payload = try_apply_exam_retake(
                se,
                exam,
                reason_text=reason_text,
                violations_count=violations_count,
                violation_type=violation_type,
            )
            if retake_payload:
                if retake_payload.get("banned"):
                    notify_banned(str(student_id), student_name, se.id, exam_id, reason_text, violations_count)
                else:
                    notify_exam_retake(
                        student_id,
                        se.id,
                        exam_id,
                        remaining=int(retake_payload.get("retakesRemaining") or 0),
                        reason=reason_text,
                        retakes_used=int(retake_payload.get("retakesUsed") or retake_payload.get("technicalRetakesUsed") or 0),
                        identity_retake=bool(retake_payload.get("identityRetake")),
                    )
                return retake_payload
        if global_account_ban:
            AppUser.objects.filter(pk=student_id).update(status="Banned")
        ban_fields = apply_exam_ban(
            se,
            BAN_REASON_VIOLATION_LIMIT,
            extra_fields=["proctor_official_warnings", "proctor_last_warning_at"],
        )
        se.save(update_fields=ban_fields)
        notify_banned(str(student_id), student_name, se.id, exam_id, reason_text, violations_count)
        return {
            "banned": True,
            "banReason": BAN_REASON_VIOLATION_LIMIT,
            "violationsCount": violations_count,
            "warningNumber": max_warnings_before_ban,
            "violationReason": reason_text,
            "isFinalWarning": False,
            "warningSuppressed": False,
            "officialWarnings": se.proctor_official_warnings,
        }

    se.save(update_fields=["proctor_official_warnings", "proctor_last_warning_at"])
    cnt_warn = se.proctor_official_warnings
    # Oxirgi rasmiy ogohlantirish: keyingi epizodda ban (masalan 3/3 ogohlantirish).
    is_final = cnt_warn >= max_warnings_before_ban - 1
    return {
        "banned": False,
        "warningSuppressed": False,
        "violationsCount": violations_count,
        "warningNumber": cnt_warn,
        "violationReason": reason_text,
        "isFinalWarning": is_final,
        "officialWarnings": cnt_warn,
    }
