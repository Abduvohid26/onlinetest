"""Sertifikat va BAN hisobot PDF (reportlab + QR)."""
import os
from io import BytesIO
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as rl_canvas

# Institut logosi — Docker image ichida frontend build "frontend_dist" ga joylashadi
# (Dockerfile: COPY --from=frontend-build /build/frontend/dist /app/frontend_dist).
# Lokal (docker'siz) ishga tushirish uchun "frontend/dist" va "frontend/public" ham
# zaxira sifatida tekshiriladi.
_BASE = Path(__file__).resolve().parent.parent.parent.parent
_LOGO_CANDIDATES = [
    _BASE / "frontend_dist" / "institute-logo.png",
    _BASE / "frontend" / "dist" / "institute-logo.png",
    _BASE / "frontend" / "public" / "institute-logo.png",
    _BASE / "frontend" / "src" / "assets" / "institute-logo.png",
    _BASE / "backend" / "static" / "institute-logo.png",
]

# O'tish mezoni: to'g'ri javoblar foizi (ball / jami savollar * 100).
PASS_PERCENT_THRESHOLD = max(1, min(100, int(os.environ.get("EXAM_PASS_PERCENT", "50"))))

# Dizayn ranglari
C_NAVY = colors.HexColor("#1e3a5f")
C_NAVY_LIGHT = colors.HexColor("#eef3f9")
C_RED = colors.HexColor("#c0392b")
C_RED_LIGHT = colors.HexColor("#fdf0ef")
C_GREEN = colors.HexColor("#1e9e5a")
C_GREEN_LIGHT = colors.HexColor("#ecfdf3")
C_SLATE = colors.HexColor("#334155")
C_MUTED = colors.HexColor("#64748b")
C_BORDER = colors.HexColor("#e2e8f0")
LOGO_PDF_SIZE = 78
QR_PDF_SIZE = 108
HEADER_BAND_H = 4


def result_questions_to_pdf_rows(questions: list[dict]) -> list[dict]:
    """Natija API dagi savollarni PDF uchun to'liq qatorlarga aylantiradi."""
    return [
        {
            "index": i + 1,
            "text": q.get("text"),
            "isCorrect": bool(q.get("isCorrect")),
            "studentAnswer": q.get("studentAnswer") or "",
            "correctAnswer": q.get("correctAnswer") or "",
            "commentCorrect": q.get("commentCorrect") or "",
            "whyStudentWrong": q.get("whyStudentWrong") or "",
            "whyCorrectIsRight": q.get("whyCorrectIsRight") or "",
            "options": q.get("options") or [],
        }
        for i, q in enumerate(questions)
    ]

# Kirill (rus) va lotin harflarini to'g'ri chizish uchun Unicode shrift.
# Standart PDF bazaviy shriftlari (Helvetica) faqat Latin-1 ni qo'llaydi — rus tilidagi
# savol/xulosa matnlari qora to'rtburchaklar sifatida chiqib qolardi.
_FONT_CANDIDATES = [
    ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ("/usr/share/fonts/dejavu/DejaVuSans.ttf", "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"),
]
FONT_REGULAR = "Helvetica"
FONT_BOLD = "Helvetica-Bold"
FONT_OBLIQUE = "Helvetica-Oblique"
for _reg_path, _bold_path in _FONT_CANDIDATES:
    if os.path.exists(_reg_path) and os.path.exists(_bold_path):
        try:
            pdfmetrics.registerFont(TTFont("DejaVuSans", _reg_path))
            pdfmetrics.registerFont(TTFont("DejaVuSans-Bold", _bold_path))
            FONT_REGULAR = "DejaVuSans"
            FONT_BOLD = "DejaVuSans-Bold"
            FONT_OBLIQUE = "DejaVuSans"  # DejaVu Sans Oblique odatda alohida o'rnatilmagan
            break
        except Exception:
            pass

