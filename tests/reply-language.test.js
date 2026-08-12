// M2: the reply language follows the language the operator actually wrote in,
// per message — for Ask AND for Run confirmations — and the UI toggle (which we
// never send to the server) can't change it. Mixed/ambiguous input falls back
// to the tenant's default language.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, stopServer, freshTenant, api, adminLibs } = require('./helpers');

test.before(async () => { await startServer(); });
test.after(async () => { await stopServer(); });

const hasArabic = (s) => /[؀-ۿ]/.test(s);
const hasLatin = (s) => /[A-Za-z]/.test(s);
const cmd = (t, body) => api(t.idToken)('/api/command', { method: 'POST', body: JSON.stringify(body) });

test('Run: English in → English confirmation', async () => {
  const t = await freshTenant();
  const r = await cmd(t, { text: 'repair my car', mode: 'run' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.action, 'repair_vehicle');
  assert.equal(r.body.lang, 'en');
  assert.ok(hasLatin(r.body.message) && !hasArabic(r.body.message), r.body.message);
});

test('Run: Arabic in → Arabic confirmation', async () => {
  const t = await freshTenant();
  const r = await cmd(t, { text: 'صلّح سيارتي', mode: 'run' });
  assert.equal(r.body.action, 'repair_vehicle');
  assert.equal(r.body.lang, 'ar');
  assert.ok(hasArabic(r.body.message), r.body.message);
});

test('Ask (no key): English in → English answer', async () => {
  const t = await freshTenant();
  const r = await cmd(t, { text: 'how does this work?', mode: 'ask' });
  assert.equal(r.body.lang, 'en');
  assert.ok(hasLatin(r.body.reply) && !hasArabic(r.body.reply), r.body.reply);
});

test('Ask (no key): Arabic in → Arabic answer', async () => {
  const t = await freshTenant();
  const r = await cmd(t, { text: 'كيف يعمل هذا؟', mode: 'ask' });
  assert.equal(r.body.lang, 'ar');
  assert.ok(hasArabic(r.body.reply), r.body.reply);
});

test('the UI toggle can never change the reply language', async () => {
  const t = await freshTenant();
  // Client sends an (ignored) UI-language hint that disagrees with the text.
  const r = await cmd(t, { text: 'make it rain', mode: 'run', uiLang: 'ar', lang: 'ar' });
  assert.equal(r.body.lang, 'en', 'reply follows the English text, not the ar hint');
  assert.ok(hasLatin(r.body.message) && !hasArabic(r.body.message), r.body.message);
});

test('mixed/ambiguous input falls back to the tenant default language', async () => {
  const t = await freshTenant();
  const { firestore } = adminLibs();
  await firestore.updateTenant(t.uid, { defaultLanguage: 'ar' });
  const r = await cmd(t, { text: 'hello مرحبا', mode: 'ask' }); // 50/50 → ambiguous
  assert.equal(r.body.lang, 'ar', 'ambiguous → tenant default (ar)');
  assert.ok(hasArabic(r.body.reply), r.body.reply);
});

test('default fallback is English when the tenant has no default set', async () => {
  const t = await freshTenant();
  const r = await cmd(t, { text: '12345', mode: 'ask' }); // no letters
  assert.equal(r.body.lang, 'en');
});
