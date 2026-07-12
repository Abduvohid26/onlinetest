import { test, expect } from '@playwright/test';

const BASE = process.env.UI_BASE || 'http://127.0.0.1:8080';
const STUDENT_ID = process.env.SMOKE_STUDENT_ID || 'demo_student';
const STUDENT_PASS = process.env.SMOKE_STUDENT_PASS || 'DemoFJSTI2026!';

test.describe('Student portal smoke', () => {
  test('demo_student dashboard tabs and results filter work', async ({ page }) => {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.locator('input[autocomplete="username"]').fill(STUDENT_ID);
    await page.locator('input[type="password"]').fill(STUDENT_PASS);
    await page.getByRole('button', { name: /Kirish|Login|Войти|Sign In/i }).click();
    await page.waitForSelector('header', { timeout: 15000 });

    await expect(page.getByRole('button', { name: /Mavjud imtihonlar|Available exams|Доступные/i })).toBeVisible();
    await page.getByRole('button', { name: /Mening natijalarim|My results|Мои результаты/i }).click();
    await expect(page.locator('#student-result-status-filter')).toBeVisible();
    await page.locator('#student-result-status-filter').selectOption('Completed');
    await page.waitForTimeout(400);
    await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
  });
});
