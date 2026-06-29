#!/usr/bin/env node
/** i18n kalitlari uz/ru/en orasida mosligini tekshiradi. */
import { translations } from '../frontend/src/i18n.ts';

const base = Object.keys(translations.uz);
let failed = false;

for (const lang of ['ru', 'en']) {
  const missing = base.filter((k) => !(k in translations[lang]));
  const extra = Object.keys(translations[lang]).filter((k) => !(k in translations.uz));
  if (missing.length || extra.length) {
    failed = true;
    console.log(`[${lang}] missing ${missing.length}:`, missing.slice(0, 15).join(', '));
    if (extra.length) console.log(`[${lang}] extra ${extra.length}:`, extra.slice(0, 10).join(', '));
  } else {
    console.log(`[${lang}] OK — ${Object.keys(translations[lang]).length} keys`);
  }
}

for (const lang of ['uz', 'ru', 'en']) {
  const empty = Object.entries(translations[lang]).filter(([, v]) => v === '');
  if (empty.length) console.log(`[${lang}] empty (${empty.length}):`, empty.map(([k]) => k).join(', '));
}

console.log(`Base (uz): ${base.length} keys`);
process.exit(failed ? 1 : 0);