# Violation type larni o'zbek tiliga tarjima
VIOLATION_LABELS: dict[str, str] = {
    "TAB_SWITCH_HARD":              "Boshqa oynaga/varaqqa o'tish (qat'iy)",
    "FULLSCREEN_EXIT_HARD":         "To'liq ekrandan chiqish (qat'iy)",
    "IDENTITY_SUBSTITUTION":        "Boshqa shaxs aniqlandi (yuz almashtirildi)",
    "REMOTE_CONTROL_SUSPECTED":     "Masofadan boshqarish dasturi aniqlandi",
    "FACE_NOT_VISIBLE":             "Yuz kamerada ko'rinmadi",
    "MULTIPLE_FACES":               "Kadrda bir nechta shaxs aniqlandi",
    "SUSPICIOUS_AUDIO":             "Shubhali ovoz/shovqin aniqlandi",
    "FORBIDDEN_OBJECT_CELL_PHONE":  "Telefon aniqlandi",
    "FORBIDDEN_OBJECT_LAPTOP":      "Noutbuk aniqlandi",
    "FORBIDDEN_OBJECT_BOOK":        "Kitob aniqlandi",
    "FORBIDDEN_OBJECT_CELL_PHONE_DETECTED": "Telefon aniqlandi",
    "COPY_PASTE_ATTEMPT":           "Nusxa ko'chirish urinishi",
    "PRINT_SCREEN_ATTEMPT":         "Ekran suratga olish urinishi",
    "PRINT_SCREEN":                 "Ekran suratga olish urinishi",
    "DEVTOOLS_OPEN":                "Dasturchi vositalari ochildi",
    "CLIPBOARD_ATTEMPT":            "Nusxa / buferga urinish (clipboard)",
    "CLIPBOARD_ACCESS":             "Bufer xotirasiga kirish",
    "GAZE_AWAY_LEFT":               "Kameradan chapga uzoq qarash",
    "GAZE_AWAY_RIGHT":              "Kameradan o'ngga uzoq qarash",
    "GAZE_AWAY_UP":                 "Tepaga uzoq qarash",
    "GAZE_AWAY_DOWN":               "Pastga uzoq qarash",
    "WHISPER_OR_CONVERSATION_SUSPECTED": "Gapirish / suhbat shubhasi",
    "TAB_SWITCH_SOFT":              "Boshqa varaqqa o'tish",
    "FACE_TURNED_AWAY":             "Yuz kameradan burilgan",
    "EXCESSIVE_MOVEMENT":           "Haddan tashqari qimirlash",
    "HAND_GESTURE_SUSPECTED":       "Qo'l ko'tarish / shubhali harakat",
    "MOUTH_MOVEMENT_TALKING":       "Og'iz harakati / gapirish aniqlandi",
    "FACE_TOO_FAR":                 "Kameradan juda uzoq",
    "FACE_TOO_CLOSE":               "Kameraga juda yaqin",
    "FACE_OFF_CENTER":              "Yuz kadr markazida emas",
    "PROCTOR_FEED_LOST":            "Kamera oqimi to'xtadi",
    "CAMERA_MIC_ACCESS_FAILED":     "Kamera yoki mikrofon ishlamadi",
    "VIRTUAL_WEBCAM_SUSPECTED":     "Virtual kamera aniqlandi",
}

# Ban sabablari — violation type bo'yicha (qisqa tushuntirish)
BAN_REASONS: dict[str, str] = {
    "TAB_SWITCH_HARD":              "Imtihon davomida boshqa brauzer oynasiga yoki varaqqa o'tildi.",
    "FULLSCREEN_EXIT_HARD":         "Imtihon davomida to'liq ekran rejimidan chiqildi.",
    "IDENTITY_SUBSTITUTION":        "Kamera orqali yuz taqqoslashda profil rasmi bilan mos kelmaydigan shaxs aniqlandi — darhol bloklash.",
    "REMOTE_CONTROL_SUSPECTED":     "Kompyuterda masofadan boshqarish dasturi (AnyDesk, TeamViewer va boshqalar) aniqlandi.",
    "FACE_NOT_VISIBLE":             "Talaba kamera oldidan uzoq vaqt ketdi yoki yuzini yashirdi.",
    "MULTIPLE_FACES":               "Imtihon davomida kadrda bir nechta shaxs aniqlandi.",
    "SUSPICIOUS_AUDIO":             "Imtihon davomida shubhali ovoz yoki gapirish aniqlandi.",
    "WHISPER_OR_CONVERSATION_SUSPECTED": "Imtihon davomida suhbat yoki pichirlash aniqlandi.",
    "FORBIDDEN_OBJECT_CELL_PHONE":  "Imtihon davomida telefon aniqlandi.",
    "FORBIDDEN_OBJECT_LAPTOP":      "Imtihon davomida ruxsatsiz noutbuk aniqlandi.",
    "FORBIDDEN_OBJECT_BOOK":        "Imtihon davomida ruxsatsiz kitob/materiallar aniqlandi.",
    "CLIPBOARD_ATTEMPT":            "Nusxa ko'chirish yoki buferga urinish aniqlandi.",
    "PRINT_SCREEN":                 "Ekran suratga olish urinishi aniqlandi.",
    "DEVTOOLS_OPEN":                "Dasturchi vositalarini ochish urinishi aniqlandi.",
    "FACE_TURNED_AWAY":             "Yuz kameradan burilgan holda imtihon qoidalari buzildi.",
    "EXCESSIVE_MOVEMENT":           "Haddan tashqari qimirlash aniqlandi.",
    "HAND_GESTURE_SUSPECTED":       "Qo'l ko'tarish yoki shubhali harakat aniqlandi.",
    "MOUTH_MOVEMENT_TALKING":       "Og'iz harakati / gapirish aniqlandi.",
    "FACE_TOO_FAR":                 "Kameradan juda uzoq o'tirilgan.",
    "FACE_TOO_CLOSE":               "Kameraga juda yaqin o'tirilgan.",
    "FACE_OFF_CENTER":              "Yuz kadr markazida emas edi.",
    "PROCTOR_FEED_LOST":            "Kamera oqimi to'xtab qoldi.",
    "CAMERA_MIC_ACCESS_FAILED":     "Kamera yoki mikrofon ishlamadi.",
    "VIRTUAL_WEBCAM_SUSPECTED":     "Virtual kamera ishlatilgani aniqlandi.",
    "GAZE_AWAY_LEFT":               "Ekrandan uzoq vaqt chapga qaraldi.",
    "GAZE_AWAY_RIGHT":              "Ekrandan uzoq vaqt o'ngga qaraldi.",
    "GAZE_AWAY_UP":                 "Ekrandan uzoq vaqt tepaga qaraldi.",
    "GAZE_AWAY_DOWN":               "Ekrandan uzoq vaqt pastga qaraldi.",
}

