"""Imtihon ban sabablari — StudentExam.ban_reason uchun standart kodlar."""
from __future__ import annotations

from apps.core.models import StudentExam

BAN_REASON_RETAKE_EXHAUSTED = "RETAKE_EXHAUSTED"
BAN_REASON_VIOLATION_LIMIT = "VIOLATION_LIMIT"
BAN_REASON_IDENTITY = "IDENTITY"
BAN_REASON_ADMIN = "ADMIN"
BAN_REASON_HARDENED = "HARDENED"

ALL_BAN_REASONS = frozenset({
    BAN_REASON_RETAKE_EXHAUSTED,
    BAN_REASON_VIOLATION_LIMIT,
    BAN_REASON_IDENTITY,
    BAN_REASON_ADMIN,
    BAN_REASON_HARDENED,
})


def apply_exam_ban(se: StudentExam, reason: str, *, extra_fields: list[str] | None = None) -> list[str]:
    """Status=Banned va ban_reason ni o'rnatadi; save uchun update_fields ro'yxati."""
    code = str(reason or "").strip() or BAN_REASON_VIOLATION_LIMIT
    if code not in ALL_BAN_REASONS:
        code = BAN_REASON_VIOLATION_LIMIT
    se.status = "Banned"
    se.ban_reason = code
    fields = ["status", "ban_reason"]
    if extra_fields:
        fields = list(dict.fromkeys(fields + extra_fields))
    return fields


def clear_exam_ban_state(se: StudentExam) -> None:
    se.ban_reason = ""


def session_phase(se: StudentExam | None) -> str:
    """Talaba sessiyasi: birinchi urinish yoki retake'dan keyin."""
    if se is None:
        return "fresh"
    if int(getattr(se, "technical_retakes_used", 0) or 0) > 0:
        return "after_retake"
    if int(getattr(se, "identity_retakes_used", 0) or 0) > 0:
        return "after_retake"
    return "fresh"
