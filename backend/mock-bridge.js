// mock-bridge.js - a fake FiveM bridge for local testing WITHOUT FiveM.
// Behaves exactly like the Lua resource: polls /bridge/poll with the tenant's
// bridge token, prints every command it receives, then acks it.
require('dotenv').config();

const BASE = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 8787}`;
const TOKEN = process.env.DEMO_BRIDGE_TOKEN;
const INTERVAL_MS = 1000;

if (!TOKEN) {
  console.error('[mock-bridge] DEMO_BRIDGE_TOKEN is not set (check backend/.env)');
  process.exit(1);
}

async function pollOnce() {
  const res = await fetch(`${BASE}/bridge/poll`, { headers: { 'x-bridge-token': TOKEN } });
  if (!res.ok) throw new Error(`poll failed: HTTP ${res.status}`);
  const { commands } = await res.json();

  for (const cmd of commands) {
    console.log(`[mock-bridge] RECEIVED ${cmd.id} ${cmd.action} ${JSON.stringify(cmd.params)}`);
  }

  if (commands.length) {
    const ids = commands.map((c) => c.id);
    const ackRes = await fetch(`${BASE}/bridge/ack`, {
      method: 'POST',
      headers: { 'x-bridge-token': TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (!ackRes.ok) throw new Error(`ack failed: HTTP ${ackRes.status}`);
    console.log(`[mock-bridge] ACKED ${ids.join(', ')}`);
  }
}

console.log(`[mock-bridge] polling ${BASE}/bridge/poll every ${INTERVAL_MS}ms`);
setInterval(() => {
  pollOnce().catch((err) => console.error(`[mock-bridge] ${err.message}`));
}, INTERVAL_MS);
