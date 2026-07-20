"""Proktor eskalatsiyasi — HTTP violations va Celery sweep uchun umumiy sozlamalar."""
from __future__ import annotations

import os


def max_warnings_before_ban() -> int:
    """3 ta rasmiy ogohlantirish — 3-chi qoidabuzarlikda retake yoki ban."""
    return max(1, int(os.environ.get("PROCTOR_MAX_WARNINGS_BEFORE_BAN", "3")))


def warn_suppress_seconds() -> int:
    return max(5, int(os.environ.get("PROCTOR_WARN_SUPPRESS_SECONDS", "10")))
