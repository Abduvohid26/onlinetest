/**
 * GazeBurstTracker — qisqa yon qarashlar yig'indisi.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GazeBurstTracker,
  GAZE_BURST_COUNT,
  GAZE_BURST_MIN_MS,
} from '../src/lib/gazeBurstTracker.ts';

describe('GazeBurstTracker', () => {
  it('bitta qisqa qarash formal bermaydi', () => {
    const t = new GazeBurstTracker();
    let now = 1000;
    assert.equal(t.push(true, 'left', now), false);
    now += GAZE_BURST_MIN_MS + 50;
    assert.equal(t.push(false, null, now), false);
  });

  it(`${GAZE_BURST_COUNT} ta yetarli burst → formal`, () => {
    const t = new GazeBurstTracker();
    let now = 1000;
    for (let i = 0; i < GAZE_BURST_COUNT; i++) {
      assert.equal(t.push(true, 'right', now), false);
      now += GAZE_BURST_MIN_MS + 80;
      const fired = t.push(false, null, now);
      if (i < GAZE_BURST_COUNT - 1) {
        assert.equal(fired, false, `burst ${i + 1} hali limit emas`);
      } else {
        assert.equal(fired, true, 'oxirgi burst formal bersin');
        assert.equal(t.lastDirection, 'right');
      }
      now += 500;
    }
  });

  it('juda qisqa miltillash burst hisoblanmaydi', () => {
    const t = new GazeBurstTracker();
    let now = 1000;
    for (let i = 0; i < 5; i++) {
      t.push(true, 'left', now);
      now += 100; // < GAZE_BURST_MIN_MS
      assert.equal(t.push(false, null, now), false);
      now += 200;
    }
  });
});
