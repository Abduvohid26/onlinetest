/**
 * O'rganiladigan nigoh xaritasi testlari.
 *
 * Asosiy maqsad — bitta aniq holatni qo'riqlash: talaba noutbuk TEPASIGA,
 * ekrandan tashqariga qaraganda model buni ushlashi kerak. Eski qattiq
 * chegaralarda aynan shu holat aniqlanmasdi.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  GazeSampleBuffer,
  classifyGaze,
  fitGazeModel,
  gazeMargins,
  predictGaze,
  type GazeFeature,
  type GazeSample,
} from '../src/lib/gazeMapping';

/**
 * Sun'iy "qurilma": ekran nuqtasidan nigoh belgilarini hosil qiladi.
 * Haqiqiy geometriyani taqlid qiladi — qorachiq siljishi ekran bo'ylab
 * chiziqli o'zgaradi, bosh esa deyarli qimirlamaydi.
 */
function featureFor(sx: number, sy: number, noise = 0, seed = 1): GazeFeature {
  // Takrorlanadigan "shovqin" (Math.random ishlatmaymiz — test barqaror bo'lsin).
  const n = (k: number) => (noise === 0 ? 0 : ((Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453) % 1) * noise);
  return {
    dx: (sx - 0.5) * 0.5 + n(1),
    dy: (sy - 0.5) * 0.4 + n(2),
    yaw: 0.01 + n(3),
    pitch: 0.5 + n(4),
  };
}

function gridSamples(noise = 0): GazeSample[] {
  const pts = [
    [0.1, 0.1], [0.5, 0.1], [0.9, 0.1],
    [0.1, 0.5], [0.5, 0.5], [0.9, 0.5],
    [0.1, 0.9], [0.5, 0.9], [0.9, 0.9],
    [0.3, 0.7], [0.7, 0.3], [0.2, 0.4],
  ];
  return pts.map(([sx, sy], i) => ({ f: featureFor(sx, sy, noise, i + 1), sx, sy }));
}

test('toza namunalardan model quriladi va aniq bashorat qiladi', () => {
  const res = fitGazeModel(gridSamples());
  assert.equal(res.ok, true);
  if (!res.ok) return;

  const p = predictGaze(res.model, featureFor(0.5, 0.5));
  assert.ok(Math.abs(p.sx - 0.5) < 0.02, `sx=${p.sx}`);
  assert.ok(Math.abs(p.sy - 0.5) < 0.02, `sy=${p.sy}`);
});

test('ekran ichidagi nigoh — ogohlantirish yo\'q', () => {
  const res = fitGazeModel(gridSamples());
  assert.equal(res.ok, true);
  if (!res.ok) return;

  for (const [sx, sy] of [[0.5, 0.5], [0.1, 0.1], [0.9, 0.9], [0.5, 0.02]]) {
    const v = classifyGaze(res.model, featureFor(sx, sy));
    assert.equal(v.side, null, `ekran ichi (${sx},${sy}) signal bermasligi kerak`);
  }
});

test('NOUTBUK TEPASIGA qarash aniqlanadi (asosiy teshik)', () => {
  const res = fitGazeModel(gridSamples());
  assert.equal(res.ok, true);
  if (!res.ok) return;

  // Ekran tepasidan ancha yuqoriga — shpargalka/ikkinchi monitor.
  const v = classifyGaze(res.model, featureFor(0.5, -0.6));
  assert.equal(v.side, 'ABOVE');
  assert.ok(v.sy < 0, `bashorat ekran tepasidan yuqori bo'lishi kerak: ${v.sy}`);
});

test('pastga (tizzadagi telefon) va yon tomonlar ham aniqlanadi', () => {
  const res = fitGazeModel(gridSamples());
  assert.equal(res.ok, true);
  if (!res.ok) return;

  assert.equal(classifyGaze(res.model, featureFor(0.5, 1.7)).side, 'BELOW');
  assert.equal(classifyGaze(res.model, featureFor(-0.7, 0.5)).side, 'LEFT_OF');
  assert.equal(classifyGaze(res.model, featureFor(1.7, 0.5)).side, 'RIGHT_OF');
});

test('namuna yetarli emas — model qurilmaydi (eski chegaralar ishlaydi)', () => {
  const few = gridSamples().slice(0, 4);
  const res = fitGazeModel(few);
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.reason, 'NOT_ENOUGH_SAMPLES');
});

test("bosishlar bitta joyda to'plangan — model qurilmaydi", () => {
  const clustered: GazeSample[] = Array.from({ length: 12 }, (_, i) => {
    const sx = 0.5 + i * 0.001;
    const sy = 0.5 + i * 0.001;
    return { f: featureFor(sx, sy), sx, sy };
  });
  const res = fitGazeModel(clustered);
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.reason, 'NO_SPREAD');
});

test('shovqinli model kengroq xavfsizlik oralig\'i beradi', () => {
  const clean = fitGazeModel(gridSamples(0));
  const noisy = fitGazeModel(gridSamples(0.25));
  assert.equal(clean.ok, true);
  assert.equal(noisy.ok, true);
  if (!clean.ok || !noisy.ok) return;

  const mc = gazeMargins(clean.model);
  const mn = gazeMargins(noisy.model);
  assert.ok(mn.y >= mc.y, `shovqinli oraliq kengroq bo'lishi kerak: ${mn.y} vs ${mc.y}`);
});

test('bitta "qaramasdan bosish" modelni buzmaydi', () => {
  const samples = gridSamples();
  // Talaba ekranning pastiga qaragan, lekin tepadagi variantni bosgan.
  samples.push({ f: featureFor(0.5, 0.95), sx: 0.5, sy: 0.05 });

  const res = fitGazeModel(samples);
  assert.equal(res.ok, true);
  if (!res.ok) return;

  const p = predictGaze(res.model, featureFor(0.5, 0.5));
  assert.ok(Math.abs(p.sy - 0.5) < 0.08, `chetlatishdan keyin markaz aniq qolishi kerak: ${p.sy}`);
});

test('tasodifiy (bog\'liqsiz) namunalar — model rad etiladi', () => {
  const samples: GazeSample[] = Array.from({ length: 16 }, (_, i) => ({
    f: { dx: ((i * 37) % 10) / 10 - 0.5, dy: ((i * 53) % 10) / 10 - 0.5, yaw: 0, pitch: 0.5 },
    sx: ((i * 71) % 10) / 10,
    sy: ((i * 29) % 10) / 10,
  }));
  const res = fitGazeModel(samples);
  // DIQQAT: `res.ok === false` ataylab — bu loyihada `strict` o'chiq va
  // `!res.ok` / `else` bilan union toraymaydi.
  if (res.ok === false) {
    assert.equal(res.reason, 'POOR_FIT');
    return;
  }
  // Mos kelsa ham qoldiq katta bo'lgani uchun oraliq juda keng bo'lishi kerak —
  // ya'ni model chegarani o'zi yumshatadi va soxta ogohlantirish bermaydi.
  assert.ok(gazeMargins(res.model).y > 0.25);
});

test('bufer faqat oxirgi namunalarni saqlaydi', () => {
  const buf = new GazeSampleBuffer(3);
  for (let i = 0; i < 5; i++) {
    buf.push({ f: featureFor(0.5, 0.5), sx: i / 10, sy: 0.5 });
  }
  assert.equal(buf.size, 3);
  assert.deepEqual(buf.all().map((s) => s.sx), [0.2, 0.3, 0.4]);
  buf.clear();
  assert.equal(buf.size, 0);
});
