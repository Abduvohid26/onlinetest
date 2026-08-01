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

#### Kichik ogohlantirishlar SANALADI: 2 tadan keyin 3-si rasmiy

Faqat davomiylik yetarli emas edi: talaba qoidani buzib, chip chiqishi bilan to‘xtatib, keyin yana buzib — rasmiy ogohlantirishga umuman yetmasligi mumkin edi. Shu sabab **har bir kichik ogohlantirish sanaladi**:

| Nechanchi kichik ogohlantirish | Natija |
|---|---|
| 1-, 2-marta | Kichik (kamera panelidagi chip, backendga hech narsa ketmaydi). Chipda hisob ko‘rinadi: `Gapirmang · 1/2` |
| **3-marta** | **Darhol rasmiy** — chip chiqishi bilanoq `logViolation` ketadi va ogohlantirish modali ochiladi |

- **Epizod** = signalning bitta uzluksiz davomi. Uzluksiz 30 soniya gapirish — bitta kichik ogohlantirish, 30 ta emas. To‘xtab, qaytadan boshlansa — yangi epizod, hisob +1.
- Hisob **tur bo‘yicha alohida** (kalit = rasmiy violation turi). Bir marta qo‘l ko‘tarish + bir marta gapirish qo‘shilib jazoga aylanmaydi.
- Rasmiy ogohlantirish berilgach (ikkala yo‘l bilan ham) o‘sha tur hisobi **nolga qaytadi** — talabaga toza start.
- Bu qoida **BARCHA** manbalarga tegishli: video (MediaPipe), audio (gapirish/shovqin), event/tab (print-screen, clipboard, devtools, tab almashtirish), mikrofon o‘chishi.

Ya‘ni rasmiy ogohlantirish endi **ikki yo‘l** bilan keladi:
1. Signal uzluksiz eskalatsiya muddatiga yetsa (4s, gapirish uchun 2s), **yoki**
2. Shu tur bo‘yicha kichik ogohlantirishlar 2 tadan oshsa.

Kod: `frontend/src/lib/smallWarningLedger.ts` (`SmallWarningLedger`, `SMALL_WARNINGS_BEFORE_FORMAL = 2`), ExamRoom’dagi `noteSmallWarningRef` / `withSmallCount`. Test: `frontend/tests/smallWarningLedger.test.ts`.

#### Gapirish uchun MAXSUS qoida (faqat gapirish uchun)

Gapirish — eng jiddiy va eng tez foyda beradigan aldash usuli (suflyor, yonidan aytib turish, ovoz orqali AI bilan ishlash). Bir necha soniyada butun savolga javob aytib ulgurish mumkin, shu sabab unga umumiy 1.5s/4s **juda sekin**. Shuning uchun **faqat gapirish** uchun tezlashtirilgan chegaralar:

| Signal | Kichik ogohlantirish | Rasmiy |
|---|---|---|
| Og‘iz qimirlashi (video, `MOUTH_MOVEMENT_TALKING`) | **darhol** — aniqlanishi bilanoq (`TALK_SIGNAL_CONFIRM_MS = 0`) | **2s** (`TALK_SIGNAL_ESCALATE_MS`) |
| Odam ovozi (audio: o‘zi yoki tashqi odam — `WHISPER_OR_CONVERSATION_SUSPECTED`) | **darhol** — birinchi aniqlangan freymda | **2s** |

Kichik ogohlantirishni darhol ko‘rsatish xavfsiz, chunki u **faqat vizual chip** — backendga hech narsa yuborilmaydi, strike hisoblanmaydi. Rasmiy (backendga ketadigan) ogohlantirish esa baribir 2s uzluksiz davom etishni talab qiladi, ya‘ni tasodifiy yo‘tal/xo‘rsinish jazolanmaydi.

Bu tezlashtirish **faqat shu ikkalasiga** tegishli. Tashqi shovqin (`SUSPICIOUS_AUDIO`) va boshqa barcha turlar umumiy qonunda (1.5s / 4s) qoladi — shovqin aldash emas, sezgirlikni oshirsak soxta signal ko‘payadi.

Kod: `TALK_SIGNAL_CONFIRM_MS` / `TALK_SIGNAL_ESCALATE_MS` va `confirmMsFor(type)` — `frontend/src/lib/realtimeProctor.ts`; audio tomoni `frontend/src/pages/ExamRoom.tsx` audio loop’ida. Chip navbatida gapirish shovqindan **ustun** ko‘rsatiladi.

#### Kichik ogohlantirish uchun ISTISNO turlar (0.4s)

Umumiy qonundagi 1.5s **kichik** ogohlantirish uchun uch turda juda sekin ekani amalda aniqlandi: talaba telefonni bir zumga ko‘tarib javobni ko‘rib olardi va ekranda hech narsa chiqmasdi. Shu sabab quyidagilarga **0.4s** qo‘yildi:

| Signal | Kichik ogohlantirish | Rasmiy (o‘zgarmadi) |
|---|---|---|
| Telefon / kitob / noutbuk (`FORBIDDEN_OBJECT_*`) | **0.4s** (`OBJECT_CONFIRM_MS`) | 1.8s (`OBJECT_ESCALATE_MS`) |
| Gapirish (`TALKING`) | **0.4s** (`INSTANT_SIGNAL_CONFIRM_MS`) | 2.5s |
| Nigoh/bosh chetga (`HEAD_AWAY` — gaze chap/o‘ng/tepa/past) | **0.4s** (`INSTANT_SIGNAL_CONFIRM_MS`) | 4s |

