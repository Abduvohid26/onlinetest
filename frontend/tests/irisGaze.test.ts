/**
 * Ko'z yo'nalishi — iris + blendshape fusion testlari.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeIrisGaze,
  isIrisGazeAway,
  computeBlendshapeGaze,
  fuseGaze,
  IRIS_GAZE_X,
  IRIS_GAZE_DOWN,
} from '../src/lib/eyeGaze.ts';

const IRIS_L = 468;
const IRIS_R = 473;
const EYE_L = { out: 33, in: 133, top: 159, bot: 145 };
const EYE_R = { out: 263, in: 362, top: 386, bot: 374 };

const W = 0.06;
const H = 0.022;

/**
 * @param dxFrac qorachiq gorizontal siljishi (ko'z kengligi ulushi)
 * @param dyFrac vertikal siljish (ham kenglik ulushi — yangi normalize)
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
    // Iris ring nuqtalari ham to'ldiriladi (avgPoint uchun).
    for (let k = 0; k < 5; k++) {
      lm[irisIdx + k] = {
        x: cxCenter + dxFrac * W,
        y: 0.42 + dyFrac * W,
        z: 0,
      };
    }
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

  it('peripheral (ko\'z qirida) siljish ham aniqlanadi', () => {
    assert.ok(IRIS_GAZE_X <= 0.09, 'ostona sezgir bo\'lsin');
    const g = computeIrisGaze(makeLandmarks(0.10, 0));
    assert.equal(isIrisGazeAway(g), true);
  });

  it('juda kichik siljish (tabiiy) chetga qarash hisoblanmaydi', () => {
    const g = computeIrisGaze(makeLandmarks(0.04, 0));
    assert.equal(isIrisGazeAway(g), false, 'kichik tabiiy siljish jazolanmasin');
  });

  it('pastga qarash (qog\'oz/telefon) — ANIQLAYDI', () => {
    const g = computeIrisGaze(makeLandmarks(0, Math.max(IRIS_GAZE_DOWN + 0.02, 0.14)));
    assert.equal(isIrisGazeAway(g), true);
  });

  it('ko\'z yumuq bo\'lsa — ishonchsiz, null qaytaradi (soxta signal bermaydi)', () => {
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

describe('fuseGaze — iris + blendshape', () => {
  it('iris yo\'q bo\'lsa ham blendshape ushlaydi', () => {
    const blend = computeBlendshapeGaze([
      { categoryName: 'eyeLookOutLeft', score: 0.55 },
      { categoryName: 'eyeLookInRight', score: 0.50 },
      { categoryName: 'eyeLookInLeft', score: 0.05 },
      { categoryName: 'eyeLookOutRight', score: 0.05 },
      { categoryName: 'eyeLookDownLeft', score: 0.05 },
      { categoryName: 'eyeLookDownRight', score: 0.05 },
      { categoryName: 'eyeLookUpLeft', score: 0.02 },
      { categoryName: 'eyeLookUpRight', score: 0.02 },
    ]);
    const fused = fuseGaze(null, blend);
    assert.equal(fused.away, true);
    assert.equal(fused.left, true);
    assert.equal(fused.direction, 'left');
  });

  it('iris va blend OR — biri yetadi', () => {
    const iris = computeIrisGaze(makeLandmarks(0.20, 0));
    const weakBlend = computeBlendshapeGaze([
      { categoryName: 'eyeLookOutLeft', score: 0.1 },
      { categoryName: 'eyeLookInRight', score: 0.1 },
      { categoryName: 'eyeLookInLeft', score: 0.1 },
      { categoryName: 'eyeLookOutRight', score: 0.1 },
      { categoryName: 'eyeLookDownLeft', score: 0.05 },
      { categoryName: 'eyeLookDownRight', score: 0.05 },
      { categoryName: 'eyeLookUpLeft', score: 0.02 },
      { categoryName: 'eyeLookUpRight', score: 0.02 },
    ]);
    const fused = fuseGaze(iris, weakBlend);
    assert.equal(fused.away, true);
    assert.ok(fused.sample?.sources.includes('iris'));
  });

  it('ikkala manba markazda — away emas', () => {
    const iris = computeIrisGaze(makeLandmarks(0, 0));
    const blend = computeBlendshapeGaze([
      { categoryName: 'eyeLookOutLeft', score: 0.05 },
      { categoryName: 'eyeLookInRight', score: 0.05 },
      { categoryName: 'eyeLookInLeft', score: 0.05 },
      { categoryName: 'eyeLookOutRight', score: 0.05 },
      { categoryName: 'eyeLookDownLeft', score: 0.05 },
      { categoryName: 'eyeLookDownRight', score: 0.05 },
      { categoryName: 'eyeLookUpLeft', score: 0.02 },
      { categoryName: 'eyeLookUpRight', score: 0.02 },
    ]);
    const fused = fuseGaze(iris, blend);
    assert.equal(fused.away, false);
  });
});
