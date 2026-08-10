// Every failure, on every endpoint, must return the documented envelope:
//   { ok:false, error:{ code, message } }
// with a stable machine-readable code the frontend switches on.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, stopServer, BASE, json, signup, freshTenant, api, adminLibs } = require('./helpers');

function assertEnvelope(res, status, code) {
  assert.equal(res.status, status, `expected HTTP ${status}, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.ok, false, `body.ok must be false: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.error && res.body.error.code, code, `expected code ${code}: ${JSON.stringify(res.body)}`);
  assert.equal(typeof res.body.error.message, 'string');
  assert.ok(res.body.error.message.length > 0, 'error.message must be non-empty');
}

test.before(async () => { await startServer(); });
test.after(async () => { await stopServer(); });

test('wrong method -> 405 METHOD_NOT_ALLOWED', async () => {
  const res = await json(await fetch(`${BASE}/api/command`, { method: 'GET' }));
  assertEnvelope(res, 405, 'METHOD_NOT_ALLOWED');
});

test('missing ID token -> 401 AUTH_REQUIRED', async () => {
  const res = await json(await fetch(`${BASE}/api/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'hi' }),
  }));
  assertEnvelope(res, 401, 'AUTH_REQUIRED');
});

test('wrong bridge token -> 401 AUTH_REQUIRED', async () => {
  const res = await json(await fetch(`${BASE}/api/bridge/poll`, { headers: { 'x-bridge-token': 'brg_wrong' } }));
  assertEnvelope(res, 401, 'AUTH_REQUIRED');
});

test('empty text -> 400 BAD_INPUT', async () => {
  const t = await freshTenant();
  const res = await api(t.idToken)('/api/command', { method: 'POST', body: JSON.stringify({ text: '' }) });
  assertEnvelope(res, 400, 'BAD_INPUT');
});

test('inactive plan -> 402 PLAN_INACTIVE on command AND poll', async () => {
  const t = await freshTenant();
  const { firestore } = adminLibs();
  await firestore.updateTenant(t.uid, { active: false });
  const cmd = await api(t.idToken)('/api/command', { method: 'POST', body: JSON.stringify({ text: 'عالجني' }) });
  assertEnvelope(cmd, 402, 'PLAN_INACTIVE');
  const tenant = await firestore.getTenant(t.uid);
  const poll = await json(await fetch(`${BASE}/api/bridge/poll`, { headers: { 'x-bridge-token': tenant.bridgeToken } }));
  assertEnvelope(poll, 402, 'PLAN_INACTIVE');
});

test('duplicate signup email -> 409 EMAIL_TAKEN', async () => {
  const first = await signup();
  assert.equal(first.status, 200);
  const dup = await json(await fetch(`${BASE}/api/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: first.email, password: 'another-pass-123', name: 'Dup' }),
  }));
  assertEnvelope(dup, 409, 'EMAIL_TAKEN');
});

test('signup with bad email/short password -> 400 BAD_INPUT', async () => {
  const bad = await json(await fetch(`${BASE}/api/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'not-an-email', password: 'longenough1' }),
  }));
  assertEnvelope(bad, 400, 'BAD_INPUT');
  const short = await json(await fetch(`${BASE}/api/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'ok@m2.test', password: 'short' }),
  }));
  assertEnvelope(short, 400, 'BAD_INPUT');
});

test('signed-in user with no tenant doc -> 404 NOT_FOUND', async () => {
  const t = await freshTenant();
  const { firebase } = adminLibs();
  await firebase.db.collection('tenants').doc(t.uid).delete();
  const res = await api(t.idToken)('/api/tenant/me');
  assertEnvelope(res, 404, 'NOT_FOUND');
});

test('stripe webhook seam -> 501 NOT_IMPLEMENTED', async () => {
  const res = await json(await fetch(`${BASE}/api/stripe/webhook`, { method: 'POST' }));
  assertEnvelope(res, 501, 'NOT_IMPLEMENTED');
});