DEFAULT_BAN_REASON = (
    "Imtihon qoidalari bir necha marta buzildi. "
    "Tizim tomonidan avtomatik ravishda bloklanish amalga oshirildi."
)


def _get_logo_path() -> str | None:
    for p in _LOGO_CANDIDATES:
        if p.exists():
            return str(p)
    return None


def _violation_label(vtype: str) -> str:
    """Violation type ni o'zbek tiliga tarjima qiladi."""
    return VIOLATION_LABELS.get(vtype, vtype.replace("_", " ").capitalize())


def _group_violation_rows_for_pdf(
    rows: list[dict],
    *,
    window_sec: int = 60,
) -> list[str]:
    """
    serverdagi 60s ogohlantirish birlashishi bilan mos: birinchi hodisadan {window_sec}s
    ichidagi ketma-kelgan yozuvlarni bitta soddalashtirilgan qator sifatida ko'rsatadi.
    """
    if not rows:
        return []
    with_ts = [r for r in rows if r.get("timestamp") is not None]
    if not with_ts:
        return ["- Vaqttama yozuv topilmadi."]
    raw = sorted(with_ts, key=lambda x: x["timestamp"])
    out: list[str] = []
    i = 0
    n = len(raw)
    w = max(10, float(window_sec))
    while i < n:
        start_ts = raw[i]["timestamp"]
        chunk: list[dict] = [raw[i]]
        j = i + 1
        while j < n:
            cur = raw[j]["timestamp"]
            if (cur - start_ts).total_seconds() > w:
                break
            chunk.append(raw[j])
            j += 1
        if len(chunk) == 1:
            ts = str(chunk[0].get("timestamp") or "")[:19].replace("T", " ")
            vt = str(chunk[0].get("violation_type") or "UNKNOWN")
            out.append(f"[{ts}]  {_violation_label(vt)}")
        else:
            t0 = str(chunk[0].get("timestamp") or "")[:19].replace("T", " ")
            t1 = str(chunk[-1].get("timestamp") or "")[:19].replace("T", " ")
            labels = " — ".join(_violation_label(str(c.get("violation_type") or "UNKNOWN")) for c in chunk)
            out.append(
                f"[{t0} – {t1}]  {len(chunk)} ta texnik hodisa, 1 rasmiy ogohlantirish davrida: {labels}"
            )
        i = j
    return out


