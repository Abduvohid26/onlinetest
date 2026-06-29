"""Celery app — background AI tasklari (proctoring, identity).

Broker yo'q bo'lsa (CELERY_BROKER_URL/REDIS_URL o'rnatilmagan) settings da
CELERY_TASK_ALWAYS_EAGER=True bo'ladi — task'lar web jarayonida sync ishlaydi,
ya'ni eski (queue'siz) xulq saqlanadi. Bu dev/test va Redis'siz deploy uchun xavfsiz.
"""
from __future__ import annotations

import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "exam_platform.settings")

app = Celery("exam_platform")
# Sozlamalarni Django settings'dan CELERY_ prefiksi bilan o'qiydi.
app.config_from_object("django.conf:settings", namespace="CELERY")
# apps/*/tasks.py larni avtomatik topadi (apps.api.tasks).
app.autodiscover_tasks()
