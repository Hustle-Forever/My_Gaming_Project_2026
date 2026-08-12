// M3: the Ask persona + deterministic fallback. The AI system prompt and the
// no-key fallback share one product-knowledge module. These are pure tests of
// that module: the fallback must actually EXPLAIN (capabilities + a concrete
// example command), in the user's language, under the cap, and must never be a
// bare restriction list. The system prompt must carry the right guidance.
const test = require('node:test');
const assert = require('node:assert/strict');
const { askSystemPrompt, fallbackAnswer, MAX_REPLY_CHARS } = require('../lib/ask-persona');

const hasArabic = (s) => /[؀-ۿ]/.test(s);
const hasLatin = (s) => /[A-Za-z]/.test(s);

test('fallback (EN): explains, names a capability, gives an example command, under cap', () => {
  const r = fallbackAnswer({ language: 'en' });
  assert.ok(hasLatin(r) && !hasArabic(r), 'English only');
  assert.ok(/run mode/i.test(r), 'mentions live control');
  assert.ok(/make it rain/i.test(r), 'gives a concrete example command');
  assert.ok(r.length <= MAX_REPLY_CHARS);
  // not merely a wall of restrictions
  assert.ok(!/^(you can only|sorry|i can'?t)/i.test(r.trim()));
});

test('fallback (AR): native Arabic, capability + example, under cap', () => {
  const r = fallbackAnswer({ language: 'ar' });
  assert.ok(hasArabic(r), 'Arabic present');
  // Native Arabic prose: no English sentences. Brand/proper nouns (M2, NPCs) are
  // allowed, so strip those before asserting there's no stray Latin word.
  assert.ok(!/[A-Za-z]{4,}/.test(r.replace(/M2|NPCs?/g, '')), 'no English words (bar brand/proper nouns)');
  assert.ok(r.includes('خلها تمطر'), 'concrete Arabic example command');
  assert.ok(r.length <= MAX_REPLY_CHARS);
});

test('fallback is concrete about THIS server when a scan model is present', () => {
  const r = fallbackAnswer({ language: 'en', server: { framework: 'QBCore', inventory: 'ox_inventory', jobs: ['police', 'mechanic'] } });
  assert.ok(/QBCore/.test(r), 'names the framework');
  assert.ok(/ox_inventory/.test(r), 'names the inventory');
});

test('fallback respects the tenant allowedActions subset', () => {
  const r = fallbackAnswer({ language: 'en', allowedActions: ['set_weather'] });
  assert.ok(/weather/i.test(r));
  assert.ok(!/spawn NPCs/i.test(r), 'actions the tenant disabled are not advertised');
});

test('system prompt (EN) instructs explain-not-deflect, reply-in-English, and lists product capabilities', () => {
  const p = askSystemPrompt({ language: 'en', allowedActions: ['spawn_vehicle', 'set_weather'] });
  assert.ok(/in English/i.test(p), 'pins reply language');
  assert.ok(/Explain, don'?t deflect/i.test(p));
  assert.ok(/Whitelist Officer/i.test(p) && /scanner/i.test(p) && /Run mode/i.test(p), 'knows the product');
  assert.ok(/spawn vehicles/i.test(p), 'lists the allowed action');
});

test('system prompt (AR) is written natively and pins Arabic replies', () => {
  const p = askSystemPrompt({ language: 'ar' });
  assert.ok(hasArabic(p));
  assert.ok(p.includes('بالعربية'), 'explicitly instructs Arabic replies');
  assert.ok(!/reply in english/i.test(p));
});

test('system prompt weaves in server facts when present', () => {
  const p = askSystemPrompt({ language: 'en', server: { framework: 'ESX', jobs: ['taxi'] } });
  assert.ok(/ESX/.test(p) && /taxi/.test(p));
});
