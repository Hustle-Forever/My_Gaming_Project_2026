// Backend hardening: security headers, payload caps, request ids,
// same-origin CORS default, and the detailed (secret-free) health check.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, stopServer, BASE, json, freshTenant, api } = require('./helpers');

test.before(async () => { await startServer(); });
test.after(async () => { await stopServer(); });

test('API responses carry security headers + request id', async () => {
  const res = await fetch(`${BASE}/api/health`);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.match(res.headers.get('x-request-id') || '', /^[0-9a-f-]{8,}$/i, 'x-request-id must be set');
});

test('HTML pages carry CSP and security headers', async () => {
  const res = await fetch(`${BASE}/`);
  assert.equal(res.status, 200);
  const csp = res.headers.get('content-security-policy') || '';
  assert.ok(csp.includes("default-src 'self'"), `CSP missing: ${csp}`);
  assert.ok(csp.includes('frame-ancestors'), 'CSP must pin frame-ancestors');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('CORS is same-origin by default (no ACAO header)', async () => {
  const res = await fetch(`${BASE}/api/health`, { headers: { origin: 'https://evil.example' } });
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});

test('oversized JSON payload -> 413 PAYLOAD_TOO_LARGE', async () => {
  const t = await freshTenant();
  const res = await api(t.idToken)('/api/command', {
    method: 'POST',
    body: JSON.stringify({ text: 'x'.repeat(100 * 1024), mode: 'run' }),
  });
  assert.equal(res.status, 413, JSON.stringify(res.body).slice(0, 200));
  assert.equal(res.body.error && res.body.error.code, 'PAYLOAD_TOO_LARGE');
});

test('over-long text (within payload cap) -> 400 BAD_INPUT', async () => {
  const t = await freshTenant();
  const res = await api(t.idToken)('/api/command', {
    method: 'POST',
    body: JSON.stringify({ text: 'y'.repeat(301), mode: 'run' }),
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error && res.body.error.code, 'BAD_INPUT');
});

test('health reports firestore + config detail without secrets', async () => {
  const res = await json(await fetch(`${BASE}/api/health`));
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.firestore, 'ok');
  assert.equal(typeof res.body.provider, 'string');
  assert.equal(typeof res.body.config, 'object');
  assert.equal(res.body.config.encryptionKey, true);
  assert.equal(typeof res.body.config.serviceAccount, 'boolean');
  const dump = JSON.stringify(res.body).toLowerCase();
  for (const leak of ['begin private key', 'aiza', 'brg_', 'encryption_key']) {
    assert.ok(!dump.includes(leak), `health must never leak secrets (found ${leak})`);
  }
});
