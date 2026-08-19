/**
 * Worker zaxira qarori — nazorat hech qachon worker sababli o'chmasligi kerak.
 *
 * Bu testlar aynan shuni qo'riqlaydi: brauzer imkoniyatlaridan biri yetishmasa
 * yoki bayroq bilan o'chirilsa, `canUseProctorWorker` `false` qaytishi va
 * chaqiruvchi eski (asosiy oqim) yo'liga tushishi shart.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';

import { canUseProctorWorker } from '../src/lib/proctorWorkerClient';

const FULL = {
  hasWorker: true,
  hasCreateImageBitmap: true,
  hasOffscreenCanvas: true,
};

test('barcha imkoniyatlar bor — worker ishlatiladi', () => {
  assert.equal(canUseProctorWorker({ ...FULL }), true);
});

test('VITE_PROCTOR_WORKER=0 — worker o\'chiriladi (qayta build\'siz qaytish yo\'li)', () => {
  assert.equal(canUseProctorWorker({ ...FULL, disabledFlag: '0' }), false);
});

test("boshqa bayroq qiymatlari worker'ni o'chirmaydi", () => {
  assert.equal(canUseProctorWorker({ ...FULL, disabledFlag: '1' }), true);
  assert.equal(canUseProctorWorker({ ...FULL, disabledFlag: '' }), true);
  assert.equal(canUseProctorWorker({ ...FULL, disabledFlag: undefined }), true);
});

test("Worker yo'q — zaxira yo'liga tushadi", () => {
  assert.equal(canUseProctorWorker({ ...FULL, hasWorker: false }), false);
});

test("createImageBitmap yo'q — kadr uzatib bo'lmaydi, zaxira", () => {
  assert.equal(canUseProctorWorker({ ...FULL, hasCreateImageBitmap: false }), false);
});

test("OffscreenCanvas yo'q — worker ichida GPU ishlamaydi, zaxira", () => {
  assert.equal(canUseProctorWorker({ ...FULL, hasOffscreenCanvas: false }), false);
});

test('bitta imkoniyat yetishmasa ham false (hammasi shart)', () => {
  assert.equal(
    canUseProctorWorker({ hasWorker: false, hasCreateImageBitmap: false, hasOffscreenCanvas: false }),
    false,
  );
});
