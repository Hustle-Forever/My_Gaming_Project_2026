// POST /api/bridge/ack - the bridge confirms executed commands; they are
// deleted from the queue. Not pay-gated (per spec the gate is on /api/command
// and /api/bridge/poll) so in-flight commands can still be acknowledged.
const { requireBridgeTenant } = require('../../lib/auth');
const { ackCommands } = require('../../lib/firestore');
const { readJson, applyCors } = require('../../lib/http');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const tenant = await requireBridgeTenant(req);
  if (!tenant) return res.status(401).json({ error: 'invalid bridge token' });

  const body = await readJson(req);
  const acked = await ackCommands(tenant.id, body.ids);
  if (acked) console.log(`[bridge] ${tenant.id} acked ${acked} command(s)`);
  res.status(200).json({ ok: true, acked });
};
