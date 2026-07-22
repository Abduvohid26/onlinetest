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

**Asosiy qonun — BARCHA qoidabuzarlik/texnik xato bir xil ishlaydi:**

1. **`LIVE_SIGNAL_CONFIRM_MS` (1.5s)** — signal uzluksiz shuncha vaqt davom etsa, **kamera panelida** (ExamRoom o‘ng panel, video ustida) kichik vizual ogohlantirish (chip) chiqadi. Bu bosqich hali **rasmiy emas** — backendga hech narsa yuborilmaydi, faqat talabaga tezkor signal.
2. **`LIVE_SIGNAL_ESCALATE_MS` (4s, jami)** — signal shundan keyin ham davom etib, umumiy uzluksiz davomiyligi shu qiymatga yetsa, endi haqiqiy (backendga `logViolation` orqali) **rasmiy ogohlantirishga** aylanadi — `violationWarning` modali ochiladi. So‘ng hisoblagich `reset()` qilinadi (signal davom etsa ham keyingi rasmiy yana to‘liq 4s dan keyin — tinimsiz takrorlanmaydi).

Qisqa uzilish (freym flicker, so‘zlar orasidagi pauza, tugmani qo‘yib yuborish) hisoblagichni buzmasligi uchun grace-oyna bor (odatda 500–1000ms).

#### Kichik ogohlantirishlar SANALADI: 3 tadan keyin 4-si rasmiy

Faqat davomiylik yetarli emas edi: talaba qoidani buzib, chip chiqishi bilan to‘xtatib, keyin yana buzib — rasmiy ogohlantirishga umuman yetmasligi mumkin edi. Shu sabab **har bir kichik ogohlantirish sanaladi**:

| Nechanchi kichik ogohlantirish | Natija |
|---|---|
| 1-, 2-, 3-marta | Kichik (kamera panelidagi chip, backendga hech narsa ketmaydi). Chipda hisob ko‘rinadi: `Gapirmang · 2/3` |
| **4-marta** | **Darhol rasmiy** — chip chiqishi bilanoq `logViolation` ketadi va ogohlantirish modali ochiladi |

- **Epizod** = signalning bitta uzluksiz davomi. Uzluksiz 30 soniya gapirish — bitta kichik ogohlantirish, 30 ta emas. To‘xtab, qaytadan boshlansa — yangi epizod, hisob +1.
- Hisob **tur bo‘yicha alohida** (kalit = rasmiy violation turi). Bir marta qo‘l ko‘tarish + bir marta gapirish qo‘shilib jazoga aylanmaydi.
- Rasmiy ogohlantirish berilgach (ikkala yo‘l bilan ham) o‘sha tur hisobi **nolga qaytadi** — talabaga toza start.
- Bu qoida **BARCHA** manbalarga tegishli: video (MediaPipe), audio (gapirish/shovqin), event/tab (print-screen, clipboard, devtools, tab almashtirish), mikrofon o‘chishi.

Ya‘ni rasmiy ogohlantirish endi **ikki yo‘l** bilan keladi:
1. Signal uzluksiz eskalatsiya muddatiga yetsa (4s, gapirish uchun 2s), **yoki**
2. Shu tur bo‘yicha kichik ogohlantirishlar 3 tadan oshsa.

Kod: `frontend/src/lib/smallWarningLedger.ts` (`SmallWarningLedger`, `SMALL_WARNINGS_BEFORE_FORMAL = 3`), ExamRoom’dagi `noteSmallWarningRef` / `withSmallCount`. Test: `frontend/tests/smallWarningLedger.test.ts`.

#### Gapirish uchun MAXSUS qoida (faqat gapirish uchun)

Gapirish — eng jiddiy va eng tez foyda beradigan aldash usuli (suflyor, yonidan aytib turish, ovoz orqali AI bilan ishlash). Bir necha soniyada butun savolga javob aytib ulgurish mumkin, shu sabab unga umumiy 1.5s/4s **juda sekin**. Shuning uchun **faqat gapirish** uchun tezlashtirilgan chegaralar:

| Signal | Kichik ogohlantirish | Rasmiy |
|---|---|---|
| Og‘iz qimirlashi (video, `MOUTH_MOVEMENT_TALKING`) | **darhol** — aniqlanishi bilanoq (`TALK_SIGNAL_CONFIRM_MS = 0`) | **2s** (`TALK_SIGNAL_ESCALATE_MS`) |
| Odam ovozi (audio: o‘zi yoki tashqi odam — `WHISPER_OR_CONVERSATION_SUSPECTED`) | **darhol** — birinchi aniqlangan freymda | **2s** |

Kichik ogohlantirishni darhol ko‘rsatish xavfsiz, chunki u **faqat vizual chip** — backendga hech narsa yuborilmaydi, strike hisoblanmaydi. Rasmiy (backendga ketadigan) ogohlantirish esa baribir 2s uzluksiz davom etishni talab qiladi, ya‘ni tasodifiy yo‘tal/xo‘rsinish jazolanmaydi.

Bu tezlashtirish **faqat shu ikkalasiga** tegishli. Tashqi shovqin (`SUSPICIOUS_AUDIO`) va boshqa barcha turlar umumiy qonunda (1.5s / 4s) qoladi — shovqin aldash emas, sezgirlikni oshirsak soxta signal ko‘payadi.

Kod: `TALK_SIGNAL_CONFIRM_MS` / `TALK_SIGNAL_ESCALATE_MS` va `confirmMsFor(type)` — `frontend/src/lib/realtimeProctor.ts`; audio tomoni `frontend/src/pages/ExamRoom.tsx` audio loop’ida. Chip navbatida gapirish shovqindan **ustun** ko‘rsatiladi.

