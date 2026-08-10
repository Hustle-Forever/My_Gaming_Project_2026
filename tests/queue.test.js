// Queue lifecycle: enqueue -> poll marks inflight (no double delivery) ->
// ack deletes; token rotation kills the old token; ask mode queues nothing;
// lastPolledAt (throttled) and firstCommandAt feed the dashboard checklist.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, stopServer, BASE, json, freshTenant, api, adminLibs, sleep } = require('./helpers');

test.before(async () => { await startServer(); });
test.after(async () => { await stopServer(); });

async function fetchPoll(tok) { return fetch(`${BASE}/api/bridge/poll`, { headers: { 'x-bridge-token': tok } }); }

test('enqueue -> poll delivers once (inflight) -> ack deletes', async () => {
  const t = await freshTenant();
  const { firestore, firebase } = adminLibs();
  const send = (text) => api(t.idToken)('/api/command', { method: 'POST', body: JSON.stringify({ text }) });

  await send('ابغى سيارة شرطة');
  const tenant = await firestore.getTenant(t.uid);

  const p1 = await json(await fetchPoll(tenant.bridgeToken));
  assert.equal(p1.status, 200);
  assert.equal(p1.body.commands.length, 1);
  assert.equal(p1.body.commands[0].action, 'spawn_vehicle');
  const id = p1.body.commands[0].id;

  // inflight: an immediate second poll must NOT redeliver
  const p2 = await json(await fetchPoll(tenant.bridgeToken));
  assert.equal(p2.body.commands.length, 0, 'no double delivery');
  const doc = await firebase.db.collection('tenants').doc(t.uid).collection('commands').doc(id).get();
  assert.equal(doc.get('status'), 'inflight');

  const ack = await json(await fetch(`${BASE}/api/bridge/ack`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-bridge-token': tenant.bridgeToken },
    body: JSON.stringify({ ids: [id] }),
  }));
  assert.equal(ack.body.acked, 1);
  assert.equal((await firebase.db.collection('tenants').doc(t.uid).collection('commands').doc(id).get()).exists, false);
});

test('token rotation: old token dies immediately, new one works', async () => {
  const t = await freshTenant();
  const { firestore } = adminLibs();
  const before = (await firestore.getTenant(t.uid)).bridgeToken;
  const rot = await api(t.idToken)('/api/tenant/rotate-bridge-token', { method: 'POST' });
  assert.equal(rot.status, 200);
  const after = rot.body.bridgeToken;
  assert.notEqual(before, after);
  assert.equal((await json(await fetchPoll(before))).status, 401);
  assert.equal((await json(await fetchPoll(after))).status, 200);
});

test('ask mode returns a reply and queues nothing', async () => {
  const t = await freshTenant();
  const res = await api(t.idToken)('/api/command', { method: 'POST', body: JSON.stringify({ text: 'what can you do?', mode: 'ask' }) });
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.reply, 'string');
  assert.ok(!('action' in res.body), 'ask must not carry an action');
  const { firebase } = adminLibs();
  const snap = await firebase.db.collection('tenants').doc(t.uid).collection('commands').get();
  assert.equal(snap.size, 0);
});

test('lastPolledAt: stamped on poll, exposed via tenant/me, throttled to 1 write/min', async () => {
  const t = await freshTenant();
  const { firestore } = adminLibs();
  const me0 = await api(t.idToken)('/api/tenant/me');
  assert.equal(me0.body.tenant.lastPolledAt, null, 'never polled -> null');

  const tenant = await firestore.getTenant(t.uid);
  await fetchPoll(tenant.bridgeToken);
  const me1 = await api(t.idToken)('/api/tenant/me');
  const stamp1 = me1.body.tenant.lastPolledAt;
  assert.ok(typeof stamp1 === 'number' && Date.now() - stamp1 < 15_000, `fresh stamp expected, got ${stamp1}`);

  await sleep(50);
  await fetchPoll(tenant.bridgeToken); // within the 60s window -> no new write
  const me2 = await api(t.idToken)('/api/tenant/me');
  assert.equal(me2.body.tenant.lastPolledAt, stamp1, 'stamp must be throttled (max one write per minute)');
});

test('firstCommandAt: null until the first QUEUED command, then permanent', async () => {
  const t = await freshTenant();
  const send = (text) => api(t.idToken)('/api/command', { method: 'POST', body: JSON.stringify({ text }) });

  assert.equal((await api(t.idToken)('/api/tenant/me')).body.tenant.firstCommandAt, null);

  await send('كم الساعة في طوكيو'); // none -> NOT a queued command
  assert.equal((await api(t.idToken)('/api/tenant/me')).body.tenant.firstCommandAt, null, 'none must not count');

  await send('عالجني'); // queued
  const first = (await api(t.idToken)('/api/tenant/me')).body.tenant.firstCommandAt;
  assert.ok(typeof first === 'number' && Date.now() - first < 15_000);

  await sleep(30);
  await send('make it rain');
  assert.equal((await api(t.idToken)('/api/tenant/me')).body.tenant.firstCommandAt, first, 'first stamp is permanent');
});
