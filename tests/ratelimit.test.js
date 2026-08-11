// Per-TENANT rate limiting on /api/command (Firestore-backed so it holds on
// serverless where each invocation may be a fresh process). This file boots
// its own dev-server with a tiny window so the test stays fast.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, stopServer, freshTenant, api } = require('./helpers');

const LIMIT = 3;
const SIGNUP_LIMIT = 3;

test.before(async () => {
  await startServer({
    RATE_LIMIT_PER_MIN: String(LIMIT),
    SIGNUP_RATE_LIMIT_PER_HOUR: String(SIGNUP_LIMIT),
  });
});
test.after(async () => { await stopServer(); });

test(`command #${LIMIT + 1} within a minute -> 429 RATE_LIMITED`, async () => {
  const t = await freshTenant();
  const send = () => api(t.idToken)('/api/command', {
    method: 'POST',
    body: JSON.stringify({ text: 'عالجني', mode: 'run' }),
  });
  for (let i = 0; i < LIMIT; i++) {
    const ok = await send();
    assert.equal(ok.status, 200, `command ${i + 1} should pass: ${JSON.stringify(ok.body)}`);
  }
  const blocked = await send();
  assert.equal(blocked.status, 429, JSON.stringify(blocked.body));
  assert.equal(blocked.body.ok, false);
  assert.equal(blocked.body.error && blocked.body.error.code, 'RATE_LIMITED');
});

test('rate limit is per tenant - a different tenant is unaffected', async () => {
  const a = await freshTenant();
  const b = await freshTenant();
  for (let i = 0; i < LIMIT; i++) {
    await api(a.idToken)('/api/command', { method: 'POST', body: JSON.stringify({ text: 'عالجني' }) });
  }
  const aBlocked = await api(a.idToken)('/api/command', { method: 'POST', body: JSON.stringify({ text: 'عالجني' }) });
  assert.equal(aBlocked.status, 429);
  const bOk = await api(b.idToken)('/api/command', { method: 'POST', body: JSON.stringify({ text: 'عالجني' }) });
  assert.equal(bOk.status, 200, JSON.stringify(bOk.body));
});

test('signup is throttled per IP (mass account creation)', async () => {
  const { BASE, uniqueEmail } = require('./helpers');
  // random per-run IPs: rl_ip counters persist in the shared emulator across
  // suite runs inside the 1h window, so fixed IPs would carry stale counts
  const b = require('crypto').randomBytes(3);
  const ip = `172.${16 + (b[0] % 16)}.${b[1]}.${b[2]}`; // one client, many signups
  const attempt = () => fetch(`${BASE}/api/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ email: uniqueEmail('flood'), password: 'flood-pass-123', name: 'Flood' }),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

  for (let i = 0; i < SIGNUP_LIMIT; i++) {
    const ok = await attempt();
    assert.equal(ok.status, 200, `signup ${i + 1} should pass: ${JSON.stringify(ok.body)}`);
  }
  const blocked = await attempt();
  assert.equal(blocked.status, 429, JSON.stringify(blocked.body));
  assert.equal(blocked.body.error && blocked.body.error.code, 'RATE_LIMITED');

  // a different IP is unaffected
  const other = await fetch(`${BASE}/api/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `172.${16 + (b[0] % 16)}.${b[1]}.${(b[2] + 1) % 256}` },
    body: JSON.stringify({ email: uniqueEmail('ok'), password: 'flood-pass-123', name: 'Ok' }),
  });
  assert.equal(other.status, 200);
});

test('ask mode is rate limited too (provider cost path)', async () => {
  const t = await freshTenant();
  for (let i = 0; i < LIMIT; i++) {
    await api(t.idToken)('/api/command', { method: 'POST', body: JSON.stringify({ text: 'hello', mode: 'ask' }) });
  }
  const blocked = await api(t.idToken)('/api/command', { method: 'POST', body: JSON.stringify({ text: 'hello', mode: 'ask' }) });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error && blocked.body.error.code, 'RATE_LIMITED');
});
