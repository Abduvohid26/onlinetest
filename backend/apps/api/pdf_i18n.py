"""PDF sertifikat va BAN hisobot matnlari (uz / ru / en)."""
from __future__ import annotations

SUPPORTED_PDF_LANGS = ("uz", "ru", "en")


def normalize_pdf_lang(lang: str | None) -> str:
    l = (lang or "uz").lower().strip()[:2]
    return l if l in SUPPORTED_PDF_LANGS else "uz"


def resolve_pdf_language(request, exam=None) -> str:
    """Talaba UI tili yoki imtihon tili — PDF uchun."""
    from apps.api.services import effective_exam_language, resolve_student_exam_language

    if exam is not None:
        return effective_exam_language(exam, resolve_student_exam_language(request, exam))
    header = str(getattr(request, "META", {}).get("HTTP_X_STUDENT_LANG") or "").lower().strip()[:2]
    if header in SUPPORTED_PDF_LANGS:
        return header
    qp = getattr(request, "query_params", None)
    if qp is not None:
        q = str(qp.get("lang") or "").lower().strip()[:2]
        if q in SUPPORTED_PDF_LANGS:
            return q
    return "uz"


def _tri(uz: str, ru: str, en: str) -> dict[str, str]:
    return {"uz": uz, "ru": ru, "en": en}


_VIOLATIONS: dict[str, dict[str, str]] = {
    "TAB_SWITCH_HARD": _tri(
        "Boshqa oynaga/varaqqa o'tish (qat'iy)",
        "Переход в другое окно/вкладку (строго)",
        "Switched to another window/tab (strict)",
    ),
    "FULLSCREEN_EXIT_HARD": _tri(
        "To'liq ekrandan chiqish (qat'iy)",
        "Выход из полноэкранного режима (строго)",
        "Exited fullscreen (strict)",
    ),
    "IDENTITY_SUBSTITUTION": _tri(
        "Boshqa shaxs aniqlandi (yuz almashtirildi)",
        "Обнаружена подмена личности (другое лицо)",
        "Identity substitution detected (different face)",
    ),
    "REMOTE_CONTROL_SUSPECTED": _tri(
        "Masofadan boshqarish dasturi aniqlandi",
        "Обнаружено ПО удалённого управления",
        "Remote control software detected",
    ),
    "FACE_NOT_VISIBLE": _tri(
        "Yuz kamerada ko'rinmadi",
        "Лицо не видно в камере",
        "Face not visible on camera",
    ),
    "MULTIPLE_FACES": _tri(
        "Kadrda bir nechta shaxs aniqlandi",
        "В кадре несколько человек",
        "Multiple people in frame",
    ),
    "SUSPICIOUS_AUDIO": _tri(
        "Shubhali ovoz/shovqin aniqlandi",
        "Обнаружен подозрительный звук/шум",
        "Suspicious audio/noise detected",
    ),
    "FORBIDDEN_OBJECT_CELL_PHONE": _tri("Telefon aniqlandi", "Обнаружен телефон", "Phone detected"),
    "FORBIDDEN_OBJECT_LAPTOP": _tri("Noutbuk aniqlandi", "Обнаружен ноутбук", "Laptop detected"),
    "FORBIDDEN_OBJECT_BOOK": _tri("Kitob aniqlandi", "Обнаружена книга", "Book detected"),
    "FORBIDDEN_OBJECT_CELL_PHONE_DETECTED": _tri("Telefon aniqlandi", "Обнаружен телефон", "Phone detected"),
    "COPY_PASTE_ATTEMPT": _tri("Nusxa ko'chirish urinishi", "Попытка копирования", "Copy attempt"),
    "PRINT_SCREEN_ATTEMPT": _tri("Ekran suratga olish urinishi", "Попытка снимка экрана", "Screenshot attempt"),
    "PRINT_SCREEN": _tri("Ekran suratga olish urinishi", "Попытка снимка экрана", "Screenshot attempt"),
    "DEVTOOLS_OPEN": _tri("Dasturchi vositalari ochildi", "Открыты инструменты разработчика", "Developer tools opened"),
    "CLIPBOARD_ATTEMPT": _tri("Nusxa / buferga urinish", "Попытка доступа к буферу обмена", "Clipboard access attempt"),
    "CLIPBOARD_ACCESS": _tri("Bufer xotirasiga kirish", "Доступ к буферу обмена", "Clipboard access"),
    "GAZE_AWAY_LEFT": _tri("Kameradan chapga uzoq qarash", "Долгий взгляд влево от камеры", "Prolonged gaze to the left"),
    "GAZE_AWAY_RIGHT": _tri("Kameradan o'ngga uzoq qarash", "Долгий взгляд вправо от камеры", "Prolonged gaze to the right"),
    "GAZE_AWAY_UP": _tri("Tepaga uzoq qarash", "Долгий взгляд вверх", "Prolonged gaze upward"),
    "GAZE_AWAY_DOWN": _tri("Pastga uzoq qarash", "Долгий взгляд вниз", "Prolonged gaze downward"),
    "WHISPER_OR_CONVERSATION_SUSPECTED": _tri(
        "Gapirish / suhbat shubhasi", "Подозрение на разговор/шёпот", "Speech/conversation suspected",
    ),
    "TAB_SWITCH_SOFT": _tri("Boshqa varaqqa o'tish", "Переход на другую вкладку", "Switched to another tab"),
    "FACE_TURNED_AWAY": _tri("Yuz kameradan burilgan", "Лицо отвернуто от камеры", "Face turned away from camera"),
    "EXCESSIVE_MOVEMENT": _tri("Haddan tashqari qimirlash", "Чрезмерные движения", "Excessive movement"),
    "HAND_GESTURE_SUSPECTED": _tri(
        "Qo'l ko'tarish / shubhali harakat", "Поднятие руки / подозрительное движение", "Hand raise / suspicious gesture",
    ),
    "MOUTH_MOVEMENT_TALKING": _tri(
        "Og'iz harakati / gapirish aniqlandi", "Движение губ / обнаружена речь", "Mouth movement / talking detected",
    ),
    "FACE_TOO_FAR": _tri("Kameradan juda uzoq", "Слишком далеко от камеры", "Too far from camera"),
    "FACE_TOO_CLOSE": _tri("Kameraga juda yaqin", "Слишком близко к камере", "Too close to camera"),
    "FACE_OFF_CENTER": _tri("Yuz kadr markazida emas", "Лицо не в центре кадра", "Face off-center"),
    "PROCTOR_FEED_LOST": _tri("Kamera oqimi to'xtadi", "Поток камеры прерван", "Camera feed lost"),
    "CAMERA_MIC_ACCESS_FAILED": _tri(
        "Kamera yoki mikrofon ishlamadi", "Камера или микрофон недоступны", "Camera or microphone failed",
    ),
    "VIRTUAL_WEBCAM_SUSPECTED": _tri("Virtual kamera aniqlandi", "Обнаружена виртуальная камера", "Virtual webcam suspected"),
}

