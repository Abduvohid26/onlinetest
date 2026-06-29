"""Background AI tasklari (Celery).

Broker yo'q bo'lsa settings.CELERY_TASK_ALWAYS_EAGER=True — bu yerdagi task'lar
web jarayonida sync ishlaydi (eski xulq). Worker bor bo'lsa, AI chaqiruvlari web
worker thread'larini band qilmaydi.

Task'lar SOF (pure) bo'lishi kerak: faqat AI hisob-kitobi, DB yozuv yo'q.
Auth/validatsiya/DB ishlari view ichida qoladi.
"""
from __future__ import annotations

import os

from celery import shared_task

# Object nomi (Vision) -> violation turi. _helpers'dagi xarita bilan bir xil.
_FORBIDDEN_OBJECT_MAP = {
    "cell_phone": "FORBIDDEN_OBJECT_CELL_PHONE",
    "cellphone": "FORBIDDEN_OBJECT_CELL_PHONE",
    "phone": "FORBIDDEN_OBJECT_CELL_PHONE",
    "laptop": "FORBIDDEN_OBJECT_LAPTOP",
    "computer": "FORBIDDEN_OBJECT_LAPTOP",
    "book": "FORBIDDEN_OBJECT_BOOK",
    "notes": "FORBIDDEN_OBJECT_BOOK",
    "notebook": "FORBIDDEN_OBJECT_BOOK",
    "paper": "FORBIDDEN_OBJECT_BOOK",
}


def run_proctor_analysis(frame_b64: str, enrich_objects: bool = False) -> dict:
    """Bitta kadrni tahlil qiladi (sof AI mantiq, DB'siz).

    Qaytadi: {"violations": [...], "face_count": int, "skipped": bool,
              "method": str|None, "code": str|None}
    """
    from apps.api.face_embedding import analyze_proctor_frame_local
    from apps.api.gemini_tools import analyze_proctor_frame

    result = analyze_proctor_frame_local(frame_b64)
    if not result.get("ok"):
        code = result.get("code", "FACE_ENGINE_UNAVAILABLE")
        # Zaxira: OpenAI/Gemini Vision (telefon/kitob aniqlash)
        ai = analyze_proctor_frame(frame_b64)
        if ai.get("ok"):
            face_count = int(ai.get("face_count") or 0)
            violations: list[str] = []
            if face_count == 0:
                violations.append("FACE_NOT_VISIBLE")
            elif face_count >= 2:
                violations.append("MULTIPLE_FACES")
            for obj in ai.get("forbidden_objects") or []:
                vtype = _FORBIDDEN_OBJECT_MAP.get(str(obj).lower().strip())
                if vtype and vtype not in violations:
                    violations.append(vtype)
            if bool(ai.get("looking_away")) and face_count == 1:
                violations.append("GAZE_AWAY_UP")
            return {
                "violations": violations,
                "face_count": face_count,
                "skipped": False,
                "method": "openai_vision",
                "code": None,
            }
        return {
            "violations": [],
            "face_count": 0,
            "skipped": True,
            "method": None,
            "code": code,
        }

    violations = list(result.get("violations") or [])
    face_count = int(result.get("face_count") or 0)

    if enrich_objects:
        ai = analyze_proctor_frame(frame_b64)
        if ai.get("ok"):
            seen = set(violations)
            for obj in ai.get("forbidden_objects") or []:
                vtype = _FORBIDDEN_OBJECT_MAP.get(str(obj).lower().strip())
                if vtype and vtype not in seen:
                    violations.append(vtype)
                    seen.add(vtype)

    return {
        "violations": violations,
        "face_count": face_count,
        "skipped": False,
        "method": result.get("method"),
        "code": None,
    }


@shared_task(name="proctor.analyze_frame", bind=True, max_retries=0)
def analyze_proctor_frame_task(self, frame_b64: str, enrich_objects: bool = False) -> dict:
    return run_proctor_analysis(frame_b64, enrich_objects)


def run_identity_compare(live_b64: str, profile_b64: str) -> dict:
    """Yuz solishtirish (sof AI mantiq). compare_faces natijasini qaytaradi."""
    from apps.api.gemini_tools import compare_faces

    return compare_faces(live_b64, profile_b64)


@shared_task(name="identity.compare_faces", bind=True, max_retries=0)
def identity_compare_task(self, live_b64: str, profile_b64: str) -> dict:
    return run_identity_compare(live_b64, profile_b64)
