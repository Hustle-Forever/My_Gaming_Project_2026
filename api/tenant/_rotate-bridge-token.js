// POST /api/tenant/rotate-bridge-token - generate a fresh bridge token.
// The old token stops working immediately; the customer pastes the new one
// into their server.cfg.
const { requireVerifiedUser } = require('../../lib/auth');
const { getTenant, updateTenant, newBridgeToken } = require('../../lib/firestore');
const { endpoint, sendErr } = require('../../lib/http');

module.exports = endpoint(['POST'], async (req, res, { log }) => {
  const user = await requireVerifiedUser(req, res);
  if (!user) return;
  const tenant = await getTenant(user.uid);
  if (!tenant) return sendErr(res, 404, 'NOT_FOUND', 'no tenant for this account');

  const bridgeToken = newBridgeToken();
  await updateTenant(user.uid, { bridgeToken });
  log('log', { msg: 'bridge token rotated', uid: user.uid });
  res.status(200).json({ ok: true, bridgeToken });
});
