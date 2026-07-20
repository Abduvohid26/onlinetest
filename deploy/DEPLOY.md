# DigitalOcean dropletga joylashtirish

**Push bilan avtomatik deploy:** GitHub’da Secrets qo‘ygach, `main` ga har pushda server yangilanadi — [DEPLOY-GITHUB-ACTIONS.md](./DEPLOY-GITHUB-ACTIONS.md).

**Domen ochilsa boshqa sayt chiqsa:** nginx hali ulangan emas — [TROUBLESHOOT-DOMAINS.md](./TROUBLESHOOT-DOMAINS.md). Bir marta: `sudo bash deploy/bootstrap-ubuntu-once.sh` yoki faqat nginx: `sudo bash deploy/enable-nginx-onlinetest.sh`.

**Lokaldan SSH parol/kalit ishlatib bo‘lmasa (tavsiya: DO web console / «Console»):** to‘liq o‘rnatish bitta qatorda (root sifatida):

```bash
curl -fsSL https://raw.githubusercontent.com/aiziyrak-coder/OnlineTest/main/deploy/droplet-bootstrap-from-console.sh | bash
```

Yoki o‘z domenlaringizni bering: `CERTBOT_EMAIL=you@mail.uz FRONT_DOMAIN=online-imtixon.uz API_DOMAIN=api.online-imtixon.uz` (export) so‘ng yuqoridagi `curl | bash`.

**Brauzer ochilmayaptimi / timeout?** SSH dan keyin serverda portlar va nginx:

```bash
curl -fsSL https://raw.githubusercontent.com/aiziyrak-coder/OnlineTest/main/deploy/droplet-open-ports-and-verify.sh | bash
```

Bu skript **faqat server ichida** UFW + nginx + xizmatlarni tekshiradi; **DNS va DO Cloud Firewall** sizning panelingizda qo‘lda (skript oxirida eslatma chiqadi).

**`api.online-imtixon.uz` DNS yo‘q / sertifikat chiqmayaptimi:** `sudo bash deploy/enable-nginx-onlinetest.sh` endi **sertifikat bo‘lmasa** avtomatik **HTTP-only** nginx qo‘yadi (`nginx -t` yiqilmasin). DNS da `api` uchun **A** yozuvi paydo bo‘lib, certbot muvaffaq bo‘lgach, yana shu skriptni ishga tushiring — HTTPS konfig yuklanadi.

## Xavfsizlik (majburiy)

