/**
 * Worker zaxira qarori — nazorat hech qachon worker sababli o'chmasligi kerak.
 *
 * DEFAULT O'CHIQ: worker real tizimda hali sinalmagan. Bir marta lokal
 * MediaPipe manbasi + worker birga yoqilganda ishlab turgan imtihon
 * platformasida butun real-time nazorat o'chib qolgan edi — shundan keyin
 * isbotlanmagan yo'l default bo'lmasligi qoidasi kiritildi.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';

import { canUseProctorWorker } from '../src/lib/proctorWorkerClient';

const FULL = {
  hasWorker: true,
  hasCreateImageBitmap: true,
  hasOffscreenCanvas: true,
};

test("bayroqsiz — worker ISHLATILMAYDI (default o'chiq)", () => {
  assert.equal(canUseProctorWorker({ ...FULL }), false);
  assert.equal(canUseProctorWorker({ ...FULL, enabledFlag: '' }), false);
  assert.equal(canUseProctorWorker({ ...FULL, enabledFlag: undefined }), false);
});

test('VITE_PROCTOR_WORKER=1 — worker yoqiladi', () => {
  assert.equal(canUseProctorWorker({ ...FULL, enabledFlag: '1' }), true);
});

test("boshqa qiymatlar worker'ni yoqmaydi (faqat aniq \"1\")", () => {
  for (const v of ['0', 'true', 'yes', 'on', '2']) {
    assert.equal(canUseProctorWorker({ ...FULL, enabledFlag: v }), false, `flag=${v}`);
  }
});

test("Worker yo'q — yoqilgan bo'lsa ham zaxira yo'liga tushadi", () => {
  assert.equal(canUseProctorWorker({ ...FULL, enabledFlag: '1', hasWorker: false }), false);
});

test("createImageBitmap yo'q — kadr uzatib bo'lmaydi, zaxira", () => {
  assert.equal(
    canUseProctorWorker({ ...FULL, enabledFlag: '1', hasCreateImageBitmap: false }),
    false,
  );
});

test("OffscreenCanvas yo'q — worker ichida GPU ishlamaydi, zaxira", () => {
  assert.equal(
    canUseProctorWorker({ ...FULL, enabledFlag: '1', hasOffscreenCanvas: false }),
    false,
  );
});

test('bitta imkoniyat yetishmasa ham false (hammasi shart)', () => {
  assert.equal(
    canUseProctorWorker({
      enabledFlag: '1',
      hasWorker: false,
      hasCreateImageBitmap: false,
      hasOffscreenCanvas: false,
    }),
    false,
  );
});
