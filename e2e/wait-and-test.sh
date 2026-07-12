#!/usr/bin/env bash
# app xizmati tayyor bo'lishini kutadi, so'ng Playwright testlarini ishga tushiradi.
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"
echo "E2E: ${BASE_URL}/api/health tayyor bo'lishini kutmoqda..."
ready=0
for _ in $(seq 1 60); do
    if curl -sf "${BASE_URL}/api/health" >/dev/null 2>&1; then
        ready=1
        break
    fi
    sleep 2
done
if [ "$ready" -ne 1 ]; then
    echo "E2E: ${BASE_URL} 120s ichida javob bermadi." >&2
    exit 1
fi
echo "E2E: backend tayyor — testlar boshlanmoqda."
exec npx playwright test "$@"
