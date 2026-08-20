"""Reverse proxy va kuzatuvchanlik uchun middleware."""
from __future__ import annotations

import logging
import re
import uuid

from apps.core import request_context as rc

# Tracing: faqat xavfsiz belgilar (header injection oldini olish)
_REQUEST_ID_SAFE = re.compile(r"^[a-zA-Z0-9._-]{8,128}$")


class RequestIdMiddleware:
    """
    X-Request-Id: mijoz yuborsa (valid bo‘lsa) qayta ishlatiladi, aks holda UUID.
    Javob sarlavhasi va logging filter orqali bog‘lanadi.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        raw = request.META.get("HTTP_X_REQUEST_ID")
        if isinstance(raw, str) and _REQUEST_ID_SAFE.match(raw.strip()):
            rid = raw.strip()
        else:
            rid = str(uuid.uuid4())
        request.request_id = rid  # type: ignore[attr-defined]
        token = rc.set_request_id(rid)
        try:
            response = self.get_response(request)
        finally:
            rc.reset_request_id(token)
        if response is not None and hasattr(response, "__setitem__"):
            response["X-Request-Id"] = rid
        return response


class RequestIdLogFilter(logging.Filter):
    """Formatterda %(request_id)s ishlatish uchun."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = rc.get_request_id() or "-"  # type: ignore[attr-defined]
        return True


class IdentityCompareLogMiddleware:
    """POST /api/student/identity-compare — terminalda [YUZ] log (debug)."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        path = (request.path or "").rstrip("/")
        if request.method == "POST" and path.endswith("/api/student/identity-compare"):
            from apps.api.identity_log import log_identity

            uid = getattr(getattr(request, "user", None), "id", None) or "anon"
            log_identity("http_in", method="POST", path=path, user_id=uid)
        response = self.get_response(request)
        if request.method == "POST" and path.endswith("/api/student/identity-compare"):
            from apps.api.identity_log import log_identity

            status = getattr(response, "status_code", "?")
            log_identity("http_out", status=status)
        return response


class SecurityHeadersMiddleware:
    """Prod uchun qo‘shimcha HTTP xavfsizlik sarlavalari (API JSON)."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if response is None or not hasattr(response, "setdefault"):
            return response
        # Permissions-Policy: kamera/mikrofon imtihon uchun kerak; geolocation o‘chirilgan
        response.setdefault(
            "Permissions-Policy",
            "camera=(self), microphone=(self), geolocation=(), payment=()",
        )
        response.setdefault("Referrer-Policy", "same-origin")
        # Nginx ham qo‘shishi mumkin; API javoblarida qayta ishlatish xavfsiz.
        response.setdefault("X-Content-Type-Options", "nosniff")
        response.setdefault("X-Frame-Options", "DENY")
        # XSS yuzasidan qo‘shimcha himoya (SPA + API)
        #
        # DIQQAT — `'wasm-unsafe-eval'` MAJBURIY. `script-src` ko‘rsatilgan
        # bo‘lsa, Chrome `WebAssembly.instantiate()` ni CSP bilan bloklaydi.
        # Ishlab turgan serverda aynan shu sabab MediaPipe hech qachon ishga
        # tushmagan va butun real-time nazorat (yuz, nigoh, bosh burilishi,
        # pozitsiya, qo‘l, ob’ekt) jimgina o‘chiq turgan — tashqaridan esa
        # "kamera ishlayapti" bo‘lib ko‘rinardi.
        #
        # `worker-src 'self' blob:` — MediaPipe/onnxruntime blob-worker ochadi;
        # usiz u `default-src 'self'` ga tushib bloklanadi.
        #
        # Regressiya testi: `e2e/tests/mediapipe-csp.spec.ts`.
        response.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; "
            "worker-src 'self' blob:; img-src 'self' data: https: blob:; "
            "connect-src 'self' https: wss:; media-src 'self' blob:; "
            "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
        )
        return response
