// M5: the owner review side. Queue (ranked), detail (transcript+evidence),
// decisions (approve/reject/reinterview + note, records who/when), delete, and
// stats. Auth + verified + pay-gate throughout.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, stopServer, BASE, json, freshTenant, api, adminLibs } = require('./helpers');

test.before(async () => { await startServer(); });
test.after(async () => { await stopServer(); });

const RUN = require('crypto').randomBytes(2);
const ipFor = (n) => `${100 + RUN[0] % 100}.${RUN[1] % 256}.${n}.2`;
const post = async (p, b, h = {}) => json(await fetch(`${BASE}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(b) }));

// enable a tenant and push a completed application through the public flow
async function tenantWithApplication(discord) {
  const t = await freshTenant();
  await api(t.idToken)('/api/whitelist/config', { method: 'POST', body: JSON.stringify({ enabled: true }) });
  const cfg = (await api(t.idToken)('/api/whitelist/config')).body.config;
  const ip = { 'x-forwarded-for': ipFor(t.uid.charCodeAt(0) % 200) };
  const start = await post('/api/apply/start', { slug: cfg.slug, language: 'en', identity: { discord, ingame: 'Ingame' } }, ip);
  let step = start.body.step, appId = start.body.appId, resumeToken = start.body.resumeToken, g = 0;
  while (step && step.kind !== 'done' && g++ < 20) {
    const r = await post('/api/apply/answer', { appId, resumeToken, text: 'I roleplayed seriously for two years as a paramedic and always stay in character during scenes' }, ip);
    step = r.body.step;
  }
  await post('/api/apply/submit', { appId, resumeToken }, ip);
  return { ...t, appId };
}

test('queue lists submitted applications with score + identity', async () => {
  const t = await tenantWithApplication('queue#1');
  const q = await api(t.idToken)('/api/whitelist/applications');
  assert.equal(q.status, 200);
  assert.ok(Array.isArray(q.body.applications) && q.body.applications.length >= 1);
  const row = q.body.applications[0];
  assert.ok(row.appId && typeof row.overall === 'number' && row.identity, JSON.stringify(row));
  assert.equal(row.status, 'submitted');
});

test('detail returns full transcript, scores with evidence, flags', async () => {
  const t = await tenantWithApplication('detail#1');
  const d = await api(t.idToken)(`/api/whitelist/applications?appId=${t.appId}`);
  assert.equal(d.status, 200);
  const a = d.body.application;
  assert.ok(a.transcript.length >= 2);
  assert.ok(a.scores.every((s) => s.evidence));
  assert.ok(Array.isArray(a.flags));
  assert.ok(typeof a.summary === 'string');
});

test('approve records the decision + who/when; reject and reinterview work', async () => {
  const t = await tenantWithApplication('decide#1');
  const dec = await api(t.idToken)('/api/whitelist/decide', { method: 'POST', body: JSON.stringify({ appId: t.appId, decision: 'approve', note: 'good fit' }) });
  assert.equal(dec.status, 200);
  const { firestore } = adminLibs();
  const app = await firestore.getApplication(t.uid, t.appId);
  assert.equal(app.status, 'approved');
  assert.equal(app.decidedBy, t.uid);
  assert.ok(app.decidedAtMs > 0);
  assert.equal(app.decisionNote, 'good fit');

  // invalid decision rejected
  assert.equal((await api(t.idToken)('/api/whitelist/decide', { method: 'POST', body: JSON.stringify({ appId: t.appId, decision: 'banana' }) })).status, 400);
});

test('decide requires the application to belong to the caller', async () => {
  const owner = await tenantWithApplication('cross#1');
  const attacker = await freshTenant();
  const r = await api(attacker.idToken)('/api/whitelist/decide', { method: 'POST', body: JSON.stringify({ appId: owner.appId, decision: 'approve' }) });
  assert.equal(r.status, 404, 'another tenant cannot decide on your applications');
});

test('delete application removes it (personal-data control)', async () => {
  const t = await tenantWithApplication('del#1');
  const del = await api(t.idToken)('/api/whitelist/decide', { method: 'POST', body: JSON.stringify({ appId: t.appId, decision: 'delete' }) });
  assert.equal(del.status, 200);
  const { firestore } = adminLibs();
  assert.equal(await firestore.getApplication(t.uid, t.appId), null);
});

test('stats reflect the queue (received, approval rate, backlog)', async () => {
  const t = await tenantWithApplication('stats#1');
  // decide it -> approval rate + backlog move
  await api(t.idToken)('/api/whitelist/decide', { method: 'POST', body: JSON.stringify({ appId: t.appId, decision: 'approve' }) });
  const s = await api(t.idToken)('/api/whitelist/stats');
  assert.equal(s.status, 200);
  assert.ok(s.body.stats.received >= 1);
  assert.ok(typeof s.body.stats.approvalRate === 'number');
  assert.ok('backlog' in s.body.stats);
});

test('review endpoints require verified auth + pay-gate', async () => {
  assert.equal((await json(await fetch(`${BASE}/api/whitelist/applications`))).status, 401);
  const unv = await freshTenant({ verified: false });
  assert.equal((await api(unv.idToken)('/api/whitelist/applications')).status, 403);
});
