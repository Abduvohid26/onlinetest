import { test, expect, type APIRequestContext } from '@playwright/test';

const DEMO_PASSWORD = process.env.DEMO_SEED_PASSWORD || 'DemoFJSTI2026!';
// "0" bo'lsa identity-compare mock qilinmaydi — real backend + real yuz (odatda
// E2E_FAKE_VIDEO_PATH bilan birga ishlatiladi, demo_student profil rasmiga mos
// haqiqiy yuz videosi). Standart: mock qilingan (tez, kamera/AI'ga bog'liq emas).
const MOCK_IDENTITY = (process.env.E2E_MOCK_IDENTITY ?? '1') !== '0';

async function apiLogin(request: APIRequestContext, baseURL: string, id: string) {
  const res = await request.post(`${baseURL}/api/auth/login`, {
    data: { id, password: DEMO_PASSWORD },
  });
  expect(res.ok(), `login failed for ${id}: ${await res.text()}`).toBeTruthy();
  return res.json();
}

/**
 * To'liq talaba imtihon oqimi: real backend (Postgres/Redis/Celery) va real
 * frontend orqali — login -> PreExamCheck (rozilik/identity/liveness) ->
 * ExamRoom (javob berish) -> natija sahifasi.
 *
 * AI/ML chegarasi ataylab mock qilinadi (identity-compare, proctor-frame,
 * MediaPipe CDN) — bu qatlamlar allaqachon backend unit testlarida (masalan
 * test_face_embedding.py) qamrab olingan; bu yerda maqsad — ilova oqimi
 * (routing, state, backend session/exam endpointlari) haqiqatan ishlashini
 * tekshirish, real kamera/AI orqali emas.
 */