**Signal manbalari va ular ushbu qonunni qanday qo‘llaydi:**

- **Video (MediaPipe, `frontend/src/lib/realtimeProctor.ts`)** — yuz yo‘q (`NO_FACE`), ko‘p yuz (`MULTI_FACE`), bosh burilishi/gaze, pozitsiya (uzoq/yaqin/markaz), haddan tashqari qimirlash, qo‘l ko‘tarish, og‘iz harakati. Har biri `trackContinuous` bilan 1.5s/4s. Sariq chip qatori.
- **Audio (`frontend/src/lib/voiceActivity.ts` + `ContinuousSignalTracker`)** — gapirish (`MOUTH_MOVEMENT_TALKING`/`WHISPER_OR_CONVERSATION_SUSPECTED`) va tashqi shovqin (`SUSPICIOUS_AUDIO`). Ko‘k chip qatori, farqli matn.
  - **Odam ovozini maishiy shovqindan ajratish** asosan **davriylik** (autokorrelyatsiya cho‘qqisi) bilan qilinadi: nutq ≥ 0.75, ventilyator/klaviatura/idish/eshik/transport/musiqa ≤ 0.50. Sof ton (mikrovolnovka "pip") ham davriy — uni **ohanglar soni** (`harmonicCount ≥ 4`) rad etadi. Chegaralar taxmin emas: `frontend/tests/audioFixtures.ts` haqiqiy FFT bilan Web Audio `getByteFrequencyData` ni aynan emulyatsiya qiladi, `frontend/tests/voiceDetection.test.ts` esa 20+ real signal turida o‘lchaydi. **Yangi chegara qo‘yishdan oldin shu testni ishga tushiring** — "flatness" mezoni aynan shu yo‘l bilan noto‘g‘ri ekani (real erkak ovozini rad etayotgani) aniqlangan.
  - Shivirlash mikrofonda aniqlanmaydi (ovozsiz tovushda f0 yo‘q) — uni video tomoni, og‘iz qimirlashi ushlaydi.
- **Event/tab (`frontend/src/lib/violationGate.ts` — yagona `ViolationGate`)** — print-screen, clipboard, devtools va tab yashiringan (`TAB_SWITCH_HARD`). Bir martalik keypress `markEvent()` bilan belgilanadi; markazlashgan tick loop 1.5s/4s ni qo‘llaydi — **bir marta tasodifiy bosish rasmiy bo‘lmaydi**, faqat 4s uzluksiz takrorlansa ("davom etsa") rasmiyga o‘tadi. Pushti chip qatori.
- **Mikrofon o‘chishi (`CAMERA_MIC_ACCESS_FAILED`)** — davomiy holat, `ContinuousSignalTracker` bilan 4s.

Uch xil chip (sariq=video, ko‘k=audio, pushti=event/tab) kamera panelida alohida qatorlarda, **farqli matn** bilan chiqadi — masalan "Gapirish aniqlandi" (audio) va "Tashqi shovqin bor" (shovqin) aralashtirilmaydi.

**Muhim nuance:** Qo‘l detektsiyasi yuz detektsiyasidan OLDIN ishga tushadi — qo‘l yuz/og‘iz ustida bo‘lsa, o‘sha freymda gapirish tekshiruvi hisobga olinmaydi (soxta "gapiryapti" bo‘lmasin). Audio gapirishida video og‘iz faolmi (`mouthActiveRef`) tekshiriladi: o‘zi gapirsa `MOUTH_MOVEMENT_TALKING`, aks holda `WHISPER_OR_CONVERSATION_SUSPECTED`. Qimirlash chegarasi ataylab bo‘shashtirilgan (charchoq/holat to‘g‘irlash jazolanmaydi).

**Qonundan tashqari (haqiqiy mustasnolar — struktura sababli):**
- `IDENTITY_SUBSTITUTION` — darhol **ban** (ogohlantirish emas, kategoriya boshqacha); `runCheck` 3 marta ketma-ket mos kelmasa.
- `FULLSCREEN_EXIT_HARD` — ilova darhol qayta-fullscreen gate ochadi (4s davom eta olmaydi).
- `REMOTE_CONTROL_SUSPECTED` — sahifa mount‘ida bir martalik UA/webdriver tekshiruvi.
- `VIRTUAL_WEBCAM_SUSPECTED` — kamera ochilishida bir martalik aniqlash.
- `PROCTOR_FEED_LOST`, `FORBIDDEN_OBJECT_*` — server (Celery) verdikti, ~20–30s server sikli.
- `TAB_SWITCH_SOFT` — faqat `pagehide` (sahifadan chiqib ketish, terminal hodisa — kutib bo‘lmaydi).
- **`TAB_SWITCH_HARD` (tab almashtirish / alt-tab)** — HODISA asosida, `visibilitychange` + `blur`/`focus`. Ketgan payt yoziladi, QAYTGANDA qancha vaqt ketgani o‘lchanadi; `TAB_AWAY_VIOLATION_MS` (1.2s) dan ko‘p bo‘lsa darhol rasmiy. Sabab: brauzer fon tabda `setInterval`ni **muzlatadi**, shu sabab faqat polling’ga tayanib bo‘lmaydi (talaba boshqa tabga o‘tib AI ishlatsa sezilmasdi). "Kichik ogohlantirish" bosqichi yo‘q — talaba boshqa tabda uni ko‘ra olmaydi.

Yangi qoidabuzalik turi qo‘shilganda: davomiy bo‘lishi mumkin bo‘lsa — albatta shu 1.5s/4s qonuniga (video `trackContinuous`, audio/mic `ContinuousSignalTracker`, yoki event/tab `ViolationGate`) ulansin.

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
