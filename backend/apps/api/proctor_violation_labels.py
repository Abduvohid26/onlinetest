"""Qoidabuzarlik turlari uchun talaba ko'rinishidagi sabab matnlari."""
from __future__ import annotations

VIOLATION_REASON_UZ: dict[str, str] = {
    "SUSPICIOUS_AUDIO": "Shovqin aniqlandi! Jimlik saqlang, gapirmang.",
    "FACE_NOT_VISIBLE": "Yuzingiz kamerada ko'rinmayapti! To'g'ri o'tiring va kameraga qarang.",
    "MULTIPLE_FACES": "Kadrda bir nechta shaxs aniqlandi! Boshqalar kameradan uzoqlashsin.",
    "FORBIDDEN_OBJECT_CELL_PHONE": "Telefon aniqlandi! Imtihon davomida telefon ishlatmang.",
    "FORBIDDEN_OBJECT_LAPTOP": "Noutbuk aniqlandi! Ruxsatsiz qurilmani olib qo'ying.",
    "FORBIDDEN_OBJECT_BOOK": "Kitob aniqlandi! Ruxsatsiz materiallarni olib qo'ying.",
    "TAB_SWITCH_SOFT": "Boshqa oynaga o'tildi! Imtihon oynasini yopmang.",
    "TAB_SWITCH_HARD": "Imtihon oynasidan chiqib ketildi! Qaytib keling.",
    "CLIPBOARD_ATTEMPT": "Nusxa ko'chirish urinishi aniqlandi!",
    "PRINT_SCREEN": "Ekran surati olish urinishi aniqlandi!",
    "DEVTOOLS_OPEN": "Developer tools ochish urinishi aniqlandi!",
    "FULLSCREEN_EXIT_HARD": "To'liq ekrandan chiqildi! Qaytib kirish uchun ekranga bosing.",
    "REMOTE_CONTROL_SUSPECTED": "Masofaviy boshqaruv aniqlandi!",
    "IDENTITY_SUBSTITUTION": "Boshqa shaxs aniqlandi! Imtihon xavfsizligi buzildi.",
    "GAZE_AWAY_LEFT": "To'g'ri qarang! Chapga emas, ekranga qarang.",
    "GAZE_AWAY_RIGHT": "To'g'ri qarang! O'ngga emas, ekranga qarang.",
    "GAZE_AWAY_UP": "To'g'ri qarang! Tepaga emas, ekranga qarang.",
    "GAZE_AWAY_DOWN": "To'g'ri qarang! Pastga emas, ekranga qarang.",
    "WHISPER_OR_CONVERSATION_SUSPECTED": "Gapirish aniqlandi! O'zingiz yoki atrofingizda ovoz chiqmasin, jimlik saqlang.",
    "CAMERA_MIC_ACCESS_FAILED": "Kamera yoki mikrofon ishlamayapti! Ruxsat bering.",
    "VIRTUAL_WEBCAM_SUSPECTED": "Virtual kamera aniqlandi! Haqiqiy kamerani ishlating.",
    "FACE_TURNED_AWAY": "To'g'ri qarang! Yuzingizni kameradan burmang.",
    "EXCESSIVE_MOVEMENT": "Haddan tashqari qimirlash aniqlandi! Tinchoq o'tiring.",
    "HAND_GESTURE_SUSPECTED": "Qo'l ko'tarish aniqlandi! Qo'llaringizni stolda ushlab turing.",
    "MOUTH_MOVEMENT_TALKING": "Gapirish aniqlandi! Ovoz chiqarmang.",
    "FACE_TOO_FAR": "Kameradan juda uzoqsiz! Yaqinroq o'tiring.",
    "FACE_TOO_CLOSE": "Kameraga juda yaqinsiz! Biroz uzoqroq o'tiring.",
    "FACE_OFF_CENTER": "Yuzingiz kadr markazida emas! O'rtaga to'g'ri o'tiring.",
    "PROCTOR_FEED_LOST": "Kamera oqimi to'xtab qoldi! Kamera ulanishini tekshiring.",
}


def violation_reason_text(vtype: str) -> str:
    key = str(vtype or "").strip()
    return VIOLATION_REASON_UZ.get(key, key)
