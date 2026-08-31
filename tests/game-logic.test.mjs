import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BATTLE_ANIMALS,
  WELCOME_PHRASES,
  toSubscript,
  formatTerm,
  pickWelcomeContent,
  generateNthTermQuestion,
  generateDifferenceQuestion,
  generateMissingTermQuestion,
  generateArithmeticMeanQuestion,
  generateQuestion,
  generateChoices,
} from '../game-logic.js';

test('toSubscript converts multi-digit indexes', () => {
  assert.equal(toSubscript(0), '₀');
  assert.equal(toSubscript(2), '₂');
  assert.equal(toSubscript(10), '₁₀');
  assert.equal(toSubscript(18), '₁₈');
});

test('formatTerm produces a with Unicode subscript', () => {
  assert.equal(formatTerm(2), 'a₂');
  assert.equal(formatTerm(10), 'a₁₀');
});

test('generated prompts never use ASCII a followed by a digit', () => {
  const generators = [generateNthTermQuestion, generateDifferenceQuestion, generateMissingTermQuestion];
  for (const generate of generators) {
    for (let i = 0; i < 100; i += 1) assert.doesNotMatch(generate().prompt, /a\d/);
  }
});

test('pickWelcomeContent returns a known deterministic animal and phrase', () => {
  const result = pickWelcomeContent(() => 0);
  assert.deepEqual(result.animal, BATTLE_ANIMALS[0]);
  assert.equal(result.phrase, WELCOME_PHRASES[0]);
});

test('welcome phrase pool contains several distinct messages', () => {
  assert.ok(WELCOME_PHRASES.length >= 6);
  assert.equal(new Set(WELCOME_PHRASES).size, WELCOME_PHRASES.length);
});

test('all generated answers and choices stay integral', () => {
  const generators = [generateNthTermQuestion, generateDifferenceQuestion, generateMissingTermQuestion, generateArithmeticMeanQuestion];
  for (const generate of generators) {
    for (let i = 0; i < 50; i += 1) assert.ok(Number.isInteger(generate().answer));
  }
  for (let i = 0; i < 100; i += 1) {
    const q = generateQuestion();
    const choices = generateChoices(q.answer);
    assert.equal(choices.length, 4);
    assert.equal(new Set(choices).size, 4);
    assert.equal(choices.filter(value => value === q.answer).length, 1);
    assert.ok(choices.every(Number.isInteger));
  }
});
