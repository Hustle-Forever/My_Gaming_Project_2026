// M1: whitelist config + data layer. Owner reads/updates the interview config;
// slugs are unique and public-lookup-able; bad question/criteria sets are
// rejected before they can reach an applicant.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, stopServer, BASE, json, freshTenant, api, adminLibs } = require('./helpers');
const { validateConfig, DEFAULTS } = require('../lib/whitelist/config');

test.before(async () => { await startServer(); });
test.after(async () => { await stopServer(); });

test('defaults are sane and shippable', () => {
  assert.ok(DEFAULTS.questions.length >= 3);
  assert.ok(DEFAULTS.criteria.length >= 3);
  assert.ok(DEFAULTS.questions.every((q) => q.text.en && q.text.ar));
  assert.ok(DEFAULTS.criteria.every((c) => c.label.en && c.label.ar));
});

test('validateConfig accepts a good patch and normalizes ids/order', () => {
  const r = validateConfig({
    enabled: true,
    questions: [{ text: { en: 'Why here?', ar: 'ليش هنا؟' } }, { text: { en: 'RP experience?', ar: 'خبرتك؟' } }],
    criteria: [{ label: { en: 'Effort', ar: 'الجهد' }, description: { en: 'detail', ar: 'تفصيل' } }],
    thresholds: { autoApprove: 90, autoReject: 20 },
    languages: ['en', 'ar'],
    identityFields: [{ key: 'discord', label: { en: 'Discord', ar: 'ديسكورد' } }],
  });
  assert.equal(r.ok, true, r.error);
  assert.ok(r.config.questions.every((q, i) => q.id && q.order === i));
  assert.ok(r.config.criteria.every((c) => c.id));
});

test('validateConfig rejects bad question sets', () => {
  assert.equal(validateConfig({ questions: [] }).ok, false);                         // empty
  assert.equal(validateConfig({ questions: [{ text: { en: 'x' } }] }).ok, false);    // missing AR
  assert.equal(validateConfig({ questions: Array(50).fill({ text: { en: 'q', ar: 'س' } }) }).ok, false); // too many
  assert.equal(validateConfig({ thresholds: { autoApprove: 10, autoReject: 90 } }).ok, false); // approve<reject
  assert.equal(validateConfig({ languages: ['fr'] }).ok, false);                     // unsupported lang
});

test('GET config returns defaults for a new tenant; POST round-trips', async () => {
  const t = await freshTenant();
  const g = await api(t.idToken)('/api/whitelist/config');
  assert.equal(g.status, 200);
  assert.equal(g.body.config.enabled, false, 'off by default');
  assert.ok(g.body.config.questions.length >= 3, 'defaults served');
  assert.ok(g.body.config.slug, 'a slug is assigned');

  const patch = { enabled: true, criteria: [{ label: { en: 'Detail', ar: 'تفصيل' }, description: { en: 'x', ar: 'س' } }] };
  const p = await api(t.idToken)('/api/whitelist/config', { method: 'POST', body: JSON.stringify(patch) });
  assert.equal(p.status, 200);
  assert.equal(p.body.config.enabled, true);
  assert.equal(p.body.config.criteria.length, 1);

  const g2 = await api(t.idToken)('/api/whitelist/config');
  assert.equal(g2.body.config.enabled, true);
  assert.equal(g2.body.config.slug, g.body.config.slug, 'slug is stable across updates');
});

test('slugs are unique across tenants (collision gets a suffix)', async () => {
  const { firestore } = adminLibs();
  const a = await freshTenant();
  const b = await freshTenant();
  const sa = (await api(a.idToken)('/api/whitelist/config')).body.config.slug;
  const sb = (await api(b.idToken)('/api/whitelist/config')).body.config.slug;
  assert.notEqual(sa, sb, 'two tenants never share a slug');
  // and each slug resolves back to exactly its tenant
  assert.equal(await firestore.getTenantBySlug(sa), a.uid);
  assert.equal(await firestore.getTenantBySlug(sb), b.uid);
});

test('config endpoints require verified auth + pay-gate', async () => {
  const noauth = await json(await fetch(`${BASE}/api/whitelist/config`));
  assert.equal(noauth.status, 401);

  const unv = await freshTenant({ verified: false });
  assert.equal((await api(unv.idToken)('/api/whitelist/config')).status, 403);

  const t = await freshTenant();
  const { firestore } = adminLibs();
  await firestore.updateTenant(t.uid, { active: false });
  assert.equal((await api(t.idToken)('/api/whitelist/config')).status, 402);
});
