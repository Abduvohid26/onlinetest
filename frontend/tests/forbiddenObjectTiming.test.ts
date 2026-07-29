import test from 'node:test';
import assert from 'node:assert/strict';

import { ContinuousSignalTracker } from '../src/lib/continuousSignal.ts';
import {
  DETECT_INTERVAL_MS,
  OBJECT_CONFIRM_MS,
  OBJECT_ESCALATE_MS,
  OBJECT_GRACE_MS,
} from '../src/lib/forbiddenObjectProctor.ts';

/**
 * Detektor har `DETECT_INTERVAL_MS` da bir marta ishlaydi va telefon kabi
 * kichik ob'ektni ba'zi freymlarda topa olmaydi ("miltillash"). Shu sababli
 * toqat oynasi (grace) tekshiruv oralig'idan KATTA bo'lishi shart — aks holda
 * bitta o'tkazib yuborilgan freym to'plangan vaqtni nolga tushiradi.
 */
test('grace oynasi tekshiruv oralig\'idan katta (regressiya himoyasi)', () => {
  assert.ok(
    OBJECT_GRACE_MS > DETECT_INTERVAL_MS,
    `grace (${OBJECT_GRACE_MS}ms) interval (${DETECT_INTERVAL_MS}ms) dan katta bo'lishi kerak`,
  );
});

interface DetectorConfig {
  intervalMs: number;
  graceMs: number;
  escalateMs: number;
}

const OLD_CONFIG: DetectorConfig = { intervalMs: 700, graceMs: 500, escalateMs: 2800 };
const NEW_CONFIG: DetectorConfig = {
  intervalMs: DETECT_INTERVAL_MS,
  graceMs: OBJECT_GRACE_MS,
  escalateMs: OBJECT_ESCALATE_MS,
};

/**
 * Detektor natijalarini simulyatsiya qiladi va eskalatsiyagacha o'tgan
 * REAL vaqtni (ms) qaytaradi. Yetib bormasa `null`.
 */
function msUntilEscalate(
  hits: (tick: number) => boolean,
  cfg: DetectorConfig,
  durationMs = 30_000,
): number | null {
  const tracker = new ContinuousSignalTracker(cfg.graceMs);
  const ticks = Math.floor(durationMs / cfg.intervalMs);
  for (let i = 0; i < ticks; i += 1) {
    const t = i * cfg.intervalMs;
    if (tracker.push(hits(i), t) >= cfg.escalateMs) return t;
  }
  return null;
}

/** Har 3-tekshiruvdan biri telefonni topmaydi — real "miltillash" namunasi. */
const flickering = (tick: number) => tick % 3 !== 2;
const always = () => true;

test('miltillovchi aniqlash ESKI sozlamada eskalatsiyaga umuman yetmasdi', () => {
  // grace (500ms) < interval (700ms) → bitta o'tkazib yuborilgan tekshiruv
  // to'plangan vaqtni nolga tushirardi va hisob hech qachon o'smasdi.
  assert.ok(OLD_CONFIG.graceMs < OLD_CONFIG.intervalMs, 'eski xato shartini tasdiqlash');
  assert.equal(msUntilEscalate(flickering, OLD_CONFIG), null);
});

test('miltillovchi aniqlash YANGI sozlamada tez eskalatsiya qiladi', () => {
  const at = msUntilEscalate(flickering, NEW_CONFIG);
  assert.notEqual(at, null, 'eskalatsiya bo\'lishi kerak');
  assert.ok(
    (at as number) <= OBJECT_ESCALATE_MS + DETECT_INTERVAL_MS,
    `~${OBJECT_ESCALATE_MS}ms kutilgandi, bo'ldi: ${at}ms`,
  );
});

test('yangi sozlama eski sozlamaga qaraganda sezilarli tez', () => {
  const oldAt = msUntilEscalate(always, OLD_CONFIG);
  const newAt = msUntilEscalate(always, NEW_CONFIG);
  assert.ok(oldAt != null && newAt != null);
  assert.ok(newAt < oldAt, `yangi (${newAt}ms) eskidan (${oldAt}ms) tez bo'lishi kerak`);
});

test('uzluksiz ko\'rinadigan telefon belgilangan vaqtda rasmiy bo\'ladi', () => {
  const at = msUntilEscalate(always, NEW_CONFIG);
  assert.notEqual(at, null);
  // Poll intervaliga bog'liq: birinchi tick escalateMs dan keyin yoki +1 interval.
  assert.ok(
    (at as number) >= OBJECT_ESCALATE_MS &&
      (at as number) <= OBJECT_ESCALATE_MS + DETECT_INTERVAL_MS,
    `kutilgan ~${OBJECT_ESCALATE_MS}..+${DETECT_INTERVAL_MS}, oldik: ${at}`,
  );
});

test('telefon kadrdan olib qo\'yilsa hisob tozalanadi', () => {
  const tracker = new ContinuousSignalTracker(OBJECT_GRACE_MS);
  let t = 0;
  for (let i = 0; i < 4; i += 1) {
    tracker.push(true, t);
    t += DETECT_INTERVAL_MS;
  }
  // Grace oynasidan uzoq vaqt yo'q — nolga tushsin.
  t += OBJECT_GRACE_MS + DETECT_INTERVAL_MS;
  assert.equal(tracker.push(false, t), 0);
});

test('kichik ogohlantirish rasmiydan oldin keladi', () => {
  assert.ok(OBJECT_CONFIRM_MS < OBJECT_ESCALATE_MS);
  assert.ok(OBJECT_CONFIRM_MS >= DETECT_INTERVAL_MS, 'kamida bitta tekshiruv sig\'sin');
});