_BAN_REASONS: dict[str, dict[str, str]] = {
    "TAB_SWITCH_HARD": _tri(
        "Imtihon davomida boshqa brauzer oynasiga yoki varaqqa o'tildi.",
        "Во время экзамена был выполнен переход в другое окно или вкладку браузера.",
        "During the exam, the student switched to another browser window or tab.",
    ),
    "FULLSCREEN_EXIT_HARD": _tri(
        "Imtihon davomida to'liq ekran rejimidan chiqildi.",
        "Во время экзамена был выход из полноэкранного режима.",
        "Fullscreen mode was exited during the exam.",
    ),
    "IDENTITY_SUBSTITUTION": _tri(
        "Kamera orqali yuz taqqoslashda profil rasmi bilan mos kelmaydigan shaxs aniqlandi — darhol bloklash.",
        "При сравнении лица с фото профиля обнаружено несоответствие — немедленная блокировка.",
        "Face verification did not match the profile photo — immediate block.",
    ),
    "REMOTE_CONTROL_SUSPECTED": _tri(
        "Kompyuterda masofadan boshqarish dasturi (AnyDesk, TeamViewer va boshqalar) aniqlandi.",
        "На компьютере обнаружено ПО удалённого доступа (AnyDesk, TeamViewer и др.).",
        "Remote access software (AnyDesk, TeamViewer, etc.) was detected.",
    ),
    "FACE_NOT_VISIBLE": _tri(
        "Talaba kamera oldidan uzoq vaqt ketdi yoki yuzini yashirdi.",
        "Студент долго отсутствовал перед камерой или скрывал лицо.",
        "The student was away from the camera or hid their face for an extended time.",
    ),
    "MULTIPLE_FACES": _tri(
        "Imtihon davomida kadrda bir nechta shaxs aniqlandi.",
        "Во время экзамена в кадре было несколько человек.",
        "Multiple people were visible in the frame during the exam.",
    ),
    "SUSPICIOUS_AUDIO": _tri(
        "Imtihon davomida shubhali ovoz yoki gapirish aniqlandi.",
        "Во время экзамена зафиксирован подозрительный звук или речь.",
        "Suspicious audio or speech was detected during the exam.",
    ),
    "WHISPER_OR_CONVERSATION_SUSPECTED": _tri(
        "Imtihon davomida suhbat yoki pichirlash aniqlandi.",
        "Во время экзамена зафиксирован разговор или шёпот.",
        "Conversation or whispering was detected during the exam.",
    ),
    "FORBIDDEN_OBJECT_CELL_PHONE": _tri(
        "Imtihon davomida telefon aniqlandi.",
        "Во время экзамена обнаружен телефон.",
        "A phone was detected during the exam.",
    ),
    "FORBIDDEN_OBJECT_LAPTOP": _tri(
        "Imtihon davomida ruxsatsiz noutbuk aniqlandi.",
        "Во время экзамена обнаружен неразрешённый ноутбук.",
        "An unauthorized laptop was detected during the exam.",
    ),
    "FORBIDDEN_OBJECT_BOOK": _tri(
        "Imtihon davomida ruxsatsiz kitob/materiallar aniqlandi.",
        "Во время экзамена обнаружены неразрешённые книги/материалы.",
        "Unauthorized books/materials were detected during the exam.",
    ),
    "CLIPBOARD_ATTEMPT": _tri(
        "Nusxa ko'chirish yoki buferga urinish aniqlandi.",
        "Зафиксирована попытка копирования или доступа к буферу.",
        "A copy or clipboard access attempt was detected.",
    ),
    "PRINT_SCREEN": _tri(
        "Ekran suratga olish urinishi aniqlandi.",
        "Зафиксирована попытка снимка экрана.",
        "A screenshot attempt was detected.",
    ),
    "DEVTOOLS_OPEN": _tri(
        "Dasturchi vositalarini ochish urinishi aniqlandi.",
        "Зафиксирована попытка открыть инструменты разработчика.",
        "An attempt to open developer tools was detected.",
    ),
    "FACE_TURNED_AWAY": _tri(
        "Yuz kameradan burilgan holda imtihon qoidalari buzildi.",
        "Правила экзамена нарушены: лицо отвернуто от камеры.",
        "Exam rules violated: face turned away from the camera.",
    ),
    "EXCESSIVE_MOVEMENT": _tri(
        "Haddan tashqari qimirlash aniqlandi.",
        "Зафиксированы чрезмерные движения.",
        "Excessive movement was detected.",
    ),
    "HAND_GESTURE_SUSPECTED": _tri(
        "Qo'l ko'tarish yoki shubhali harakat aniqlandi.",
        "Зафиксировано поднятие руки или подозрительное движение.",
        "Hand raising or a suspicious gesture was detected.",
    ),
    "MOUTH_MOVEMENT_TALKING": _tri(
        "Og'iz harakati / gapirish aniqlandi.",
        "Зафиксировано движение губ / речь.",
        "Mouth movement / talking was detected.",
    ),
    "FACE_TOO_FAR": _tri(
        "Kameradan juda uzoq o'tirilgan.",
        "Студент сидел слишком далеко от камеры.",
        "The student sat too far from the camera.",
    ),
    "FACE_TOO_CLOSE": _tri(
        "Kameraga juda yaqin o'tirilgan.",
        "Студент сидел слишком близко к камере.",
        "The student sat too close to the camera.",
    ),
    "FACE_OFF_CENTER": _tri(
        "Yuz kadr markazida emas edi.",
        "Лицо не находилось в центре кадра.",
        "The face was not centered in the frame.",
    ),
    "PROCTOR_FEED_LOST": _tri(
        "Kamera oqimi to'xtab qoldi.",
        "Поток камеры был прерван.",
        "The camera feed was interrupted.",
    ),
    "CAMERA_MIC_ACCESS_FAILED": _tri(
        "Kamera yoki mikrofon ishlamadi.",
        "Камера или микрофон не работали.",
        "The camera or microphone did not work.",
    ),
    "VIRTUAL_WEBCAM_SUSPECTED": _tri(
        "Virtual kamera ishlatilgani aniqlandi.",
        "Обнаружено использование виртуальной камеры.",
        "Use of a virtual webcam was detected.",
    ),
    "GAZE_AWAY_LEFT": _tri(
        "Ekrandan uzoq vaqt chapga qaraldi.",
        "Долгое отведение взгляда влево от экрана.",
        "Prolonged gaze to the left of the screen.",
    ),
    "GAZE_AWAY_RIGHT": _tri(
        "Ekrandan uzoq vaqt o'ngga qaraldi.",
        "Долгое отведение взгляда вправо от экрана.",
        "Prolonged gaze to the right of the screen.",
    ),
    "GAZE_AWAY_UP": _tri(
        "Ekrandan uzoq vaqt tepaga qaraldi.",
        "Долгое отведение взгляда вверх от экрана.",
        "Prolonged upward gaze away from the screen.",
    ),
    "GAZE_AWAY_DOWN": _tri(
        "Ekrandan uzoq vaqt pastga qaraldi.",
        "Долгое отведение взгляда вниз от экрана.",
        "Prolonged downward gaze away from the screen.",
    ),
    "TAB_SWITCH_SOFT": _tri(
        "Imtihon davomida boshqa varaqqa o'tildi.",
        "Во время экзамена был переход на другую вкладку.",
        "The student switched to another tab during the exam.",
    ),
}

