import { defineConfig, devices } from '@playwright/test';

/**
 * Docker'da `e2e` xizmati `app`ning tarmoq nazratini bo'lishadi
 * (`network_mode: service:app`) — shuning uchun BASE_URL doim 127.0.0.1.
 * MUHIM: getUserMedia faqat "xavfsiz kontekst"da ishlaydi (HTTPS yoki
 * localhost/127.0.0.1) — boshqa hostname (masalan docker-compose servis nomi
 * "app") ishlatilsa, brauzer navigator.mediaDevices'ni butunlay yashiradi.
 */
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8080';

// Ixtiyoriy: real yuzli fake-camera video (.y4m/.mjpeg) — E2E_FAKE_VIDEO_PATH
// orqali beriladi (masalan mahalliy e2e/fixtures/fake_camera.y4m, HECH QACHON
// git'ga commit qilinmaydi — shaxsiy foto). Berilmasa, Chromium'ning standart
// sintetik (animatsion, yuzsiz) fake device'i ishlatiladi — identity-compare
// shu holatda test spec'ida mock qilinishi kerak (haqiqiy yuz yo'q).
const FAKE_VIDEO_PATH = process.env.E2E_FAKE_VIDEO_PATH || '';

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Real kamera/mikrofon shart emas: Chromium sintetik (animatsion) fake device
    // beradi — getUserMedia muvaffaqiyatli bo'ladi va freym-oralig'ida haqiqiy
    // piksel o'zgarishi bo'ladi (passiv liveness tekshiruvi uchun yetarli).
    launchOptions: {
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        ...(FAKE_VIDEO_PATH ? [`--use-file-for-fake-video-capture=${FAKE_VIDEO_PATH}`] : []),
      ],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['camera', 'microphone'],
      },
    },
  ],
});
