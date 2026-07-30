import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTION_SPECS,
  LivenessSequence,
  LivenessStep,
  averageEar,
  eyesClosed,
  eyesOpen,
  isMouthOpen,
  mouthOpenRatio,
  pickLivenessActions,
  type LivenessAction,
} from '../src/lib/livenessChallenge.ts';

// --- Landmark yasovchi yordamchilar ---------------------------------------

/** Ko'z ochiqligi berilgan nisbatga teng bo'ladigan landmark to'plami. */
function faceLandmarks(opts: { ear?: number; mouthGap?: number } = {}) {
  const ear = opts.ear ?? 0.3;
  const mouthGap = opts.mouthGap ?? 0.02;
  const lm: { x: number; y: number }[] = [];
  const put = (i: number, x: number, y: number) => {
    while (lm.length <= i) lm.push({ x: 0, y: 0 });
    lm[i] = { x, y };
  };
  // Chap ko'z: kenglik 0.1, balandlik = 0.1 * ear
  put(33, 0.30, 0.40);
  put(133, 0.40, 0.40);
  put(159, 0.35, 0.40 - (0.1 * ear) / 2);
  put(145, 0.35, 0.40 + (0.1 * ear) / 2);
  // O'ng ko'z
  put(263, 0.70, 0.40);
  put(362, 0.60, 0.40);
  put(386, 0.65, 0.40 - (0.1 * ear) / 2);
  put(374, 0.65, 0.40 + (0.1 * ear) / 2);
  // Og'iz: kenglik 0.1
  put(61, 0.45, 0.70);
  put(291, 0.55, 0.70);
  put(13, 0.50, 0.70 - mouthGap / 2);
  put(14, 0.50, 0.70 + mouthGap / 2);
  return lm;
}

test('ko\'z ochiqligi (EAR) to\'g\'ri hisoblanadi', () => {
  assert.ok(Math.abs((averageEar(faceLandmarks({ ear: 0.30 })) as number) - 0.30) < 1e-6);
  assert.equal(eyesOpen(faceLandmarks({ ear: 0.30 })), true);
  assert.equal(eyesClosed(faceLandmarks({ ear: 0.30 })), false);
  assert.equal(eyesClosed(faceLandmarks({ ear: 0.08 })), true);
  assert.equal(eyesOpen(faceLandmarks({ ear: 0.08 })), false);
});

test('landmark yetishmasa null qaytadi (soxta "bajarildi" bo\'lmasin)', () => {
  assert.equal(averageEar([]), null);
  assert.equal(mouthOpenRatio([]), null);
  assert.equal(isMouthOpen([]), false);
});

test('og\'iz ochilishi aniqlanadi', () => {
  assert.equal(isMouthOpen(faceLandmarks({ mouthGap: 0.01 })), false);
  assert.equal(isMouthOpen(faceLandmarks({ mouthGap: 0.05 })), true);
});

// --- Bosqich holat mashinasi ----------------------------------------------

/** Bosqichni kadrlar oqimi bilan "o'ynatadi". */
function play(
  step: LivenessStep,
  frames: { active: boolean; ms: number; faceOk?: boolean }[],
  startAt = 0,
): number {
  let t = startAt;
  for (const f of frames) {
    const end = t + f.ms;
    while (t < end) {
      step.push(f.active, t, f.faceOk ?? true);
      t += 50;
    }
  }
  return t;
}

test('SMILE: baseline kuzatilgach, ushlab turilsa bajariladi', () => {
  const step = new LivenessStep('SMILE');
  play(step, [
    { active: false, ms: 400 }, // baseline
    { active: true, ms: 600 }, // hold
  ]);
  assert.equal(step.done, true);
});

test('ALLAQACHON harakatni ko\'rsatib turgan yozuv o\'ta olmaydi', () => {
  // Oldindan yozilgan "doim tabassumli" video: baseline hech qachon yopilmaydi.
  const step = new LivenessStep('SMILE');
  play(step, [{ active: true, ms: ACTION_SPECS.SMILE.timeoutMs + 500 }]);
  assert.equal(step.done, false);
  assert.equal(step.failed, true, 'vaqt tugashi bilan muvaffaqiyatsiz bo\'lsin');
});

