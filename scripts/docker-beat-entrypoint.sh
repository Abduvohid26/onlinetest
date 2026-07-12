#!/usr/bin/env bash
# Celery beat konteyneri — davriy tasklarni (masalan proctor.sweep_stale_sessions)
# rejalashtirilgan vaqtda navbatga qo'yadi. DIQQAT: shu xizmatning faqat BITTA
# nusxasi ishlashi kerak — bir nechta beat jarayoni bir xil taskni bir necha
# marta navbatga qo'yib yuboradi (duplicate schedule).
set -euo pipefail

export DJANGO_SETTINGS_MODULE=exam_platform.settings
export DJANGO_DEBUG="${DJANGO_DEBUG:-1}"
export JWT_SECRET="${JWT_SECRET:-docker-dev-jwt-secret-min-24-chars}"

cd /app/backend

# PostgreSQL'ni kutish
if [ -n "${DATABASE_URL:-}" ]; then
    echo "Beat: PostgreSQL tayyor bo'lishini kutmoqda..."
    until python - <<'EOF'
import os, sys, urllib.parse, socket
p = urllib.parse.urlparse(os.environ["DATABASE_URL"])
s = socket.socket(); s.settimeout(3)
try:
    s.connect((p.hostname, p.port or 5432)); s.close(); sys.exit(0)
except Exception:
    sys.exit(1)
EOF
    do sleep 1; done
    echo "Beat: PostgreSQL tayyor."
fi

# Redis (broker)'ni kutish — beat schedule dispatch qilishi uchun broker shart.
if [ -n "${REDIS_URL:-}" ]; then
    echo "Beat: Redis (broker) kutilmoqda..."
    until python - <<'EOF'
import os, sys, urllib.parse, socket
p = urllib.parse.urlparse(os.environ["REDIS_URL"])
s = socket.socket(); s.settimeout(3)
try:
    s.connect((p.hostname, p.port or 6379)); s.close(); sys.exit(0)
except Exception:
    sys.exit(1)
EOF
    do sleep 1; done
    echo "Beat: Redis tayyor."
fi

echo "=== Celery beat ==="
exec celery -A exam_platform beat \
    --loglevel="${CELERY_LOGLEVEL:-info}" \
    -s /tmp/celerybeat-schedule
