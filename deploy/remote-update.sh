#!/usr/bin/env bash
# Serverda loyiha ildizidan: git pull, api.env yuklash, frontend (bir domen VITE),
# backend migrate/collectstatic, nginx (HTTP-only fallback), systemd restart, health.
#
# Ishlatish:
#   cd /var/www/onlinetest && bash deploy/remote-update.sh
#   bash deploy/remote-update.sh --no-git
#   bash deploy/remote-update.sh --reset-admin   # XAVFLI: barcha user + imtihonlarni o'chiradi, faqat admin/fjsti123
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NO_GIT=0
AUTOSTASH=1
RESET_ADMIN=0
for arg in "$@"; do
  case "$arg" in
    --no-git) NO_GIT=1 ;;
    --no-autostash) AUTOSTASH=0 ;;
    --reset-admin) RESET_ADMIN=1 ;;
    *)
      echo "[remote-update] Noma'lum argument: $arg (ruxsat: --no-git, --no-autostash, --reset-admin)" >&2
      exit 1
      ;;
  esac
done

if [[ "$RESET_ADMIN" -eq 1 ]]; then
  echo "[remote-update] DIQQAT: --reset-admin — barcha AppUser va imtihon/natija yozuvlari o'chadi; faqat ID admin / parol fjsti123 qoladi."
fi

STASHED=0
STASH_NAME="remote-update-autostash-$(date +%F-%H%M%S)"

git_pull_safe() {
  if [[ "$NO_GIT" -eq 1 ]]; then
    echo "[remote-update] --no-git: git pull o'tkazib yuborildi."
    return 0
  fi
  if [[ "$AUTOSTASH" -eq 1 ]] && [[ -n "$(git status --porcelain)" ]]; then
    git stash push -u -m "$STASH_NAME" >/dev/null
    STASHED=1
    echo "[remote-update] Lokal o'zgarishlar vaqtincha stash qilindi."
  fi
  git pull origin main
}

restore_stash_if_any() {
  if [[ "$STASHED" -eq 1 ]]; then
    if git stash list | grep -q "$STASH_NAME"; then
      echo "[remote-update] Stash qaytarilmoqda..."
      if ! git stash pop --index >/dev/null 2>&1; then
        echo "[remote-update] WARN: stash auto-popda konflikt bo'ldi. Qo'lda tekshiring: git stash list"
      fi
    fi
  fi
}

load_api_env() {
  local api_env="/etc/onlinetest/api.env"
  if [[ ! -f "$api_env" ]]; then
    echo "[remote-update] WARN: $api_env topilmadi — migrate prod sozlamasida xato berishi mumkin."
    return 0
  fi
  set -a
  # shellcheck disable=SC1091
  source "$api_env"
  set +a
  echo "[remote-update] $api_env yuklandi."
}


ensure_frontend_env() {
  local f="$ROOT/frontend/.env.production"
  if [[ ! -f "$f" ]]; then
    cp "$ROOT/frontend/.env.production.example" "$f"
    echo "[remote-update] frontend/.env.production yaratildi (namunadan)."
  fi
  if grep -qE 'api\.online-imtixon\.uz' "$f" 2>/dev/null; then
    if grep -q '^VITE_API_BASE_URL=' "$f"; then
      sed -i 's|^VITE_API_BASE_URL=.*|VITE_API_BASE_URL=|' "$f"
    else
      printf '\nVITE_API_BASE_URL=\n' >>"$f"
    fi
    if grep -q '^VITE_SOCKET_URL=' "$f"; then
      sed -i 's|^VITE_SOCKET_URL=.*|VITE_SOCKET_URL=|' "$f"
    else
      printf '\nVITE_SOCKET_URL=\n' >>"$f"
    fi
    echo "[remote-update] VITE_*: api.online-imtixon.uz olib tashlandi (bir domen / nisbiy /api)."
  fi
}

run_enable_nginx() {
  if [[ ! -f "$ROOT/deploy/enable-nginx-onlinetest.sh" ]]; then
    echo "[remote-update] WARN: enable-nginx-onlinetest.sh topilmadi."
    return 0
  fi
  if [[ $(id -u) -eq 0 ]]; then
    bash "$ROOT/deploy/enable-nginx-onlinetest.sh"
  elif command -v sudo >/dev/null 2>&1; then
    sudo bash "$ROOT/deploy/enable-nginx-onlinetest.sh"
  else
    echo "[remote-update] WARN: sudo yo'q — nginx: qo'lda sudo bash deploy/enable-nginx-onlinetest.sh"
  fi
}

check_health() {
  local local_api="http://127.0.0.1:9081/api/health"
  if ! command -v curl >/dev/null 2>&1; then
    return 0
  fi
  echo "[remote-update] Health tekshirilmoqda..."
  curl -fsS --max-time 8 "$local_api" >/dev/null && echo "  - gunicorn 9081: OK" || echo "  - gunicorn 9081: FAIL ($local_api)"
}

git_pull_safe

if [[ -f "$ROOT/deploy/systemd/onlinetest-api.service" ]]; then
  sudo cp "$ROOT/deploy/systemd/onlinetest-api.service" /etc/systemd/system/onlinetest-api.service
fi
sudo systemctl daemon-reload
load_api_env

if [[ ! -d backend/.venv ]]; then
  python3 -m venv backend/.venv
fi
(
  cd backend
  ./.venv/bin/pip install -r requirements.txt -q
  ./.venv/bin/python manage.py migrate --noinput
  if [[ "$RESET_ADMIN" -eq 1 ]]; then
    ./.venv/bin/python manage.py reset_single_admin --yes
  fi
  ./.venv/bin/python manage.py collectstatic --noinput
)

ensure_frontend_env
(
  cd frontend
  npm ci
  npm run build
)

npm ci --omit=dev --prefix "$ROOT"

run_enable_nginx

if systemctl is-active --quiet onlinetest-api 2>/dev/null; then
  sudo systemctl restart onlinetest-api
  echo "[remote-update] onlinetest-api va qayta ishga tushirildi."
else
  echo "[remote-update] WARN: onlinetest-api aktiv emas — birinchi o'rnatish: deploy/bootstrap-ubuntu-once.sh"
fi

if command -v nginx >/dev/null 2>&1; then
  sudo nginx -t
  sudo systemctl reload nginx
fi

if id www-data &>/dev/null; then
  if [[ $(id -u) -eq 0 ]]; then
    chown -R www-data:www-data "$ROOT/backend" "$ROOT/frontend/dist" "$ROOT/node_modules" 2>/dev/null || true
  elif command -v sudo >/dev/null 2>&1; then
    sudo chown -R www-data:www-data "$ROOT/backend" "$ROOT/frontend/dist" "$ROOT/node_modules" 2>/dev/null || true
  fi
fi

restore_stash_if_any
check_health
echo "[remote-update] OK"