test.describe('Student exam flow (end-to-end)', () => {
  test('demo_student verifies identity, passes liveness, takes an exam, and sees a result', async ({
    page,
    request,
    baseURL,
  }) => {
    // Real identity/liveness rejimida (MOCK_IDENTITY=0) har bir bosqich haqiqiy
    // backend/AI round-trip qiladi — standart 90s global timeout yetarli emas.
    if (!MOCK_IDENTITY) test.setTimeout(180_000);
    const base = baseURL!;

    // ── 1) Setup: demo_student guruhiga tayinlangan qisqa imtihon yaratish (real API) ──
    const { token: adminToken } = await apiLogin(request, base, 'demo_admin');
    const groupsRes = await request.get(`${base}/api/admin/groups`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(groupsRes.ok()).toBeTruthy();
    const groups = await groupsRes.json();
    expect(groups.length, 'guruh topilmadi — seed_demo_users avval ishga tushishi kerak').toBeGreaterThan(0);
    const group = groups.find((g: any) => g.name === '1-guruh') ?? groups[0];

    const now = Date.now();
    const examTitle = `E2E imtihon ${now}`;
    const questions = [
      { id: 1, text: 'E2E: 2+2=?', options: ['3', '4', '5', '6'], correctAnswer: '4' },
      { id: 2, text: 'E2E: 3+1=?', options: ['2', '3', '4', '5'], correctAnswer: '4' },
    ];
    const createRes = await request.post(`${base}/api/admin/exams`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        title: examTitle,
        start_time: new Date(now - 5 * 60_000).toISOString(),
        end_time: new Date(now + 60 * 60_000).toISOString(),
        duration_minutes: 30,
        language: 'uz',
        manual_questions: JSON.stringify(questions),
        group_ids: [group.id],
      },
    });
    expect(createRes.ok(), await createRes.text()).toBeTruthy();
    const { id: examId } = await createRes.json();

    await test.step('cleanup: imtihonni oxirida o\'chirish', async () => {
      test.info().annotations.push({ type: 'exam-id', description: String(examId) });
    });

    try {
      // ── 1.5) Playwright brauzeri navigator.webdriver=true qo'yadi — ilovaning
      // VAC qatlami buni (to'g'ri) "masofaviy boshqaruv" deb belgilab, ogohlantirish
      // modalini ochib qo'yardi va bu qadam qachon sodir bo'lishi ExamRoom mount
      // tafsilotlariga bog'liq (timing-sensitive). Haqiqiy talaba brauzerida bu
      // flag yo'q — shu sabab test uchun uni standart Playwright usuli bilan spoof
      // qilamiz (ilova kodini emas, faqat test muhitini o'zgartiradi).
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      });

      // ── 2) MediaPipe CDN'ni bloklaymiz — position-gate va active yaw-challenge
      // ilovaning o'zida mavjud "model yuklanmadi" graceful-degradation yo'liga
      // o'tadi (haqiqiy, production'da ham ishlaydigan kod yo'li).
      await page.route('**cdn.jsdelivr.net/npm/@mediapipe/**', (route) => route.abort());
      await page.route('**storage.googleapis.com/mediapipe-models/**', (route) => route.abort());

      // ── 3) AI chegarasini mock qilamiz (yuz solishtirish + proctor-frame) —
      // MOCK_IDENTITY=false bo'lsa identity-compare real backend'ga boradi
      // (real yuz bilan sinash uchun, E2E_FAKE_VIDEO_PATH bilan birga).
      if (MOCK_IDENTITY) {
        await page.route('**/api/student/identity-compare', (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ match: true, skipped: false, score: 0.91, method: 'embedding' }),
          }),
        );
      }
      await page.route('**/api/student/exams/*/proctor-frame', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            violations: [],
            face_count: 1,
            forbidden_objects: [],
            looking_away: false,
          }),
        }),
      );

      // ── 4) Login (real UI) ──
      await page.goto(base);
      await page.locator('input[autocomplete="username"]').fill('demo_student');
      await page.locator('input[type="password"]').fill(DEMO_PASSWORD);
      await page.locator('form button[type="submit"]').click();

      // ── 5) Dashboard: yangi yaratilgan imtihonni boshlash ──
      await expect(page.getByText(examTitle)).toBeVisible({ timeout: 20_000 });
      await page.getByRole('button', { name: 'Imtihonni boshlash' }).click();

      // ── 6) PreExamCheck: qoidalarni oxirigacha aylantirish, rozilik ──
      await page.getByTestId('vac-rules-box').evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      await page.locator('input[type="checkbox"]').check();

      // ── 7) Identity (mock orqali darhol "match"), so'ng liveness (passiv +
      // active challenge — ikkalasi ham MediaPipe yo'qligi tufayli avtomatik o'tadi) ──
      const verifyBtn = page.getByRole('button', { name: 'Yuzni tekshirish' });
      await expect(verifyBtn).toBeEnabled({ timeout: 20_000 });
      await verifyBtn.click();
      await expect(page.getByText('Tasdiqlandi ✓')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText('Jonlilik tasdiqlandi ✓')).toBeVisible({ timeout: 15_000 });

      await page.getByRole('button', { name: 'Kirish', exact: true }).click();

      // ── 8) ExamRoom lobby: real /start chaqiruvi shu yerda sodir bo'ladi ──
      await page.getByRole('button', { name: 'Imtihonni boshlash' }).click();

      // ── 9) ExamRoom: ikkala savolga to'g'ri javob berish va topshirish ──
      // Radio input `sr-only` (vizual jihatdan yashirilgan) — label ustidan klik
      // native forward qilishi kerak, lekin ba'zi hollarda inputning o'zini
      // to'g'ridan-to'g'ri (force bilan, actionability tekshiruvini chetlab)
      // bosish ishonchliroq.
      await expect(page.getByText('E2E: 2+2=?')).toBeVisible({ timeout: 20_000 });
      await page.locator('input[name="q-1"][value="4"]').click({ force: true });
      await expect(page.locator('input[name="q-1"][value="4"]')).toBeChecked();
      await page.getByRole('button', { name: 'Keyingi →' }).click();
      await expect(page.getByText('E2E: 3+1=?')).toBeVisible();
      await page.locator('input[name="q-2"][value="4"]').click({ force: true });
      await expect(page.locator('input[name="q-2"][value="4"]')).toBeChecked();
      await page.getByRole('button', { name: 'Yakunlash' }).click();

      // ── 10) Natija sahifasi — 2/2 to'g'ri javob ──
      await expect(page.getByText('Test natijasi')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText('100%')).toBeVisible();
      await expect(page.getByText("O'tish mezoni: kamida 50% to'g'ri javob")).toBeVisible();
    } finally {
      // Demo ma'lumotlar bazasi toza qolishi uchun test imtihonini o'chiramiz.
      await request.delete(`${base}/api/admin/exams/${examId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
    }
  });
});
