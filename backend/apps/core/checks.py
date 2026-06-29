"""Django system checks (`manage.py check --deploy`)."""
from __future__ import annotations

import os

from django.conf import settings
from django.core.checks import Error, Warning, register, Tags


def _inmemory_channel_layer() -> bool:
    backend = (settings.CHANNEL_LAYERS or {}).get("default", {}).get("BACKEND", "")
    return "InMemoryChannelLayer" in backend


def _allow_inmemory_optout() -> bool:
    """Ataylab bitta jarayonli (single-process) deploy uchun ochiq eshik."""
    return (os.environ.get("ALLOW_INMEMORY_CHANNELS") or "").strip().lower() in (
        "1",
        "true",
        "yes",
    )


@register(Tags.security, deploy=True)
def warn_face_engine_for_identity(app_configs, **kwargs):
    """Prod da identity-compare uchun yuz embedding engine kerak."""
    if settings.DEBUG:
        return []
    try:
        from apps.api.face_embedding import face_engine_ready

        if face_engine_ready():
            return []
    except Exception:
        pass
    fallback = (os.environ.get("FACE_COMPARE_FALLBACK_OPENAI") or "").strip().lower() in (
        "1",
        "true",
        "yes",
    )
    key = (
        os.environ.get("OPENAI_API_KEY", "").strip()
        or os.environ.get("GEMINI_API_KEY", "").strip()
    )
    if fallback and key:
        return []
    hints = [
        "opencv-contrib-python-headless o‘rnating va apps/api/face_models/ da YuNet+SFace ONNX modellari bo‘lsin.",
    ]
    if fallback:
        hints.append("Yoki FACE_COMPARE_FALLBACK_OPENAI=0 va faqat embedding ishlating.")
    else:
        hints.append("Yoki FACE_COMPARE_FALLBACK_OPENAI=1 va OPENAI_API_KEY qo‘shing.")
    return [
        Warning(
            "Yuz embedding engine tayyor emas — POST /api/student/identity-compare ishlamasligi mumkin (503).",
            hint=" ".join(hints),
            id="exam.W002",
        )
    ]


@register(Tags.compatibility, deploy=True)
def warn_inmemory_channel_layer_in_prod(app_configs, **kwargs):
    """
    Prod da InMemoryChannelLayer WebSocket signalni worker'lar orasida tarqatmaydi —
    jonli proctoring (LiveMonitor) ishlamaydi. Shipped gunicorn.conf.py `workers=max(2, …)`
    bilan ishlaydi, ya'ni prod amalda DOIM ko'p worker'li — shu sabab bu Error.
    Redis kerak: REDIS_URL o'rnatilsa channel layer va VAC replay cache ham Redis'ga o'tadi.
    Ataylab bitta jarayonli deploy uchun: ALLOW_INMEMORY_CHANNELS=1.
    """
    if settings.DEBUG or not _inmemory_channel_layer():
        return []
    hint = (
        "REDIS_URL=redis://127.0.0.1:6379/0 o'rnating (channels-redis allaqachon o'rnatilgan). "
        "Bu VAC HMAC replay cache'ni ham FileBased o'rniga Redis'ga o'tkazadi."
    )
    if _allow_inmemory_optout():
        return [
            Warning(
                "CHANNEL_LAYERS = InMemoryChannelLayer (prod) — bitta jarayonda ishlaydi, "
                "lekin ko'p worker'da WebSocket proctoring (LiveMonitor) buziladi. "
                "ALLOW_INMEMORY_CHANNELS=1 bilan ataylab ruxsat berilgan.",
                hint=hint + " Faqat bitta worker (WEB_CONCURRENCY=1) bilan ishlating.",
                id="exam.W003",
            )
        ]
    return [
        Error(
            "CHANNEL_LAYERS = InMemoryChannelLayer (prod) — WebSocket proctoring signali "
            "Gunicorn worker'lar orasida yetib bormaydi (LiveMonitor ishlamaydi). "
            "Shipped gunicorn config kamida 2 worker ishga tushiradi.",
            hint=(
                hint
                + " Ataylab bitta jarayonli (single-process) deploy bo'lsa: "
                "ALLOW_INMEMORY_CHANNELS=1 o'rnating (faqat WEB_CONCURRENCY=1 bilan)."
            ),
            id="exam.E001",
        )
    ]
