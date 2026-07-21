import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ViolationGate } from '../src/lib/violationGate.ts';

// confirm=1500, escalate=3000, grace=700, eventHold=600 (violationGate standarti)
const CONFIRM = 1500;
const ESCALATE = 3000;

describe('ViolationGate — state-based (tab yashiringan)', () => {
  it('yashirin bo\'lmasa 0 qaytaradi', () => {
    const g = new ViolationGate(CONFIRM, ESCALATE);
    assert.equal(g.push('TAB', false, 0), 0);
    assert.equal(g.push('TAB', false, 1000), 0);
  });

  it('1.5s da kichik, 3s da rasmiy bosqichga o\'tadi', () => {
    const g = new ViolationGate(CONFIRM, ESCALATE);
    assert.equal(g.stage(g.push('TAB', true, 0)), 'none');
    assert.equal(g.stage(g.push('TAB', true, 1000)), 'none');
    assert.equal(g.stage(g.push('TAB', true, 1600)), 'small');
    assert.equal(g.stage(g.push('TAB', true, 3100)), 'official');
  });

  it('3s dan oldin qaytib kelsa rasmiy bo\'lmaydi', () => {
    const g = new ViolationGate(CONFIRM, ESCALATE);
    g.push('TAB', true, 0);
    g.push('TAB', true, 2000);
    // qaytib keldi (active=false) — grace (700ms) dan keyin resetlanadi
    assert.equal(g.push('TAB', false, 2800), 0);
    assert.equal(g.stage(g.push('TAB', false, 3500)), 'none');
  });
});

describe('ViolationGate — event-based (print-screen/clipboard/devtools)', () => {
  it('bitta hodisa rasmiy bo\'lmaydi (hold so\'ngach so\'nadi)', () => {
    const g = new ViolationGate(CONFIRM, ESCALATE);
    g.markEvent('PRINT_SCREEN', 0);
    // hold 600ms — 700ms grace ichida biroz active, lekin takrorlanmasa 1.5s ga yetmaydi
    assert.equal(g.stage(g.push('PRINT_SCREEN', false, 250)), 'none');
    assert.equal(g.stage(g.push('PRINT_SCREEN', false, 1000)), 'none');
    assert.equal(g.stage(g.push('PRINT_SCREEN', false, 2000)), 'none');
  });

  it('uzluksiz takrorlansa 3s da rasmiyga o\'tadi ("davom etsa")', () => {
    const g = new ViolationGate(CONFIRM, ESCALATE);
    let officialAt: number | null = null;
    // har 250ms da qayta bosiladi (hold 600ms — uzluksiz faol)
    for (let t = 0; t <= 3200; t += 250) {
      g.markEvent('CLIPBOARD_ATTEMPT', t);
      const ms = g.push('CLIPBOARD_ATTEMPT', false, t);
      if (g.stage(ms) === 'official' && officialAt === null) officialAt = t;
    }
    assert.ok(officialAt !== null && officialAt >= ESCALATE, `official at ${officialAt}`);
  });

  it('reset() dan keyin qayta boshdan hisoblanadi', () => {
    const g = new ViolationGate(CONFIRM, ESCALATE);
    for (let t = 0; t <= 3000; t += 250) {
      g.markEvent('DEVTOOLS_OPEN', t);
      g.push('DEVTOOLS_OPEN', false, t);
    }
    g.reset('DEVTOOLS_OPEN');
    // resetdan darhol keyin — yana marklansa ham 0 dan boshlanadi
    g.markEvent('DEVTOOLS_OPEN', 3100);
    assert.equal(g.stage(g.push('DEVTOOLS_OPEN', false, 3150)), 'none');
  });
});
