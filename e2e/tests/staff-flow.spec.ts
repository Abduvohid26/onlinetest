import { test, expect } from '@playwright/test';

const BASE = process.env.UI_BASE || 'http://127.0.0.1:8080';
const STAFF_ID = process.env.SMOKE_STAFF_ID || 'demo_staff';
const STAFF_PASS = process.env.SMOKE_STAFF_PASS || 'DemoFJSTI2026!';

test.describe('Staff portal smoke', () => {
  test('demo_staff can login and see assigned exams tab', async ({ page }) => {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.locator('input[autocomplete="username"]').fill(STAFF_ID);
    await page.locator('input[type="password"]').fill(STAFF_PASS);
    await page.getByRole('button', { name: /Kirish|Login|Войти|Sign In/i }).click();
    await page.waitForSelector('header', { timeout: 15000 });
    await expect(page).toHaveURL(/\/(staff)?$/);
    await expect(page.getByText(/Staff|Xodim|Кабинет|portal/i).first()).toBeVisible({ timeout: 10000 });
  });
});
