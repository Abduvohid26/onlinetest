"""Yuz tekshiruvi (identity-compare) — har doim terminalga log."""

from __future__ import annotations

import logging
import sys

logger = logging.getLogger("fjsti.identity")


def log_identity(event: str, **fields: object) -> None:
    parts = [f"{k}={fields[k]}" for k in sorted(fields)]
    msg = f"[YUZ] {event} | {' '.join(parts)}"
    logger.info(msg)
    # runserver / gunicorn aralash loglarda ham ko'rinsin
    print(msg, file=sys.stderr, flush=True)
