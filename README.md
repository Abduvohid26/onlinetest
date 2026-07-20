# FJSTI Online Exam

**Farg‘ona jamoat salomatligi tibbiyot instituti** uchun masofaviy imtihon platformasi.

Uchta rol: **talaba (student)**, **admin**, **staff (kuzatuvchi/proktor)**. Django REST API + React SPA + WebSocket real-time proctoring + Celery background tasklar.

To‘liq funksional talablar: [`docs/TEXNIK_TALABLAR.md`](docs/TEXNIK_TALABLAR.md)  
Bug hisobot (sahifa bo‘yicha): [`docs/BUG_REPORT.md`](docs/BUG_REPORT.md)

---

## Tezkor boshlash (Docker)

```bash
docker compose up --build
```

Brauzer: **http://127.0.0.1:8080**

| Login | Rol | Parol |
|-------|-----|-------|
| `demo_admin` | Admin | `DemoFJSTI2026!` |
| `demo_staff` | Staff (kuzatuvchi) | `DemoFJSTI2026!` |
| `demo_student` | Talaba | `DemoFJSTI2026!` |

Django ORM admin (alohida): **http://127.0.0.1:8080/django-admin/** — `admin` / `AdminLocal123`

Demo foydalanuvchilarni qayta yaratish:
```bash
docker compose exec app python manage.py seed_demo_users
```

---

## Loyiha tuzilmasi

```
OnlineTest/
├── backend/                 # Django 5 + DRF + Channels + Celery
│   ├── apps/
│   │   ├── core/            # Modellar, migratsiyalar, admin
│   │   └── api/             # REST API, WebSocket, PDF, AI, proctoring
│   └── exam_platform/       # settings, asgi, urls
├── frontend/                # React 19 + Vite + TypeScript + Tailwind
│   └── src/
│       ├── pages/           # Login, dashboards, exam flow
│       ├── components/      # UI, LiveMonitor, natija, kalkulyator
│       └── lib/             # Proctoring, VAC, WebSocket, API
├── e2e/                     # Playwright end-to-end testlar
├── deploy/                  # Nginx, systemd, prod skriptlar
├── docs/                    # Texnik talablar, bug hisobot
└── docker-compose.yml       # app + db + redis + worker + beat
```

### Texnologiyalar

| Qatlam | Texnologiya |
|--------|-------------|
| Backend | Python 3.12, Django, DRF, Channels, Celery |
| Ma’lumotlar bazasi | PostgreSQL (SQLite **qo‘llab-quvvatlanmaydi**) |
| Cache / Queue | Redis (WebSocket, Celery, VAC HMAC) |
| Frontend | React, Vite, TypeScript, Motion, Tailwind |
| Real-time | WebSocket (`ws/realtime/`) — WebRTC signaling |
| AI | OpenAI API (savol import, tarjima, proctor frame, identity) |
| PDF | ReportLab — sertifikat va ban hisoboti |

---

## Rollar va imkoniyatlar

### Talaba (Student)

Imtihon topshirish, natijalarni ko‘rish, proctoring qoidalarga rioya qilish.

| Bosqich | Sahifa / komponent | Yo‘l |
|---------|-------------------|------|
| Kirish | Login | `/login` |
| Bosh sahifa | Talaba paneli — mavjud imtihonlar, natijalar | `/` |
| Oldi tekshiruv | Kamera, VAC qoidalar, shaxs, liveness | State: `checking` |
| Imtihon | Savollar, taymer, proctoring, kalkulyator | State: `taking` |
| Natija | Ball, savollar tahlili, PDF | State: `finished` |
| Ommaviy tekshiruv | QR orqali natija (login shart emas) | `/verify/result/:id?k=...` |

**Asosiy API:** `/api/student/exams`, `/api/student/results`, start/submit/draft, violations, identity-compare, proctor-frame.

### Admin

To‘liq boshqaruv: kontingent, imtihonlar, test bazasi, moderatsiya, audit.

| Sahifa | Yo‘l | Vazifa |
|--------|------|--------|
| Asosiy panel | `/admin` | Statistika, tezkor havolalar |
| Darajalar | `/admin/levels` | Kurslar CRUD |
| Guruhlar | `/admin/groups` | Guruhlar CRUD |
| Talabalar | `/admin/students` | Talaba qo‘shish/tahrirlash, profil rasm |
| Bloklanganlar | `/admin/banned` | Unban, apellyatsiyalar, review queue |
| Xodimlar | `/admin/staff` | Staff/admin foydalanuvchilar |
| Audit | `/admin/audit` | Harakatlar jurnali, CSV export |
| Test bazasi | `/admin/testbank` | PDF/DOCX smart import, kategoriyalar |
| Imtihon yaratish | `/admin/exam/create` | Bank / PDF / qo‘lda |
| Imtihonlar ro‘yxati | `/admin/exam/list` | Natijalar, Live Monitor, retake, CSV |

