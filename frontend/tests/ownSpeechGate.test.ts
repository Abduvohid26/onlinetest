import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  OwnSpeechGate,
  MOUTH_WINDOW_SAMPLES,
  MOUTH_WINDOW_MIN_SAMPLES,
} from '../src/lib/ownSpeechGate';

/** Ketma-ket `n` ta kadrni beradi va oxirgi qarorni qaytaradi. */
function feed(gate: OwnSpeechGate, frames: boolean[]): boolean {
  let last = false;
  for (const f of frames) last = gate.push(f);
  return last;
}

describe('OwnSpeechGate — tashqi shovqin o‘chirilganda "o‘zi gapiryaptimi"', () => {
  test('yonidagi odam gapiryapti (og‘iz qimirlamaydi) — hisoblanmaydi', () => {
    const gate = new OwnSpeechGate();
    assert.equal(feed(gate, new Array(MOUTH_WINDOW_SAMPLES).fill(false)), false);
  });

  test("talabaning o'zi gapiryapti (og'iz uzluksiz harakatda) — hisoblanadi", () => {
    const gate = new OwnSpeechGate();
    assert.equal(feed(gate, new Array(MOUTH_WINDOW_SAMPLES).fill(true)), true);
  });

  test("qisqa noto'g'ri ijobiy (yutinish/kulish) — hisoblanmaydi", () => {
    const gate = new OwnSpeechGate();
    // 10 kadrdan faqat 2 tasida og'iz harakati (20% < 60%).
    const frames = new Array(MOUTH_WINDOW_SAMPLES).fill(false);
    frames[3] = true;
    frames[4] = true;
    assert.equal(feed(gate, frames), false);
  });

  test('nutq orasidagi tabiiy pauzalar qarorni buzmaydi (70% harakat)', () => {
    const gate = new OwnSpeechGate();
    const frames = new Array(MOUTH_WINDOW_SAMPLES).fill(true);
    frames[2] = false;
    frames[6] = false;
    frames[9] = false;
    // 7/10 = 70% ≥ 60% — o'zi gapiryapti deb hisoblanadi.
    assert.equal(feed(gate, frames), true);
  });

  test('yarmidan kami (50%) — chegaradan past, hisoblanmaydi', () => {
    const gate = new OwnSpeechGate();
    const frames = new Array(MOUTH_WINDOW_SAMPLES).fill(false);
    for (let i = 0; i < 5; i++) frames[i] = true;
    assert.equal(feed(gate, frames), false);
  });

  test("yetarli kadr yig'ilmaguncha qaror berilmaydi", () => {
    const gate = new OwnSpeechGate();
    for (let i = 0; i < MOUTH_WINDOW_MIN_SAMPLES - 1; i++) {
      assert.equal(gate.push(true), false, `${i + 1}-kadr hali yetarli emas`);
    }
    assert.equal(gate.push(true), true);
  });

  test('oyna suriladi: eski gapirish yangi jimlikni yopib qololmaydi', () => {
    const gate = new OwnSpeechGate();
    assert.equal(feed(gate, new Array(MOUTH_WINDOW_SAMPLES).fill(true)), true);
    // Talaba jim bo'ldi, lekin yonida gap davom etyapti — oyna to'lgach o'chadi.
    assert.equal(feed(gate, new Array(MOUTH_WINDOW_SAMPLES).fill(false)), false);
  });

  test('reset() oynani tozalaydi', () => {
    const gate = new OwnSpeechGate();
    feed(gate, new Array(MOUTH_WINDOW_SAMPLES).fill(true));
    gate.reset();
    assert.equal(gate.push(true), false, 'resetdan keyin yangi oyna yig‘iladi');
  });
});
