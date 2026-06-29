/**
 * VAC request guard unit testlari.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { syncVacFromResponse } from '../src/lib/examRequestGuard.ts';

describe('syncVacFromResponse', () => {
  it('server seq va challenge ni yangilaydi', () => {
    const state = { seq: 1, challengeSeed: 'abc' };
    const headers = new Headers({
      'X-Exam-Seq-Next': '2',
      'X-Exam-Challenge-Next': 'def456',
    });
    syncVacFromResponse(headers, state);
    assert.equal(state.seq, 2);
    assert.equal(state.challengeSeed, 'def456');
  });

  it('noto‘g‘ri seq header e’tiborsiz qoldiriladi', () => {
    const state = { seq: 5, challengeSeed: 'x' };
    syncVacFromResponse(new Headers({ 'X-Exam-Seq-Next': '0' }), state);
    assert.equal(state.seq, 5);
  });
});
