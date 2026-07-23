import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeYaw,
  challengeYawCentered,
  challengeYawMatches,
  computeSmileRatio,
  isSmiling,
  SMILE_RATIO_MIN,
} from '../src/lib/facePositionCheck.ts';

function landmarks(noseX: number, leftX = 0.3, rightX = 0.7): any[] {
  const lm: any[] = [];
  lm[1] = { x: noseX, y: 0.5 };
  lm[234] = { x: leftX, y: 0.5 };
  lm[454] = { x: rightX, y: 0.5 };
  return lm;
}

function smileLandmarks(opts: {
  mouthSpan?: number;
  cornerLift?: number;
  leftX?: number;
  rightX?: number;
}): any[] {
  const leftX = opts.leftX ?? 0.3;
  const rightX = opts.rightX ?? 0.7;
  const faceW = rightX - leftX;
  const mouthSpan = opts.mouthSpan ?? 0.38;
  const cornerLift = opts.cornerLift ?? 0;
  const lm: any[] = [];
  lm[234] = { x: leftX, y: 0.5 };
  lm[454] = { x: rightX, y: 0.5 };
  const mouthW = faceW * mouthSpan;
  const centerX = (leftX + rightX) / 2;
  lm[61] = { x: centerX - mouthW / 2, y: 0.58 - cornerLift };
  lm[291] = { x: centerX + mouthW / 2, y: 0.58 - cornerLift };
  lm[13] = { x: centerX, y: 0.55 };
  return lm;
}

describe('computeYaw', () => {
  it('returns ~0 when nose is centered between left/right landmarks', () => {
    const yaw = computeYaw(landmarks(0.5));
    assert.ok(yaw !== null);
    assert.ok(Math.abs(yaw as number) < 1e-9);
  });

  it('returns a positive value when nose shifts toward the right landmark', () => {
    const yaw = computeYaw(landmarks(0.65));
    assert.ok(yaw !== null);
    assert.ok((yaw as number) > 0.2);
  });

  it('returns a negative value when nose shifts toward the left landmark', () => {
    const yaw = computeYaw(landmarks(0.35));
    assert.ok(yaw !== null);
    assert.ok((yaw as number) < -0.2);
  });

  it('returns null when required landmarks are missing', () => {
    const lm: any[] = [];
    lm[1] = { x: 0.5, y: 0.5 };
    // 234/454 missing
    assert.equal(computeYaw(lm), null);
  });
});

describe('challengeYawMatches', () => {
  it('accepts positive yaw for left turn (mirror preview)', () => {
    assert.equal(challengeYawMatches('left', 0.25), true);
    assert.equal(challengeYawMatches('left', 0.1), false);
  });

  it('accepts negative yaw for right turn (mirror preview)', () => {
    assert.equal(challengeYawMatches('right', -0.25), true);
    assert.equal(challengeYawMatches('right', -0.1), false);
  });
});

describe('challengeYawCentered', () => {
  it('accepts near-zero yaw', () => {
    assert.equal(challengeYawCentered(0.05), true);
    assert.equal(challengeYawCentered(0.2), false);
  });
});

describe('computeSmileRatio / isSmiling', () => {
  it('neutral mouth scores below smile threshold', () => {
    const ratio = computeSmileRatio(smileLandmarks({ mouthSpan: 0.36, cornerLift: 0 }));
    assert.ok(ratio !== null);
    assert.ok(ratio! < SMILE_RATIO_MIN);
    assert.equal(isSmiling(smileLandmarks({ mouthSpan: 0.36, cornerLift: 0 })), false);
  });

  it('wide mouth + lifted corners counts as smile', () => {
    const lm = smileLandmarks({ mouthSpan: 0.5, cornerLift: 0.04 });
    const ratio = computeSmileRatio(lm);
    assert.ok(ratio !== null);
    assert.ok(ratio! >= SMILE_RATIO_MIN);
    assert.equal(isSmiling(lm), true);
  });
});
