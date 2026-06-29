"""VAC (Virtual Anti-Cheat) muhit sozlamalari — prod da guardlar default yoqilgan."""
from __future__ import annotations

import os

from django.conf import settings


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in ("1", "true", "yes")


def _prod_default_on() -> bool:
    return not settings.DEBUG


def vac_hmac_guard_enabled() -> bool:
    return _env_bool("VAC_HMAC_GUARD", _prod_default_on())


def vac_seq_guard_enabled() -> bool:
    return _env_bool("VAC_SEQ_GUARD", _prod_default_on())


def vac_challenge_guard_enabled() -> bool:
    return _env_bool("VAC_CHALLENGE_GUARD", _prod_default_on())


def vac_any_guard_enabled() -> bool:
    return vac_hmac_guard_enabled() or vac_seq_guard_enabled() or vac_challenge_guard_enabled()


def identity_verify_required() -> bool:
    return _env_bool("IDENTITY_VERIFY_REQUIRED", _prod_default_on())


def vac_device_lock_enabled() -> bool:
    return _env_bool("VAC_DEVICE_LOCK", True)


def vac_pc_only_enabled() -> bool:
    return _env_bool("VAC_PC_ONLY", True)


def exam_min_submit_seconds() -> int:
    raw = os.environ.get("EXAM_MIN_SUBMIT_SECONDS")
    if raw is not None:
        try:
            return max(0, int(raw))
        except ValueError:
            pass
    return 30 if not settings.DEBUG else 0


def identity_verify_max_age_seconds() -> int:
    try:
        return max(60, int(os.environ.get("IDENTITY_VERIFY_MAX_AGE_SEC", "1800")))
    except ValueError:
        return 1800