**Asosiy API:** `/api/admin/*` — users, levels, groups, exams, test-bank, stats, audit, ban-appeals.

### Staff (kuzatuvchi)

Faqat **o‘ziga biriktirilgan** imtihonlarni kuzatish va natijalarni ko‘rish.

| Sahifa | Yo‘l | Vazifa |
|--------|------|--------|
| Staff portali | `/` | Sarlavha + imtihonlar tabi |
| Imtihonlar | (inline) | Ro‘yxat, filter, natijalar (read-only) |
| Live Monitor | (modal) | Jonli kamera, ban ogohlantirish, unblock |

**Cheklovlar:** imtihon yaratish, tahrirlash, CSV, retake — **admin** uchun.

**API:** `GET /api/staff/exams`, `GET /api/staff/exams/:id/results`, unblock via `/api/admin/student_exams/:id/unblock`.

---

## Imtihon oqimi (talaba)

```
Login → Dashboard → PreExamCheck (kamera, qoidalar, shaxs, liveness)
    → ExamRoom (savollar + proctoring) → Submit → Natija → PDF / Dashboard
```

**Anti-cheat (VAC):** HMAC soat, ketma-ketlik raqami, challenge header, qurilma bog‘lash, tab almashtirish, kamera yo‘qolishi, yuz tekshiruvi, ovoz faolligi. 3 ogohlantirish → ban.

**Proctoring:** MediaPipe (client) + server frame tahlili (Celery) + WebSocket (staff/admin Live Monitor).

### Proctoring eskalatsiya qoidasi (qonun)

Bir martalik hodisalar (tab-switch, print-screen, clipboard, devtools, remote-control, forbidden object, identity-substitution) — aniqlangan zahoti to‘g‘ridan-to‘g‘ri rasmiy ogohlantirish/ban sifatida backendga yuboriladi (`apps/api/views/student.py: student_violations`).

**Davomiy tabiatga ega signallar** — bosh burilishi/gaze, kameradan uzoq/yaqin/markazdan chetda turish, haddan tashqari qimirlash (`frontend/src/lib/realtimeProctor.ts`, video/MediaPipe), gapirish va tashqi shovqin (`frontend/src/lib/voiceActivity.ts`, audio/mikrofon) — barchasi bitta umumiy `ContinuousSignalTracker` (`frontend/src/lib/continuousSignal.ts`) orqali ikki bosqichda ishlaydi:

1. **`LIVE_SIGNAL_CONFIRM_MS` (1.5s)** — signal uzluksiz shuncha vaqt davom etsa, kamera panelida (ExamRoom o‘ng panel, video ustida) kichik vizual ogohlantirish chiqadi. Bu bosqich hali **rasmiy emas** — backendga hech narsa yuborilmaydi, faqat talabaga tezkor signal. Video-manba (pozitsiya/harakat/og‘iz) va audio-manba (nutq/shovqin) alohida qatorlarda, **farqli matn bilan** ko‘rsatiladi — masalan "Gapirish aniqlandi" (audio, o‘z ovozi/og‘iz) va "Tashqi shovqin bor" (audio, notekis manba) aralashtirilmaydi.
2. **`LIVE_SIGNAL_ESCALATE_MS` (3s, jami)** — signal shu bosqichdan keyin ham davom etib, umumiy uzluksiz davomiyligi shu qiymatga yetsa, endi haqiqiy (backendga yuboriladigan, `logViolation` orqali) rasmiy ogohlantirishga aylanadi — mavjud ogohlantirish modali (`violationWarning`) ochiladi. Eskalatsiyadan so‘ng hisoblagich `reset()` qilinadi — signal davom etayotgan bo‘lsa ham keyingi ogohlantirish yana to‘liq 3s dan keyin keladi (tinimsiz takrorlanmaydi).

Qisqa uzilish (freym flicker, so‘zlar orasidagi tabiiy pauza) hisoblagichni buzmasligi uchun har bir signal turi uchun grace-oyna bor (odatda 500–700ms, gapirish uchun 1000ms).

Gapirishni ikki xil yo‘l bilan aniqlash mumkin — talabaning o‘z og‘iz harakati (video) yoki mikrofondagi inson ovozi (audio); qaysi biri sodir bo‘lsa ham xuddi shu 1.5s/3s qoidasiga bo‘ysunadi. Audio eskalatsiya paytida video og‘iz harakati faolmi (`mouthActiveRef`) tekshiriladi: talabaning o‘zi gapirsa `MOUTH_MOVEMENT_TALKING`, aks holda atrofda/orqada boshqa odam gapirishi shubhasi (`WHISPER_OR_CONVERSATION_SUSPECTED`) sifatida yuboriladi. Qimirlash uchun chegara ataylab bo‘shashtirilgan — uzoq imtihon davomida oddiy holatni to‘g‘irlash/charchoq harakati jazolanmaydi, faqat haqiqatan uzluksiz haddan tashqari harakat eskalatsiya qiladi.