_UI: dict[str, dict[str, str]] = {
    "uz": {
        "institute_name": "FARG'ONA JAMOAT SALOMATLIGI TIBBIYOT INSTITUTI",
        "footer_doc": "Farg\u2019ona jamoat salomatligi tibbiyot instituti \u2014 avtomatik shakllantirilgan hujjat",
        "page_suffix": "{n}-bet",
        "qr_verify": "QR tekshiruv",
        "cert_title": "Onlayn imtihon sertifikati",
        "cert_subtitle": "Hujjat raqamli QR orqali tekshiriladi",
        "ban_title": "Rasmiy intizomiy bayonnoma",
        "ban_subtitle": "BAN hisobot \u2014 QR orqali tekshiriladi",
        "ban_hint": "Avtomatik shakllantirilgan ichki nazorat hujjati",
        "result_id": "Natija ID",
        "student": "Talaba",
        "student_id": "Talaba ID",
        "full_name": "F.I.Sh.",
        "exam": "Imtihon",
        "completed_at": "Yakunlangan sana",
        "issued_at": "Berilgan sana",
        "integrity_code": "Yaxlitlik kodi",
        "verify_url": "Tekshiruv havolasi",
        "passed_badge": "MUVAFFAQIYATLI O'TDI",
        "failed_badge": "O'TA OLMADI",
        "scoring_rule": "Hisoblash: har bir to'g'ri javob 1 ball ({score} / {total}). O'tish mezoni: kamida {threshold}%.",
        "overview": "Xulosa",
        "questions_detail": "Savollar bo'yicha batafsil natija",
        "questions_continued": "Savollar (davomi)",
        "your_answer": "Javobingiz",
        "correct_answer": "To'g'ri javob",
        "comment": "Izoh",
        "why_wrong": "Nima uchun noto'g'ri",
        "why_correct_right": "To'g'ri javob tushuntirishi",
        "options": "Variantlar:",
        "opt_you": "siz",
        "opt_correct": "to'g'ri",
        "student_info": "Talaba ma'lumotlari",
        "why_blocked": "Nima uchun bloklandi",
        "block_reason_title": "Bloklash sababi",
        "timeline_title": "Ogohlantirishlar va bloklash tartibi",
        "timeline_note": "Ketma-ket qoidabuzarliklar {win}s ichida bitta rasmiy ogohlantirish sifatida hisoblanadi.",
        "warning_title": "{n}-rasmiy ogohlantirish",
        "ban_step": "BAN",
        "ban_instant_title": "BAN \u2014 darhol bloklash",
        "violation_recorded": "Qoidabuzarlik qayd etilgan.",
        "ban_after_warnings": "{n} ta rasmiy ogohlantirishdan keyin imtihon to'xtatildi.",
        "last_violation": "Oxirgi qoidabuzarlik: {label}.",
        "unknown_violation": "noma'lum qoidabuzarlik",
        "instant_headline": "Darhol bloklash: {label}. Yuz almashtirish yoki shaxsni almashtirish aniqlandi \u2014 ogohlantirishsiz to'xtatildi.",
        "blocked_after_3": "3 ta rasmiy ogohlantirishdan keyin bloklandi. Oxirgi qoidabuzarlik: {label}.",
        "discipline_extra": "Intizomiy tartib: 1-ogohlantirish \u2192 2-ogohlantirish \u2192 3-ogohlantirish \u2192 BAN. Ushbu talaba {n} ta rasmiy ogohlantirish olganidan so'ng imtihon to'xtatildi.",
        "generic_headline": "Bloklash sababi: {label}.",
        "generic_extra": "Imtihon qoidalari buzilgani sababli tizim tomonidan avtomatik bloklash qo'llanildi. Jami qayd etilgan hodisalar: {count}.",
        "default_ban_reason": "Imtihon qoidalari bir necha marta buzildi. Tizim tomonidan avtomatik ravishda bloklanish amalga oshirildi.",
        "footer_policy": "Farg\u2019ona jamoat salomatligi tibbiyot instituti \u2014 ichki nazorat siyosati asosida shakllantirildi.",
        "responsible_sign": "Mas\u2019ul shaxs imzosi: ________________________________",
        "date_label": "Sana: _______________",
        "chunk_single": "[{ts}]  {label}",
        "chunk_multi": "[{t0} \u2013 {t1}]  {count} ta texnik hodisa: {labels}",
    },
    "ru": {
        "institute_name": "ФАРГОНСКИЙ ИНСТИТУТ ОБЩЕСТВЕННОГО ЗДОРОВЬЯ",
        "footer_doc": "Фаргонский институт общественного здоровья \u2014 автоматически сформированный документ",
        "page_suffix": "{n}-стр",
        "qr_verify": "Проверка QR",
        "cert_title": "Сертификат онлайн-экзамена",
        "cert_subtitle": "Документ проверяется по QR-коду",
        "ban_title": "Официальная дисциплинарная справка",
        "ban_subtitle": "Отчёт BAN \u2014 проверка по QR",
        "ban_hint": "Автоматически сформированный внутренний документ контроля",
        "result_id": "ID результата",
        "student": "Студент",
        "student_id": "ID студента",
        "full_name": "Ф.И.О.",
        "exam": "Экзамен",
        "completed_at": "Дата завершения",
        "issued_at": "Дата выдачи",
        "integrity_code": "Код целостности",
        "verify_url": "Ссылка для проверки",
        "passed_badge": "УСПЕШНО СДАН",
        "failed_badge": "НЕ СДАН",
        "scoring_rule": "Подсчёт: каждый правильный ответ = 1 балл ({score} / {total}). Порог сдачи: минимум {threshold}%.",
        "overview": "Итог",
        "questions_detail": "Подробный результат по вопросам",
        "questions_continued": "Вопросы (продолжение)",
        "your_answer": "Ваш ответ",
        "correct_answer": "Правильный ответ",
        "comment": "Комментарий",
        "why_wrong": "Почему неверно",
        "why_correct_right": "Пояснение правильного ответа",
        "options": "Варианты:",
        "opt_you": "вы",
        "opt_correct": "верно",
        "student_info": "Данные студента",
        "why_blocked": "Почему заблокирован",
        "block_reason_title": "Причина блокировки",
        "timeline_title": "Предупреждения и блокировка",
        "timeline_note": "Последовательные нарушения в течение {win} с считаются одним официальным предупреждением.",
        "warning_title": "{n}-е официальное предупреждение",
        "ban_step": "BAN",
        "ban_instant_title": "BAN \u2014 немедленная блокировка",
        "violation_recorded": "Нарушение зафиксировано.",
        "ban_after_warnings": "После {n} официальных предупреждений экзамен остановлен.",
        "last_violation": "Последнее нарушение: {label}.",
        "unknown_violation": "неизвестное нарушение",
        "instant_headline": "Немедленная блокировка: {label}. Обнаружена подмена лица \u2014 без предупреждений.",
        "blocked_after_3": "Блокировка после 3 официальных предупреждений. Последнее нарушение: {label}.",
        "discipline_extra": "Порядок: 1-е предупреждение \u2192 2-е \u2192 3-е \u2192 BAN. Экзамен остановлен после {n} предупреждений.",
        "generic_headline": "Причина блокировки: {label}.",
        "generic_extra": "Автоматическая блокировка из-за нарушения правил экзамена. Всего записей: {count}.",
        "default_ban_reason": "Правила экзамена были нарушены несколько раз. Блокировка выполнена системой автоматически.",
        "footer_policy": "Фаргонский институт общественного здоровья \u2014 сформировано на основе внутренней политики контроля.",
        "responsible_sign": "Подпись ответственного лица: ________________________________",
        "date_label": "Дата: _______________",
        "chunk_single": "[{ts}]  {label}",
        "chunk_multi": "[{t0} \u2013 {t1}]  {count} техн. событий: {labels}",
    },
    "en": {
        "institute_name": "FERGANA INSTITUTE OF PUBLIC HEALTH",
        "footer_doc": "Fergana Institute of Public Health \u2014 automatically generated document",
        "page_suffix": "p. {n}",
        "qr_verify": "QR verify",
        "cert_title": "Online exam certificate",
        "cert_subtitle": "Document verified via QR code",
        "ban_title": "Official disciplinary report",
        "ban_subtitle": "BAN report \u2014 verified via QR",
        "ban_hint": "Automatically generated internal proctoring document",
        "result_id": "Result ID",
        "student": "Student",
        "student_id": "Student ID",
        "full_name": "Full name",
        "exam": "Exam",
        "completed_at": "Completed at",
        "issued_at": "Issued at",
        "integrity_code": "Integrity code",
        "verify_url": "Verification URL",
        "passed_badge": "PASSED",
        "failed_badge": "FAILED",
        "scoring_rule": "Scoring: each correct answer = 1 point ({score} / {total}). Pass threshold: at least {threshold}%.",
        "overview": "Summary",
        "questions_detail": "Detailed results by question",
        "questions_continued": "Questions (continued)",
        "your_answer": "Your answer",
        "correct_answer": "Correct answer",
        "comment": "Comment",
        "why_wrong": "Why incorrect",
        "why_correct_right": "Why the correct answer is right",
        "options": "Options:",
        "opt_you": "you",
        "opt_correct": "correct",
        "student_info": "Student information",
        "why_blocked": "Why blocked",
        "block_reason_title": "Block reason",
        "timeline_title": "Warnings and block sequence",
        "timeline_note": "Consecutive violations within {win}s count as one official warning.",
        "warning_title": "Official warning #{n}",
        "ban_step": "BAN",
        "ban_instant_title": "BAN \u2014 immediate block",
        "violation_recorded": "Violation recorded.",
        "ban_after_warnings": "Exam stopped after {n} official warning(s).",
        "last_violation": "Last violation: {label}.",
        "unknown_violation": "unknown violation",
        "instant_headline": "Immediate block: {label}. Identity substitution detected \u2014 no prior warnings.",
        "blocked_after_3": "Blocked after 3 official warnings. Last violation: {label}.",
        "discipline_extra": "Sequence: warning 1 \u2192 2 \u2192 3 \u2192 BAN. Exam stopped after {n} warning(s).",
        "generic_headline": "Block reason: {label}.",
        "generic_extra": "Automatic block due to exam rule violations. Total logged events: {count}.",
        "default_ban_reason": "Exam rules were violated multiple times. The system applied an automatic block.",
        "footer_policy": "Fergana Institute of Public Health \u2014 generated under internal proctoring policy.",
        "responsible_sign": "Responsible officer signature: ________________________________",
        "date_label": "Date: _______________",
        "chunk_single": "[{ts}]  {label}",
        "chunk_multi": "[{t0} \u2013 {t1}]  {count} technical events: {labels}",
    },
}


