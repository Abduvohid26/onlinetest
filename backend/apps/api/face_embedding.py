"""Yuz embedding — OpenCV YuNet + SFace (cosine similarity). OpenAI Vision emas."""
from __future__ import annotations

import base64
import logging
import os
import threading
from functools import lru_cache
from pathlib import Path
from typing import Any

from apps.api.identity_log import log_identity

_logger = logging.getLogger(__name__)

_MODELS_DIR = Path(__file__).resolve().parent / "face_models"
_YUNET = _MODELS_DIR / "face_detection_yunet_2023mar.onnx"
_SFACE = _MODELS_DIR / "face_recognition_sface_2021dec.onnx"

_ENGINE_LOCK = threading.Lock()
_ENGINE: dict[str, Any] | None = None


def _cosine_threshold() -> float:
    raw = (os.environ.get("FACE_MATCH_COSINE_THRESHOLD") or "0.40").strip()
    try:
        return max(0.2, min(0.95, float(raw)))
    except ValueError:
        return 0.40


def _decode_b64_image(data_b64: str) -> bytes | None:
    s = (data_b64 or "").strip()
    if "," in s:
        s = s.split(",", 1)[1].strip()
    pad = len(s) % 4
    if pad:
        s += "=" * (4 - pad)
    try:
        raw = base64.b64decode(s, validate=False)
    except Exception:
        return None
    return raw if len(raw) >= 80 else None


def _ensure_models() -> bool:
    if _YUNET.is_file() and _SFACE.is_file():
        return True
    urls = {
        _YUNET: "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
        _SFACE: "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx",
    }
    try:
        import urllib.request

        _MODELS_DIR.mkdir(parents=True, exist_ok=True)
        for path, url in urls.items():
            if path.is_file():
                continue
            _logger.info("Downloading face model %s", path.name)
            urllib.request.urlretrieve(url, path)  # noqa: S310
        return _YUNET.is_file() and _SFACE.is_file()
    except Exception as exc:
        _logger.warning("face model download failed: %s", exc)
        return False


def _engine_available() -> bool:
    try:
        import cv2  # noqa: F401

        return hasattr(cv2, "FaceRecognizerSF") and hasattr(cv2, "FaceDetectorYN")
    except Exception:
        return False


def _get_engine() -> dict[str, Any] | None:
    global _ENGINE
    if _ENGINE is not None:
        return _ENGINE
    if not _engine_available() or not _ensure_models():
        return None
    with _ENGINE_LOCK:
        if _ENGINE is not None:
            return _ENGINE
        try:
            import cv2

            detector = cv2.FaceDetectorYN.create(
                str(_YUNET),
                "",
                (320, 320),
                score_threshold=0.65,
                nms_threshold=0.3,
                top_k=5000,
            )
            recognizer = cv2.FaceRecognizerSF.create(str(_SFACE), "")
            _ENGINE = {"detector": detector, "recognizer": recognizer, "cv2": cv2}
            return _ENGINE
        except Exception as exc:
            _logger.warning("face engine init failed: %s", exc)
            return None


def _bytes_to_bgr(image_bytes: bytes):
    import cv2
    import numpy as np

    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    return img


def _largest_face(faces):
    if faces is None or len(faces) == 0:
        return None
    return max(faces, key=lambda f: float(f[2]) * float(f[3]))


def _extract_feature(image_bytes: bytes, engine: dict[str, Any]) -> tuple[Any | None, str | None]:
    cv2 = engine["cv2"]
    detector = engine["detector"]
    recognizer = engine["recognizer"]

    img = _bytes_to_bgr(image_bytes)
    if img is None or img.size == 0:
        return None, "INVALID_IMAGE"

    h, w = img.shape[:2]
    if w < 48 or h < 48:
        return None, "IMAGE_TOO_SMALL"

    detector.setInputSize((w, h))
    _, faces = detector.detect(img)
    face = _largest_face(faces)
    if face is None:
        return None, "FACE_NOT_DETECTED"

    aligned = recognizer.alignCrop(img, face)
    feature = recognizer.feature(aligned)
    return feature, None


@lru_cache(maxsize=1)
def face_engine_ready() -> bool:
    return _get_engine() is not None


