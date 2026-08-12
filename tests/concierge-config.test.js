// M1: Concierge config + data layer. Owner reads/updates the onboarding
// config; validation rejects bad tone/timing/language sets; defaults are
// bilingual and shippable.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, stopServer, BASE, json, freshTenant, api, adminLibs } = require('./helpers');
const { validateConfig, DEFAULTS, TONES } = require('../lib/concierge/config');

test.before(async () => { await startServer(); });
test.after(async () => { await stopServer(); });

test('defaults are bilingual and shippable', () => {
  assert.ok(DEFAULTS.greeting.en && DEFAULTS.greeting.ar);
  assert.ok(TONES.includes(DEFAULTS.tone));
  assert.ok(DEFAULTS.languages.length >= 1);
  assert.ok(DEFAULTS.checkinSeconds >= 60);
  assert.equal(DEFAULTS.enabled, false);
});

test('validateConfig accepts a good patch', () => {
  const r = validateConfig({
    enabled: true, tone: 'serious', languages: ['en', 'ar'],
    greeting: { en: 'Welcome to the city.', ar: 'أهلًا بك في المدينة.' },
    checkinSeconds: 300, retentionDays: 30,
    features: { greet: true, ask: true, guide: true, checkin: true, introduce: true },
    recommendJobs: [{ id: 'police', label: { en: 'Police', ar: 'شرطة' } }],
  });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.config.tone, 'serious');
});

test('validateConfig rejects bad values', () => {
  assert.equal(validateConfig({ tone: 'clown' }).ok, false);
  assert.equal(validateConfig({ languages: ['fr'] }).ok, false);
  assert.equal(validateConfig({ languages: [] }).ok, false);
  assert.equal(validateConfig({ checkinSeconds: 5 }).ok, false);      // too short
  assert.equal(validateConfig({ checkinSeconds: 99999 }).ok, false);  // too long
  assert.equal(validateConfig({ retentionDays: 0 }).ok, false);
  assert.equal(validateConfig({ greeting: { en: 'hi' } }).ok, false); // missing AR
});

test('GET config returns defaults; POST round-trips; slug/enabled stable', async () => {
  const t = await freshTenant();
  const g = await api(t.idToken)('/api/concierge/config');
  assert.equal(g.status, 200);
  assert.equal(g.body.config.enabled, false);
  assert.ok(g.body.config.greeting.en);

  const p = await api(t.idToken)('/api/concierge/config', { method: 'POST', body: JSON.stringify({ enabled: true, tone: 'casual' }) });
  assert.equal(p.status, 200);
  assert.equal(p.body.config.enabled, true);
  assert.equal(p.body.config.tone, 'casual');

  const g2 = await api(t.idToken)('/api/concierge/config');
  assert.equal(g2.body.config.enabled, true);
  assert.equal(g2.body.config.tone, 'casual');
});

test('config endpoints require verified auth + pay-gate', async () => {
  assert.equal((await json(await fetch(`${BASE}/api/concierge/config`))).status, 401);
  const unv = await freshTenant({ verified: false });
  assert.equal((await api(unv.idToken)('/api/concierge/config')).status, 403);
  const t = await freshTenant();
  const { firestore } = adminLibs();
  await firestore.updateTenant(t.uid, { active: false });
  assert.equal((await api(t.idToken)('/api/concierge/config')).status, 402);
});
