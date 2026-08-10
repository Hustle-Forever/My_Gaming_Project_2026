// server.js - Express wiring: app-facing /api/command, bridge-facing
// /bridge/poll + /bridge/ack, /health, and static hosting of the app/ folder.
require('dotenv').config();
const path = require('path');
const express = require('express');
const auth = require('./auth');
const queue = require('./fivem');
const claude = require('./claude');
const actions = require('./actions');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'app')));

app.get('/health', (req, res) => res.json({ ok: true }));

// --- basic per-IP rate limiting for /api/command ---

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 20;
const hits = new Map(); // ip -> [timestamps]

function rateLimit(req, res, next) {
  const now = Date.now();
  const recent = (hits.get(req.ip) || []).filter((ts) => now - ts < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) {
    return res.status(429).json({ error: 'rate limited - try again in a minute' });
  }
  recent.push(now);
  hits.set(req.ip, recent);
  next();
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, arr] of hits) {
    if (arr.every((ts) => now - ts >= RATE_WINDOW_MS)) hits.delete(ip);
  }
}, RATE_WINDOW_MS).unref();

// --- app-facing route ---

app.post('/api/command', rateLimit, async (req, res) => {
  if (!auth.checkAppSecret(req.get('x-app-secret'))) {
    return res.status(401).json({ error: 'invalid app secret' });
  }

  const { tenantId, text } = req.body || {};
  const tenant = auth.getTenant(String(tenantId || ''));
  if (!tenant) return res.status(400).json({ error: 'unknown tenant' });
  if (typeof text !== 'string' || !text.trim() || text.length > 300) {
    return res.status(400).json({ error: 'text must be a non-empty string of at most 300 characters' });
  }

  let interpreted;
  try {
    interpreted = await claude.interpret(tenant, text.trim());
  } catch (err) {
    console.error(`[api] interpret failed: ${err.message}`);
    interpreted = { action: 'none', params: {} };
  }

  // Final gate: whitelist + tenant allowlist. Every action passes through
  // here no matter where it came from. Anything unclean becomes "none".
  let valid;
  try {
    valid = actions.validateAction(interpreted.action, interpreted.params, tenant.allowedActions);
  } catch (err) {
    console.warn(`[api] rejected action "${interpreted.action}": ${err.message}`);
    valid = { action: 'none', params: {} };
  }

  if (valid.action === 'none') {
    console.log(`[api] ${tenant.id} "${text.trim()}" -> none`);
    return res.json({ ok: true, action: 'none', queued: false, message: actions.friendlyMessage('none') });
  }

  const cmd = queue.enqueue(tenant.id, valid);
  console.log(`[api] ${tenant.id} "${text.trim()}" -> ${cmd.id} ${valid.action} ${JSON.stringify(valid.params)}`);
  res.json({
    ok: true,
    action: valid.action,
    params: valid.params,
    queued: true,
    message: actions.friendlyMessage(valid.action, valid.params),
  });
});

// --- bridge-facing routes (authenticated by per-tenant bridge token) ---

function bridgeAuth(req, res, next) {
  const tenant = auth.tenantByBridgeToken(req.get('x-bridge-token'));
  if (!tenant) return res.status(401).json({ error: 'invalid bridge token' });
  req.tenant = tenant;
  next();
}

// Both path forms are served: the platform bridge resource polls /api/bridge/*
// while the original demo mock-bridge uses /bridge/*.
app.get(['/bridge/poll', '/api/bridge/poll'], bridgeAuth, (req, res) => {
  const commands = queue.drain(req.tenant.id);
  if (commands.length) {
    console.log(`[bridge] ${req.tenant.id} pulled ${commands.length} command(s): ${commands.map((c) => `${c.id}:${c.action}`).join(', ')}`);
  }
  res.json({ commands });
});

app.post(['/bridge/ack', '/api/bridge/ack'], bridgeAuth, (req, res) => {
  const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids : [];
  const acked = queue.ack(req.tenant.id, ids);
  if (acked) console.log(`[bridge] ${req.tenant.id} acked ${acked} command(s): ${ids.join(', ')}`);
  res.json({ ok: true, acked });
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => {
  console.log(`[backend] listening on http://localhost:${PORT}`);
  console.log(`[backend] app UI:    http://localhost:${PORT}/`);
  console.log(`[backend] interpret: ${process.env.DEMO_ANTHROPIC_API_KEY ? 'Claude (BYOK)' : 'stub keyword matcher (no DEMO_ANTHROPIC_API_KEY set)'}`);
});
