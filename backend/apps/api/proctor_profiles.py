"""Qoidalar profili — retake chegaralari uchun.

DIQQAT: imtihon yaratishda profil TANLOVI olib tashlandi. Har doim
`DEFAULT_PROCTOR_PROFILE` (standart) ishlatiladi; admin retake sonlarini
alohida maydonlar orqali o'zgartira oladi. Modul saqlanmoqda, chunki mavjud
imtihonlarda `proctor_profile` qiymati bor va chegaralar shundan o'qiladi.
"""
from __future__ import annotations

PROCTOR_PROFILE_SOFT = "soft"
PROCTOR_PROFILE_STANDARD = "standard"
PROCTOR_PROFILE_STRICT = "strict"

PROCTOR_PROFILES: dict[str, dict[str, int]] = {
    PROCTOR_PROFILE_SOFT: {
        "technical_retakes_allowed": 5,
        "identity_retakes_allowed": 1,
    },
    PROCTOR_PROFILE_STANDARD: {
        "technical_retakes_allowed": 3,
        "identity_retakes_allowed": 1,
    },
    PROCTOR_PROFILE_STRICT: {
        "technical_retakes_allowed": 1,
        "identity_retakes_allowed": 0,
    },
}


#: Yagona ishlatiladigan profil (tanlov yo'q).
DEFAULT_PROCTOR_PROFILE = PROCTOR_PROFILE_STANDARD


def normalize_proctor_profile(raw: str | None) -> str:
    key = str(raw or "").strip().lower()
    if key in PROCTOR_PROFILES:
        return key
    return PROCTOR_PROFILE_STANDARD


def retake_limits_for_profile(profile: str | None) -> dict[str, int]:
    return dict(PROCTOR_PROFILES[normalize_proctor_profile(profile)])
