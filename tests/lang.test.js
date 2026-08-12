// M2: language detection follows the user, per message. Pure unit tests for the
// one small detector module; the endpoint-level "reply language follows input"
// proof lives in interpret.test.js / queue.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { detectLanguage } = require('../lib/lang');

test('clear English → en', () => {
  assert.equal(detectLanguage('repair my car'), 'en');
  assert.equal(detectLanguage('make it rain'), 'en');
  assert.equal(detectLanguage('what can you do?'), 'en');
});

test('clear Arabic → ar', () => {
  assert.equal(detectLanguage('صلّح سيارتي'), 'ar');
  assert.equal(detectLanguage('ابغى سيارة شرطة'), 'ar');
  assert.equal(detectLanguage('كيف يعمل هذا؟'), 'ar');
});

test('dominant script wins even with a foreign word mixed in', () => {
  assert.equal(detectLanguage('ابغى سيارة شرطة police'), 'ar'); // mostly Arabic
  assert.equal(detectLanguage('set the time to 5 مساء'), 'en'); // mostly English
});

test('genuinely mixed / ambiguous → falls back to the given default', () => {
  assert.equal(detectLanguage('hello مرحبا', 'en'), 'en');
  assert.equal(detectLanguage('hello مرحبا', 'ar'), 'ar');
});

test('no letters (digits/punctuation/emoji only) → fallback', () => {
  assert.equal(detectLanguage('123 !!!', 'ar'), 'ar');
  assert.equal(detectLanguage('', 'en'), 'en');
  assert.equal(detectLanguage('👍🔥', 'ar'), 'ar');
});

test('default fallback is en when none is given', () => {
  assert.equal(detectLanguage('42'), 'en');
});
