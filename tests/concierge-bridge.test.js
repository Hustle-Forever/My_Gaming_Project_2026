// M5: bridge integration. The FiveM bridge posts player events and receives
// only closed-set actions back; sessions persist; returning players aren't
// re-onboarded; and the concierge Lua has no write/spawn/teleport primitive.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { startServer, stopServer, BASE, json, freshTenant, api, adminLibs } = require('./helpers');

test.before(async () => { await startServer(); });
test.after(async () => { await stopServer(); });

const CLOSED = new Set(['send_message', 'set_waypoint', 'show_menu']);

async function enabledTenant() {
  const t = await freshTenant();
  await api(t.idToken)('/api/concierge/config', { method: 'POST', body: JSON.stringify({ enabled: true, checkinSeconds: 60 }) });
  const { firestore } = adminLibs();
  const tenant = await firestore.getTenant(t.uid);
  return { ...t, bridgeToken: tenant.bridgeToken };
}
const bridge = async (token, body) => json(await fetch(`${BASE}/api/concierge/event`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-bridge-token': token }, body: JSON.stringify(body),
}));
const poll = async (token, body) => json(await fetch(`${BASE}/api/concierge/reply`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-bridge-token': token }, body: JSON.stringify(body),
}));

test('join → greeting; only closed-set actions come back', async () => {
  const t = await enabledTenant();
  const r = await bridge(t.bridgeToken, { type: 'join', playerId: 'steam:1', playerName: 'Ali', language: 'en' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.onboard, true);
  assert.ok(r.body.actions.length >= 1);
  assert.ok(r.body.actions.every((a) => CLOSED.has(a.type)), JSON.stringify(r.body.actions));
  assert.ok(r.body.actions.some((a) => a.type === 'send_message'), 'a greeting is sent');

  const { firestore } = adminLibs();
  const s = await firestore.getConciergeSession(t.uid, 'steam:1');
  assert.equal(s.status, 'in_progress');
});

test('choice → waypoint + guidance (closed set)', async () => {
  const t = await enabledTenant();
  await bridge(t.bridgeToken, { type: 'join', playerId: 'steam:2', playerName: 'Sara', language: 'en' });
  const r = await bridge(t.bridgeToken, { type: 'choice', playerId: 'steam:2', jobId: 'police' });
  assert.equal(r.status, 200);
  assert.ok(r.body.actions.every((a) => CLOSED.has(a.type)));
  assert.ok(r.body.actions.some((a) => a.type === 'set_waypoint'), 'a waypoint is set');
});

test('dismiss stops everything; further events return no actions', async () => {
  const t = await enabledTenant();
  await bridge(t.bridgeToken, { type: 'join', playerId: 'steam:3', language: 'en' });
  const d = await bridge(t.bridgeToken, { type: 'dismiss', playerId: 'steam:3' });
  assert.equal(d.status, 200);
  const after = await bridge(t.bridgeToken, { type: 'choice', playerId: 'steam:3', jobId: 'police' });
  assert.deepEqual(after.body.actions, [], 'dismissed player gets nothing');
  const { firestore } = adminLibs();
  assert.equal((await firestore.getConciergeSession(t.uid, 'steam:3')).status, 'dismissed');
});

test('a returning (completed) player is NOT re-onboarded', async () => {
  const t = await enabledTenant();
  const { firestore } = adminLibs();
  await firestore.setConciergeSession(t.uid, 'steam:4', { status: 'done', updatedAtMs: Date.now(), arrivedAtMs: Date.now() });
  const r = await bridge(t.bridgeToken, { type: 'join', playerId: 'steam:4', language: 'en' });
  assert.equal(r.body.onboard, false, 'completed player is left alone');
  assert.deepEqual(r.body.actions, []);
});

test('Arabic join greets in Arabic', async () => {
  const t = await enabledTenant();
  const r = await bridge(t.bridgeToken, { type: 'join', playerId: 'steam:5', language: 'ar' });
  const msg = r.body.actions.find((a) => a.type === 'send_message');
  assert.match(msg.text, /[؀-ۿ]/);
});

test('reply poll delivers the check-in once it is due', async () => {
  const t = await enabledTenant();
  await bridge(t.bridgeToken, { type: 'join', playerId: 'steam:6', language: 'en' });
  await bridge(t.bridgeToken, { type: 'choice', playerId: 'steam:6', jobId: 'police' });
  const { firestore } = adminLibs();
  // fast-forward: put the session at await_checkin with a stale timer
  const s = await firestore.getConciergeSession(t.uid, 'steam:6');
  await firestore.setConciergeSession(t.uid, 'steam:6', { ...s, phase: 'await_checkin', lastPhaseAtMs: Date.now() - 120000 });
  const p = await poll(t.bridgeToken, { playerId: 'steam:6' });
  assert.equal(p.status, 200);
  assert.ok(p.body.actions.some((a) => a.type === 'send_message'), 'check-in message delivered');
});

test('bridge auth + gate: wrong token 401, disabled concierge ignored, inactive 402', async () => {
  const t = await enabledTenant();
  assert.equal((await bridge('brg_wrong', { type: 'join', playerId: 'x' })).status, 401);

  const off = await freshTenant();
  const { firestore } = adminLibs();
  const offTenant = await firestore.getTenant(off.uid);
  const r = await bridge(offTenant.bridgeToken, { type: 'join', playerId: 'y', language: 'en' });
  assert.equal(r.body.onboard, false, 'disabled concierge does nothing');

  await firestore.updateTenant(t.uid, { active: false });
  assert.equal((await bridge(t.bridgeToken, { type: 'join', playerId: 'z' })).status, 402);
});

test('BRIDGE LUA is read/notify-only: no write/spawn/teleport/give primitives', () => {
  const file = path.join(__dirname, '..', 'fivem-bridge', 'concierge.lua');
  assert.ok(fs.existsSync(file), 'concierge.lua exists');
  const stripLua = (s) => s.replace(/--\[\[[\s\S]*?\]\]/g, ' ').replace(/--[^\n]*/g, ' ');
  const src = stripLua(fs.readFileSync(file, 'utf8'));
  for (const re of [
    /\bSaveResourceFile\b/, /\bos\.execute\b/, /\bio\.open\b/,
    /GiveMoney|AddMoney|addAccountMoney|AddItem|giveItem/i,
    /SetEntityCoords|SetPlayerRoutingBucket|CreateVehicle|CreatePed|SpawnPed/i,
    /DropPlayer|deferrals|setJob|SetJob/i,
  ]) {
    assert.ok(!re.test(src), `concierge.lua must not contain ${re}`);
  }
  // it MUST use the allowed display/waypoint APIs
  assert.match(src, /SetNewWaypoint|chatMessage|TriggerClientEvent/);
});
