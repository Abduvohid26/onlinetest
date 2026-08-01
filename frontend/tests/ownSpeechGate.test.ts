import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { OwnSpeechGate, MOUTH_WINDOW_SAMPLES } from '../src/lib/ownSpeechGate';

/** Ketma-ket kadrlarni beradi va oxirgi qarorni qaytaradi. */
function feed(gate: OwnSpeechGate, frames: boolean[]): boolean {
  let last = false;
  for (const f of frames) last = gate.push(f);
  return last;
}

describe('OwnSpeechGate — tashqi shovqin o‘chirilganda "o‘zi gapiryaptimi"', () => {
  test('yonidagi odam gapiryapti (og‘iz umuman qimirlamaydi) — hisoblanmaydi', () => {
    const gate = new OwnSpeechGate();
    assert.equal(feed(gate, new Array(MOUTH_WINDOW_SAMPLES).fill(false)), false);
  });

  test("talabaning o'zi gapiryapti (og'iz uzluksiz harakatda) — hisoblanadi", () => {
    const gate = new OwnSpeechGate();
    assert.equal(feed(gate, new Array(MOUTH_WINDOW_SAMPLES).fill(true)), true);
  });

  test("og'iz UZUQ-YULUQ aniqlansa ham hisoblanadi — sezgirlik pasaymaydi", () => {
    const gate = new OwnSpeechGate();
    // MediaPipe har kadrda aniqlamaydi (past yorug'lik / past FPS): 10 kadrdan 1 tasi.
    const frames = new Array(MOUTH_WINDOW_SAMPLES).fill(false);
    frames[4] = true;
    assert.equal(feed(gate, frames), true);
  });

  test('birinchi kadrdanoq javob beradi — imtihon boshida kechikish yo‘q', () => {
    const gate = new OwnSpeechGate();
    assert.equal(gate.push(true), true);
  });

  test('oyna suriladi: talaba jim bo‘lgach, yonidagi gap hisoblanmaydi', () => {
    const gate = new OwnSpeechGate();
    assert.equal(feed(gate, new Array(MOUTH_WINDOW_SAMPLES).fill(true)), true);
    // Og'iz to'xtadi, lekin mikrofonda gap davom etyapti (boshqa odam):
    // oyna to'liq almashgach signal o'chadi.
    assert.equal(feed(gate, new Array(MOUTH_WINDOW_SAMPLES).fill(false)), false);
  });

  test('oyna ichida bitta eski harakat qolsa — hali o‘z nutqi deb hisoblanadi', () => {
    const gate = new OwnSpeechGate();
    gate.push(true);
    // Oyna to'lmaguncha o'sha bitta kadr saqlanadi (gap orasidagi pauza).
    assert.equal(feed(gate, new Array(MOUTH_WINDOW_SAMPLES - 1).fill(false)), true);
    assert.equal(gate.push(false), false, 'oyna to‘lgach o‘chadi');
  });

  test('reset() oynani tozalaydi', () => {
    const gate = new OwnSpeechGate();
    feed(gate, new Array(MOUTH_WINDOW_SAMPLES).fill(true));
    gate.reset();
    assert.equal(gate.push(false), false);
  });
});
