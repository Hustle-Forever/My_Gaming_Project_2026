// The pay-gate MECHANISM stays intact even though signup is open access:
// deactivation blocks command + poll with 402, reactivation restores both,
// deactivation re-blocks, and ack stays un-gated so in-flight commands settle.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, stopServer, BASE, json, freshTenant, api, adminLibs } = require('./helpers');

test.before(async () => { await startServer(); });
test.after(async () => { await stopServer(); });

test('deactivate -> 402; reactivate -> works; deactivate -> re-blocked; ack un-gated', async () => {
  const t = await freshTenant();
  const { firestore } = adminLibs();
  const send = () => api(t.idToken)('/api/command', { method: 'POST', body: JSON.stringify({ text: 'عالجني' }) });
  const bridge = async () => {
    const tenant = await firestore.getTenant(t.uid);
    return json(await fetch(`${BASE}/api/bridge/poll`, { headers: { 'x-bridge-token': tenant.bridgeToken } }));
  };

  // active on signup -> queue one command and poll it inflight (for the ack check)
  const first = await send();
  assert.equal(first.status, 200);
  assert.equal(first.body.queued, true);
  const pulled = await bridge();
  assert.equal(pulled.status, 200);
  assert.equal(pulled.body.commands.length, 1);
  const cmdId = pulled.body.commands[0].id;

  // deactivate -> both gated
  await firestore.updateTenant(t.uid, { active: false });
  assert.equal((await send()).status, 402);
  assert.equal((await bridge()).status, 402);

  // ...but ack still settles the in-flight command
  const tenant = await firestore.getTenant(t.uid);
  const ack = await json(await fetch(`${BASE}/api/bridge/ack`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-bridge-token': tenant.bridgeToken },
    body: JSON.stringify({ ids: [cmdId] }),
  }));
  assert.equal(ack.status, 200);
  assert.equal(ack.body.acked, 1);

  // reactivate -> both work again
  await firestore.updateTenant(t.uid, { active: true });
  assert.equal((await send()).status, 200);
  assert.equal((await bridge()).status, 200);

  // deactivate again -> re-blocked
  await firestore.updateTenant(t.uid, { active: false });
  assert.equal((await send()).status, 402);
  assert.equal((await bridge()).status, 402);
});
