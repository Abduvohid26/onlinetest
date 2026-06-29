#!/usr/bin/env node
/**
 * Node.js ≥ 20 majburiy (frontend Tailwind oxide + Vite 6 + realtime).
 */
const MIN_MAJOR = 20;
const MIN_MINOR = 19; // @vitejs/plugin-react 5.2+ talabi
const raw = process.versions.node;
const parts = raw.split('.').map((p) => Number.parseInt(p, 10));
const major = parts[0];
const minor = parts[1] ?? 0;

const ok =
  Number.isFinite(major) &&
  (major > MIN_MAJOR || (major === MIN_MAJOR && minor >= MIN_MINOR) || major >= 22);

if (!ok) {
  console.error(
    `\n[onlinetest] Node.js ${MIN_MAJOR}.${MIN_MINOR}+ (yoki 22.12+) kerak. Hozir: v${raw}\n` +
      `  nvm:  nvm install 20 && nvm use\n` +
      `  fnm:  fnm install 20.19.2 && fnm use\n` +
      `  yoki: https://nodejs.org/ (LTS 20.19+)\n`,
  );
  process.exit(1);
}
