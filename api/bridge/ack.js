// POST /api/bridge/ack - the bridge confirms executed commands; they are
// deleted from the queue. Not pay-gated (per spec the gate is on /api/command
// and /api/bridge/poll) so in-flight commands can still be acknowledged.
const { requireBridgeTenant } = require('../../lib/auth');
const { ackCommands } = require('../../lib/firestore');
const { endpoint, readJson, sendErr } = require('../../lib/http');

module.exports = endpoint(['POST'], async (req, res, { log }) => {
  const tenant = await requireBridgeTenant(req);
  if (!tenant) return sendErr(res, 401, 'AUTH_REQUIRED', 'invalid bridge token');

  const body = await readJson(req);
  const acked = await ackCommands(tenant.id, body.ids);
  if (acked) log('log', { msg: 'bridge acked', uid: tenant.id, count: acked });
  res.status(200).json({ ok: true, acked });
});
