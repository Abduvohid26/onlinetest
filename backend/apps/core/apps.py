import logging
import os

from django.apps import AppConfig
from django.conf import settings

logger = logging.getLogger("apps.core")


def _warn_inmemory_channel_layer_at_boot() -> None:
    """Prod da InMemoryChannelLayer ishlatilsa boot vaqtida log'ga yozadi.

    `manage.py check --deploy` (exam.E001) ishlatilmasdan server ko'tarilgan bo'lsa ham
    ops shu ogohlantirishni ko'radi: ko'p worker'da LiveMonitor jim buziladi.
    """
    if settings.DEBUG:
        return
    backend = (settings.CHANNEL_LAYERS or {}).get("default", {}).get("BACKEND", "")
    if "InMemoryChannelLayer" not in backend:
        return
    optout = (os.environ.get("ALLOW_INMEMORY_CHANNELS") or "").strip().lower() in (
        "1",
        "true",
        "yes",
    )
    msg = (
        "CHANNEL_LAYERS=InMemoryChannelLayer (prod) — REDIS_URL o'rnatilmagan. "
        "Ko'p worker'da WebSocket proctoring (LiveMonitor) worker'lar orasida ishlamaydi."
    )
    if optout:
        logger.warning("%s ALLOW_INMEMORY_CHANNELS=1 — faqat WEB_CONCURRENCY=1 bilan ishlating.", msg)
    else:
        logger.error("%s REDIS_URL qo'shing yoki ALLOW_INMEMORY_CHANNELS=1 (single-process).", msg)


class CoreConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.core"
    label = "core"
    verbose_name = "Core"

    def ready(self):
        from . import checks  # noqa: F401 — @register() system checks

        _warn_inmemory_channel_layer_at_boot()
