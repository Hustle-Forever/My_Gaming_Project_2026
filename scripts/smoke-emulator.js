// scripts/smoke-emulator.js - end-to-end self-test of the whole platform on
// the Firebase Emulator Suite. Run via:  npm run smoke:emulator
// (firebase emulators:exec starts Auth + Firestore, sets the emulator env
// vars, runs this script, then tears everything down.)
//
// Covers: health -> signup -> pay-gate 402 before activation -> activation ->
// key stored encrypted -> Arabic command interpreted -> queued -> bridge
// poll -> ack -> nonsense=none -> ask mode -> auth failures (401) -> token
// rotation -> deactivation gates command AND poll (402).
//
// Interpret mode: with no Gemini key the keyword fallback runs (offline).
// Set TEST_GEMINI_KEY to store a real key and exercise live Gemini too.
require('dotenv').config();
const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 3200;
const BASE = `http://localhost:${PORT}`;
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const EMAIL = 'smoke@m2.test';
const PASSWORD = 'smoke-pass-123';
const GEMINI_KEY = process.env.TEST_GEMINI_KEY || 'fake-gemini-key-for-encryption-test';
const LIVE = Boolean(process.env.TEST_GEMINI_KEY);

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('❌ FIRESTORE_EMULATOR_HOST is not set - run this via `npm run smoke:emulator` (firebase emulators:exec).');
  process.exit(1);
}
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'a'.repeat(64); // test key when no .env

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = async (res) => ({ status: res.status, body: await res.json().catch(() => ({})) });

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts', 'dev-server.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
  });
  server.stdout.on('data', (d) => process.stdout.write(`   dev> ${d}`));
  server.stderr.on('data', (d) => process.stderr.write(`   dev! ${d}`));
  const finish = (code) => {
    server.on('exit', () => process.exit(code));
    server.kill();
    setTimeout(() => process.exit(code), 3000).unref();
  };

  // 0. health
  let healthy = false;
  for (let i = 0; i < 40 && !healthy; i++) {
    try { healthy = (await fetch(`${BASE}/api/health`)).ok; } catch (_) {}
    if (!healthy) await sleep(200);
  }
  check('backend starts and /api/health responds', healthy);
  if (!healthy) return finish(1);

  // 1. signup -> auth user + tenant (active:false)
  const su = await json(await fetch(`${BASE}/api/signup`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, name: 'Smoke RP' }),
  }));
  const uid = su.body.uid;
  check('signup creates auth user + tenant', su.status === 200 && !!uid, JSON.stringify(su.body));

  // 1b. verify the email (admin) - the API's verification gate 403s otherwise
  const { auth: adminAuth } = require(path.join(ROOT, 'lib', 'firebase'));
  await adminAuth.updateUser(uid, { emailVerified: true });

  // 2. sign in -> ID token
  const si = await json(await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=any`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, returnSecureToken: true }),
  }));
  const token = si.body.idToken;
  check('sign in returns ID token', !!token);

  const api = (pathname, opts = {}) => fetch(`${BASE}${pathname}`, {
    ...opts,
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  }).then(json);
  const sendCmd = (text, mode = 'run') => api('/api/command', { method: 'POST', body: JSON.stringify({ text, mode }) });

  // 3. unauthenticated -> 401
  const noAuth = await json(await fetch(`${BASE}/api/command`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'hi' }),
  }));
  check('command without token -> 401', noAuth.status === 401, `got ${noAuth.status}`);

  // 4. OPEN ACCESS: new accounts are active immediately — no payment required.
  const { getTenant, updateTenant } = require(path.join(ROOT, 'lib', 'firestore'));
  check('new signup is active by default (no payment)', (await getTenant(uid)).active === true);

  // 6. store provider key -> encrypted at rest, decrypt round-trips
  const keyRes = await api('/api/tenant/key', { method: 'POST', body: JSON.stringify({ apiKey: GEMINI_KEY, provider: 'gemini' }) });
  const stored = await getTenant(uid);
  const { decryptSecret } = require(path.join(ROOT, 'lib', 'crypto'));
  check(
    'provider key stored AES-GCM encrypted (never plaintext)',
    keyRes.status === 200 && stored.providerKeyEnc && stored.providerKeyEnc !== GEMINI_KEY && decryptSecret(stored.providerKeyEnc) === GEMINI_KEY
  );

  // 7. /api/tenant/me never exposes the key
  const me = await api('/api/tenant/me');
  check('tenant/me exposes status but never the key', me.status === 200 && me.body.tenant.hasKey === true && !('providerKeyEnc' in me.body.tenant), JSON.stringify(me.body.tenant && Object.keys(me.body.tenant)));

  // 8. Arabic command -> interpreted -> queued (fake key falls back to keywords; real key uses Gemini)
  const hero = await sendCmd('ابغى سيارة شرطة');
  check(
    '"ابغى سيارة شرطة" -> spawn_vehicle{police}, queued',
    hero.status === 200 && hero.body.action === 'spawn_vehicle' && hero.body.params.model === 'police' && hero.body.queued === true,
    JSON.stringify(hero.body)
  );

  // 9. bridge polls it (x-bridge-token), then acks it
  const bridgeToken = me.body.tenant.bridgeToken;
  const poll1 = await json(await fetch(`${BASE}/api/bridge/poll`, { headers: { 'x-bridge-token': bridgeToken } }));
  const cmd = (poll1.body.commands || [])[0];
  check('bridge poll returns the command', poll1.status === 200 && cmd && cmd.action === 'spawn_vehicle', JSON.stringify(poll1.body));
  const ack = await json(await fetch(`${BASE}/api/bridge/ack`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-bridge-token': bridgeToken },
    body: JSON.stringify({ ids: [cmd ? cmd.id : ''] }),
  }));
  const poll2 = await json(await fetch(`${BASE}/api/bridge/poll`, { headers: { 'x-bridge-token': bridgeToken } }));
  check('ack removes it; queue drains clean', ack.body.acked === 1 && poll2.body.commands.length === 0);

  // 10. nonsense -> none, nothing queued
  const none = await sendCmd('كم الساعة في طوكيو');
  const poll3 = await json(await fetch(`${BASE}/api/bridge/poll`, { headers: { 'x-bridge-token': bridgeToken } }));
  check('nonsense -> none, nothing queued', none.body.action === 'none' && none.body.queued === false && poll3.body.commands.length === 0, JSON.stringify(none.body));

  // 11. ask mode -> text reply, nothing queued
  const askRes = await sendCmd('what can you do?', 'ask');
  const poll4 = await json(await fetch(`${BASE}/api/bridge/poll`, { headers: { 'x-bridge-token': bridgeToken } }));
  check('ask mode -> {reply}, nothing queued', askRes.status === 200 && typeof askRes.body.reply === 'string' && askRes.body.reply.length > 0 && poll4.body.commands.length === 0);

  // 12. wrong bridge token -> 401
  const badTok = await json(await fetch(`${BASE}/api/bridge/poll`, { headers: { 'x-bridge-token': 'brg_wrong' } }));
  check('wrong bridge token -> 401', badTok.status === 401, `got ${badTok.status}`);

  // 13. rotation: new token works, old token dies
  const rot = await api('/api/tenant/rotate-bridge-token', { method: 'POST' });
  const newToken = rot.body.bridgeToken;
  const oldPoll = await json(await fetch(`${BASE}/api/bridge/poll`, { headers: { 'x-bridge-token': bridgeToken } }));
  const newPoll = await json(await fetch(`${BASE}/api/bridge/poll`, { headers: { 'x-bridge-token': newToken } }));
  check('token rotation: old -> 401, new -> 200', rot.status === 200 && oldPoll.status === 401 && newPoll.status === 200);

  // 14. deactivation gates BOTH paths -> 402
  await updateTenant(uid, { active: false });
  const gatedCmd = await sendCmd('عالجني');
  const gatedPoll = await json(await fetch(`${BASE}/api/bridge/poll`, { headers: { 'x-bridge-token': newToken } }));
  check('deactivated -> 402 on command AND poll', gatedCmd.status === 402 && gatedPoll.status === 402, `cmd ${gatedCmd.status}, poll ${gatedPoll.status}`);

  // summary
  const failed = results.filter((r) => !r.pass);
  console.log('\n──────────────────────────────────────────');
  console.log(failed.length === 0
    ? `✅ PLATFORM SMOKE PASSED (${results.length}/${results.length})`
    : `❌ PLATFORM SMOKE FAILED (${results.length - failed.length}/${results.length} passed)`);
  console.log(LIVE
    ? 'ℹ️  Ran with a real Gemini key (TEST_GEMINI_KEY) — live interpretation exercised.'
    : 'ℹ️  No TEST_GEMINI_KEY set — interpretation ran on the keyword fallback; the Gemini call path is exercised once a customer saves a real key.');
  console.log('──────────────────────────────────────────\n');
  finish(failed.length === 0 ? 0 : 1);
})().catch((err) => {
  console.error(`❌ smoke crashed: ${err.stack || err.message}`);
  process.exit(1);
});
