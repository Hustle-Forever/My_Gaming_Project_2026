// Milestone 4: the diagnosis layer. The broken fixture must surface EVERY
// planted fault; the clean fixtures must stay clean (no false positives).
// This is the test that proves the product actually works.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const access = require('../lib/serverAccess');
const { scan } = require('../lib/scanner');

const FIX = path.join(__dirname, 'fixtures', 'servers');
const run = (name) => scan(access.fromDirectory(path.join(FIX, name)), { destroyAdapter: true });

function ids(report) { return report.findings.map((f) => f.checkId); }

test('broken fixture surfaces every planted problem', () => {
  const r = run('broken');
  const got = ids(r);
  for (const expected of [
    'duplicate-inventory',   // qb-inventory + ox_inventory
    'missing-dependency',    // sketchy needs ox_target (absent)
    'load-order',            // qb-inventory ensured before qb-core
    'nested-folder',         // mx-nested/mx-nested
    'missing-manifest',      // no-manifest-here
    'lua-syntax',            // bad-script unclosed if
    'ghost-resource',        // qb-heists ensured, not on disk
    'busy-loop',             // hot-loop while true + Wait(0)
    'risk-shell',            // os.execute
    'risk-http',             // suspicious outbound webhook
    'risk-credentials',      // hardcoded password/webhook token
    'risk-escrow',           // .fxap escrow
    'dead-weight',           // unused-lib on disk, never started
  ]) {
    assert.ok(got.includes(expected), `missing planted finding: ${expected} (got ${got.join(', ')})`);
  }
  // every finding carries evidence + bilingual text
  for (const f of r.findings) {
    assert.ok(f.severity, `${f.checkId} needs a severity`);
    assert.ok(f.title.en && f.title.ar, `${f.checkId} needs EN+AR title`);
    assert.ok(f.why.en && f.why.ar, `${f.checkId} needs EN+AR why`);
    assert.ok(f.fix.en && f.fix.ar, `${f.checkId} needs EN+AR fix`);
    assert.ok(Array.isArray(f.evidence) && f.evidence.length >= 1, `${f.checkId} needs evidence`);
  }
});

test('clean QBCore fixture reports clean (no false positives)', () => {
  const r = run('qbcore-clean');
  const blocking = r.findings.filter((f) => f.severity === 'critical' || f.severity === 'high');
  assert.deepEqual(blocking.map((f) => f.checkId), [], `clean server flagged: ${blocking.map((f) => f.checkId)}`);
  assert.ok(r.health.score >= 90, `clean score ${r.health.score}`);
  assert.equal(r.identity.framework.framework, 'qbcore');
});

test('clean ESX fixture reports clean', () => {
  const r = run('esx-clean');
  const blocking = r.findings.filter((f) => f.severity === 'critical' || f.severity === 'high');
  assert.deepEqual(blocking.map((f) => f.checkId), []);
  assert.equal(r.identity.framework.framework, 'esx');
  assert.ok(r.health.score >= 85, `esx score ${r.health.score}`);
});

test('report is ranked worst-first and has a plain-language verdict', () => {
  const r = run('broken');
  const sev = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  for (let i = 1; i < r.findings.length; i++) {
    assert.ok(sev[r.findings[i - 1].severity] <= sev[r.findings[i].severity], 'findings must be severity-sorted');
  }
  assert.ok(r.health.score < 60, `broken health should be poor, got ${r.health.score}`);
  assert.ok(r.health.verdict.en.length > 0 && r.health.verdict.ar.length > 0);
});

test('checks are pluggable: each exports the standard shape', () => {
  const checks = require('../lib/scanner/checks');
  assert.ok(checks.length >= 7);
  for (const c of checks) {
    assert.equal(typeof c.id, 'string');
    assert.equal(typeof c.run, 'function');
    assert.ok(['critical', 'high', 'medium', 'low', 'info'].includes(c.severity));
  }
});

test('the derived model is storable and carries NO raw source', () => {
  const r = run('broken');
  const json = JSON.stringify(r.model);
  assert.ok(!json.includes('os.execute'), 'model must not embed raw lua source');
  assert.ok(!json.includes('SuperSecret123'), 'model must not embed secrets');
  // but it keeps the useful structure
  assert.ok(r.model.resources.sketchy);
});
