"""Talaba urinish tarixi — ViolationLog asosida."""
from __future__ import annotations

from apps.api.proctor_violation_labels import violation_reason_text
from apps.core.models import ViolationLog


def build_attempt_history(
    student_id, exam_id: int, *, limit: int = 12, lang: str | None = None
) -> list[dict]:
    rows = (
        ViolationLog.objects.filter(student_id=student_id, exam_id=exam_id)
        .order_by("-timestamp")[:limit]
    )
    out: list[dict] = []
    for row in reversed(list(rows)):
        vtype = str(row.violation_type or "").strip()
        ts = row.timestamp
        out.append(
            {
                "violation_type": vtype,
                "reason": violation_reason_text(vtype, lang) if vtype else "",
                "at": ts.isoformat() if ts else None,
            }
        )
    return out
