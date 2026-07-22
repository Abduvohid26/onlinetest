/**
 * "3 kichik ogohlantirish → 4-martasi rasmiy" qonuni (README.md).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SmallWarningLedger, SMALL_WARNINGS_BEFORE_FORMAL } from '../src/lib/smallWarningLedger.ts';

/** Bitta to'liq epizod: signal boshlandi → tugadi. */
function episode(l: SmallWarningLedger, key: string): boolean {
  const escalate = l.noteActive(key);
  l.noteCleared(key);
  return escalate;
}

describe('SmallWarningLedger', () => {
  it('3 tagacha kichik, 4-epizodda rasmiy', () => {
    const l = new SmallWarningLedger();
    assert.equal(episode(l, 'TALK'), false, '1-marta kichik');
    assert.equal(episode(l, 'TALK'), false, '2-marta kichik');
    assert.equal(episode(l, 'TALK'), false, '3-marta kichik');
    assert.equal(episode(l, 'TALK'), true, '4-marta RASMIY');
  });

  it('uzluksiz signal bitta epizod — takroran sanalmaydi', () => {
    const l = new SmallWarningLedger();
    // Signal davom etyapti: har kadrda noteActive chaqiriladi, lekin hisob 1 da qoladi.
    for (let i = 0; i < 50; i++) assert.equal(l.noteActive('TALK'), false);
    assert.equal(l.count('TALK'), 1, 'uzluksiz signal = 1 ta kichik ogohlantirish');
  });

  it('turlar bir-biriga qo\'shilmaydi', () => {
    const l = new SmallWarningLedger();
    for (let i = 0; i < 3; i++) episode(l, 'TALK');
    // Boshqa turdagi birinchi epizod hali kichik bo'lishi kerak.
    assert.equal(episode(l, 'HAND'), false);
    assert.equal(episode(l, 'TALK'), true, 'gapirish limiti to\'lgan');
  });

  it('rasmiy berilgach hisob nolga qaytadi', () => {
    const l = new SmallWarningLedger();
    for (let i = 0; i < 3; i++) episode(l, 'TALK');
    assert.equal(l.count('TALK'), 3);
    l.formalIssued('TALK');
    assert.equal(l.count('TALK'), 0);
    assert.equal(episode(l, 'TALK'), false, 'rasmiydan keyin yana 3 ta kichik beriladi');
  });

  it('remaining() qolgan kichik ogohlantirishlar sonini beradi', () => {
    const l = new SmallWarningLedger();
    assert.equal(l.remaining('TALK'), SMALL_WARNINGS_BEFORE_FORMAL);
    episode(l, 'TALK');
    assert.equal(l.remaining('TALK'), SMALL_WARNINGS_BEFORE_FORMAL - 1);
  });

  it('reset() hammasini tozalaydi', () => {
    const l = new SmallWarningLedger();
    for (let i = 0; i < 3; i++) episode(l, 'TALK');
    l.reset();
    assert.equal(l.count('TALK'), 0);
  });
});
