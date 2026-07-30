import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ConsoleProbeDevtoolsDetector,
  WindowSizeDevtoolsHeuristic,
} from '../src/lib/devtoolsDetect.ts';

test('birinchi o\'lchov baza sifatida olinadi — darhol signal bermaydi', () => {
  const h = new WindowSizeDevtoolsHeuristic();
  // OS masshtablash tufayli farq katta bo'lsa ham, bu NORMAL holat.
  assert.equal(h.push(400, 250), false);
  assert.equal(h.push(400, 250), false, 'o\'zgarmasa signal bo\'lmasin');
});

test('doimiy katta farq (OS masshtablash) soxta signal bermaydi', () => {
  const h = new WindowSizeDevtoolsHeuristic();
  for (let i = 0; i < 50; i += 1) {
    assert.equal(h.push(500, 300), false);
  }
});

test('panel ochilishi (bazadan keskin o\'sish) aniqlanadi', () => {
  const h = new WindowSizeDevtoolsHeuristic();
  h.push(20, 80); // baza
  assert.equal(h.push(20, 80), false);
  assert.equal(h.push(420, 80), true, 'kenglik bo\'yicha panel');

  const h2 = new WindowSizeDevtoolsHeuristic();
  h2.push(20, 80);
  assert.equal(h2.push(20, 300), true, 'balandlik bo\'yicha panel');
});

test('panel yopilgach baza pasayadi — keyingi ochilish ham aniqlanadi', () => {
  const h = new WindowSizeDevtoolsHeuristic();
  h.push(20, 80);
  assert.equal(h.push(420, 80), true, '1-ochilish');
  assert.equal(h.push(20, 80), false, 'yopildi');
  assert.equal(h.push(420, 80), true, '2-ochilish ham aniqlansin');
});

test('reset bazani unutadi (fullscreen\'dan chiqildi)', () => {
  const h = new WindowSizeDevtoolsHeuristic();
  h.push(20, 80);
  assert.equal(h.push(420, 80), true);
  h.reset();
  assert.equal(h.push(420, 80), false, 'yangi baza — signal yo\'q');
});

test('chegaradan kichik o\'sish signal bermaydi', () => {
  const h = new WindowSizeDevtoolsHeuristic(320, 180);
  h.push(0, 0);
  assert.equal(h.push(320, 180), false, 'aynan chegara — hali emas');
  assert.equal(h.push(321, 0), true);
});

test('konsol zondi: getter o\'qilmasa DevTools yopiq deb hisoblanadi', () => {
  const orig = console.log;
  const origClear = console.clear;
  console.log = () => {}; // DevTools yopiq: hech kim obyektni o'qimaydi
  console.clear = () => {};
  try {
    const d = new ConsoleProbeDevtoolsDetector();
    assert.equal(d.check(), false);
  } finally {
    console.log = orig;
    console.clear = origClear;
  }
});

test('konsol zondi: getter o\'qilsa DevTools ochiq deb hisoblanadi', () => {
  const orig = console.log;
  const origClear = console.clear;
  // DevTools obyektni ko'rsatish uchun xossalarini o'qiydi — shuni taqlid qilamiz.
  console.log = (..._args: unknown[]) => {
    for (const a of _args) {
      if (a && typeof a === 'object') void (a as Record<string, unknown>).id;
    }
  };
  console.clear = () => {};
  try {
    const d = new ConsoleProbeDevtoolsDetector();
    assert.equal(d.check(), true);
  } finally {
    console.log = orig;
    console.clear = origClear;
  }
});

test('konsol zondi: har tekshiruvda holat qaytadan hisoblanadi', () => {
  const orig = console.log;
  const origClear = console.clear;
  let reading = true;
  console.log = (..._args: unknown[]) => {
    if (!reading) return;
    for (const a of _args) {
      if (a && typeof a === 'object') void (a as Record<string, unknown>).id;
    }
  };
  console.clear = () => {};
  try {
    const d = new ConsoleProbeDevtoolsDetector();
    assert.equal(d.check(), true, 'ochiq');
    reading = false;
    assert.equal(d.check(), false, 'yopilgach false qaytsin (yopishib qolmasin)');
  } finally {
    console.log = orig;
    console.clear = origClear;
  }
});
