// POST /api/tenant/rotate-bridge-token - generate a fresh bridge token.
// The old token stops working immediately; the customer pastes the new one
// into their server.cfg.
const { requireUser } = require('../../lib/auth');
const { getTenant, updateTenant, newBridgeToken } = require('../../lib/firestore');
const { applyCors } = require('../../lib/http');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const user = await requireUser(req);
  if (!user) return res.status(401).json({ error: 'invalid or missing ID token' });
  const tenant = await getTenant(user.uid);
  if (!tenant) return res.status(404).json({ error: 'no tenant for this account' });

  const bridgeToken = newBridgeToken();
  await updateTenant(user.uid, { bridgeToken });
  console.log(`[tenant] ${user.uid} rotated bridge token`);
  res.status(200).json({ ok: true, bridgeToken });
};
