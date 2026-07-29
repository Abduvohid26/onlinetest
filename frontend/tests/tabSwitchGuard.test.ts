import test from 'node:test';
import assert from 'node:assert/strict';

import { TabSwitchGuard, tabGuardBlocked, type TabGuardState } from '../src/lib/tabSwitchGuard.ts';

const ARM_MS = 3000;
const AWAY_MS = 1200;

/** Imtihon normal ketayotgan barqaror holat. */
function stable(over: Partial<TabGuardState> = {}): TabGuardState {
  return {
    sessionStarted: true,
    banned: false,
    fullscreenRequired: false,
    fullscreenSuppressed: false,
    fullscreenRequestInFlight: false,
    warningModalOpen: false,
    smallWarnOpen: false,
    inFullscreen: true,
    present: true,
    ...over,
  };
}

/** Nazoratni qurollangan holatga keltiradi va joriy vaqtni qaytaradi. */
function armed(g: TabSwitchGuard, t0 = 1_000): number {
  g.evaluate(stable(), t0);
  g.evaluate(stable(), t0 + ARM_MS);
  assert.equal(g.armed, true, 'barqaror holatdan keyin qurollanishi kerak');
  return t0 + ARM_MS;
}

test('barqarorlik oynasi tugamaguncha qurollanmaydi', () => {
  const g = new TabSwitchGuard(ARM_MS);
  assert.equal(g.evaluate(stable(), 1_000), false);
  assert.equal(g.evaluate(stable(), 1_000 + ARM_MS - 1), false);
  assert.equal(g.evaluate(stable(), 1_000 + ARM_MS), true);
});

test('fullscreen gate ochiq — hech qachon qurollanmaydi', () => {
  const g = new TabSwitchGuard(ARM_MS);
  g.evaluate(stable({ fullscreenRequired: true }), 1_000);
  g.evaluate(stable({ fullscreenRequired: true }), 10_000);
  assert.equal(g.armed, false);
});

test('fullscreen yo\'qolishi bilan darhol o\'chadi', () => {
  const g = new TabSwitchGuard(ARM_MS);
  const t = armed(g);
  g.evaluate(stable({ inFullscreen: false }), t + 10);
  assert.equal(g.armed, false);
});

test('imtihon boshida fullscreen o\'tish to\'lqini qoidabuzarlik bermaydi', () => {
  // Aynan foydalanuvchi ko'rgan holat: gate modali chiqishi bilan
  // "boshqa oynaga o'tildi" ogohlantirishi ham chiqardi.
  const g = new TabSwitchGuard(ARM_MS);
  let t = 1_000;

  // Sessiya boshlandi, fullscreen hali yo'q → gate ochiq.
  g.evaluate(stable({ inFullscreen: false, fullscreenRequired: true }), t);
  // Brauzer o'tish paytida blur/visibility to'lqini beradi.
  g.markAway(t + 50);
  assert.equal(g.endAway(t + 900, AWAY_MS), false, 'gate ochiq — yozilmasin');

  // Fullscreen so'rovi yuborildi (javob kutilmoqda).
  g.evaluate(stable({ fullscreenRequestInFlight: true }), t + 1_000);
  g.markAway(t + 1_050);
  assert.equal(g.endAway(t + 3_000, AWAY_MS), false, 'so\'rov paytida — yozilmasin');

  // Fullscreen'ga kirdik, lekin brauzer hali blur/focus yuborib turibdi.
  t += 2_000;
  g.evaluate(stable(), t);
  g.markAway(t + 100);
  assert.equal(g.endAway(t + 2_000, AWAY_MS), false, 'barqarorlik oynasida — yozilmasin');
  assert.equal(g.armed, false);
});

test('barqarorlashgach haqiqiy tab almashtirish aniqlanadi', () => {
  const g = new TabSwitchGuard(ARM_MS);
  const t = armed(g);
  g.markAway(t + 100);
  assert.equal(g.endAway(t + 100 + AWAY_MS, AWAY_MS), true);
});

test('qisqa fokus yo\'qolishi (OS bildirishnomasi) yozilmaydi', () => {
  const g = new TabSwitchGuard(ARM_MS);
  const t = armed(g);
  g.markAway(t + 100);
  assert.equal(g.endAway(t + 100 + AWAY_MS - 1, AWAY_MS), false);
});

test('ketganda ko\'rinmaslik qurolni o\'chirmaydi (signalning o\'zi)', () => {
  const g = new TabSwitchGuard(ARM_MS);
  const t = armed(g);
  g.markAway(t + 10);
  // Talaba boshqa oynada — evaluate ishlashda davom etadi.
  assert.equal(g.evaluate(stable({ present: false }), t + 500), true);
  assert.equal(g.endAway(t + 3_000, AWAY_MS), true);
});

test('rasmiy ogohlantirish modali ochiq — o\'chadi va qayta qurollanadi', () => {
  const g = new TabSwitchGuard(ARM_MS);
  const t = armed(g);
  g.evaluate(stable({ warningModalOpen: true }), t + 10);
  assert.equal(g.armed, false);
  g.markAway(t + 20);
  assert.equal(g.endAway(t + 5_000, AWAY_MS), false);

  // Modal yopildi — hisoblagich noldan.
  g.evaluate(stable(), t + 6_000);
  assert.equal(g.armed, false);
  g.evaluate(stable(), t + 6_000 + ARM_MS);
  assert.equal(g.armed, true);
});

test('ban yoki sessiya yopilishi bloklaydi', () => {
  assert.equal(tabGuardBlocked(stable({ banned: true })), true);
  assert.equal(tabGuardBlocked(stable({ sessionStarted: false })), true);
  assert.equal(tabGuardBlocked(stable({ smallWarnOpen: true })), true);
  assert.equal(tabGuardBlocked(stable({ fullscreenSuppressed: true })), true);
  assert.equal(tabGuardBlocked(stable()), false);
});

test('disarm ketgan vaqt hisobini ham tozalaydi', () => {
  const g = new TabSwitchGuard(ARM_MS);
  const t = armed(g);
  g.markAway(t + 10);
  g.disarm();
  assert.equal(g.endAway(t + 10_000, AWAY_MS), false);
});
