import { test, expect, type APIRequestContext } from '@playwright/test';

const DEMO_PASSWORD = process.env.DEMO_SEED_PASSWORD || 'DemoFJSTI2026!';

async function apiLogin(request: APIRequestContext, baseURL: string, id: string) {
  const res = await request.post(`${baseURL}/api/auth/login`, {
    data: { id, password: DEMO_PASSWORD },
  });
  expect(res.ok(), `login failed for ${id}: ${await res.text()}`).toBeTruthy();
  return res.json();
}

/**
 * Texnik qayta urinish oqimi — real backend (Postgres) orqali:
 * imtihon yaratish (technical_retakes_allowed) → start → texnik violationlar →
 * technicalRetake (ban emas) → qayta start → grant +3 → fail.
 */
test.describe('Technical retake flow (API E2E)', () => {
  test('PROCTOR_FEED_LOST triggers retake; grant and fail endpoints work', async ({
    request,
    baseURL,
  }) => {
    const base = baseURL!;
    const { token: adminToken } = await apiLogin(request, base, 'demo_admin');
    const { token: studentToken, user: studentUser } = await apiLogin(request, base, 'demo_student');

    const groupsRes = await request.get(`${base}/api/admin/groups`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(groupsRes.ok()).toBeTruthy();
    const groups = await groupsRes.json();
    const group = groups.find((g: { name: string }) => g.name === '1-guruh') ?? groups[0];

    const now = Date.now();
    const examTitle = `E2E texnik retake ${now}`;
    const questions = [{ id: 1, text: '1+1=?', options: ['1', '2', '3', '4'], correctAnswer: '2' }];

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
        technical_retakes_allowed: 5,
      },
    });
    expect(createRes.ok(), await createRes.text()).toBeTruthy();
    const { id: examId } = await createRes.json();

    const deviceFp = 'e2e-playwright-device-fp';
    const authHeaders = {
      Authorization: `Bearer ${studentToken}`,
      'X-Device-Fingerprint': deviceFp,
    };

    try {
      const startRes = await request.post(`${base}/api/student/exams/${examId}/start`, {
        headers: authHeaders,
        data: { pin: '' },
      });
      expect(startRes.ok(), await startRes.text()).toBeTruthy();
      const startBody = await startRes.json();
      const deviceToken = startBody.deviceToken as string;
      expect(deviceToken).toBeTruthy();

      const violHeaders = {
        ...authHeaders,
        'X-Device-Session-Token': deviceToken,
      };

      const postViolation = async (vtype: string) => {
        const res = await request.post(`${base}/api/student/violations`, {
          headers: violHeaders,
          data: { exam_id: examId, violation_type: vtype, screenshot_url: '' },
        });
        expect(res.ok(), await res.text()).toBeTruthy();
        return res.json();
      };

      // 3 ta ogohlantirish (turli texnik turlar — dedupe muammosiz), 4-chisida retake
      const warnTypes = ['PROCTOR_FEED_LOST', 'CAMERA_MIC_ACCESS_FAILED', 'VIRTUAL_WEBCAM_SUSPECTED'];
      for (let i = 0; i < 3; i++) {
        const body = await postViolation(warnTypes[i]);
        expect(body.banned, `step ${i + 1} should not ban yet`).toBeFalsy();
        expect(body.technicalRetake).toBeFalsy();
        // Prod merge oynasi (10s) — ogohlantirishlar alohida hisoblansin
        await new Promise((r) => setTimeout(r, 11_000));
      }

      const retakeBody = await postViolation('PROCTOR_FEED_LOST');
      expect(retakeBody.banned, JSON.stringify(retakeBody)).toBeFalsy();
      expect(retakeBody.technicalRetake, JSON.stringify(retakeBody)).toBeTruthy();
      expect(retakeBody.technicalRetakesRemaining).toBe(4);

      // Qayta start — Pending holatdan
      const restartRes = await request.post(`${base}/api/student/exams/${examId}/start`, {
        headers: authHeaders,
        data: { pin: '' },
      });
      expect(restartRes.ok(), await restartRes.text()).toBeTruthy();

      // Natijalar ro'yxatida technical retake statistikasi
      const resultsRes = await request.get(`${base}/api/admin/exams/${examId}/results`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(resultsRes.ok()).toBeTruthy();
      const resultsBody = await resultsRes.json();
      const row = (resultsBody.results as Array<Record<string, unknown>>).find(
        (r) => r.student_id === studentUser.id,
      );
      expect(row).toBeTruthy();
      expect(row!.technical_retakes_used).toBe(1);
      expect(row!.technical_retakes_remaining).toBe(4);

      const studentExamId = row!.id as number;

      // Staff grant +3 (demo_staff mavjud bo'lsa)
      const staffLogin = await request.post(`${base}/api/auth/login`, {
        data: { id: 'demo_staff', password: DEMO_PASSWORD },
      });
      if (staffLogin.ok()) {
        const { token: staffToken } = await staffLogin.json();
        // Imtihonni staff'ga biriktirish
        await request.patch(`${base}/api/admin/exams/${examId}`, {
          headers: { Authorization: `Bearer ${adminToken}` },
          data: { teacher_id: 'demo_staff' },
        });

        const grantRes = await request.post(
          `${base}/api/admin/student_exams/${studentExamId}/grant-technical-retakes`,
          { headers: { Authorization: `Bearer ${staffToken}` }, data: {} },
        );
        expect(grantRes.ok(), await grantRes.text()).toBeTruthy();
        const grantBody = await grantRes.json();
        expect(grantBody.success).toBeTruthy();
        expect(grantBody.technical_retakes_remaining).toBeGreaterThanOrEqual(7);
      }

      const failRes = await request.post(`${base}/api/admin/student_exams/${studentExamId}/fail`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: {},
      });
      expect(failRes.ok(), await failRes.text()).toBeTruthy();
      expect((await failRes.json()).status).toBe('Failed');

      const blockedStart = await request.post(`${base}/api/student/exams/${examId}/start`, {
        headers: authHeaders,
        data: { pin: '' },
      });
      expect(blockedStart.status()).toBe(403);
    } finally {
      await request.delete(`${base}/api/admin/exams/${examId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
    }
  });
});