1. Chatda yuborilgan **root parolini darhol o‘zgartiring** (`passwd`). Keyinchalik faqat **SSH kalit** (`PermitRootLogin prohibit-password`).
2. **Parolni** skript, Git yoki issue’larga yozmang. `api.env` faqat serverda, huquq `chmod 600`.
3. [OnlineTest](https://github.com/aiziyrak-coder/OnlineTest) repozitoriyasi bo‘sh bo‘lsa, avval lokaldan `git push` qiling.

## Domenlar

| Xizmat   | Domen                      | Nginx root / proxy        |
|----------|----------------------------|---------------------------|
| Frontend | `online-imtixon.uz`    | Statik `frontend/dist`    |
| API+WS   | `api.online-imtixon.uz` | `127.0.0.1:9081` (HTTP + WebSocket) |

Boshqa loyihalarga tegmaslik: faqat **loopback** (`127.0.0.1`) portlari; tashqi dunyoga faqat **80/443** orqali nginx.

## 1) Bo‘sh portlarni tekshirish

Serverda:

```bash
bash deploy/find-free-ports.sh
```

Agar `9081` band bo’lsa, boshqa bo’sh port tanlang va quyidagilarni yangilang:

- `deploy/systemd/onlinetest-api.service` — `--bind 127.0.0.1:YANGI`
- `deploy/nginx/onlinetest.conf` — `proxy_pass` portlari

## 2) DNS

`online-imtixon.uz` va `api.online-imtixon.uz` uchun **A** yozuvlari droplet IP (`209.38.239.183`) ga.

## 3) Serverda katalog va kod

```bash
sudo mkdir -p /var/www/onlinetest /etc/onlinetest
sudo chown -R $USER:$USER /var/www/onlinetest
cd /var/www/onlinetest
git clone https://github.com/aiziyrak-coder/OnlineTest.git .
# yoki mavjud repodan: git pull
```

### To'liq 0-dan qayta o'rnatish (tavsiya)

```bash
sudo rm -rf /var/www/onlinetest
sudo mkdir -p /var/www/onlinetest
sudo git clone https://github.com/aiziyrak-coder/OnlineTest.git /var/www/onlinetest
cd /var/www/onlinetest
sudo CERTBOT_EMAIL=admin@online-imtixon.uz FRONT_DOMAIN=online-imtixon.uz API_DOMAIN=api.online-imtixon.uz bash deploy/full-install-root.sh
```

## 4) Backend

```bash
cd /var/www/onlinetest/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
sudo cp deploy/env.api.example /etc/onlinetest/api.env
sudo nano /etc/onlinetest/api.env   # kalitlarni to‘ldiring
sudo chmod 600 /etc/onlinetest/api.env
python manage.py migrate
python manage.py bootstrap_exam   # bir marta; keyin parolni o‘zgartiring
deactivate
```

`bootstrap_exam` admin yaratadi: ID odatda `fjstiadmin` (`ADMIN_BOOTSTRAP_ID`). **Production (`DJANGO_DEBUG=0`):** `ADMIN_BOOTSTRAP_PASSWORD` muhitda majburiy va kamida **12** belgi; standart parol ishlatilmaydi. Mahalliy ishlab chiqish (`DEBUG=1`) da parol ixtiyoriy — berilmasa `fjsti123`. `deploy/bootstrap-ubuntu-once.sh` birinchi marta `api.env` da kuchli parol generatsiya qiladi (`/root/onlinetest-admin-once.txt`).

**iMentor integratsiyasi:** `api.env` da `IMENTOR_API_KEY` va ixtiyoriy `IMENTOR_API_BASE_URL` (standart `https://imentor.devflix.uz/api`) ni to‘ldiring. Kalit bo‘lmasa iMentor imtihonlari yaratilmaydi. Yangi testlar iMentor da 1 soatdan keyin e’lon qilinadi.

**Docker (lokal):** `backend/.env` da `IMENTOR_API_KEY` bo‘lishi kerak. `docker-compose.yml` ichida `environment: IMENTOR_API_KEY: ${IMENTOR_API_KEY:-}` qo‘ymang — bo‘sh qiymat `.env` dagi kalitni container ichida o‘chirib yuboradi.

**Demo kirishlar (ixtiyoriy):** `python manage.py seed_demo_users` — `demo_admin`, `demo_student`, `demo_teacher` uchun **bir xil** parol. Prod: `api.env` da `DEMO_SEED_PASSWORD` (kamida 12 belgi) majburiy. Dev (`DEBUG=1`): o‘rnatilmasa parol `DemoFJSTI2026!`. **Eslatma:** `teacher` roli SPA login da qo‘llab-quvvatlanmaydi (403); faqat admin va student tizimga kiradi.

**Toza boshlash:** `python manage.py reset_single_admin --yes` — barcha `AppUser` va imtihon/natija yozuvlarini o‘chiradi, faqat **ID `admin`**, parol **`fjsti123`** qoldiradi (`--id` / `--password` bilan boshqacha ham bo‘ladi).

## 5) Frontend build (production)

Lokal yoki serverda:

```bash
cd /var/www/onlinetest/frontend
cp .env.production.example .env.production
# Bir domen: VITE_API_BASE_URL va VITE_SOCKET_URL bo‘sh qoldiring (nisbiy /api/). `api.*` DNS yo‘q bo‘lsa https://api... yozmang — brauzerda ERR_NAME_NOT_RESOLVED.
npm ci
npm run build
```

Natija: `frontend/dist` — nginx `root` shu yerga ishora qiladi.

## 6) Systemd xizmatlarini yoqish

WebSocket Django Channels orqali ishlaydi — alohida Node.js server kerak emas. Faqat `onlinetest-api` servisini yoqing:

```bash
sudo chown -R www-data:www-data /var/www/onlinetest
sudo cp deploy/systemd/onlinetest-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now onlinetest-api
```

## 7) Nginx + TLS

```bash
sudo cp deploy/nginx/onlinetest.conf /etc/nginx/sites-available/onlinetest
sudo ln -sf /etc/nginx/sites-available/onlinetest /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Ikki domen uchun SSL (yoki qo‘lda). **Avval** loyiha katalogiga kiring (`cd /var/www/onlinetest`).

Agar `nginx -t` da `options-ssl-nginx.conf` topilmadi desa:

```bash
sudo bash deploy/ensure-letsencrypt-nginx-options.sh
sudo nginx -t
```

Keyin:

```bash
# api DNS yo'q bo'lsa — faqat apex (bitta sertifikat):
sudo bash deploy/https-certbot.sh online-imtixon.uz

# api A yozuvi tayyor bo'lsa:
# sudo bash deploy/https-certbot.sh online-imtixon.uz api.online-imtixon.uz
# yoki: sudo certbot --nginx -d online-imtixon.uz -d api.online-imtixon.uz
```

Certbot konfigni yangilaydi; keyin `listen 443 ssl` bloklari paydo bo‘ladi.

**HTTPS dan keyin** `/etc/onlinetest/api.env` va `frontend/.env.production` da faqat **`https://`** URL lar bo‘lishi kerak (`deploy/https-certbot.sh` oxirida eslatma chiqadi). `DJANGO_SECURE_SSL=1` **qo‘ymang** — TLS nginx da; Django qayta yo‘naltirish cheksiz loop berishi mumkin.

## 8) Yangilash (bitta skript)

`deploy/remote-update.sh` quyidagilarni ketma-ket bajaradi: `git pull`, `/etc/onlinetest/api.env` yuklab `migrate` / `collectstatic`, `api.online-imtixon.uz` bo’lsa `frontend/.env.production` dagi VITE ni bir domen (bo’sh) qilib tuzatadi, frontend `npm ci && build`, **`sudo bash deploy/enable-nginx-onlinetest.sh`** (sertifikat bo’lmasa HTTP-only), systemd unitlarni nusxalaydi, servislarni restart, health.

**Bitta qator (pull + migrate + build + nginx + restart):** loyiha ildizidan (standart katalog `/var/www/onlinetest`; boshqa joyda bo‘lsa `cd` ni o‘zgartiring).

```bash
cd /var/www/onlinetest && bash deploy/server-pull-restart.sh
```

`deploy/server-pull-restart.sh` — `remote-update.sh` ga yo‘naltiruvchi qisqa nom.

```bash
cd /var/www/onlinetest
bash deploy/remote-update.sh
```

Qo‘shimcha flaglar:

```bash
bash deploy/remote-update.sh --no-git          # git pull qilmasin
bash deploy/remote-update.sh --no-autostash      # lokal o‘zgarishlarni stash qilmasin
bash deploy/remote-update.sh --reset-admin       # XAVFLI: barcha user + imtihonlarni o‘chiradi; faqat admin / fjsti123
```

## Tekshiruv

**Eslatma:** prod da API **8000** da emas; Gunicorn `127.0.0.1:9081` da (`onlinetest-api.service`). Shuning uchun `curl http://127.0.0.1:8000/...` bo‘sh yoki rad etiladi — to‘g‘ri tekshiruv: `9081` yoki nginx orqali.

- `curl -sS http://127.0.0.1:9081/api/health` — `{"ok":true,"database":true}`
- `curl -sS http://127.0.0.1:9081/api/live` — build/reviziya (ixtiyoriy)
- `curl -sS -H 'Host: online-imtixon.uz' http://127.0.0.1/api/health` — xuddi shunday (bir domen nginx)
- `https://api.online-imtixon.uz/api/health` — faqat `api` DNS va TLS tayyor bo‘lsa
- `https://online-imtixon.uz` yoki `http://online-imtixon.uz` — SPA yuklanishi
- Brauzerda login va imtihon oqimi

## Xavfsizlik (audit qoidalari)

- **Maxfiy kalitlar** faqat `/etc/onlinetest/*.env` (chmod `600`), repoda emas: `DJANGO_SECRET_KEY`, `JWT_SECRET`, `GEMINI_API_KEY`, `DEPLOY_HOOK_SECRET`.
- **Gunicorn** faqat `127.0.0.1:9081` (HTTP + WebSocket) — tashqi dunyoga faqat nginx `80/443`.
- **Gunicorn** `--forwarded-allow-ips=127.0.0.1` — `X-Forwarded-Proto` faqat mahalliy proksi ishonchli.
- **CORS** prod da aniq ro‘yxat (`CORS_ALLOWED_ORIGINS`); `DJANGO_DEBUG=0`.
- **JWT** server bazasidagi `AppUser` rolini ishlatadi; muddati `JWT_EXPIRE_HOURS` bilan cheklangan.
- **PostgreSQL** yagona qo‘llab-quvvatlanadigan baza (`DATABASE_URL` majburiy). SQLite umuman ishlatilmaydi.
- **VAC guardlar** prod da default yoqilgan (`VAC_HMAC_GUARD`, `VAC_SEQ_GUARD`, `VAC_CHALLENGE_GUARD` — `deploy/env.api.example`).
- **VAC cache** multi-worker replay uchun: `VAC_CACHE_DIR` yoki `REDIS_URL` (tavsiya).
- **Deploy hook** `timingSafeEqual` bilan solishtiradi; nginx orqali maxfiy sarlavha.
- **WebSocket** ulanishda JWT majburiy (`?token=` query param); `join-exam` xabari assignment va rol tekshiradi — noto'g'ri bo'lsa `close(4001)` bilan yopiladi.

## Ma’lumotlarning doimiyligi (muhim)

Ma’lumotlar **PostgreSQL** (`DATABASE_URL`) da saqlanadi (SQLite ishlatilmaydi).

- **`git pull` va `migrate`** mavjud ma’lumotlarni o‘chirmaydi; migratsiyalar faqat jadval tuzilmasini yangilaydi.
- Zaxira `pg_dump` orqali olinadi (`deploy/backup-database.sh`).
- Serverda **disk zaxirasi** majburiy: `sudo mkdir -p /var/backups/onlinetest` va cron:

```bash
sudo bash /var/www/onlinetest/deploy/backup-database.sh
sudo cp deploy/backup-cron.example /etc/cron.d/onlinetest-backup
sudo chmod 644 /etc/cron.d/onlinetest-backup
```

Zaxira nusxalari: `BACKUP_DIR` (standart `/var/backups/onlinetest`), `45` kundan oshiq eski fayllar avtomatik o‘chiriladi (`BACKUP_KEEP_DAYS`).

- Droplet/snapshot yoki hosting **disk backup** ni alohida yoqing.
