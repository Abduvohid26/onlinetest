/**
 * Qorachiq (iris) asosidagi ko'z yo'nalishi — sintetik landmark'lar bilan tekshiruv.
 *
 * Maqsad: bosh to'g'ri turgan holda ham ko'z chetga/pastga qaraganini aniqlash
 * mantig'ini jonli kamerasiz sinash. MediaPipe 478 nuqta beradi; biz faqat
 * kerakli indekslarni (iris markazlari + ko'z burchak/qovoqlari) to'ldiramiz.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeIrisGaze, isIrisGazeAway } from '../src/lib/realtimeProctor.ts';

const IRIS_L = 468;
const IRIS_R = 473;
const EYE_L = { out: 33, in: 133, top: 159, bot: 145 };
const EYE_R = { out: 263, in: 362, top: 386, bot: 374 };

/** Ko'z kengligi/balandligi (normalized koordinatalarda taxminiy real qiymatlar). */
const W = 0.06; // ko'z kengligi
const H = 0.022; // ko'z balandligi (ochiq ko'z: h/w ≈ 0.37)

/**
 * 478 nuqtali landmark massivi yasaydi.
 * @param dxFrac qorachiqning ko'z markazidan gorizontal siljishi (kenglik ulushi)
 * @param dyFrac vertikal siljish (balandlik ulushi)
 * @param eyeH   ko'z balandligi (yumuq ko'zni sinash uchun kichraytiriladi)
 */
function makeLandmarks(dxFrac: number, dyFrac: number, eyeH = H) {
  const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const setEye = (
    eye: { out: number; in: number; top: number; bot: number },
    irisIdx: number,
    cxCenter: number,
  ) => {
    lm[eye.out] = { x: cxCenter - W / 2, y: 0.42, z: 0 };
    lm[eye.in] = { x: cxCenter + W / 2, y: 0.42, z: 0 };
    lm[eye.top] = { x: cxCenter, y: 0.42 - eyeH / 2, z: 0 };
    lm[eye.bot] = { x: cxCenter, y: 0.42 + eyeH / 2, z: 0 };
    lm[irisIdx] = { x: cxCenter + dxFrac * W, y: 0.42 + dyFrac * eyeH, z: 0 };
  };
  setEye(EYE_L, IRIS_L, 0.42);
  setEye(EYE_R, IRIS_R, 0.58);
  return lm;
}

describe('computeIrisGaze — qorachiq yo\'nalishi', () => {
  it('ko\'z markazda bo\'lsa — chetga qaramagan', () => {
    const g = computeIrisGaze(makeLandmarks(0, 0));
    assert.ok(g, 'gaze hisoblanishi kerak');
    assert.ok(Math.abs(g!.dx) < 0.02, `dx markazga yaqin bo'lsin, oldik: ${g!.dx}`);
    assert.equal(isIrisGazeAway(g), false);
  });

  it('ko\'z yon tomonga qarasa — ANIQLAYDI (bosh qimirlamasa ham)', () => {
    const right = computeIrisGaze(makeLandmarks(0.25, 0));
    const left = computeIrisGaze(makeLandmarks(-0.25, 0));
    assert.equal(isIrisGazeAway(right), true, 'o\'ngga qarash aniqlanishi kerak');
    assert.equal(isIrisGazeAway(left), true, 'chapga qarash aniqlanishi kerak');
  });

  it('juda kichik siljish (tabiiy) chetga qarash hisoblanmaydi', () => {
    const g = computeIrisGaze(makeLandmarks(0.08, 0));
    assert.equal(isIrisGazeAway(g), false, 'kichik tabiiy siljish jazolanmasin');
  });

  it('pastga qarash (qog\'oz/telefon) — ANIQLAYDI', () => {
    const g = computeIrisGaze(makeLandmarks(0, 0.45));
    assert.equal(isIrisGazeAway(g), true);
  });

  it('ko\'z yumuq bo\'lsa — ishonchsiz, null qaytaradi (soxta signal bermaydi)', () => {
    // Ko'z balandligi juda kichik → h/w < EYE_OPEN_MIN_RATIO
    const g = computeIrisGaze(makeLandmarks(0.3, 0, 0.004));
    assert.equal(g, null, 'yumuq ko\'zda gaze hisoblanmasligi kerak');
    assert.equal(isIrisGazeAway(g), false);
  });

  it('iris nuqtalari yo\'q (eski model) — null, jim degradatsiya', () => {
    const short = Array.from({ length: 468 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    assert.equal(computeIrisGaze(short), null);
    assert.equal(isIrisGazeAway(null), false);
  });
});
