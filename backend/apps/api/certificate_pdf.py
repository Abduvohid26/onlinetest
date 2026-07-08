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


def _draw_header(c, w: float, h: float, title: str, subtitle: str, hint: str):
    """Institut logosi va sarlavha chizish."""
    logo_path = _get_logo_path()
    logo_x = 40
    logo_y = h - 95
    logo_size = 55

    if logo_path:
        try:
            from reportlab.lib.utils import ImageReader
            c.drawImage(
                ImageReader(logo_path),
                logo_x, logo_y,
                width=logo_size, height=logo_size,
                preserveAspectRatio=True, mask="auto",
            )
        except Exception:
            _draw_logo_placeholder(c, logo_x + logo_size // 2, logo_y + logo_size // 2, logo_size // 2)
    else:
        _draw_logo_placeholder(c, logo_x + logo_size // 2, logo_y + logo_size // 2, logo_size // 2)

    text_x = logo_x + logo_size + 12
    c.setFont(FONT_BOLD, 13)
    c.setFillColor(colors.HexColor("#1a1a2e"))
    c.drawString(text_x, h - 55, "Farg\u2019ona jamoat salomatligi tibbiyot instituti")
    c.setFont(FONT_BOLD, 11)
    c.setFillColor(colors.HexColor("#c0392b"))
    c.drawString(text_x, h - 72, title)
    c.setFont(FONT_REGULAR, 8)
    c.setFillColor(colors.HexColor("#555555"))
    c.drawString(text_x, h - 86, subtitle)
    if hint:
        c.setFont(FONT_OBLIQUE, 8)
        c.setFillColor(colors.HexColor("#888888"))
        c.drawString(text_x, h - 98, hint)

    # Ajratuvchi chiziq
    c.setStrokeColor(colors.HexColor("#c0392b"))
    c.setLineWidth(1.5)
    c.line(40, h - 108, w - 40, h - 108)
    c.setFillColor(colors.black)


def _draw_logo_placeholder(c, cx: float, cy: float, r: float):
    """Logo topilmasa doira ichida FJSTI yozuvi."""
    c.setStrokeColor(colors.HexColor("#1a1a2e"))
    c.setLineWidth(1.5)
    c.circle(cx, cy, r, stroke=1, fill=0)
    c.setFont(FONT_BOLD, 9)
    c.setFillColor(colors.HexColor("#1a1a2e"))
    c.drawCentredString(cx, cy - 4, "FJSTI")


def _draw_qr(c, verify_url: str, w: float, h: float):
    """QR kod chizish."""
    try:
        import qrcode
        from reportlab.lib.utils import ImageReader

        qr = qrcode.QRCode(version=2, box_size=3, border=1,
                           error_correction=qrcode.constants.ERROR_CORRECT_M)
        qr.add_data(verify_url)
        qr.make(fit=True)
        img = qr.make_image(fill_color="black", back_color="white")
        qbuf = BytesIO()
        img.save(qbuf, format="PNG")
        qbuf.seek(0)
        qr_size = 85
        c.drawImage(ImageReader(qbuf), w - qr_size - 35, h - qr_size - 35,
                    width=qr_size, height=qr_size)
        c.setFont(FONT_REGULAR, 6)
        c.setFillColor(colors.HexColor("#888888"))
        c.drawCentredString(w - 35 - qr_size // 2, h - qr_size - 42, "QR tekshiruv")
    except Exception:
        pass


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
                 hint="")

    pct = round((score / total) * 100) if total else 0
    threshold = pass_threshold if pass_threshold is not None else PASS_PERCENT_THRESHOLD
    passed = pct >= threshold
    badge_color = colors.HexColor("#1e9e5a") if passed else colors.HexColor("#c0392b")
    badge_bg = colors.HexColor("#e8f8ef") if passed else colors.HexColor("#fdecea")
    badge_label = "MUVAFFAQIYATLI O'TDI" if passed else "O'TA OLMADI"

    y = h - 128

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
    c.setFillColor(colors.HexColor("#fafbfc"))
    c.setStrokeColor(colors.HexColor("#e3e6ea"))
    c.roundRect(40, box_top - box_height + 10, w - 80, box_height, 6, stroke=1, fill=1)
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

    # --- Savollar ---
    c.setFont(FONT_BOLD, 11)
    c.setFillColor(colors.HexColor("#1a1a2e"))
    c.drawString(50, y, "Savollar bo'yicha natija")
    y -= 16

    for r in rows:
        is_correct = bool(r.get("isCorrect"))
        mark_color = colors.HexColor("#1e9e5a") if is_correct else colors.HexColor("#c0392b")
        mark = "\u2713" if is_correct else "\u2717"
        idx = r.get("index")
        text = str(r.get("text") or "")
        student_ans = str(r.get("studentAnswer") or "").strip()
        correct_ans = str(r.get("correctAnswer") or "").strip()
        lines = _wrap_text(c, f"{idx}. {text}", FONT_REGULAR, 9, w - 120) or [f"{idx}."]
        for li, line in enumerate(lines[:3]):
            if y < 70:
                y = new_page()
            c.setFont(FONT_REGULAR, 9)
            c.setFillColor(colors.HexColor("#1a1a2e"))
            c.drawString(50, y, line)
            if li == 0:
                c.setFont(FONT_BOLD, 10)
                c.setFillColor(mark_color)
                c.drawRightString(w - 50, y, mark)
            y -= 12

        # Javoblar — kichik shrift
        if student_ans or correct_ans:
            if y < 70:
                y = new_page()
            c.setFont(FONT_REGULAR, 7)
            if student_ans:
                c.setFillColor(colors.HexColor("#555555"))
                ans_lines = _wrap_text(c, f"Javobingiz: {student_ans}", FONT_REGULAR, 7, w - 100)
                for al in ans_lines[:2]:
                    c.drawString(58, y, al)
                    y -= 10
            if correct_ans:
                c.setFillColor(colors.HexColor("#1e9e5a") if is_correct else colors.HexColor("#0d6b3f"))
                corr_lines = _wrap_text(
                    c,
                    f"To'g'ri javob: {correct_ans}",
                    FONT_REGULAR,
                    7,
                    w - 100,
                )
                for cl in corr_lines[:2]:
                    c.drawString(58, y, cl)
                    y -= 10
        y -= 3

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

    _draw_page_frame(c, w, h)
    _draw_qr(c, verify_url, w, h)
    _draw_header(c, w, h,
                 title="Rasmiy intizomiy bayonnoma (BAN hisobot)",
                 subtitle="Hujjat raqamli QR orqali tekshiriladi",
                 hint="Ushbu hujjat instituting ichki nazorat tizimi tomonidan avtomatik shakllantirildi")

    y = h - 128
    c.setFont(FONT_REGULAR, 10)
    c.setFillColor(colors.HexColor("#1a1a2e"))

    fields = [
        ("Talaba ID",        student_id),
        ("Talaba F.I.Sh.",   student_name),
        ("Imtihon",          exam_title),
        ("Berilgan sana",    issued_at[:19].replace("T", " ")),
        ("QR tekshiruv",     verify_url[:85] + ("..." if len(verify_url) > 85 else "")),
    ]
    for label, val in fields:
        c.setFont(FONT_BOLD, 9)
        c.drawString(50, y, f"{label}:")
        c.setFont(FONT_REGULAR, 9)
        c.drawString(160, y, str(val)[:100])
        y -= 14

    # Ban sababi — muhim qism
    y -= 8
    ban_headline, ban_detail = _ban_reason_text(
        violations,
        official_warnings=official_warnings,
        last_violation_type=last_violation_type,
    )
    box_h = 72
    c.setStrokeColor(colors.HexColor("#e74c3c"))
    c.setLineWidth(0.5)
    c.rect(40, y - box_h + 10, w - 80, box_h + 10, stroke=1, fill=0)

    c.setFont(FONT_BOLD, 10)
    c.setFillColor(colors.HexColor("#c0392b"))
    c.drawString(50, y, "Nima uchun bloklandi:")
    y -= 14

    c.setFont(FONT_BOLD, 9)
    c.setFillColor(colors.HexColor("#1a1a2e"))
    for line in _wrap_text(c, ban_headline, FONT_BOLD, 9, w - 100)[:3]:
        c.drawString(50, y, line)
        y -= 12

    c.setFont(FONT_REGULAR, 8)
    c.setFillColor(colors.HexColor("#444444"))
    for line in _wrap_text(c, ban_detail, FONT_REGULAR, 8, w - 100)[:4]:
        c.drawString(50, y, line)
        y -= 11

    # Ogohlantirish bosqichlari (1 → 2 → 3 → BAN)
    y -= 6
    warn_n = max(0, int(official_warnings or 0))
    instant_ban = (last_violation_type or "") in {"IDENTITY_SUBSTITUTION"}
    steps = ["1", "2", "3", "BAN"]
    step_x = 50
    for i, step in enumerate(steps):
        if instant_ban:
            active = i == 3
        else:
            active = (i < 3 and warn_n >= i + 1) or (i == 3 and warn_n >= 3)
        c.setFillColor(colors.HexColor("#c0392b") if active else colors.HexColor("#e0e0e0"))
        c.circle(step_x + 8, y, 7, stroke=0, fill=1)
        c.setFont(FONT_BOLD, 7)
        c.setFillColor(colors.white if active else colors.HexColor("#888888"))
        c.drawCentredString(step_x + 8, y - 2, step)
        if i < len(steps) - 1:
            c.setStrokeColor(colors.HexColor("#cccccc"))
            c.setLineWidth(0.8)
            c.line(step_x + 16, y, step_x + 28, y)
        step_x += 32
    c.setFont(FONT_REGULAR, 7)
    c.setFillColor(colors.HexColor("#888888"))
    c.drawString(50, y - 14, f"Rasmiy ogohlantirishlar: {warn_n} / 3")
    y -= 28
    c.setFillColor(colors.HexColor("#1a1a2e"))

    # Qoidabuzarliklar ro'yxati
    c.setFont(FONT_BOLD, 10)
    c.drawString(50, y, "Qayd etilgan qoidabuzarliklar:")
    y -= 14

    c.setFont(FONT_REGULAR, 9)
    warn_win = max(15, int(os.environ.get("PROCTOR_WARN_SUPPRESS_SECONDS", "30")))
    grouped = _group_violation_rows_for_pdf(violations, window_sec=warn_win) if violations else []
    if not grouped:
        c.drawString(50, y, "- Qoidabuzarlik loglari topilmadi.")
        y -= 12
    else:
        c.setFont(FONT_REGULAR, 8)
        c.setFillColor(colors.HexColor("#666666"))
        c.drawString(50, y, f"Eslatma: ketma-kelgan hodisalar {warn_win}s oynasida 1 rasmiy ogohlantirish bilan PDF da bitta qator sifatida ko'rsatiladi.")
        y -= 12
        c.setFont(FONT_REGULAR, 9)
        c.setFillColor(colors.HexColor("#1a1a2e"))
        for idx, line in enumerate(grouped[:40], start=1):
            line_txt = f"{idx}) {line}"
            c.drawString(50, y, line_txt[:118])
            y -= 11
            if y < 80:
                c.showPage()
                y = h - 50
                c.setFont(FONT_REGULAR, 9)

    # Pastki qism
    y -= 16
    c.setStrokeColor(colors.HexColor("#cccccc"))
    c.setLineWidth(0.5)
    c.line(40, y + 4, w - 40, y + 4)

    c.setFont(FONT_REGULAR, 8)
    c.setFillColor(colors.HexColor("#555555"))
    c.drawString(50, y - 8,
                 "Ushbu hujjat Farg\u2019ona jamoat salomatligi tibbiyot instituti")
    c.drawString(50, y - 20,
                 "ichki nazorat siyosati asosida avtomatik shakllantirildi.")

    c.setFont(FONT_BOLD, 9)
    c.setFillColor(colors.HexColor("#1a1a2e"))
    c.drawString(50, y - 38, "Mas\u2019ul shaxs imzosi: ____________________________")
    c.drawString(320, y - 38, "Sana: _______________")

    c.showPage()
    c.save()
    return buf.getvalue()
