#!/usr/bin/env node
/**
 * Admin + Student portal UI smoke: sahifalar, dizayn, tarjima (uz/ru/en).
 * Ishga tushirish: cd /tmp/ui-test && node portal_ui_check.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.UI_BASE || 'http://127.0.0.1:5173';
const ADMIN_ID = process.env.SMOKE_ADMIN_ID || 'demo_admin';
const ADMIN_PASS = process.env.SMOKE_ADMIN_PASS || 'DemoFJSTI2026!';
const STUDENT_ID = process.env.SMOKE_STUDENT_ID || 'demo_student';
const STUDENT_PASS = process.env.SMOKE_STUDENT_PASS || 'DemoFJSTI2026!';

const LANG_EXPECT = {
  uz: { loginBtn: 'Kirish', tabExams: 'Mavjud imtihonlar', tabResults: 'Mening natijalarim', roleStudent: 'Talaba kabineti' },
  ru: { loginBtn: 'Войти', tabExams: 'Доступные экзамены', tabResults: 'Мои результаты', roleStudent: 'Кабинет студента' },
  en: { loginBtn: 'Sign In', tabExams: 'Available exams', tabResults: 'My results', roleStudent: 'Student portal' },
};

const ADMIN_PAGES = [
  { nav: 'Asosiy panel', title: 'Asosiy panel' },
  { nav: 'Darajalar (kurslar)', title: 'Darajalar (kurslar)' },
  { nav: 'Guruhlar', title: 'Guruhlar' },
  { nav: 'Barcha talabalar', title: 'Barcha talabalar' },
  { nav: 'Bloklanganlar', title: 'Bloklanganlar' },
  { nav: 'Xodimlar', title: 'Xodimlar' },
  { nav: 'Test bazasi', title: 'Test bazasi' },
  { nav: 'Imtihon yaratish', title: 'Imtihon yaratish' },
  { nav: /Imtihonlar ro.yxati/, title: /Imtihonlar ro.yxati/ },
];

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

async function dismissModals(page) {
  for (let i = 0; i < 3; i++) {
    const overlay = page.locator('.fixed.inset-0.z-50, .fixed.inset-0.z-\\[100\\]');
    if (!(await overlay.count())) break;
    const cancel = page.locator('button').filter({ hasText: /Bekor qilish|Cancel|Отмена/i }).first();
    const closeX = page.locator('.rounded-3xl button').filter({ has: page.locator('svg') }).first();
    if (await cancel.count()) await cancel.click({ force: true });
    else if (await closeX.count()) await closeX.click({ force: true });
    else await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }
}

async function setLang(page, lang, onLogin = false) {
  const label = lang === 'uz' ? /O.z/ : lang === 'ru' ? /^Ру$/ : /^En$/;
  const root = onLogin ? page : page.locator('header');
  await root.locator('button').filter({ hasText: label }).first().click();
  await page.waitForTimeout(350);
}

async function doLogin(page, id, pass) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.locator('input[type="text"], input:not([type])').first().fill(id);
  await page.locator('input[type="password"]').fill(pass);
  await page.locator('button[type="submit"], button').filter({ hasText: /Kirish|Login|Войти/i }).first().click();
  await page.waitForSelector('header', { timeout: 15000 });
}

async function doLogout(page) {
  await page.locator('button').filter({ hasText: /Chiqish|Logout|Выйти/i }).first().click();
  await page.waitForURL(/login/, { timeout: 10000 }).catch(() => {});
}

async function checkLoginI18n(page) {
  console.log('\n══ Login tarjima ══');
  for (const lang of ['uz', 'ru', 'en']) {
    await setLang(page, lang, true);
    const exp = LANG_EXPECT[lang];
    const btn = page.locator('button[type="submit"]').first();
    const text = ((await btn.textContent()) || '').trim();
    ok(`login [${lang}] tugma`, text.includes(exp.loginBtn), `got="${text}"`);
  }
  await setLang(page, 'uz', true);
}

async function checkStudentPortal(page) {
  console.log('\n══ Student portal ══');
  await doLogin(page, STUDENT_ID, STUDENT_PASS, 'Chiqish');
  ok('student login', true);

  for (const lang of ['uz', 'ru', 'en']) {
    await setLang(page, lang);
    const exp = LANG_EXPECT[lang];
    const roleText = await page.locator('header p').first().textContent().catch(() => '');
    ok(`student [${lang}] role zone`, (roleText || '').includes(exp.roleStudent.slice(0, 12)), roleText?.trim());
    const tabEx = page.locator('button').filter({ hasText: exp.tabExams }).first();
    ok(`student [${lang}] tab exams`, (await tabEx.count()) > 0);
    await tabEx.click();
    await page.waitForTimeout(400);
    const h2 = await page.locator('h2').first().textContent();
    ok(`student [${lang}] exams heading`, (h2 || '').length > 2);
    const tabRes = page.locator('button').filter({ hasText: exp.tabResults }).first();
    ok(`student [${lang}] tab results`, (await tabRes.count()) > 0);
    await tabRes.click();
    await page.waitForTimeout(400);
    const err = page.locator('.text-red-800, .text-red-700').filter({ hasText: /error|xato|403|500/i });
    ok(`student [${lang}] xato yo'q`, (await err.count()) === 0);
  }

  // Dizayn: header + content wrapper
  const header = page.locator('header').first();
  const headerBox = await header.boundingBox();
  ok('student header fixed', !!headerBox && headerBox.y < 5);
  const card = page.locator('.rounded-3xl').first();
  ok('student content card', (await card.count()) > 0);

  await setLang(page, 'uz');
  await doLogout(page);
}

async function checkAdminPortal(page) {
  console.log('\n══ Admin portal ══');
  await doLogin(page, ADMIN_ID, ADMIN_PASS, 'Chiqish');
  ok('admin login', true);

  const sidebar = page.locator('aside').first();
  const box = await sidebar.boundingBox();
  ok('admin sidebar', !!box && box.width > 100);
  if (box) ok('admin sidebar below header', box.y >= 50);

  for (const p of ADMIN_PAGES) {
    const label = p.nav instanceof RegExp ? p.nav.source : p.nav;
    const btn = page.locator('aside button').filter({ hasText: p.nav }).first();
    if (!(await btn.count())) {
      ok(`admin nav: ${label}`, false, 'topilmadi');
      continue;
    }
    await btn.click();
    await page.waitForTimeout(350);
    const h1 = ((await page.locator('main h1').first().textContent()) || '').trim();
    const titleOk = p.title instanceof RegExp ? p.title.test(h1) : h1.includes(p.title);
    ok(`admin sahifa: ${label}`, titleOk, `h1="${h1}"`);
  }

  // Admin tarjima (ru)
  await setLang(page, 'ru');
  const ruNav = page.locator('aside button').filter({ hasText: /Главная|Уровни|Группы/ }).first();
  ok('admin [ru] sidebar', (await ruNav.count()) > 0);
  await setLang(page, 'uz');

  await dismissModals(page);
  await doLogout(page);
}

async function main() {
  console.log(`Portal UI check → ${BASE}`);
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  try {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await checkLoginI18n(page);
    await checkStudentPortal(page);
    await checkAdminPortal(page);

    const critical = consoleErrors.filter(
      (e) => !/favicon|vite|ERR_NETWORK|ERR_QUIC|net::ERR_/i.test(e)
    );
    ok('console errors', critical.length === 0, critical.slice(0, 2).join(' | '));
  } catch (e) {
    failures.push(`fatal: ${e}`);
    console.error('FATAL', e);
    await page.screenshot({ path: '/tmp/portal_ui_fail.png', fullPage: true }).catch(() => {});
  } finally {
    await browser.close();
  }

  console.log(`\n${'='.repeat(40)}`);
  console.log(`Passed: ${passes.length}`);
  if (failures.length) {
    console.log(`FAILED (${failures.length}):`);
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
  console.log('ALL PORTAL CHECKS PASSED');
}

main();
