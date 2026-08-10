// smoke-test.js - end-to-end self-test of the whole pipe WITHOUT FiveM.
// Spawns the backend and the mock bridge as child processes with a controlled
// environment, then verifies:
//   1. Arabic command -> spawn_vehicle{police}, queued
//   2. the mock bridge receives AND acks that command within ~3s
//   3. an unauthorized bridge token gets a 401
//   4. a nonsense request -> action "none", nothing queued
// If DEMO_ANTHROPIC_API_KEY is set (in the shell or backend/.env), the backend
// interprets with live Claude; otherwise it runs the deterministic stub and
// the test notes that the live Claude step was skipped. Both paths must pass.
require('dotenv').config();
const { spawn } = require('child_process');
const path = require('path');

const PORT = 8791; // separate from the dev default 8787 so a running dev server doesn't clash
const BASE = `http://localhost:${PORT}`;
const APP_SECRET = 'smoke-app-secret';
const BRIDGE_TOKEN = 'smoke-bridge-token';
const API_KEY = process.env.DEMO_ANTHROPIC_API_KEY || '';
const LIVE_CLAUDE = Boolean(API_KEY);

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const childEnv = {
  ...process.env,
  PORT: String(PORT),
  APP_SECRET,
  DEMO_BRIDGE_TOKEN: BRIDGE_TOKEN,
  DEMO_ANTHROPIC_API_KEY: API_KEY,
  BACKEND_URL: BASE,
};

function start(script, name, lines) {
  const child = spawn(process.execPath, [path.join(__dirname, script)], { env: childEnv });
  child.stdout.on('data', (d) => {
    for (const line of d.toString().split('\n')) {
      if (!line.trim()) continue;
      lines.push(line);
      console.log(`   ${name}> ${line}`);
    }
  });
  child.stderr.on('data', (d) => process.stderr.write(`   ${name}! ${d}`));
  return child;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHealth(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return true;
    } catch (_) {}
    await sleep(150);
  }
  return false;
}

async function sendCommand(text) {
  const res = await fetch(`${BASE}/api/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-app-secret': APP_SECRET },
    body: JSON.stringify({ tenantId: 'demo', text }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function waitForBridge(lines, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (lines.some(predicate)) return true;
    await sleep(150);
  }
  return false;
}

(async () => {
  console.log(`\nSmoke test — interpret mode: ${LIVE_CLAUDE ? 'live Claude (BYOK key found)' : 'stub keyword matcher (no DEMO_ANTHROPIC_API_KEY)'}\n`);

  const backendLines = [];
  const bridgeLines = [];
  const backend = start('server.js', 'backend', backendLines);
  const stop = (code) => {
    backend.kill();
    bridge && bridge.kill();
    process.exit(code);
  };
  let bridge = null;

  if (!(await waitForHealth(8000))) {
    check('backend starts and /health responds', false);
    return stop(1);
  }
  check('backend starts and /health responds', true);

  bridge = start('mock-bridge.js', 'bridge', bridgeLines);
  await sleep(400);

  // 1 + 2: the hero command flows all the way through
  const heroTimeout = LIVE_CLAUDE ? 30_000 : 10_000;
  const hero = await sendCommand('ابغى سيارة شرطة');
  check(
    '"ابغى سيارة شرطة" -> spawn_vehicle {model: police}, queued',
    hero.status === 200 &&
      hero.body.ok === true &&
      hero.body.action === 'spawn_vehicle' &&
      hero.body.params && hero.body.params.model === 'police' &&
      hero.body.queued === true,
    `got ${hero.status} ${JSON.stringify(hero.body)}`
  );

  const received = await waitForBridge(
    bridgeLines,
    (l) => l.includes('RECEIVED') && l.includes('spawn_vehicle') && l.includes('police'),
    3000
  );
  check('mock bridge receives the spawn_vehicle command within ~3s', received);

  const receivedLine = bridgeLines.find((l) => l.includes('RECEIVED') && l.includes('spawn_vehicle')) || '';
  const cmdId = (receivedLine.match(/c_[0-9a-f]+/) || [null])[0];
  const acked = await waitForBridge(bridgeLines, (l) => l.includes('ACKED') && (!cmdId || l.includes(cmdId)), 3000);
  check('mock bridge acks that command', acked, cmdId ? `id ${cmdId}` : 'no id parsed');

  // 3: unauthorized bridge token
  const badPoll = await fetch(`${BASE}/bridge/poll`, { headers: { 'x-bridge-token': 'wrong-token' } });
  check('unauthorized bridge token gets 401', badPoll.status === 401, `got ${badPoll.status}`);

  // 4: nonsense request -> none, nothing queued
  const receivedCountBefore = bridgeLines.filter((l) => l.includes('RECEIVED')).length;
  const nonsense = await sendCommand('كم الساعة في طوكيو');
  check(
    '"كم الساعة في طوكيو" -> action none, not queued',
    nonsense.status === 200 && nonsense.body.action === 'none' && nonsense.body.queued === false,
    `got ${nonsense.status} ${JSON.stringify(nonsense.body)}`
  );
  await sleep(2000);
  const receivedCountAfter = bridgeLines.filter((l) => l.includes('RECEIVED')).length;
  check('nothing reached the bridge for the nonsense request', receivedCountAfter === receivedCountBefore);

  // summary
  const failed = results.filter((r) => !r.pass);
  console.log('\n──────────────────────────────────────────');
  console.log(failed.length === 0 ? `✅ SMOKE TEST PASSED (${results.length}/${results.length})` : `❌ SMOKE TEST FAILED (${results.length - failed.length}/${results.length} passed)`);
  if (!LIVE_CLAUDE) {
    console.log('ℹ️  DEMO_ANTHROPIC_API_KEY not set — the pipe was verified end-to-end with the stub interpreter; the live Claude step was skipped. Set the key in backend/.env and re-run to test it.');
  }
  console.log('──────────────────────────────────────────\n');
  stop(failed.length === 0 ? 0 : 1);
})().catch((err) => {
  console.error(`❌ smoke test crashed: ${err.message}`);
  process.exit(1);
});