def _ban_reason_text(
    violations: list[dict],
    *,
    official_warnings: int = 0,
    last_violation_type: str = "",
) -> tuple[str, str]:
    """
    (asosiy_sabab, qo'shimcha_tushuntirish) qaytaradi.
    """
    last_type = (last_violation_type or "").strip()
    if not last_type and violations:
        last_type = str(violations[0].get("violation_type") or "")

    instant_types = {"IDENTITY_SUBSTITUTION"}
    if last_type in instant_types:
        detail = BAN_REASONS.get(last_type, DEFAULT_BAN_REASON)
        headline = (
            f"Darhol bloklash: {_violation_label(last_type)}. "
            "Yuz almashtirish yoki shaxsni almashtirish aniqlandi — ogohlantirishsiz to'xtatildi."
        )
        return headline, detail

    priority = [
        "IDENTITY_SUBSTITUTION",
        "REMOTE_CONTROL_SUSPECTED",
        "TAB_SWITCH_HARD",
        "FULLSCREEN_EXIT_HARD",
        "MULTIPLE_FACES",
        "WHISPER_OR_CONVERSATION_SUSPECTED",
        "MOUTH_MOVEMENT_TALKING",
        "FACE_NOT_VISIBLE",
    ]
    vtypes = [str(v.get("violation_type") or "") for v in violations]
    trigger_type = last_type
    if not trigger_type:
        for p in priority:
            if p in vtypes:
                trigger_type = p
                break
        if not trigger_type and vtypes:
            from collections import Counter
            trigger_type = Counter(vtypes).most_common(1)[0][0]

    trigger_label = _violation_label(trigger_type) if trigger_type else "noma'lum qoidabuzarlik"
    detail = BAN_REASONS.get(trigger_type, DEFAULT_BAN_REASON)

    warn_n = max(0, int(official_warnings or 0))
    if warn_n >= 3:
        headline = (
            f"3 ta rasmiy ogohlantirishdan keyin bloklandi. "
            f"Oxirgi qoidabuzarlik: {trigger_label}."
        )
        extra = (
            f"Intizomiy tartib: 1-ogohlantirish → 2-ogohlantirish → 3-ogohlantirish → BAN. "
            f"Ushbu talaba {warn_n} ta rasmiy ogohlantirish olganidan so'ng imtihon to'xtatildi."
        )
        return headline, f"{detail} {extra}"

    headline = f"Bloklash sababi: {trigger_label}."
    extra = (
        "Imtihon qoidalari buzilgani sababli tizim tomonidan avtomatik bloklash qo'llanildi. "
        f"Jami qayd etilgan hodisalar: {len(violations)}."
    )
    return headline, f"{detail} {extra}"


