import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanQuestionPrompt, normalizeQuestionOptions } from '../src/lib/examQuestionUtils.ts';

describe('examQuestionUtils', () => {
  it('normalizeQuestionOptions filters empty strings', () => {
    const opts = normalizeQuestionOptions(['A javob', '', '  ', 'B javob', '']);
    assert.equal(opts.length, 2);
    assert.equal(opts[0], 'A javob');
  });

  it('normalizeQuestionOptions generates fallback labels', () => {
    const opts = normalizeQuestionOptions(['', '', '']);
    assert.ok(opts.length >= 2);
    assert.match(opts[0], /^A\)/);
  });

  it('cleanQuestionPrompt strips import suffix', () => {
    const text = 'Savol matni?\nВыберите один из 5 вариантов ответа:';
    assert.equal(cleanQuestionPrompt(text), 'Savol matni?');
  });
});