Nega xavfsiz: kichik ogohlantirish — **faqat vizual chip**, backendga yuborilmaydi va strike hisoblanmaydi. Rasmiy ogohlantirish vaqtlari tegilmagan, ya‘ni tasodifiy harakat jazolanmaydi.

Qolgan barcha turlar (pozitsiya, qimirlash, qo‘l, tashqi shovqin, print-screen, clipboard, devtools) umumiy 1.5s da qoladi.

#### Pastga qarash teshigi (tuzatilgan)

Nigoh nazoratida jiddiy teshik bor edi: talaba **pastga** (tizzadagi telefonga) qaraganda qovoq tushadi, ko‘z torayadi va `computeIrisGaze()` `null` qaytaradi — natijada nigoh nazorati **butunlay jim** bo‘lib qolardi. Ya‘ni eng muhim aldash holati aniqlanmasdi.

Endi `eyesTooNarrowForGaze()` shu holatni **o‘zi signal** sifatida hisoblaydi (`gazeDown` ga qo‘shiladi). Ko‘z pirillashi (~200ms) 0.4s uzluksiz talabidan qisqa, shuning uchun jazolanmaydi. Kod: `frontend/src/lib/realtimeProctor.ts`, testlar: `frontend/tests/irisGaze.test.ts`.

#### Shaxsni qayta tekshirish oralig‘i

`IDENTITY_CHECK_MS` = **15s** (avval 90s). 90 soniya yuz almashtirish uchun juda keng oyna edi. Server throttle `face_verify` = 25/min, 15s = 4/min — chegaraga yetmaydi.

**Signal manbalari va ular ushbu qonunni qanday qo‘llaydi:**

- **Video (MediaPipe, `frontend/src/lib/realtimeProctor.ts`)** — yuz yo‘q (`NO_FACE`), ko‘p yuz (`MULTI_FACE`), bosh burilishi/gaze, pozitsiya (uzoq/yaqin/markaz), haddan tashqari qimirlash, qo‘l ko‘tarish, og‘iz harakati. Har biri `trackContinuous` bilan 1.5s/4s. Sariq chip qatori.
- **Audio (`frontend/src/lib/voiceActivity.ts` + `ContinuousSignalTracker`)** — gapirish (`MOUTH_MOVEMENT_TALKING`/`WHISPER_OR_CONVERSATION_SUSPECTED`) va tashqi shovqin (`SUSPICIOUS_AUDIO`). Ko‘k chip qatori, farqli matn.
  - **Odam ovozini maishiy shovqindan ajratish — `frontend/src/lib/sileroVad.ts` (Silero VAD, neyron tarmoq).** Qo‘lda yozilgan DSP mezonlari (RMS/ZCR/davriylik) real audioda ishlamagani o‘lchab isbotlangan: jim/uzoq ovozda atigi **7.5%** aniqlash, maishiy shovqinda **13.7%** soxta ijobiy. Silero xuddi shu audioda **100%** aniqlash va **0%** soxta ijobiy beradi. To‘liq hisobot va uni qayta ishga tushirish: [`docs/VAD_BENCHMARK.md`](docs/VAD_BENCHMARK.md).
  - Sabab: real nutqning ~40% kadri ovozsiz (`s`, `sh`, `f`, `t`) — davriyligi yo‘q; aksincha ko‘p maishiy shovqin davriy (ventilyator, signal, budilnik, bola yig‘isi). Bu ikki sinf qo‘lda sozlanadigan 5-6 o‘lchamli fazoda kesishadi — u yerda chegara **umuman mavjud emas**, shu sabab threshold sozlash bilan hal bo‘lmaydi.
  - Model (2.3MB) va ONNX runtime (13.5MB, gzip 3.3MB) **o‘zimizda hosted** (`public/models/`, `public/ort/`), CDN‘ga bog‘liq emas; nginx ularni siqadi va 30 kun keshlaydi. Tezlik brauzerda o‘lchangan: **0.25–0.38 ms / 32ms audio kadr**.
  - **Sezgirlik kaliti — `SPEECH_MIN_FRAMES` (`sileroVad.ts`).** Nutq shuncha kadr uzluksiz davom etsagina tasdiqlanadi (1 kadr = 32ms; hozir 12 = 384ms). Bitta kadr yetarli bo‘lganda maishiy shovqinda 9.7% soxta ogohlantirish chiqardi; 384ms talab bilan **0%**, real gapirishni aniqlash esa **100%** bo‘lib qoldi. Sezgirlikni o‘zgartirishdan oldin `tools/vad-benchmark/verify_chain.py` ni ishga tushiring — u to‘liq ishlab chiqarish zanjirini real audioda takrorlaydi, ya‘ni chegarani his bilan emas, o‘lchov bilan tanlaysiz.
  - Model yuklanmasa — eski DSP zaxira sifatida ishlaydi (`voiceActivity.ts` saqlangan). Proctoring hech qachon imtihonni buzmaydi.
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
