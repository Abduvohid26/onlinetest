import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeYaw } from '../src/lib/facePositionCheck.ts';

function landmarks(noseX: number, leftX = 0.3, rightX = 0.7): any[] {
  const lm: any[] = [];
  lm[1] = { x: noseX, y: 0.5 };
  lm[234] = { x: leftX, y: 0.5 };
  lm[454] = { x: rightX, y: 0.5 };
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
