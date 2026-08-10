// Auth: signup creates the tenant (active:true - open access, no payment),
// sign-in yields a usable ID token, every protected endpoint 401s without
// one, and the refresh-token path mints tokens the API accepts.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, stopServer, BASE, json, signup, signIn, refreshIdToken, freshTenant, api, adminLibs } = require('./helpers');

test.before(async () => { await startServer(); });
test.after(async () => { await stopServer(); });

test('signup creates auth user + tenant, ACTIVE by default (open access)', async () => {
  const su = await signup();
  assert.equal(su.status, 200);
  assert.ok(su.uid, 'signup must return uid');
  const { firestore } = adminLibs();
  const tenant = await firestore.getTenant(su.uid);
  assert.ok(tenant, 'tenant doc must exist');
  assert.equal(tenant.active, true, 'open access: new tenants are active with no payment');
  assert.equal(tenant.providerKeyEnc, null);
  assert.ok(tenant.bridgeToken.startsWith('brg_'));
  assert.ok(Array.isArray(tenant.allowedActions) && tenant.allowedActions.length === 6);
});

test('sign-in returns a token the API accepts', async () => {
  const t = await freshTenant();
  const me = await api(t.idToken)('/api/tenant/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.tenant.active, true);
  assert.equal(me.body.tenant.name, 'Test RP');
});

test('every protected endpoint -> 401 without a token', async () => {
  for (const [method, pathname] of [
    ['GET', '/api/tenant/me'],
    ['POST', '/api/tenant/key'],
    ['POST', '/api/tenant/rotate-bridge-token'],
    ['POST', '/api/command'],
  ]) {
    const res = await json(await fetch(`${BASE}${pathname}`, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(method === 'POST' ? { body: '{}' } : {}),
    }));
    assert.equal(res.status, 401, `${method} ${pathname} must 401`);
    assert.equal(res.body.error.code, 'AUTH_REQUIRED');
  }
});

test('garbage bearer token -> 401', async () => {
  const res = await api('garbage.token.here')('/api/tenant/me');
  assert.equal(res.status, 401);
});

test('refresh-token path mints a fresh ID token the API accepts', async () => {
  const su = await signup();
  const { refreshToken } = await signIn(su.email, su.password);
  const freshToken = await refreshIdToken(refreshToken);
  assert.ok(freshToken, 'refresh must return an id token');
  const me = await api(freshToken)('/api/tenant/me');
  assert.equal(me.status, 200, JSON.stringify(me.body));
});
