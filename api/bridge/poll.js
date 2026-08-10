// GET /api/bridge/poll - the FiveM bridge pulls pending commands.
// Auth: x-bridge-token. Pay-gate: an inactive tenant's bridge gets 402 and
// nothing runs.
const { requireBridgeTenant } = require('../../lib/auth');
const { drainCommands } = require('../../lib/firestore');
const { applyCors } = require('../../lib/http');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });

  const tenant = await requireBridgeTenant(req);
  if (!tenant) return res.status(401).json({ error: 'invalid bridge token' });
  if (!tenant.active) return res.status(402).json({ error: 'subscription inactive' });

  const commands = await drainCommands(tenant.id);
  if (commands.length) {
    console.log(`[bridge] ${tenant.id} pulled ${commands.length} command(s): ${commands.map((c) => `${c.id}:${c.action}`).join(', ')}`);
  }
  res.status(200).json({ commands });
};
