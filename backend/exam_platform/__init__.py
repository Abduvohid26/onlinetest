"""exam_platform paketi.

Celery app'ni Django ishga tushganda yuklaymiz — shunda @shared_task'lar
default app'ga bog'lanadi va `celery -A exam_platform` ishlaydi.
"""
from exam_platform.celery import app as celery_app

__all__ = ("celery_app",)
