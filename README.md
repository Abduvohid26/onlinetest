# FJSTI Online Exam

Masofaviy imtihon platformasi: **Django REST API**, **React (Vite) SPA**, **Django Channels** WebSocket real-time (proctoring signal). Batafsil funksional talablar: [`docs/TEXNIK_TALABLAR.md`](docs/TEXNIK_TALABLAR.md).

## Ishga tushirish (Docker — yagona yo'l)

Node/Python/PostgreSQL/Redis — hammasi konteynerda. Boshqa hech narsa o'rnatish shart emas:

```bash
docker compose up --build
```

Brauzer: **http://127.0.0.1:8080**

Demo loginlar (parol hammasiga **`DemoFJSTI2026!`**):

| Login | Rol |
|-------|-----|
| `demo_admin` | admin |
| `demo_staff` | staff (kuzatuvchi) |
| `demo_student` | talaba |

Django admin paneli: `http://127.0.0.1:8080/admin/` (`admin` / `AdminLocal123`).

- To'xtatish: `Ctrl+C` yoki `docker compose down`
- Loglar: `docker compose logs -f`
- Stack: `app` (API + SPA, `:8080`), `db` (PostgreSQL), `redis`, `worker` (Celery proctoring tasklari)

## Muhit o'zgaruvchilari (ixtiyoriy — `backend/.env`)

Docker standartlari ishlash uchun yetarli. AI funksiyalari uchun bittagina o'zgaruvchi muhim:

| O'zgaruvchi | Tavsif |
|-------------|--------|
| `OPENAI_API_KEY` | Yuz solishtirish, smart import, AI savollar (yo'q bo'lsa AI funksiyalari o'tkazib yuboriladi) |
| `OPENAI_MODEL` / `OPENAI_VISION_MODEL` | Standart: `gpt-4o-mini` / `gpt-4o` |
| `DATABASE_URL` | PostgreSQL (`postgres://...`). Docker'da avtomatik; SQLite qo'llab-quvvatlanmaydi |
| `REDIS_URL` | Channel layer + Celery broker (Docker'da avtomatik) |
| `JWT_SECRET`, `DJANGO_SECRET_KEY` | Prod deploy uchun (Docker dev'da standart bor) |

To'liq namunalar: `backend/.env.example`, `deploy/env.api.example`.

## Joylashtirish

[`deploy/DEPLOY.md`](deploy/DEPLOY.md), GitHub Actions: [`deploy/DEPLOY-GITHUB-ACTIONS.md`](deploy/DEPLOY-GITHUB-ACTIONS.md).

**Serverda bitta yangilash** (git pull, migrate, frontend build, nginx HTTP/HTTPS tanlash, restart):

```bash
cd /var/www/onlinetest && bash deploy/remote-update.sh
```

Barcha foydalanuvchi + imtihonlarni o‘chirib faqat `admin` / `fjsti123` qoldirish (xavfli): `bash deploy/remote-update.sh --reset-admin`

## Xavfsizlik eslatmalari

- Repoda `.env` qolmaganini tekshiring (`.gitignore`). Baza — PostgreSQL (SQLite ishlatilmaydi).
- Brauzerda **parolni localStorage da saqlamaymiz**; «Eslab qolish» faqat foydalanuvchi ID.
- Production da `bootstrap_exam` kuchsiz standart parol ishlatmaydi — `ADMIN_BOOTSTRAP_PASSWORD` o‘rnating yoki `deploy/bootstrap-ubuntu-once.sh` avtogeneratsiyasidan foydalaning.

## Masshtablash / yuklama eslatmalari

- **Redis majburiy** (bir nechta Gunicorn worker bo'lsa, `WEB_CONCURRENCY>1`): WebSocket proctoring (LiveMonitor) signali worker'lar orasida `channels-redis` orqali tarqaladi; `REDIS_URL` bo'lmasa `InMemoryChannelLayer` ishlatiladi va jonli kuzatuv buziladi. `REDIS_URL` VAC HMAC replay cache'ni ham FileBased o'rniga Redis'ga o'tkazadi. Prod'da `REDIS_URL` yo'q bo'lsa `manage.py check --deploy` buni `exam.E001` (Error) bilan to'xtatadi; ataylab bitta jarayonli deploy uchun `ALLOW_INMEMORY_CHANNELS=1` (faqat `WEB_CONCURRENCY=1`). Docker Compose'da Redis allaqachon sozlangan.
- **AI background queue (Celery):** `proctor-frame` AI kadr tahlili Celery worker'da bajariladi — web worker thread'larini band qilmaydi. `REDIS_URL` (yoki `CELERY_BROKER_URL`) bo'lsa: endpoint `202 {task_id}` qaytaradi, client `GET .../proctor-frame/{task_id}` bilan natijani poll qiladi. Broker yo'q bo'lsa (dev/test) `CELERY_TASK_ALWAYS_EAGER=True` — task sync ishlaydi, eski xulq saqlanadi (frontend ikkala holatni qo'llaydi). Worker: `celery -A exam_platform worker -l info --concurrency=2` (Docker: `worker` service, systemd: `deploy/systemd/onlinetest-worker.service`). `identity-compare` hozircha sync (imtihon start oldidan bir martalik); `identity_compare_task` kelajak uchun tayyor.

## CI

GitHub Actions: `.github/workflows/ci.yml` (frontend typecheck/test/build, backend check/test).