Yangi davomiy-tabiatli signal turi qo‘shilganda ushbu ikki bosqichli qoidaga rioya qilinsin — bir martalik hodisalarga (tab-switch, print-screen va h.k.) bu mexanizm qo‘llanilmaydi.

---

## Ishga tushirish (batafsil)

### Docker (tavsiya etiladi)

```bash
docker compose up --build
```

Servislar: `app` (:8080), `db` (PostgreSQL), `redis`, `worker` (Celery), `beat` (stale session sweep).

### Lokal (Docker siz — qiyinroq)

Backend:
```bash
cd backend
pip install -r requirements/dev.txt
# .env: DJANGO_SECRET_KEY, JWT_SECRET, DATABASE_URL (PostgreSQL)
python manage.py migrate
python manage.py runserver
```

Frontend:
```bash
cd frontend
npm install
npm run dev    # http://127.0.0.1:5173
```

Node: `>=20.19 <23` (`.nvmrc`).

---

## Test va sifat nazorati

```bash
# Frontend typecheck
cd frontend && npm run lint

# Frontend unit testlar
cd frontend && npm test

# Backend
cd backend && python manage.py test apps.api.tests -v 1

# UI smoke (server ishlab turishi kerak)
node scripts/admin_ui_check.mjs
node scripts/portal_ui_check.mjs

# E2E (Playwright)
cd e2e && npx playwright test
```

CI: `.github/workflows/ci.yml` — frontend + backend + realtime smoke.

---

## Muhit o‘zgaruvchilari

| O‘zgaruvchi | Tavsif |
|-------------|--------|
| `OPENAI_API_KEY` | AI: import, tarjima, proctor, identity (yo‘q bo‘lsa graceful degrade) |
| `OPENAI_MODEL` / `OPENAI_VISION_MODEL` | Standart: `gpt-4o-mini` / `gpt-4o` |
| `DATABASE_URL` | PostgreSQL majburiy |
| `REDIS_URL` | WebSocket + Celery + VAC cache (prod da majburiy, ko‘p worker bo‘lsa) |
| `JWT_SECRET`, `DJANGO_SECRET_KEY` | Auth va imzo |
| `PUBLIC_APP_URL` | QR / sertifikat verify URL |
| `VITE_API_BASE_URL` | Frontend API bazasi (default: nisbiy `/api`) |

Namunalar: `backend/.env.example`, `deploy/env.api.example`.

---

## Joylashtirish (production)

- [`deploy/DEPLOY.md`](deploy/DEPLOY.md) — to‘liq qo‘llanma
- [`deploy/DEPLOY-GITHUB-ACTIONS.md`](deploy/DEPLOY-GITHUB-ACTIONS.md) — CI/CD
- Server yangilash: `bash deploy/remote-update.sh`
- HTTPS: `sudo bash deploy/https-certbot.sh your-domain.uz`

**Muhim:** Prod nginx da `/admin/` SPA yo‘llari Django API ga proxy qilinmasligi kerak — batafsil [`docs/BUG_REPORT.md`](docs/BUG_REPORT.md) (ADM-27).

---

## Xavfsizlik

- JWT (HS256), rol serverda DB dan qayta tekshiriladi
- Parol brauzerda saqlanmaydi; «Eslab qolish» faqat foydalanuvchi ID
- Banned talaba login va imtihon API larida bloklanadi
- Sertifikat: `result_public_id` + `integrity_code` + QR verify
- `.env` va maxfiy kalitlar repoga kirmasligi kerak

---

## Masshtablash

- **Redis** — bir nechta Gunicorn worker + WebSocket uchun majburiy
- **Celery worker** — `proctor-frame` AI tahlili (202 + poll)
- **Celery beat** — `proctor.sweep_stale_sessions` (kamera uzilgan sessiyalar)
- Faqat **bitta** beat instance ishlashi kerak

---

## Hujjatlar

| Fayl | Mazmun |
|------|--------|
| [`docs/TEXNIK_TALABLAR.md`](docs/TEXNIK_TALABLAR.md) | To‘liq funksional TZ (o‘zbekcha) |
| [`docs/BUG_REPORT.md`](docs/BUG_REPORT.md) | Sahifa bo‘yicha bug ro‘yxati |
| [`CLAUDE.md`](CLAUDE.md) | AI/agent uchun arxitektura qisqacha |
| [`deploy/DEPLOY.md`](deploy/DEPLOY.md) | Server o‘rnatish |

---

## Litsenziya va aloqa

FJSTI ichki loyiha. Savollar uchun institut IT bo‘limi yoki loyiha administratori bilan bog‘laning.