def _draw_header(c, w: float, h: float, title: str, subtitle: str, hint: str, *, accent: str = "cert"):
    """Institut logosi, sarlavha va QR — yangilangan professional ko'rinish."""
    accent_color = C_RED if accent == "ban" else C_NAVY
    band_y = h - 36
    c.setFillColor(accent_color)
    c.rect(18, band_y, w - 36, HEADER_BAND_H, stroke=0, fill=1)

    logo_path = _get_logo_path()
    logo_x = 42
    logo_y = h - 38 - LOGO_PDF_SIZE
    if logo_path:
        try:
            from reportlab.lib.utils import ImageReader
            c.drawImage(
                ImageReader(logo_path),
                logo_x, logo_y,
                width=LOGO_PDF_SIZE, height=LOGO_PDF_SIZE,
                preserveAspectRatio=True, mask="auto",
            )
        except Exception:
            _draw_logo_placeholder(c, logo_x + LOGO_PDF_SIZE // 2, logo_y + LOGO_PDF_SIZE // 2, LOGO_PDF_SIZE // 2)
    else:
        _draw_logo_placeholder(c, logo_x + LOGO_PDF_SIZE // 2, logo_y + LOGO_PDF_SIZE // 2, LOGO_PDF_SIZE // 2)

    text_x = logo_x + LOGO_PDF_SIZE + 16
    text_max_w = w - text_x - QR_PDF_SIZE - 55
    c.setFont(FONT_BOLD, 12)
    c.setFillColor(C_NAVY)
    inst_lines = _wrap_text(c, "Farg\u2019ona jamoat salomatligi tibbiyot instituti", FONT_BOLD, 12, text_max_w)[:2]
    inst_y = h - 52
    for il in inst_lines:
        c.drawString(text_x, inst_y, il)
        inst_y -= 13
    c.setFont(FONT_BOLD, 13)
    c.setFillColor(accent_color)
    c.drawString(text_x, h - 72, title)
    c.setFont(FONT_REGULAR, 8.5)
    c.setFillColor(C_MUTED)
    c.drawString(text_x, h - 86, subtitle)
    if hint:
        for i, hl in enumerate(_wrap_text(c, hint, FONT_REGULAR, 7.5, text_max_w)[:2]):
            c.drawString(text_x, h - 98 - i * 10, hl)

    c.setStrokeColor(C_BORDER)
    c.setLineWidth(0.8)
    c.line(40, h - 118, w - 40, h - 118)
    c.setFillColor(colors.black)


def _draw_qr(c, verify_url: str, w: float, h: float, *, size: int | None = None):
    """QR kod chizish."""
    qr_size = size or QR_PDF_SIZE
    try:
        import qrcode
        from reportlab.lib.utils import ImageReader

        qr = qrcode.QRCode(version=2, box_size=4, border=1,
                           error_correction=qrcode.constants.ERROR_CORRECT_M)
        qr.add_data(verify_url)
        qr.make(fit=True)
        img = qr.make_image(fill_color="black", back_color="white")
        qbuf = BytesIO()
        img.save(qbuf, format="PNG")
        qbuf.seek(0)
        qr_x = w - qr_size - 42
        qr_y = h - qr_size - 42
        c.setFillColor(colors.white)
        c.setStrokeColor(C_BORDER)
        c.roundRect(qr_x - 6, qr_y - 6, qr_size + 12, qr_size + 18, 6, stroke=1, fill=1)
        c.drawImage(ImageReader(qbuf), qr_x, qr_y, width=qr_size, height=qr_size)
        c.setFont(FONT_REGULAR, 7)
        c.setFillColor(C_MUTED)
        c.drawCentredString(qr_x + qr_size / 2, qr_y - 11, "QR tekshiruv")
    except Exception:
        pass


def _draw_logo_placeholder(c, cx: float, cy: float, r: float):
    """Logo topilmasa doira ichida FJSTI yozuvi."""
    c.setStrokeColor(C_NAVY)
    c.setLineWidth(1.5)
    c.circle(cx, cy, r, stroke=1, fill=0)
    c.setFont(FONT_BOLD, 9)
    c.setFillColor(C_NAVY)
    c.drawCentredString(cx, cy - 4, "FJSTI")


def _wrap_text(c, text: str, font: str, size: float, max_width: float) -> list[str]:
    """So'zlarni max_width ga sig'adigan qatorlarga bo'ladi (harf kesish o'rniga)."""
    words = str(text or "").split()
    if not words:
        return []
    lines: list[str] = []
    line = words[0]
    for word in words[1:]:
        test = f"{line} {word}"
        if c.stringWidth(test, font, size) <= max_width:
            line = test
        else:
            lines.append(line)
            line = word
    lines.append(line)
    return lines


def _draw_page_frame(c, w: float, h: float):
    """Har sahifa atrofida ingichka ramka \u2014 sertifikat ko'rinishini beradi."""
    c.setStrokeColor(colors.HexColor("#dcdfe6"))
    c.setLineWidth(1)
    c.rect(18, 18, w - 36, h - 36, stroke=1, fill=0)
    c.setFillColor(colors.black)


def _draw_footer(c, w: float, page_label: str = ""):
    c.setFont(FONT_REGULAR, 7)
    c.setFillColor(colors.HexColor("#9aa0aa"))
    c.drawString(30, 26, "Farg\u2019ona jamoat salomatligi tibbiyot instituti \u2014 avtomatik shakllantirilgan hujjat")
    if page_label:
        c.drawRightString(w - 30, 26, page_label)
    c.setFillColor(colors.black)


def build_certificate_pdf(
    *,
    result_id: str,
    student_name: str,
    exam_title: str,
    completed_at: str,
    score: int,
    total: int,
    verify_url: str,
    integrity_code: str,
    overview: str,
    rows: list[dict],
    pass_threshold: int | None = None,
) -> bytes:
    buf = BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=A4)
    w, h = A4
    page_no = 1

    def new_page():
        nonlocal page_no
        _draw_footer(c, w, f"{page_no}-bet")
        c.showPage()
        page_no += 1
        _draw_page_frame(c, w, h)
        return h - 50

    _draw_page_frame(c, w, h)
    _draw_qr(c, verify_url, w, h)
    _draw_header(c, w, h,
                 title="Onlayn imtihon sertifikati",
                 subtitle="Hujjat raqamli QR orqali tekshiriladi",
                 hint="",
                 accent="cert")

    pct = round((score / total) * 100) if total else 0
    threshold = pass_threshold if pass_threshold is not None else PASS_PERCENT_THRESHOLD
    passed = pct >= threshold
    badge_color = C_GREEN if passed else C_RED
    badge_bg = C_GREEN_LIGHT if passed else C_RED_LIGHT
    badge_label = "MUVAFFAQIYATLI O'TDI" if passed else "O'TA OLMADI"

    y = h - 138

    # --- Ma'lumotlar bloki (chegaralangan karta) ---
    box_top = y
    fields = [
        ("Natija ID",        result_id),
        ("Talaba",           student_name),
        ("Imtihon",          exam_title),
        ("Yakunlangan sana", completed_at[:19].replace("T", " ")),
        ("Yaxlitlik kodi",   integrity_code),
        ("Tekshiruv havolasi", verify_url),
    ]
    box_height = 18 + len(fields) * 15 + 6
    c.setFillColor(C_NAVY_LIGHT)
    c.setStrokeColor(C_BORDER)
    c.roundRect(40, box_top - box_height + 10, w - 80, box_height, 8, stroke=1, fill=1)
    c.setFillColor(colors.black)

    fy = box_top
    for label, val in fields:
        c.setFont(FONT_BOLD, 9)
        c.setFillColor(colors.HexColor("#555555"))
        c.drawString(52, fy, f"{label}:")
        c.setFont(FONT_REGULAR, 9)
        c.setFillColor(colors.HexColor("#1a1a2e"))
        max_w = w - 52 - 170
        val_lines = _wrap_text(c, str(val), FONT_REGULAR, 9, max_w)[:1] or [""]
        val_text = val_lines[0]
        # Juda uzun (havola kabi) qiymatlarni kesib, oxiriga "..." qo'shamiz.
        while c.stringWidth(val_text, FONT_REGULAR, 9) > max_w and len(val_text) > 4:
            val_text = val_text[:-4] + "..."
        c.drawString(170, fy, val_text)
        fy -= 15
    y = box_top - box_height + 2

    # --- Ball / natija (rangli badge bilan) ---
    y -= 18
    c.setFont(FONT_BOLD, 22)
    c.setFillColor(colors.HexColor("#1a1a2e"))
    c.drawString(50, y, f"{score} / {total}")
    c.setFont(FONT_BOLD, 13)
    c.setFillColor(badge_color)
    c.drawString(150, y + 3, f"({pct}%)")

    badge_w = c.stringWidth(badge_label, FONT_BOLD, 9) + 20
    c.setFillColor(badge_bg)
    c.roundRect(w - 50 - badge_w, y - 3, badge_w, 20, 4, stroke=0, fill=1)
    c.setFont(FONT_BOLD, 9)
    c.setFillColor(badge_color)
    c.drawCentredString(w - 50 - badge_w / 2, y + 3, badge_label)
    c.setFillColor(colors.black)
    y -= 16

    # O'tish mezoni va hisoblash qoidasi
    c.setFont(FONT_REGULAR, 8)
    c.setFillColor(colors.HexColor("#666666"))
    rule_line = (
        f"Hisoblash: har bir to'g'ri javob 1 ball ({score} / {total}). "
        f"O'tish mezoni: kamida {threshold}%."
    )
    for line in _wrap_text(c, rule_line, FONT_REGULAR, 8, w - 100):
        c.drawString(50, y, line)
        y -= 11
    y -= 8
    c.setFillColor(colors.black)

    # --- Xulosa ---
    if (overview or "").strip():
        c.setFont(FONT_BOLD, 11)
        c.setFillColor(colors.HexColor("#1a1a2e"))
        c.drawString(50, y, "Xulosa")
        y -= 16
        c.setFont(FONT_REGULAR, 9)
        c.setFillColor(colors.HexColor("#333333"))
        for para in (overview or "")[:3000].split("\n"):
            if not para.strip():
                y -= 6
                continue
            for line in _wrap_text(c, para, FONT_REGULAR, 9, w - 100)[:20]:
                c.drawString(50, y, line)
                y -= 13
                if y < 90:
                    y = new_page()
                    c.setFont(FONT_REGULAR, 9)
        y -= 10
        c.setFillColor(colors.black)

    # --- Savollar (batafsil) ---
    c.setFont(FONT_BOLD, 12)
    c.setFillColor(C_NAVY)
    c.drawString(50, y, "Savollar bo'yicha batafsil natija")
    y -= 18

    for r in rows:
        is_correct = bool(r.get("isCorrect"))
        mark_color = C_GREEN if is_correct else C_RED
        card_bg = C_GREEN_LIGHT if is_correct else C_RED_LIGHT
        idx = r.get("index")
        text = str(r.get("text") or "")
        student_ans = str(r.get("studentAnswer") or "").strip()
        correct_ans = str(r.get("correctAnswer") or "").strip()
        comment_ok = str(r.get("commentCorrect") or "").strip()
        why_wrong = str(r.get("whyStudentWrong") or "").strip()
        why_right = str(r.get("whyCorrectIsRight") or "").strip()
        options = r.get("options") or []

        q_lines = _wrap_text(c, f"{idx}. {text}", FONT_REGULAR, 9, w - 130) or [f"{idx}."]
        detail_blocks: list[tuple[str, str]] = []
        if student_ans:
            detail_blocks.append(("Javobingiz", student_ans))
        if correct_ans:
            detail_blocks.append(("To'g'ri javob", correct_ans))
        if is_correct and comment_ok:
            detail_blocks.append(("Izoh", comment_ok))
        if not is_correct and why_wrong:
            detail_blocks.append(("Nima uchun noto'g'ri", why_wrong))
        if not is_correct and why_right:
            detail_blocks.append(("To'g'ri javob tushuntirishi", why_right))

        block_lines = 0
        for label, body in detail_blocks:
            block_lines += 1 + len(_wrap_text(c, body, FONT_REGULAR, 8, w - 120)[:6])
        if options:
            block_lines += 1 + min(len(options), 8)
        card_h = 16 + len(q_lines[:4]) * 12 + block_lines * 11 + 12

        if y - card_h < 70:
            y = new_page()
            c.setFont(FONT_BOLD, 12)
            c.setFillColor(C_NAVY)
            c.drawString(50, y, "Savollar (davomi)")
            y -= 18

        card_top = y
        c.setFillColor(card_bg)
        c.setStrokeColor(mark_color)
        c.roundRect(42, card_top - card_h, w - 84, card_h, 8, stroke=1, fill=1)

        cy = card_top - 14
        for li, line in enumerate(q_lines[:4]):
            c.setFont(FONT_REGULAR if li else FONT_BOLD, 9 if li else 10)
            c.setFillColor(C_SLATE)
            c.drawString(52, cy, line)
            if li == 0:
                c.setFont(FONT_BOLD, 11)
                c.setFillColor(mark_color)
                mark = "\u2713" if is_correct else "\u2717"
                c.drawRightString(w - 52, cy, mark)
            cy -= 12

        if options:
            c.setFont(FONT_BOLD, 7.5)
            c.setFillColor(C_MUTED)
            c.drawString(52, cy, "Variantlar:")
            cy -= 10
            c.setFont(FONT_REGULAR, 7.5)
            for opt_i, opt in enumerate(options[:8], start=1):
                opt_mark = ""
                if student_ans and str(opt) == student_ans:
                    opt_mark = " \u2190 siz"
                elif correct_ans and str(opt) == correct_ans:
                    opt_mark = " \u2190 to'g'ri"
                for ol in _wrap_text(c, f"{opt_i}) {opt}{opt_mark}", FONT_REGULAR, 7.5, w - 120)[:2]:
                    c.drawString(58, cy, ol)
                    cy -= 9

        for label, body in detail_blocks:
            c.setFont(FONT_BOLD, 8)
            c.setFillColor(C_SLATE)
            c.drawString(52, cy, f"{label}:")
            cy -= 10
            c.setFont(FONT_REGULAR, 8)
            c.setFillColor(C_MUTED if label != "To'g'ri javob" else C_GREEN)
            for bl in _wrap_text(c, body, FONT_REGULAR, 8, w - 120)[:8]:
                c.drawString(58, cy, bl)
                cy -= 10

        y = card_top - card_h - 10

    _draw_footer(c, w, f"{page_no}-bet")
    c.showPage()
    c.save()
    return buf.getvalue()


def build_ban_report_pdf(
    *,
    student_id: str,
    student_name: str,
    exam_title: str,
    issued_at: str,
    violations: list[dict],
    verify_url: str,
    official_warnings: int = 0,
    last_violation_type: str = "",
) -> bytes:
    buf = BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=A4)
    w, h = A4
    page_no = 1

    def new_page():
        nonlocal page_no
        _draw_footer(c, w, f"{page_no}-bet")
        c.showPage()
        page_no += 1
        _draw_page_frame(c, w, h)
        return h - 50

    _draw_page_frame(c, w, h)
    _draw_qr(c, verify_url, w, h)
    _draw_header(c, w, h,
                 title="Rasmiy intizomiy bayonnoma (BAN hisobot)",
                 subtitle="Hujjat raqamli QR orqali tekshiriladi",
                 hint="Ushbu hujjat institut ichki nazorat tizimi tomonidan avtomatik shakllantirildi",
                 accent="ban")

    y = h - 138
    fields = [
        ("Talaba ID", student_id),
        ("Talaba F.I.Sh.", student_name),
        ("Imtihon", exam_title),
        ("Berilgan sana", issued_at[:19].replace("T", " ")),
    ]
    box_h = 14 + len(fields) * 16 + 8
    c.setFillColor(C_NAVY_LIGHT)
    c.setStrokeColor(C_BORDER)
    c.roundRect(40, y - box_h + 8, w - 80, box_h, 8, stroke=1, fill=1)
    fy = y - 6
    for label, val in fields:
        c.setFont(FONT_BOLD, 9)
        c.setFillColor(C_MUTED)
        c.drawString(52, fy, f"{label}:")
        c.setFont(FONT_REGULAR, 9)
        c.setFillColor(C_SLATE)
        for vl in _wrap_text(c, str(val), FONT_REGULAR, 9, w - 200)[:1]:
            c.drawString(165, fy, vl)
        fy -= 16
    y -= box_h + 10

    ban_headline, ban_detail = _ban_reason_text(
        violations,
        official_warnings=official_warnings,
        last_violation_type=last_violation_type,
    )
    headline_lines = _wrap_text(c, ban_headline, FONT_BOLD, 9.5, w - 110)[:4]
    detail_lines: list[str] = []
    for dl in _wrap_text(c, ban_detail, FONT_REGULAR, 8.5, w - 110):
        detail_lines.append(dl)
        if len(detail_lines) >= 8:
            break
    reason_h = 28 + len(headline_lines) * 12 + len(detail_lines) * 11 + 34

    c.setFillColor(C_RED_LIGHT)
    c.setStrokeColor(C_RED)
    c.roundRect(40, y - reason_h, w - 80, reason_h, 8, stroke=1, fill=1)
    c.setFont(FONT_BOLD, 11)
    c.setFillColor(C_RED)
    c.drawString(52, y - 16, "Nima uchun bloklandi")
    ry = y - 30
    c.setFont(FONT_BOLD, 9.5)
    c.setFillColor(C_SLATE)
    for line in headline_lines:
        c.drawString(52, ry, line)
        ry -= 12
    c.setFont(FONT_REGULAR, 8.5)
    c.setFillColor(C_MUTED)
    for line in detail_lines:
        c.drawString(52, ry, line)
        ry -= 11

    # Ogohlantirish bosqichlari
    warn_n = max(0, int(official_warnings or 0))
    instant_ban = (last_violation_type or "") in {"IDENTITY_SUBSTITUTION"}
    steps = ["1", "2", "3", "BAN"]
    step_x = 52
    step_y = y - reason_h + 14
    for i, step in enumerate(steps):
        if instant_ban:
            active = i == 3
        else:
            active = (i < 3 and warn_n >= i + 1) or (i == 3 and warn_n >= 3)
        c.setFillColor(C_RED if active else colors.HexColor("#e2e8f0"))
        c.circle(step_x + 10, step_y, 9, stroke=0, fill=1)
        c.setFont(FONT_BOLD, 8)
        c.setFillColor(colors.white if active else C_MUTED)
        c.drawCentredString(step_x + 10, step_y - 3, step)
        if i < len(steps) - 1:
            c.setStrokeColor(colors.HexColor("#cbd5e1"))
            c.setLineWidth(1)
            c.line(step_x + 20, step_y, step_x + 34, step_y)
        step_x += 38
    c.setFont(FONT_REGULAR, 7.5)
    c.setFillColor(C_MUTED)
    c.drawString(52, step_y - 16, f"Rasmiy ogohlantirishlar: {warn_n} / 3")
    y -= reason_h + 14

    c.setFont(FONT_BOLD, 11)
    c.setFillColor(C_NAVY)
    c.drawString(50, y, "Qayd etilgan qoidabuzarliklar")
    y -= 16

    warn_win = max(15, int(os.environ.get("PROCTOR_WARN_SUPPRESS_SECONDS", "30")))
    grouped = _group_violation_rows_for_pdf(violations, window_sec=warn_win) if violations else []
    if not grouped:
        c.setFont(FONT_REGULAR, 9)
        c.setFillColor(C_MUTED)
        c.drawString(50, y, "- Qoidabuzarlik loglari topilmadi.")
        y -= 12
    else:
        c.setFont(FONT_REGULAR, 7.5)
        c.setFillColor(C_MUTED)
        for note in _wrap_text(
            c,
            f"Eslatma: ketma-kelgan hodisalar {warn_win}s oynasida 1 rasmiy ogohlantirish bilan bitta qator sifatida ko'rsatiladi.",
            FONT_REGULAR,
            7.5,
            w - 100,
        )[:2]:
            c.drawString(50, y, note)
            y -= 10
        y -= 4
        for idx, line in enumerate(grouped, start=1):
            if y < 90:
                y = new_page()
            row_bg = C_NAVY_LIGHT if idx % 2 == 0 else colors.white
            row_lines = _wrap_text(c, f"{idx}) {line}", FONT_REGULAR, 8.5, w - 110)[:3]
            row_h = max(18, len(row_lines) * 11 + 8)
            c.setFillColor(row_bg)
            c.roundRect(42, y - row_h, w - 84, row_h, 4, stroke=0, fill=1)
            c.setFont(FONT_REGULAR, 8.5)
            c.setFillColor(C_SLATE)
            ly = y - 12
            for rl in row_lines:
                c.drawString(50, ly, rl)
                ly -= 11
            y -= row_h + 4

    y -= 12
    c.setStrokeColor(C_BORDER)
    c.setLineWidth(0.8)
    c.line(40, y, w - 40, y)
    y -= 18
    c.setFont(FONT_REGULAR, 8)
    c.setFillColor(C_MUTED)
    c.drawString(50, y, "Ushbu hujjat Farg\u2019ona jamoat salomatligi tibbiyot instituti ichki nazorat siyosati asosida shakllantirildi.")
    c.setFont(FONT_BOLD, 9)
    c.setFillColor(C_SLATE)
    c.drawString(50, y - 28, "Mas\u2019ul shaxs imzosi: ____________________________")
    c.drawString(320, y - 28, "Sana: _______________")

    _draw_footer(c, w, f"{page_no}-bet")
    c.showPage()
    c.save()
    return buf.getvalue()
