import { test, expect, type APIRequestContext } from '@playwright/test';

const DEMO_PASSWORD = process.env.DEMO_SEED_PASSWORD || 'DemoFJSTI2026!';

/**
 * MediaPipe HAQIQATAN yuklanadimi — tarmoq dalili bo'yicha o'lchov.
 *
 * NEGA ALOHIDA TEST: `exam-flow.spec.ts` MediaPipe CDN'ini ATAYLAB bloklaydi
 * (`route.abort()`) — u "model yuklanmadi" degan zaxira yo'lni sinaydi. Ya'ni
 * engine'ning O'ZI hech qachon e2e bilan tekshirilmagan: u butunlay ishlamay
 * qolsa ham hamma testlar yashil bo'laverardi.
 *
 * Bu test hech narsani bloklamaydi va MediaPipe artefaktlari uchun ketgan
 * BARCHA so'rovlarni yozib boradi. UI oqimiga bog'lanmaydi — soxta kamerada
 * haqiqiy yuz yo'q, shuning uchun "yuz topildi" ni kutish noto'g'ri bo'lardi.
 * Bizga kerak bo'lgan yagona narsa: WASM va model fayllari yuklandimi.
 *
 * PreExamCheck sahifasi yetarli — `FacePositionChecker` aynan shu yerda
 * MediaPipe'ni ishga tushiradi.
 */
async function apiLogin(request: APIRequestContext, baseURL: string, id: string) {
  const res = await request.post(`${baseURL}/api/auth/login`, {
    data: { id, password: DEMO_PASSWORD },
  });
  expect(res.ok(), `login failed for ${id}: ${await res.text()}`).toBeTruthy();
  return res.json();
}

test.describe('MediaPipe real-time engine', () => {
  test('WASM va model fayllari brauzerga yuklanadi', async ({ page, request, baseURL }) => {
    test.setTimeout(150_000);
    const base = baseURL!;

    // Faol imtihon yaratamiz (demo seed'da vaqti o'tgan bo'lishi mumkin).
    const { token: adminToken } = await apiLogin(request, base, 'demo_admin');
    const groups = await (
      await request.get(`${base}/api/admin/groups`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      })
    ).json();
    const group = groups.find((g: any) => g.name === '1-guruh') ?? groups[0];
    const now = Date.now();
    const examTitle = `MP probe ${now}`;
    const createRes = await request.post(`${base}/api/admin/exams`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        title: examTitle,
        start_time: new Date(now - 5 * 60_000).toISOString(),
        end_time: new Date(now + 60 * 60_000).toISOString(),
        duration_minutes: 30,
        language: 'uz',
        manual_questions: JSON.stringify([
          { id: 1, text: 'MP: 2+2=?', options: ['3', '4', '5', '6'], correctAnswer: '4' },
        ]),
        group_ids: [group.id],
      },
    });
    expect(createRes.ok(), await createRes.text()).toBeTruthy();
    const { id: examId } = await createRes.json();

    const seen: Array<{ status: number; url: string }> = [];
    const failed: string[] = [];
    const consoleErrors: string[] = [];

    const isMp = (u: string) => /mediapipe|vision_wasm|\.task(\?|$)|\.tflite(\?|$)/i.test(u);

    page.on('response', (r) => {
      if (isMp(r.url())) seen.push({ status: r.status(), url: r.url() });
    });
    page.on('requestfailed', (r) => {
      if (isMp(r.url())) failed.push(`${r.url()}  →  ${r.failure()?.errorText}`);
    });
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });

    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    // TASHQI CDN'NI BLOKLAYMIZ — ishlab turgan tizimdagi holatni taqlid qiladi.
    // Talabalar tarmog'idan `cdn.jsdelivr.net` ochilmaydi (serverga yuborilgan
    // diagnostika buni ko'rsatdi: MediaPipe `[object Event]` bilan yiqilardi,
    // ya'ni skript yuklanmagani hodisasi). Shu holatda ham nazorat ishlashi
    // SHART — modellar o'z domenimizdan berilishi kerak.
    if (process.env.E2E_ALLOW_CDN !== '1') {
      await page.route('**cdn.jsdelivr.net/**', (route) => route.abort());
      await page.route('**storage.googleapis.com/**', (route) => route.abort());
    }

    // Login → dashboard → imtihon oldi tekshiruvi (kamera shu yerda ochiladi).
    await page.goto(base);
    await page.locator('input[autocomplete="username"]').fill('demo_student');
    await page.locator('input[type="password"]').fill(DEMO_PASSWORD);
    await page.locator('form button[type="submit"]').click();

    await expect(page.getByText(examTitle)).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Imtihonni boshlash' }).first().click();

    // Kamera ochilishi + MediaPipe yuklanishi uchun vaqt.
    await expect(page.getByText('Imtihon oldidan tekshiruv')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(35_000);

    console.log('\n══════ MEDIAPIPE TARMOQ HISOBOTI ══════');
    if (seen.length === 0) {
      console.log('  ⚠ BIRORTA so\'rov bo\'lmadi — engine umuman ishga tushmagan');
    }
    for (const r of seen) console.log(`  ${r.status}  ${r.url}`);
    if (failed.length) {
      console.log('  ── yiqilgan so\'rovlar ──');
      for (const f of failed) console.log(`  ✗ ${f}`);
    }
    if (consoleErrors.length) {
      console.log('  ── brauzer konsol xatolari ──');
      for (const e of consoleErrors.slice(0, 12)) console.log(`  ! ${e}`);
    }
    console.log('═══════════════════════════════════════\n');

    const wasm = seen.find((r) => /vision_wasm.*\.wasm/i.test(r.url));
    const model = seen.find((r) => /face_landmarker\.task/i.test(r.url));

    expect(wasm, 'MediaPipe WASM umuman so\'ralmadi').toBeTruthy();
    expect(wasm!.status, `WASM status ${wasm?.status}`).toBeLessThan(400);
    expect(
      model,
      'face_landmarker.task UMUMAN so\'ralmadi — engine WASM bosqichida yiqilgan',
    ).toBeTruthy();
    expect(model!.status, `model status ${model?.status}`).toBeLessThan(400);

    await request.delete(`${base}/api/admin/exams/${examId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
  });
});
