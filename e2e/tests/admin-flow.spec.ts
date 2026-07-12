import { test, expect } from '@playwright/test';

const BASE = process.env.UI_BASE || 'http://127.0.0.1:8080';
const ADMIN_ID = process.env.SMOKE_ADMIN_ID || 'demo_admin';
const ADMIN_PASS = process.env.SMOKE_ADMIN_PASS || 'DemoFJSTI2026!';

const ADMIN_NAV = [
  'Asosiy panel',
  'Darajalar (kurslar)',
  'Guruhlar',
  'Barcha talabalar',
  'Bloklanganlar',
  'Xodimlar',
  'Audit jurnali',
  'Test bazasi',
  'Imtihon yaratish',
  'Imtihonlar ro’yxati',
];

async function loginAdmin(page: import('@playwright/test').Page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.locator('input[autocomplete="username"]').fill(ADMIN_ID);
  await page.locator('input[type="password"]').fill(ADMIN_PASS);
  await page.getByRole('button', { name: /Kirish|Login|Войти|Sign In/i }).click();
  await page.waitForURL(/\/admin/, { timeout: 15000 });
}

test.describe('Admin portal — all pages', () => {
  test('demo_admin can open every sidebar page without error', async ({ page }) => {
    await loginAdmin(page);
    const sidebar = page.locator('aside nav, nav').first();
    for (const label of ADMIN_NAV) {
      await sidebar.getByRole('button', { name: label, exact: true }).click();
      await page.waitForTimeout(600);
      await expect(page.locator('body')).not.toContainText(/Internal Server Error|500|NameError/i);
    }
  });
});
