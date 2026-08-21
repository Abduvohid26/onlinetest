#!/usr/bin/env bash
#
# YANGI serverda ishlatiladi: `migrate-export.sh` yiqqan arxivni tiklaydi.
#
#   sudo bash deploy/migrate-import.sh /root/onlinetest-migrate-YYYYMMDD-HHMMSS.tar.gz
#
# Oldindan kerak: docker, docker compose, git, nginx.
# Kod git'dan klon qilinadi; arxivda faqat git'da BO'LMAGAN narsalar bor.
set -euo pipefail

BUNDLE="${1:-}"
ROOT="${ONLINETEST_ROOT:-/home/onlinetest}"
REPO="${REPO_URL:-https://github.com/Abduvohid26/onlinetest.git}"
DOMAIN="${DOMAIN:-online-imtixon.uz}"
WORK="/tmp/onlinetest-import-$$"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[!] %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m[x] %s\033[0m\n' "$*" >&2; exit 1; }

[[ -n "$BUNDLE" && -f "$BUNDLE" ]] || die "Foydalanish: $0 /yo'l/onlinetest-migrate-*.tar.gz"
command -v docker >/dev/null || die "docker yo'q: apt install -y docker.io docker-compose-plugin"

mkdir -p "$WORK"
tar xzf "$BUNDLE" -C "$WORK"
[[ -f "$WORK/INFO.txt" ]] && cat "$WORK/INFO.txt"

# ── 1) Kod ─────────────────────────────────────────────────────────────────
say "1/6 Kod"
if [[ -d "$ROOT/.git" ]]; then
  echo "    $ROOT mavjud — git pull"
  git -C "$ROOT" pull --ff-only
else
  git clone "$REPO" "$ROOT"
fi
cd "$ROOT"

# ── 2) .env ────────────────────────────────────────────────────────────────
say "2/6 .env"
if [[ -f "$WORK/env" ]]; then
  # Mavjudini hech qachon jimgina bosib ketmaymiz.
  [[ -f "$ROOT/.env" ]] && cp "$ROOT/.env" "$ROOT/.env.bak-$(date +%s)" && warn "eskisi .env.bak-* ga saqlandi"
  cp "$WORK/env" "$ROOT/.env"
  chmod 600 "$ROOT/.env"
  echo "    OK"
else
  warn ".env arxivda yo'q — .env.example dan yarating"
fi

# ── 3) data/ ───────────────────────────────────────────────────────────────
say "3/6 data/"
if [[ -f "$WORK/data.tar.gz" ]]; then
  tar xzf "$WORK/data.tar.gz" -C "$ROOT"
  echo "    $(du -sh "$ROOT/data" 2>/dev/null | cut -f1)"
else
  echo "    arxivda yo'q"
fi

# ── 4) Baza ────────────────────────────────────────────────────────────────
say "4/6 PostgreSQL"
docker compose up -d db
echo "    baza tayyor bo'lishini kutmoqda..."
for _ in $(seq 1 60); do
  docker compose exec -T db pg_isready -U onlinetest >/dev/null 2>&1 && break
  sleep 2
done
docker compose exec -T db pg_isready -U onlinetest >/dev/null 2>&1 || die "baza ko'tarilmadi"

# Bo'sh emasligini tekshiramiz — tasodifan ustiga yozib yubormaslik uchun.
TABLES="$(docker compose exec -T db psql -U onlinetest -d onlinetest -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>/dev/null | tr -d '[:space:]' || echo 0)"
if [[ "${TABLES:-0}" != "0" && "${FORCE_DB:-0}" != "1" ]]; then
  die "Bazada allaqachon $TABLES ta jadval bor. Ustiga yozish uchun: FORCE_DB=1 $0 $BUNDLE"
fi
gunzip -c "$WORK/db.sql.gz" | docker compose exec -T db psql -U onlinetest -d onlinetest >/dev/null
echo "    tiklandi"

# ── 5) nginx ───────────────────────────────────────────────────────────────
say "5/6 nginx"
if [[ -d "$WORK/nginx" ]] && compgen -G "$WORK/nginx/*" >/dev/null; then
  cp "$WORK"/nginx/"$DOMAIN"* /etc/nginx/sites-available/ 2>/dev/null || true
  [[ -d "$WORK/nginx/snippets" ]] && mkdir -p /etc/nginx/snippets && \
    cp "$WORK"/nginx/snippets/* /etc/nginx/snippets/ 2>/dev/null || true
  ln -sf "/etc/nginx/sites-available/$DOMAIN" "/etc/nginx/sites-enabled/$DOMAIN" 2>/dev/null || true

  # MediaPipe (WebAssembly) uchun CSP shart. Usiz butun real-time nazorat o'chadi.
  if grep -rqs "wasm-unsafe-eval" /etc/nginx/sites-available/ 2>/dev/null; then
    echo "    CSP: 'wasm-unsafe-eval' bor ✓"
  else
    warn "CSP da 'wasm-unsafe-eval' YO'Q — MediaPipe ishlamaydi, nazorat o'chadi!"
    warn "script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:;  qo'shing"
  fi
  nginx -t && systemctl reload nginx && echo "    nginx qayta yuklandi"
else
  warn "nginx konfiguratsiyasi arxivda yo'q — qo'lda sozlang"
fi

if [[ -f "$WORK/letsencrypt.tar.gz" && "${SKIP_CERTS:-0}" != "1" ]]; then
  tar xzf "$WORK/letsencrypt.tar.gz" -C /etc && echo "    sertifikatlar ko'chirildi"
fi
[[ -f "$WORK/onlinetest-backup" ]] && cp "$WORK/onlinetest-backup" /etc/cron.d/ && chmod 644 /etc/cron.d/onlinetest-backup

# ── 6) Ishga tushirish ─────────────────────────────────────────────────────
say "6/6 Xizmatlarni ko'tarish"
docker compose up -d --build

rm -rf "$WORK"
say "TAYYOR"
cat <<NEXT

Tekshiruv:
  docker compose ps
  curl -sI https://$DOMAIN/ | grep -i content-security-policy
  docker compose logs -f | grep PROCTOR-DIAG

DNS hali ko'chmagan bo'lsa, o'tkazgandan keyin:
  certbot --nginx -d $DOMAIN -d www.$DOMAIN

Imtihonni ochib, kamera panelida "Yuz to'g'ri" / "Yuz ko'rinmayapti"
chiqishini ko'ring. "Kamera tayyor..." qolsa — engine ishlamayapti.
NEXT
