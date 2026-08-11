// Milestone 5: the scan API (auth + verified email + pay-gate + rate limit +
// envelope + Firestore storage) and the read-only guarantee of the bridge.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { startServer, stopServer, BASE, json, freshTenant, api, adminLibs } = require('./helpers');

test.before(async () => { await startServer({ SCAN_RATE_LIMIT_PER_HOUR: '3' }); });
test.after(async () => { await stopServer(); });

// A scan-pack the dashboard would build client-side from the chosen folder.
function packFromFixture(name) {
  const root = path.join(__dirname, 'fixtures', 'servers', name);
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir)) {
      const full = path.join(dir, e);
      const st = fs.statSync(full);
      if (st.isDirectory()) { walk(full); continue; }
      const rel = path.relative(root, full).replace(/\\/g, '/');
      const isText = /\.(lua|cfg|json|sql|txt|md)$/i.test(rel);
      files.push({ path: rel, size: st.size, content: isText ? fs.readFileSync(full, 'utf8') : undefined });
    }
  };
  walk(root);
  return { files };
}

test('POST /api/scan (upload) -> scanId, report stored, retrievable', async () => {
  const t = await freshTenant();
  const res = await api(t.idToken)('/api/scan', {
    method: 'POST',
    body: JSON.stringify({ source: 'upload', pack: packFromFixture('broken') }),
  });
  assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 300));
  assert.ok(res.body.scanId, 'returns a scanId');
  assert.equal(res.body.status, 'complete');
  assert.ok(res.body.health.score < 60, 'broken server scores low');

  const status = await api(t.idToken)(`/api/scan-status?scanId=${res.body.scanId}`);
  assert.equal(status.status, 200);
  assert.equal(status.body.scan.identity.framework.framework, 'qbcore');
  assert.ok(status.body.scan.findings.length >= 10);

  // stored in Firestore under the tenant, derived-only (no raw source)
  const { firebase } = adminLibs();
  const doc = await firebase.db.collection('tenants').doc(t.uid).collection('scans').doc(res.body.scanId).get();
  assert.equal(doc.exists, true);
  const dump = JSON.stringify(doc.data());
  assert.ok(!dump.includes('os.execute'), 'no raw source stored');
  assert.ok(!dump.includes('SuperSecret123'), 'no secrets stored');
});

test('scan-status without id lists the tenant\'s scan history', async () => {
  const t = await freshTenant();
  await api(t.idToken)('/api/scan', { method: 'POST', body: JSON.stringify({ source: 'upload', pack: packFromFixture('qbcore-clean') }) });
  const list = await api(t.idToken)('/api/scan-status');
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(list.body.scans) && list.body.scans.length >= 1);
  assert.ok(list.body.scans[0].scanId && list.body.scans[0].health, 'history carries summaries');
});

test('scan endpoints require auth', async () => {
  const res = await json(await fetch(`${BASE}/api/scan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'AUTH_REQUIRED');
});

test('scan endpoints require a verified email', async () => {
  const t = await freshTenant({ verified: false });
  const res = await api(t.idToken)('/api/scan', { method: 'POST', body: JSON.stringify({ source: 'upload', pack: { files: [] } }) });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'EMAIL_UNVERIFIED');
});

test('scan is pay-gated (402 when inactive)', async () => {
  const t = await freshTenant();
  const { firestore } = adminLibs();
  await firestore.updateTenant(t.uid, { active: false });
  const res = await api(t.idToken)('/api/scan', { method: 'POST', body: JSON.stringify({ source: 'upload', pack: packFromFixture('qbcore-clean') }) });
  assert.equal(res.status, 402);
  assert.equal(res.body.error.code, 'PLAN_INACTIVE');
});

test('scan is rate limited per tenant', async () => {
  const t = await freshTenant();
  const send = () => api(t.idToken)('/api/scan', { method: 'POST', body: JSON.stringify({ source: 'upload', pack: packFromFixture('ambiguous') }) });
  for (let i = 0; i < 3; i++) assert.equal((await send()).status, 200, `scan ${i + 1}`);
  const blocked = await send();
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error.code, 'RATE_LIMITED');
});

test('bad scan input -> 400 BAD_INPUT', async () => {
  const t = await freshTenant();
  const res = await api(t.idToken)('/api/scan', { method: 'POST', body: JSON.stringify({ source: 'upload' }) }); // no pack
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'BAD_INPUT');
});

// THE read-only guarantee: the bridge must expose no way to write, move, or
// delete a customer's files. Static assertion over the whole bridge source.
test('BRIDGE IS READ-ONLY: no write/delete/move primitives anywhere in fivem-bridge/', async () => {
  const dir = path.join(__dirname, '..', 'fivem-bridge');
  const lua = fs.readdirSync(dir).filter((f) => f.endsWith('.lua'));
  // Strip Lua comments first: the guarantee is about executable CODE. (scan.lua
  // documents the forbidden APIs in a comment; that must not trip the check.)
  const stripLua = (s) => s.replace(/--\[\[[\s\S]*?\]\]/g, ' ').replace(/--[^\n]*/g, ' ');
  const src = lua.map((f) => stripLua(fs.readFileSync(path.join(dir, f), 'utf8'))).join('\n');

  // FiveM's file-write API and OS/file mutation primitives - none may appear
  const forbidden = [
    /\bSaveResourceFile\b/,     // FiveM resource file WRITE
    /\bos\.remove\b/,
    /\bos\.rename\b/,
    /\bos\.execute\b/,
    /\bio\.popen\b/,
    /\bio\.write\b/,
    /\bio\.open\s*\([^)]*,[^)]*['"][waW+]/, // io.open in a write/append mode
  ];
  for (const re of forbidden) {
    assert.ok(!re.test(src), `bridge must not contain ${re}`);
  }
  // and it MUST use the read-only read API where it reads files
  const scanLua = path.join(dir, 'scan.lua');
  if (fs.existsSync(scanLua)) {
    const s = stripLua(fs.readFileSync(scanLua, 'utf8'));
    assert.ok(/\bLoadResourceFile\b/.test(s), 'bridge reads via LoadResourceFile (read-only)');
    assert.ok(!/\bSaveResourceFile\b/.test(s), 'bridge never writes');
  }
});