class PdfTexts:
  """PDF uchun tilga mos matnlar."""

  def __init__(self, lang: str | None = "uz"):
      self.lang = normalize_pdf_lang(lang)

  def t(self, key: str, **kwargs) -> str:
      s = _UI[self.lang].get(key) or _UI["uz"].get(key, key)
      return s.format(**kwargs) if kwargs else s

  def page_label(self, page_no: int) -> str:
      return self.t("page_suffix", n=page_no)

  def violation_label(self, vtype: str) -> str:
      entry = _VIOLATIONS.get(vtype or "")
      if entry:
          return entry.get(self.lang) or entry["uz"]
      return (vtype or "").replace("_", " ").capitalize()

  def ban_reason(self, vtype: str) -> str:
      entry = _BAN_REASONS.get(vtype or "")
      if entry:
          return entry.get(self.lang) or entry["uz"]
      return self.t("default_ban_reason")

  def format_chunk_summary(
      self,
      *,
      timestamp_start: str,
      timestamp_end: str,
      count: int,
      labels: str,
  ) -> str:
      if count == 1:
          return self.t("chunk_single", ts=timestamp_start, label=labels)
      return self.t(
          "chunk_multi",
          t0=timestamp_start,
          t1=timestamp_end,
          count=count,
          labels=labels,
      )
