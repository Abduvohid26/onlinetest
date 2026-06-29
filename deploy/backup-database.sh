#!/usr/bin/env bash
# PostgreSQL zaxirasi (pg_dump): foydalanuvchilar, test bazasi, imtihon natijalari.
# DATABASE_URL dan ulanadi (postgres://user:pass@host:port/dbname).
# Cron: kuniga 2 marta masalan 03:15 va 15:15
#   15 3,15 * * * root /var/www/onlinetest/deploy/backup-database.sh >> /var/log/onlinetest-backup.log 2>&1
set -euo pipefail

ROOT="${ONLINETEST_ROOT:-/var/www/onlinetest}"
DEST="${BACKUP_DIR:-/var/backups/onlinetest}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-45}"

# DATABASE_URL ni api.env dan o'qiymiz (agar muhitda bo'lmasa).
if [[ -z "${DATABASE_URL:-}" && -f /etc/onlinetest/api.env ]]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' /etc/onlinetest/api.env | tail -1 | cut -d= -f2-)"
fi
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[backup-database] Xato: DATABASE_URL o'rnatilmagan (postgres://...)" >&2
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "[backup-database] Xato: pg_dump yo'q — apt install postgresql-client" >&2
  exit 1
fi

mkdir -p "$DEST"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
OUT="$DEST/db-$STAMP.sql.gz"

# pg_dump to'g'ridan-to'g'ri connection string qabul qiladi.
pg_dump "$DATABASE_URL" | gzip > "$OUT"

chmod 600 "$OUT" 2>/dev/null || true
find "$DEST" -maxdepth 1 -name 'db-*.sql.gz' -type f -mtime "+$KEEP_DAYS" -delete 2>/dev/null || true
echo "[backup-database] OK $OUT"
