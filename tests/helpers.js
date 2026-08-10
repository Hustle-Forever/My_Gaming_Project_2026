// tests/helpers.js - shared plumbing for the suite. Boots ONE dev-server for
// the whole `node --test` run (all test files share it), talks to the Firebase
// emulators that `firebase emulators:exec` already started, and hands each
// test file fresh users/tenants so files never step on each other.
require('dotenv').config();
const { spawn } = require('child_process');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
// node --test runs each test FILE in its own process; a pid-derived port lets
// every file boot its own dev-server without collisions.
const PORT = Number(process.env.TEST_PORT || 3400 + (process.pid % 1000));
const BASE = `http://localhost:${PORT}`;
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('tests must run via `npm test` (firebase emulators:exec sets the emulator env)');
  process.exit(1);
}
// Deterministic test crypto key + test-mode flags, inherited by the dev-server.
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'a'.repeat(64);
process.env.NODE_ENV = 'test';

let server = null;
let serverExited = null;

// node --test runs each file in its own process by default in some versions;
// to keep one server per PROCESS we start lazily and reuse.
async function startServer(extraEnv = {}) {
  if (server) return BASE;
  server = spawn(process.execPath, [path.join(ROOT, 'scripts', 'dev-server.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'test',
      // ratelimit.test.js passes a small RATE_LIMIT_PER_MIN via extraEnv;
      // everything else runs on the API's default.
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', () => {});
  server.stderr.on('data', (d) => process.stderr.write(`   dev! ${d}`));
  serverExited = new Promise((r) => server.on('exit', r));
  process.on('exit', () => { try { server.kill(); } catch (_) {} });

  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return BASE;
    } catch (_) {}
    await sleep(200);
  }
  throw new Error('dev-server did not become healthy');
}

async function stopServer() {
  if (!server) return;
  server.kill();
  await serverExited;
  server = null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function json(res) {
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => ({})) };
}

// ---- accounts ----
let counter = 0;
function uniqueEmail(tag) {
  counter += 1;
  return `${tag}-${Date.now()}-${counter}-${crypto.randomBytes(3).toString('hex')}@m2.test`;
}

async function signup({ email, password = 'test-pass-123', name = 'Test RP' } = {}) {
  const mail = email || uniqueEmail('user');
  const res = await json(await fetch(`${BASE}/api/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: mail, password, name }),
  }));
  return { ...res, email: mail, password, uid: res.body.uid };
}

// Sign in against the Auth emulator REST API -> ID token + refresh token.
async function signIn(email, password = 'test-pass-123') {
  const res = await json(await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=any`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  ));
  return { idToken: res.body.idToken, refreshToken: res.body.refreshToken };
}

// Exchange a refresh token for a fresh ID token (the "token refresh path").
async function refreshIdToken(refreshToken) {
  const res = await json(await fetch(`http://${AUTH_HOST}/securetoken.googleapis.com/v1/token?key=any`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
  }));
  return res.body.id_token;
}

// One-call convenience: fresh signed-in tenant for a test file.
async function freshTenant(opts = {}) {
  const su = await signup(opts);
  const { idToken, refreshToken } = await signIn(su.email, su.password);
  return { uid: su.uid, email: su.email, password: su.password, idToken, refreshToken };
}

function api(idToken) {
  return async (pathname, opts = {}) => json(await fetch(`${BASE}${pathname}`, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      ...(idToken ? { authorization: `Bearer ${idToken}` } : {}),
      ...(opts.headers || {}),
    },
  }));
}

// Direct Firestore access (admin SDK against the emulator) for arranging
// state the API deliberately refuses to expose (e.g. reading providerKeyEnc,
// flipping `active`, setting provider:'fake').
function adminLibs() {
  return {
    firestore: require(path.join(ROOT, 'lib', 'firestore')),
    crypto: require(path.join(ROOT, 'lib', 'crypto')),
    firebase: require(path.join(ROOT, 'lib', 'firebase')),
  };
}

module.exports = {
  ROOT, BASE, startServer, stopServer, sleep, json,
  uniqueEmail, signup, signIn, refreshIdToken, freshTenant, api, adminLibs,
};
