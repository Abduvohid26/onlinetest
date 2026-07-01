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
    "DEVTOOLS_OPEN":                "Dasturchi vositalari ochildi",
    "CLIPBOARD_ATTEMPT":            "Nusxa / buferga urinish (clipboard)",
    "CLIPBOARD_ACCESS":             "Bufer xotirasiga kirish",
    "GAZE_AWAY_LEFT":               "Kameradan chapga uzoq qarash",
    "GAZE_AWAY_RIGHT":              "Kameradan o'ngga uzoq qarash",
    "GAZE_AWAY_UP":                 "Tepaga uzoq qarash",
    "GAZE_AWAY_DOWN":               "Pastga uzoq qarash",
    "WHISPER_OR_CONVERSATION_SUSPECTED": "Gapirish / suhbat shubhasi",
    "TAB_SWITCH_SOFT":              "Boshqa varaqqa o'tish",
}

# Ban sabablari — violation type bo'yicha
BAN_REASONS: dict[str, str] = {
    "TAB_SWITCH_HARD":              "Imtihon davomida boshqa brauzer oynasiga yoki varaqqa o'tildi. Bu qoidabuzarlik hisoblanadi va imtihon darhol to'xtatildi.",
    "FULLSCREEN_EXIT_HARD":         "Imtihon davomida to'liq ekran rejimidan chiqildi. Bu qoidabuzarlik hisoblanadi va imtihon darhol to'xtatildi.",
    "IDENTITY_SUBSTITUTION":        "Kamera orqali amalga oshirilgan yuz taqqoslashida profil rasmi bilan mos kelmaydigan shaxs aniqlandi. Imtihon darhol to'xtatildi.",
    "REMOTE_CONTROL_SUSPECTED":     "Kompyuterda masofadan boshqarish dasturi (AnyDesk, TeamViewer va boshqalar) aniqlandi. Bu qoidabuzarlik hisoblanadi.",
    "FACE_NOT_VISIBLE":             "Talaba kamera oldidan uzoq vaqt ketdi yoki yuzini yashirdi.",
    "MULTIPLE_FACES":               "Imtihon davomida kadrda bir nechta shaxs aniqlandi.",
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


def _ban_reason_text(violations: list[dict]) -> str:
    """Asosiy ban sababini aniqlaydi."""
    if not violations:
        return DEFAULT_BAN_REASON
    # Eng og'ir violation ni topish
    priority = [
        "IDENTITY_SUBSTITUTION",
        "REMOTE_CONTROL_SUSPECTED",
        "TAB_SWITCH_HARD",
        "FULLSCREEN_EXIT_HARD",
        "MULTIPLE_FACES",
        "FACE_NOT_VISIBLE",
    ]
    vtypes = [str(v.get("violation_type") or "") for v in violations]
    for p in priority:
        if p in vtypes:
            return BAN_REASONS.get(p, DEFAULT_BAN_REASON)
    # Eng ko'p takrorlangan violation
    from collections import Counter
    most_common = Counter(vtypes).most_common(1)
    if most_common:
        return BAN_REASONS.get(most_common[0][0], DEFAULT_BAN_REASON)
    return DEFAULT_BAN_REASON


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
    passed = pct >= 50
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
    y -= 30

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

    for r in rows[:60]:
        is_correct = bool(r.get("isCorrect"))
        mark_color = colors.HexColor("#1e9e5a") if is_correct else colors.HexColor("#c0392b")
        mark = "\u2713" if is_correct else "\u2717"
        idx = r.get("index")
        text = str(r.get("text") or "")
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
    c.setStrokeColor(colors.HexColor("#e74c3c"))
    c.setLineWidth(0.5)
    c.rect(40, y - 42, w - 80, 52, stroke=1, fill=0)

    c.setFont(FONT_BOLD, 10)
    c.setFillColor(colors.HexColor("#c0392b"))
    c.drawString(50, y, "Bloklash sababi:")
    y -= 14

    ban_reason = _ban_reason_text(violations)
    c.setFont(FONT_REGULAR, 9)
    c.setFillColor(colors.HexColor("#1a1a2e"))
    # Uzun matnni qatorlarga bo'lish
    words = ban_reason.split()
    line = ""
    for word in words:
        test = (line + " " + word).strip()
        if len(test) > 90:
            c.drawString(50, y, line)
            y -= 12
            line = word
        else:
            line = test
    if line:
        c.drawString(50, y, line)
        y -= 12

    y -= 18
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
