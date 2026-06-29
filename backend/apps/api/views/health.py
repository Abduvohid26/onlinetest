"""Health / readiness endpointlari."""
from __future__ import annotations

from apps.api.views._helpers import *  # noqa: F401,F403


@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):
    """Umumiy holat + DB tekshiruvi (monitoring / eski mijozlar bilan mos)."""
    import time

    from django.db import connection

    db_ok = False
    db_ms = None
    try:
        t0 = time.perf_counter()
        connection.ensure_connection()
        with connection.cursor() as cur:
            cur.execute("SELECT 1")
            cur.fetchone()
        db_ms = round((time.perf_counter() - t0) * 1000, 2)
        db_ok = True
    except Exception:
        db_ok = False
    return Response(
        {
            "ok": True,
            "service": "fjsti-exam-api",
            "request_id": _request_id(request),
            "database": db_ok,
            "db_latency_ms": db_ms,
            "build": _health_build_ref(),
        }
    )


@api_view(["GET"])
@permission_classes([AllowAny])
def health_live(request):
    """Kubernetes / load balancer liveness — DBsiz, tez."""
    return Response(
        {
            "ok": True,
            "live": True,
            "service": "fjsti-exam-api",
            "request_id": _request_id(request),
            "build": _health_build_ref(),
        }
    )


@api_view(["GET"])
@permission_classes([AllowAny])
def health_ready(request):
    """Readiness — baza ulanishi bo‘lmasa 503."""
    import time

    from django.db import connection

    try:
        t0 = time.perf_counter()
        connection.ensure_connection()
        with connection.cursor() as cur:
            cur.execute("SELECT 1")
            cur.fetchone()
        db_ms = round((time.perf_counter() - t0) * 1000, 2)
    except Exception:
        return Response(
            {
                "ok": False,
                "ready": False,
                "service": "fjsti-exam-api",
                "request_id": _request_id(request),
                "database": False,
            },
            status=503,
        )
    return Response(
        {
            "ok": True,
            "ready": True,
            "service": "fjsti-exam-api",
            "request_id": _request_id(request),
            "database": True,
            "db_latency_ms": db_ms,
            "build": _health_build_ref(),
        }
    )
