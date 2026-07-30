import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BRIGHTNESS_MAX,
  BRIGHTNESS_MIN,
  EYE_OPEN_RATIO_MIN,
  NET_JITTER_MAX_MS,
  NET_LATENCY_MAX_MS,
  classifyEyeReadability,
  classifyImageQuality,
  classifyNetwork,
  computeImageStats,
} from '../src/lib/mediaQualityCheck.ts';

// --- Sintetik tasvirlar ---------------------------------------------------

/** Bir xil kulrang (tekis) — kontrast va tiniqlik nol. */
function flat(value: number, w = 32, h = 32): Uint8Array {
  return new Uint8Array(w * h).fill(value);
}

/** Shaxmat naqsh — o'tkir chegaralar, yuqori tiniqlik. */
function checker(w = 32, h = 32, size = 4): Uint8Array {
  const g = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const on = (Math.floor(x / size) + Math.floor(y / size)) % 2 === 0;
      g[y * w + x] = on ? 210 : 40;
    }
  }
  return g;
}

/** Yumshoq gradient — kontrast bor, lekin o'tkir chegara yo'q (xira). */
function gradient(w = 32, h = 32): Uint8Array {
  const g = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) g[y * w + x] = 40 + Math.round((x / (w - 1)) * 170);
  }
  return g;
}

test('tekis tasvir — kontrast va tiniqlik nol', () => {
  const s = computeImageStats(flat(120), 32, 32);
  assert.equal(Math.round(s.brightness), 120);
  assert.ok(s.contrast < 1, `kontrast ~0 bo'lsin, oldik ${s.contrast}`);
  assert.ok(s.sharpness < 1, `tiniqlik ~0 bo'lsin, oldik ${s.sharpness}`);
  assert.equal(classifyImageQuality(s), 'LOW_CONTRAST');
});

test('shaxmat naqsh — tiniq deb topiladi', () => {
  const s = computeImageStats(checker(), 32, 32);
  assert.ok(s.sharpness > 1000, `o'tkir chegaralar yuqori tiniqlik bersin: ${s.sharpness}`);
  assert.equal(classifyImageQuality(s), 'OK');
});

test('yumshoq gradient — xira deb topiladi', () => {
  const s = computeImageStats(gradient(), 32, 32);
  assert.ok(s.contrast > 18, 'kontrast yetarli');
  assert.equal(classifyImageQuality(s), 'BLURRY');
});

test('qorong\'i va haddan yorqin xona aniqlanadi', () => {
  const dark = computeImageStats(checker().map((v) => Math.round(v * 0.15)) as unknown as Uint8Array, 32, 32);
  assert.ok(dark.brightness < BRIGHTNESS_MIN);
  assert.equal(classifyImageQuality(dark), 'TOO_DARK');

  const bright = computeImageStats(flat(240), 32, 32);
  assert.ok(bright.brightness > BRIGHTNESS_MAX);
  assert.equal(classifyImageQuality(bright), 'TOO_BRIGHT');
});

test('yorug\'lik muammosi xiralikdan USTUN (sabab aniqroq)', () => {
  // Qorong'i VA xira — talabaga "xona qorong'i" deyish foydali.
  const s = { sharpness: 0, brightness: 10, contrast: 5 };
  assert.equal(classifyImageQuality(s), 'TOO_DARK');
});

test('buzuq kirishda yiqilmaydi', () => {
  assert.deepEqual(computeImageStats(new Uint8Array(0), 0, 0), {
    sharpness: 0,
    brightness: 0,
    contrast: 0,
  });
  assert.deepEqual(computeImageStats(flat(100, 2, 2), 2, 2), {
    sharpness: 0,
    brightness: 0,
    contrast: 0,
  });
});

// --- Ko'z o'qilishi -------------------------------------------------------

test('ochiq ko\'z — nigoh nazorati ishlaydi', () => {
  assert.equal(classifyEyeReadability([0.32, 0.30]), 'OK');
  assert.equal(classifyEyeReadability([EYE_OPEN_RATIO_MIN]), 'OK');
});

test('torgan ko\'z — nigoh nazorati ishonchsiz', () => {
  assert.equal(classifyEyeReadability([0.10, 0.11]), 'EYES_NARROW');
});

test('landmark yo\'q — alohida holat (kamera burchagi yaroqsiz)', () => {
  assert.equal(classifyEyeReadability([]), 'NO_LANDMARKS');
  assert.equal(classifyEyeReadability([null, null]), 'NO_LANDMARKS');
});

test('bitta ko\'z o\'qilsa ham yetadi (yon yorug\'lik)', () => {
  assert.equal(classifyEyeReadability([null, 0.30]), 'OK');
});

// --- Tarmoq ---------------------------------------------------------------

const ms = (...v: (number | null)[]) => v.map((x) => ({ ms: x }));

test('tez va barqaror tarmoq — OK', () => {
  const r = classifyNetwork(ms(80, 95, 88, 91, 85));
  assert.equal(r.status, 'OK');
  assert.equal(r.failures, 0);
  assert.ok(r.jitterMs < 50);
});

test('sekin lekin barqaror — SLOW', () => {
  const r = classifyNetwork(ms(1200, 1210, 1205, 1195));
  assert.equal(r.status, 'SLOW');
  assert.ok(r.medianMs > NET_LATENCY_MAX_MS);
});

test('tebranish katta — UNSTABLE', () => {
  const r = classifyNetwork(ms(50, 900, 60, 1100, 70));
  assert.equal(r.status, 'UNSTABLE');
  assert.ok(r.jitterMs > NET_JITTER_MAX_MS);
});

test('bir nechta so\'rov yiqilsa — UNSTABLE', () => {
  const r = classifyNetwork(ms(90, null, 95, null, 88));
  assert.equal(r.status, 'UNSTABLE');
  assert.equal(r.failures, 2);
});

test('bitta yiqilish toqat qilinadi', () => {
  const r = classifyNetwork(ms(90, null, 95, 92, 88));
  assert.equal(r.status, 'OK');
  assert.equal(r.failures, 1);
});

test('hammasi yiqilsa — OFFLINE', () => {
  const r = classifyNetwork(ms(null, null, null));
  assert.equal(r.status, 'OFFLINE');
});

test('bo\'sh o\'lchov — OFFLINE (jim o\'tkazmaydi)', () => {
  assert.equal(classifyNetwork([]).status, 'OFFLINE');
});

test('median bitta chetlanishdan buzilmaydi', () => {
  const r = classifyNetwork(ms(90, 92, 5000, 95, 91));
  assert.ok(r.medianMs < 200, `median barqaror bo'lsin: ${r.medianMs}`);
});
