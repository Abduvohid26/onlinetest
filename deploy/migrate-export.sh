#!/usr/bin/env bash
#
# ESKI serverda ishlatiladi: ko'chirish uchun kerak bo'lgan HAMMA narsani
# bitta arxivga yig'adi.
#
#   sudo bash deploy/migrate-export.sh
#
# Nima yig'iladi (git'da YO'Q narsalar — kod git'dan klon qilinadi):
#   1. PostgreSQL bazasi  (pg_dump)
#   2. .env               (parollar, API kalitlar)
#   3. data/              (talabalar kontingenti, ~775MB)
#   4. nginx sayt konfiguratsiyasi (CSP bilan birga!)
#   5. Let's Encrypt sertifikatlari (ixtiyoriy)
#   6. cron zaxira sozlamasi (bo'lsa)
#
# HECH NARSA O'CHIRILMAYDI — skript faqat o'qiydi.
set -euo pipefail

ROOT="${ONLINETEST_ROOT:-/home/onlinetest}"
DOMAIN="${DOMAIN:-online-imtixon.uz}"
OUT_DIR="${OUT_DIR:-/root/onlinetest-migrate}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
BUNDLE="$OUT_DIR/onlinetest-migrate-$STAMP.tar.gz"
WORK="$OUT_DIR/work-$STAMP"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[!] %s\033[0m\n' "$*"; }

[[ -d "$ROOT" ]] || { echo "Xato: $ROOT topilmadi. ONLINETEST_ROOT bering." >&2; exit 1; }
mkdir -p "$WORK"
cd "$ROOT"

# ── 1) Baza ────────────────────────────────────────────────────────────────
# MUHIM: volume nusxalash EMAS, pg_dump. Yangi serverda PostgreSQL versiyasi
# boshqacha bo'lsa, xom volume ochilmaydi — dump esa doim ochiladi.
say "1/6 PostgreSQL zaxirasi"
docker compose exec -T db pg_dump -U onlinetest onlinetest | gzip > "$WORK/db.sql.gz"
echo "    $(du -h "$WORK/db.sql.gz" | cut -f1)"

# ── 2) .env ────────────────────────────────────────────────────────────────
say "2/6 .env (parollar va API kalitlar)"
if [[ -f "$ROOT/.env" ]]; then
  cp "$ROOT/.env" "$WORK/env"
  echo "    OK"
else
  warn ".env topilmadi — yangi serverda qo'lda yaratasiz"
fi

# ── 3) data/ ───────────────────────────────────────────────────────────────
# Bind mount (`./data:/app/data:ro`), git'da yo'q — ko'chirilmasa yo'qoladi.
say "3/6 data/ (kontingent fayllari)"
if [[ -d "$ROOT/data" ]]; then
  tar czf "$WORK/data.tar.gz" -C "$ROOT" data
  echo "    $(du -h "$WORK/data.tar.gz" | cut -f1)"
else
  warn "data/ yo'q — o'tkazib yuborildi"
fi

# ── 4) nginx ───────────────────────────────────────────────────────────────
# DIQQAT: bu faylda CSP bor va unda `'wasm-unsafe-eval'` BO'LISHI SHART.
# Usiz Chrome WebAssembly'ni bloklaydi va butun real-time nazorat o'chadi.
say "4/6 nginx konfiguratsiyasi"
mkdir -p "$WORK/nginx"
for f in "/etc/nginx/sites-available/$DOMAIN" "/etc/nginx/sites-available/$DOMAIN.conf"; do
  [[ -f "$f" ]] && cp "$f" "$WORK/nginx/"
done
if [[ -d /etc/nginx/snippets ]]; then
  mkdir -p "$WORK/nginx/snippets"
  find /etc/nginx/snippets -name "*onlinetest*" -o -name "*imtixon*" 2>/dev/null \
    | while read -r f; do cp "$f" "$WORK/nginx/snippets/" 2>/dev/null || true; done
fi
if grep -rqs "wasm-unsafe-eval" "$WORK/nginx" 2>/dev/null; then
  echo "    CSP tekshirildi: 'wasm-unsafe-eval' BOR ✓"
else
  warn "CSP da 'wasm-unsafe-eval' TOPILMADI — yangi serverda MediaPipe ishlamaydi!"
  warn "Batafsil: deploy/DEPLOY.md, 'CSP' bo'limi"
fi

# ── 5) TLS sertifikatlari (ixtiyoriy) ──────────────────────────────────────
say "5/6 Let's Encrypt sertifikatlari"
if [[ "${SKIP_CERTS:-0}" != "1" && -d "/etc/letsencrypt/live/$DOMAIN" ]]; then
  tar czf "$WORK/letsencrypt.tar.gz" -C /etc letsencrypt 2>/dev/null || \
    warn "letsencrypt arxivlanmadi (ruxsat?)"
  echo "    OK — lekin DNS o'tkazilgach 'certbot --nginx' bilan qayta olish ham mumkin"
else
  echo "    o'tkazib yuborildi"
fi

# ── 6) cron ────────────────────────────────────────────────────────────────
say "6/6 cron zaxira sozlamasi"
[[ -f /etc/cron.d/onlinetest-backup ]] && cp /etc/cron.d/onlinetest-backup "$WORK/" && echo "    OK" || echo "    yo'q"

# ── Ma'lumotnoma ───────────────────────────────────────────────────────────
git -C "$ROOT" rev-parse HEAD > "$WORK/GIT_COMMIT" 2>/dev/null || true
cat > "$WORK/INFO.txt" <<INFO
Manba:   $(hostname) — $ROOT
Sana:    $(date -u +'%Y-%m-%d %H:%M:%S UTC')
Domen:   $DOMAIN
Commit:  $(cat "$WORK/GIT_COMMIT" 2>/dev/null || echo '-')

Tiklash: yangi serverda deploy/migrate-import.sh
INFO

tar czf "$BUNDLE" -C "$WORK" .
rm -rf "$WORK"

say "TAYYOR"
echo "  $BUNDLE  ($(du -h "$BUNDLE" | cut -f1))"
echo
echo "Yangi serverga uzatish:"
echo "  scp $BUNDLE root@YANGI_IP:/root/"
