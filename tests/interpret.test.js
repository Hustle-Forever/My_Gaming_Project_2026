// Interpretation: Arabic + English + diacritics + Arabic-Indic digits map to
// whitelisted actions; out-of-scope -> none and queues NOTHING; and the core
// guarantee - an action outside the whitelist can NEVER be queued, even when
// the provider itself returns one (simulated via the test-only fake provider).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, stopServer, BASE, json, freshTenant, api, adminLibs } = require('./helpers');

test.before(async () => { await startServer(); });
test.after(async () => { await stopServer(); });

async function queueSize(uid) {
  const { firebase } = adminLibs();
  const snap = await firebase.db.collection('tenants').doc(uid).collection('commands').get();
  return snap.size;
}

// Wire a tenant to the test-only fake provider (rogue-AI simulator).
async function fakeProviderTenant() {
  const t = await freshTenant();
  await api(t.idToken)('/api/tenant/key', { method: 'POST', body: JSON.stringify({ apiKey: 'fake-key-0123456789' }) });
  const { firestore } = adminLibs();
  await firestore.updateTenant(t.uid, { provider: 'fake' });
  return t;
}

test('Arabic "ابغى سيارة شرطة" -> spawn_vehicle police, queued', async () => {
  const t = await freshTenant();
  const res = await api(t.idToken)('/api/command', { method: 'POST', body: JSON.stringify({ text: 'ابغى سيارة شرطة' }) });
  assert.equal(res.status, 200);
  assert.equal(res.body.action, 'spawn_vehicle');
  assert.equal(res.body.params.model, 'police');
  assert.equal(res.body.queued, true);
  assert.ok(res.body.message.includes('شرطة'), 'friendly Arabic message');
});

test('English "make it rain" -> set_weather rain', async () => {
  const t = await freshTenant();
  const res = await api(t.idToken)('/api/command', { method: 'POST', body: JSON.stringify({ text: 'make it rain' }) });
  assert.equal(res.body.action, 'set_weather');
  assert.equal(res.body.params.type, 'rain');
  assert.equal(res.body.queued, true);
});

test('diacritics: "صلّح سيارتي" -> repair_vehicle', async () => {
  const t = await freshTenant();
  const res = await api(t.idToken)('/api/command', { method: 'POST', body: JSON.stringify({ text: 'صلّح سيارتي' }) });
  assert.equal(res.body.action, 'repair_vehicle');
  assert.equal(res.body.queued, true);
});

test('Arabic-Indic digits: "خل الساعة ٥" -> set_time 5', async () => {
  const t = await freshTenant();
  const res = await api(t.idToken)('/api/command', { method: 'POST', body: JSON.stringify({ text: 'خل الساعة ٥' }) });
  assert.equal(res.body.action, 'set_time');
  assert.equal(res.body.params.hour, 5);
});

test('out-of-scope question -> none, nothing queued', async () => {
  const t = await freshTenant();
  const res = await api(t.idToken)('/api/command', { method: 'POST', body: JSON.stringify({ text: 'كم الساعة في طوكيو' }) });
  assert.equal(res.status, 200);
  assert.equal(res.body.action, 'none');
  assert.equal(res.body.queued, false);
  assert.equal(await queueSize(t.uid), 0, 'queue must stay empty');
});

test('WHITELIST GUARANTEE: provider returns a non-whitelisted action -> none, queue empty', async () => {
  const t = await fakeProviderTenant();
  const res = await api(t.idToken)('/api/command', { method: 'POST', body: JSON.stringify({ text: 'xxrogue' }) });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.action, 'none', 'rogue action must be neutralized');
  assert.equal(res.body.queued, false);
  assert.equal(await queueSize(t.uid), 0, 'ROGUE ACTION REACHED THE QUEUE - whitelist gate is broken');
});

test('fake-provider control: a valid action from the provider IS queued (proves the simulator is live)', async () => {
  const t = await fakeProviderTenant();
  const res = await api(t.idToken)('/api/command', { method: 'POST', body: JSON.stringify({ text: 'xxvalid' }) });
  assert.equal(res.body.action, 'spawn_vehicle', JSON.stringify(res.body));
  assert.equal(res.body.params.model, 'adder');
  assert.equal(res.body.queued, true);
  assert.equal(await queueSize(t.uid), 1);
});

test('provider returns whitelisted action with ILLEGAL param -> none, queue empty', async () => {
  const t = await fakeProviderTenant();
  const res = await api(t.idToken)('/api/command', { method: 'POST', body: JSON.stringify({ text: 'xxbadparam' }) });
  assert.equal(res.body.action, 'none');
  assert.equal(await queueSize(t.uid), 0, 'illegal param must never be queued');
});

test('action allowed globally but NOT for this tenant -> none, queue empty', async () => {
  const t = await freshTenant();
  const { firestore } = adminLibs();
  await firestore.updateTenant(t.uid, { allowedActions: ['set_weather'] }); // vehicles stripped
  const res = await api(t.idToken)('/api/command', { method: 'POST', body: JSON.stringify({ text: 'ابغى سيارة شرطة' }) });
  assert.equal(res.body.action, 'none');
  assert.equal(await queueSize(t.uid), 0);
});

test('provider outage -> keyword fallback still answers, no internals leaked', async () => {
  const t = await fakeProviderTenant();
  const res = await api(t.idToken)('/api/command', { method: 'POST', body: JSON.stringify({ text: 'xxthrow عالجني' }) });
  assert.equal(res.status, 200);
  assert.equal(res.body.action, 'heal_player', 'fallback interpreter must take over');
  const dump = JSON.stringify(res.body);
  assert.ok(!dump.includes('simulated provider outage'), 'provider internals must not reach the client');
});

test('ask mode during provider outage -> canned reply, 200', async () => {
  const t = await fakeProviderTenant();
  const res = await api(t.idToken)('/api/command', { method: 'POST', body: JSON.stringify({ text: 'xxthrow what can you do', mode: 'ask' }) });
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.reply, 'string');
  assert.ok(res.body.reply.length > 0);
  assert.ok(!res.body.reply.includes('simulated'), 'no internals in reply');
});