test('BLINK: yumilish YETARLI EMAS — qayta ochilishi ham shart', () => {
  const closedOnly = new LivenessStep('BLINK');
  play(closedOnly, [
    { active: false, ms: 300 }, // ko'z ochiq (baseline)
    { active: true, ms: 3000 }, // ko'zni yumib turdi va ochmadi
  ]);
  assert.equal(closedOnly.done, false, 'ko\'zni yumib turish o\'tmasin');
  assert.equal(closedOnly.currentPhase, 'releasing');

  const realBlink = new LivenessStep('BLINK');
  play(realBlink, [
    { active: false, ms: 300 },
    { active: true, ms: 150 }, // yumdi
    { active: false, ms: 150 }, // qayta ochdi
  ]);
  assert.equal(realBlink.done, true);
});

test('harakat yetarlicha ushlanmasa bajarilmaydi, lekin qayta urinish mumkin', () => {
  const step = new LivenessStep('MOUTH_OPEN');
  const t = play(step, [
    { active: false, ms: 350 },
    { active: true, ms: 150 }, // juda qisqa (holdMs=400)
    { active: false, ms: 200 },
  ]);
  assert.equal(step.done, false);
  // Ikkinchi urinish — endi yetarlicha ushlab turadi.
  play(step, [{ active: true, ms: 600 }], t);
  assert.equal(step.done, true);
});

test('yuz kadrdan yo\'qolsa hisob to\'xtaydi (soxta bajarilish bo\'lmasin)', () => {
  const step = new LivenessStep('SMILE');
  play(step, [
    { active: false, ms: 350 },
    { active: true, ms: 300, faceOk: false }, // yuz ko'rinmaydi — sanalmasin
  ]);
  assert.equal(step.done, false);
});

test('vaqt tugasa bosqich muvaffaqiyatsiz', () => {
  const step = new LivenessStep('SMILE');
  play(step, [{ active: false, ms: ACTION_SPECS.SMILE.timeoutMs + 500 }]);
  assert.equal(step.failed, true);
});

// --- Ketma-ketlik ----------------------------------------------------------

test('ikkala bosqich bajarilgandagina o\'tadi', () => {
  const seq = new LivenessSequence(['BLINK', 'SMILE']);
  assert.equal(seq.currentAction, 'BLINK');
  assert.deepEqual(seq.progress, { step: 1, total: 2 });

  let t = 0;
  const feed = (active: boolean, ms: number) => {
    const end = t + ms;
    let status: string = 'running';
    while (t < end) {
      status = seq.push(active, t);
      t += 50;
    }
    return status;
  };

  feed(false, 300);
  feed(true, 150); // ko'z yumdi
  feed(false, 100); // ochdi → BLINK bajarildi
  assert.equal(seq.currentAction, 'SMILE', 'keyingi harakatga o\'tsin');

  feed(false, 350); // SMILE baseline
  const status = feed(true, 600);
  assert.equal(status, 'passed');
});

test('bitta bosqich vaqtida bajarilmasa butun chaqiriq yiqiladi', () => {
  const seq = new LivenessSequence(['SMILE', 'BLINK']);
  let t = 0;
  let status: string = 'running';
  while (t < ACTION_SPECS.SMILE.timeoutMs + 500) {
    status = seq.push(false, t);
    t += 50;
  }
  assert.equal(status, 'failed');
});

// --- Tasodifiylik ----------------------------------------------------------

test('har chaqiriqda tasodifiy harakatlar tanlanadi', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i += 1) seen.add(pickLivenessActions(2).join(','));
  assert.ok(seen.size > 1, 'ketma-ketlik o\'zgarib turishi kerak (yozuvga qarshi)');
});

test('tanlangan harakatlar takrorlanmaydi va ikkita burilish birga tushmaydi', () => {
  for (let i = 0; i < 200; i += 1) {
    const picked = pickLivenessActions(2);
    assert.equal(picked.length, 2);
    assert.equal(new Set(picked).size, 2, 'takrorlanmasin');
    const turns = picked.filter((a: LivenessAction) => a.startsWith('TURN_')).length;
    assert.ok(turns <= 1, 'ikkita burilish birga so\'ralmasin');
  }
});

test('pickLivenessActions berilgan random bilan aniq natija beradi', () => {
  const seqRandom = [0, 0, 0, 0].values();
  const picked = pickLivenessActions(2, () => seqRandom.next().value ?? 0);
  assert.equal(picked.length, 2);
  assert.equal(new Set(picked).size, 2);
});
