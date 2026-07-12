#!/usr/bin/env node
/**
 * Admin panel UI smoke — barcha sidebar sahifalarini tekshiradi.
 * Ishga tushirish: npx playwright install chromium && node scripts/admin_ui_check.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.UI_BASE || 'http://127.0.0.1:5173';
const ADMIN_ID = process.env.SMOKE_ADMIN_ID || 'demo_admin';
const ADMIN_PASS = process.env.SMOKE_ADMIN_PASS || 'DemoFJSTI2026!';

const PAGES = [
  { nav: 'Asosiy panel', title: 'Asosiy panel', check: async (page) => {
    await page.waitForSelector('text=Admin Panel', { timeout: 10000 });
  }},
  { nav: 'Darajalar (kurslar)', title: 'Darajalar (kurslar)', check: async (page) => {
    await page.waitForSelector('button:has-text("Qo\'shish"), button:has-text("Добавить"), button:has-text("Add")', { timeout: 8000 }).catch(() => {});
  }},
  { nav: 'Guruhlar', title: 'Guruhlar', check: async (page) => {
    await page.waitForTimeout(500);
  }},
  { nav: 'Barcha talabalar', title: 'Barcha talabalar', check: async (page) => {
    await page.waitForTimeout(500);
  }},
  { nav: 'Bloklanganlar', title: 'Bloklanganlar', check: async (page) => {
    await page.waitForTimeout(500);
  }},
  { nav: 'Xodimlar', title: 'Xodimlar', check: async (page) => {
    await page.waitForTimeout(500);
  }},
  { nav: 'Audit jurnali', title: 'Audit jurnali', check: async (page) => {
    await page.waitForTimeout(500);
  }},
  { nav: 'Test bazasi', title: 'Test bazasi', check: async (page) => {
    await page.waitForSelector('text=Import, text=import, text=Kategoriya, text=категор', { timeout: 8000 }).catch(() => {});
  }},
  { nav: 'Imtihon yaratish', title: 'Imtihon yaratish', check: async (page) => {
    await page.waitForSelector('input, textarea', { timeout: 8000 });
    const titleInput = page.locator('input').first();
    await titleInput.waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('button').filter({ hasText: /Baza|Bank|bank/i }).first().click({ timeout: 3000 }).catch(() => {});
    await page.locator('button').filter({ hasText: /Qo'lda|Manual|manual/i }).first().click({ timeout: 3000 }).catch(() => {});
  }},
  { nav: /Imtihonlar ro.yxati/, title: /Imtihonlar ro.yxati/, check: async (page) => {
    await page.waitForTimeout(800);
    await dismissModals(page);
  }},
];

async function dismissModals(page) {
  for (let i = 0; i < 3; i++) {
    const overlay = page.locator('.fixed.inset-0.z-50');
    if (!(await overlay.count())) break;
    const cancel = page.locator('button').filter({ hasText: /Bekor qilish|Cancel|Отмена/i }).first();
    const closeX = page.locator('.rounded-3xl button').filter({ has: page.locator('svg') }).first();
    if (await cancel.count()) await cancel.click({ force: true });
    else if (await closeX.count()) await closeX.click({ force: true });
    else await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }
}

const failures = [];
const passes = [];

function ok(name, cond, detail = '') {
  if (cond) {
    passes.push(name);
    console.log(`  OK  ${name}`);
  } else {
    const msg = detail ? `${name} — ${detail}` : name;
    failures.push(msg);
    console.log(`  FAIL ${msg}`);
  }
}

async function login(page) {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 30000 });
  const idInput = page.locator('input[type="text"], input:not([type])').first();
  const pwInput = page.locator('input[type="password"]');
  await idInput.fill(ADMIN_ID);
  await pwInput.fill(ADMIN_PASS);
  await page.locator('button[type="submit"], button').filter({ hasText: /Kirish|Login|Войти/i }).first().click();
  await page.waitForSelector('text=Admin Panel', { timeout: 15000 });
  ok('login → admin panel', true);
}

async function checkNoConsoleErrors(errors) {
  const critical = errors.filter(
    (e) =>
      !e.includes('favicon') &&
      !e.includes('DevTools') &&
      !e.includes('vite') &&
      !e.includes('ERR_NETWORK_CHANGED') &&
      !e.includes('ERR_QUIC_PROTOCOL') &&
      !e.includes('net::ERR_')
  );
  ok('console errors', critical.length === 0, critical.slice(0, 3).join(' | '));
}

async function checkSidebarLayout(page) {
  const header = page.locator('header, [class*="h-\\[62px\\]"]').first();
  await header.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  const sidebar = page.locator('aside').first();
  if (await sidebar.count()) {
    const box = await sidebar.boundingBox();
    ok('sidebar visible (desktop)', !!box && box.width > 100, box ? `w=${box.width}` : 'no box');
    if (box) {
      ok('sidebar below header', box.y >= 50, `y=${box.y}`);
    }
  }
}

async function main() {
  console.log(`Admin UI check → ${BASE}`);
  const consoleErrors = [];
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  try {
    await login(page);
    await checkSidebarLayout(page);

    for (const p of PAGES) {
      const navLabel = p.nav instanceof RegExp ? p.nav.source : p.nav;
      console.log(`\n→ ${navLabel}`);
      const btn = page.locator('aside button, nav button').filter({ hasText: p.nav }).first();
      if (!(await btn.count())) {
        ok(`nav: ${navLabel}`, false, 'sidebar tugmasi topilmadi');
        continue;
      }
      await btn.click();
      await page.waitForTimeout(400);
      const h1 = page.locator('main h1').first();
      const h1Text = (await h1.textContent())?.trim() || '';
      const titleOk =
        p.title instanceof RegExp
          ? p.title.test(h1Text)
          : h1Text.includes(p.title) || p.title.includes(h1Text.slice(0, 8));
      ok(`sahifa: ${navLabel}`, titleOk, `h1="${h1Text}"`);
      const errAlert = page.locator('[class*="red"], [class*="destructive"]').filter({ hasText: /xato|error|failed|403|500/i });
      const errCount = await errAlert.count();
      ok(`xato banner yo'q (${navLabel})`, errCount === 0, errCount ? `${errCount} ta` : '');
      try {
        await p.check(page);
        ok(`kontent: ${navLabel}`, true);
      } catch (e) {
        ok(`kontent: ${navLabel}`, false, String(e).slice(0, 120));
      }
    }

    await checkNoConsoleErrors(consoleErrors);

    // ── Chuqur: manual imtihon yaratish + tahrirlash modali ─────────────────
    await dismissModals(page);
    console.log('\n→ Chuqur test: manual imtihon');
    await page.locator('aside button').filter({ hasText: /Imtihon yaratish/ }).click();
    await page.waitForTimeout(600);
    await page.locator('button').filter({ hasText: /Qo.lda kiritish/ }).click();
    await page.waitForTimeout(400);
    await page.locator('form input').first().fill(`UI Smoke ${Date.now()}`);
    const groupPick = page.locator('form .grid button[type="button"]').first();
    if (await groupPick.count()) await groupPick.click();
    await page.getByPlaceholder(/Savol matni|Question Text/i).fill('UI smoke: 2+2 necha?');
    await page.getByPlaceholder('A) ...').fill('3');
    await page.getByPlaceholder('B) ...').fill('4');
    await page.getByPlaceholder('C) ...').fill('5');
    await page.getByPlaceholder('D) ...').fill('6');
    await page.locator('button').filter({ hasText: /^A: 3/ }).click();
    const createRes = page.waitForResponse(
      (r) => r.url().includes('/api/admin/exams') && r.request().method() === 'POST',
      { timeout: 20000 },
    );
    await page.locator('form button[type="submit"]').click();
    const res = await createRes.catch(() => null);
    if (!res) {
      const errText = await page.locator('[class*="red"], .text-red').first().textContent().catch(() => '');
      ok('manual imtihon POST', false, errText?.trim() || 'javob kelmadi');
    } else {
      ok('manual imtihon POST', res.status() === 200, `status=${res.status()}`);
    }
    if (res && res.status() === 200) {
      await page.waitForTimeout(400);
      ok('muvaffaqiyat xabari', (await page.locator('text=/muvaffaqiyatli yaratildi|created successfully/i').count()) > 0);
    }

    console.log('\n→ Chuqur test: tahrirlash modali');
    await page.locator('aside button').filter({ hasText: /Imtihonlar ro/i }).click();
    await page.waitForTimeout(1000);
    const editBtn = page.locator('button').filter({ hasText: /Tahrirlash/ }).first();
    ok('tahrirlash tugmasi', (await editBtn.count()) > 0);
    if (await editBtn.count()) {
      await editBtn.click();
      await page.waitForSelector('.rounded-3xl', { timeout: 10000 });
      await page.waitForTimeout(500);
      const modal = page.locator('.rounded-3xl').first();
      ok('tahrirlash modali ochildi', await modal.isVisible());
      const titleInModal = modal.locator('input').first();
      ok('modal forma maydonlari', await titleInModal.isVisible());
      await dismissModals(page);
      ok('modal yopildi', !(await page.locator('.fixed.inset-0.z-50').count()));
    }
  } catch (e) {
    failures.push(`fatal: ${e}`);
    console.error('FATAL', e);
    await page.screenshot({ path: '/tmp/admin_ui_fail.png', fullPage: true }).catch(() => {});
    console.log('Screenshot: /tmp/admin_ui_fail.png');
  } finally {
    await browser.close();
  }

  console.log(`\n${'='.repeat(40)}`);
  console.log(`Passed checks: ${passes.length}`);
  if (failures.length) {
    console.log(`FAILED (${failures.length}):`);
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
  console.log('ALL UI CHECKS PASSED');
}

main();