def compare_face_images(profile_b64: str, live_b64: str) -> dict:
    """
    Ikki rasmni SFace embedding orqali solishtiradi.
    Returns:
        success, match, score (cosine), method, code?, detail?
    """
    engine = _get_engine()
    if engine is None:
        log_identity("embedding_skip", reason="FACE_ENGINE_UNAVAILABLE")
        return {"success": False, "code": "FACE_ENGINE_UNAVAILABLE"}

    p_bytes = _decode_b64_image(profile_b64)
    l_bytes = _decode_b64_image(live_b64)
    if not p_bytes or not l_bytes:
        return {"success": False, "code": "INVALID_IMAGE"}

    cv2 = engine["cv2"]
    recognizer = engine["recognizer"]
    threshold = _cosine_threshold()

    log_identity("embedding_start", profile_kb=round(len(p_bytes) / 1024, 1), live_kb=round(len(l_bytes) / 1024, 1))

    p_feat, p_err = _extract_feature(p_bytes, engine)
    if p_feat is None:
        code = p_err or "FACE_NOT_DETECTED"
        log_identity("embedding_fail", side="profile", code=code)
        return {"success": True, "match": False, "score": 0.0, "method": "embedding", "code": code}

    l_feat, l_err = _extract_feature(l_bytes, engine)
    if l_feat is None:
        code = l_err or "FACE_NOT_DETECTED"
        log_identity("embedding_fail", side="live", code=code)
        return {"success": True, "match": False, "score": 0.0, "method": "embedding", "code": code}

    score = float(recognizer.match(p_feat, l_feat, cv2.FaceRecognizerSF_FR_COSINE))
    matched = score >= threshold
    log_identity(
        "embedding_done",
        match=matched,
        score=round(score, 4),
        threshold=threshold,
    )
    return {
        "success": True,
        "match": matched,
        "score": round(score, 4),
        "method": "embedding",
        "threshold": threshold,
    }


def _decode_frame_b64(frame_b64: str) -> bytes | None:
    return _decode_b64_image(frame_b64)


def _detect_faces_raw(image_bytes: bytes, engine: dict[str, Any]):
    """Barcha yuzlar (YuNet) — proktor uchun."""
    cv2 = engine["cv2"]
    detector = engine["detector"]
    img = _bytes_to_bgr(image_bytes)
    if img is None or img.size == 0:
        return None, []
    h, w = img.shape[:2]
    detector.setInputSize((w, h))
    _, faces = detector.detect(img)
    if faces is None or len(faces) == 0:
        return img, []
    return img, list(faces)


def analyze_proctor_frame_local(frame_b64: str) -> dict:
    """
    OpenCV YuNet — yuz soni va kadr markazidan og‘ish (qarab ketish).
    OpenAI kerak emas.
    """
    engine = _get_engine()
    if engine is None:
        return {"ok": False, "code": "FACE_ENGINE_UNAVAILABLE"}

    raw = _decode_frame_b64(frame_b64)
    if not raw:
        return {"ok": False, "code": "INVALID_IMAGE"}

    img, faces = _detect_faces_raw(raw, engine)
    if img is None:
        return {"ok": False, "code": "INVALID_IMAGE"}

    ih, iw = img.shape[:2]
    face_count = len(faces)
    violations: list[str] = []

    if face_count == 0:
        violations.append("FACE_NOT_VISIBLE")
    elif face_count >= 2:
        violations.append("MULTIPLE_FACES")
    else:
        face = faces[0]
        fx, fy, fw, fh = float(face[0]), float(face[1]), float(face[2]), float(face[3])
        cx = fx + fw / 2.0
        cy = fy + fh / 2.0
        rel_x = (cx - iw / 2.0) / max(iw, 1)
        rel_y = (cy - ih / 2.0) / max(ih, 1)
        # Yuz markazdan ancha siljiganda — qarab ketish / uxlash holati
        if rel_x < -0.18:
            violations.append("GAZE_AWAY_LEFT")
        elif rel_x > 0.18:
            violations.append("GAZE_AWAY_RIGHT")
        if rel_y < -0.14:
            violations.append("GAZE_AWAY_UP")
        elif rel_y > 0.18:
            violations.append("GAZE_AWAY_DOWN")

    return {
        "ok": True,
        "face_count": face_count,
        "violations": violations,
        "forbidden_objects": [],
        "looking_away": any(v.startswith("GAZE_AWAY") for v in violations),
        "method": "opencv",
    }
