// BYOK key handling: encrypted at rest (ciphertext != plaintext, AES-GCM
// round-trip), never returned by ANY endpoint, provider constrained.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, stopServer, BASE, json, freshTenant, api, adminLibs } = require('./helpers');

const SECRET_KEY = 'AIzaFakeTestKey-DO-NOT-LEAK-9f8e7d6c5b4a';

test.before(async () => { await startServer(); });
test.after(async () => { await stopServer(); });

test('key is stored encrypted; decrypt round-trips; plaintext never in Firestore', async () => {
  const t = await freshTenant();
  const save = await api(t.idToken)('/api/tenant/key', {
    method: 'POST',
    body: JSON.stringify({ apiKey: SECRET_KEY, provider: 'gemini' }),
  });
  assert.equal(save.status, 200);
  assert.equal(save.body.hasKey, true);

  const { firestore, crypto } = adminLibs();
  const tenant = await firestore.getTenant(t.uid);
  assert.ok(tenant.providerKeyEnc, 'ciphertext stored');
  assert.notEqual(tenant.providerKeyEnc, SECRET_KEY, 'must not be plaintext');
  assert.ok(!tenant.providerKeyEnc.includes(SECRET_KEY), 'ciphertext must not embed plaintext');
  assert.equal(crypto.decryptSecret(tenant.providerKeyEnc), SECRET_KEY, 'AES-GCM round-trip');
});

test('no endpoint ever returns the key (response-body scan)', async () => {
  const t = await freshTenant();
  await api(t.idToken)('/api/tenant/key', { method: 'POST', body: JSON.stringify({ apiKey: SECRET_KEY }) });

  const { firestore } = adminLibs();
  const tenant = await firestore.getTenant(t.uid);
  const responses = [
    await api(t.idToken)('/api/tenant/me'),
    await api(t.idToken)('/api/command', { method: 'POST', body: JSON.stringify({ text: 'عالجني' }) }),
    await api(t.idToken)('/api/command', { method: 'POST', body: JSON.stringify({ text: 'hello', mode: 'ask' }) }),
    await api(t.idToken)('/api/tenant/rotate-bridge-token', { method: 'POST' }),
    await json(await fetch(`${BASE}/api/health`)),
    await json(await fetch(`${BASE}/api/bridge/poll`, { headers: { 'x-bridge-token': tenant.bridgeToken } })),
  ];
  for (const res of responses) {
    const dump = JSON.stringify(res.body);
    assert.ok(!dump.includes(SECRET_KEY), `key leaked in: ${dump.slice(0, 120)}`);
    assert.ok(!dump.includes('providerKeyEnc'), `ciphertext field leaked in: ${dump.slice(0, 120)}`);
  }
  // /api/tenant/me reports presence only
  assert.equal(responses[0].body.tenant.hasKey, true);
});

test('key shorter than 10 chars -> 400 BAD_INPUT', async () => {
  const t = await freshTenant();
  const res = await api(t.idToken)('/api/tenant/key', { method: 'POST', body: JSON.stringify({ apiKey: 'short' }) });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'BAD_INPUT');
});

test('unknown provider name falls back to tenant provider (never stored raw)', async () => {
  const t = await freshTenant();
  const res = await api(t.idToken)('/api/tenant/key', {
    method: 'POST',
    body: JSON.stringify({ apiKey: SECRET_KEY, provider: 'evil-llm' }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.provider, 'gemini');
});
