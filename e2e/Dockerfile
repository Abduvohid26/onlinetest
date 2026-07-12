# Playwright versiyasi package.json'dagi @playwright/test bilan bir xil bo'lishi SHART
# (browser build'lari versiyaga bog'liq) — ikkalasini birga yangilang.
FROM mcr.microsoft.com/playwright:v1.61.1-jammy

WORKDIR /e2e

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

COPY tsconfig.json playwright.config.ts ./
COPY tests ./tests
COPY wait-and-test.sh ./
RUN chmod +x wait-and-test.sh

ENTRYPOINT ["./wait-and-test.sh"]
