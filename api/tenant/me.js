// GET /api/tenant/me - the tenant doc for the signed-in customer,
// WITHOUT providerKeyEnc. The key never leaves the server.
const { requireUser } = require('../../lib/auth');
const { getTenant } = require('../../lib/firestore');
const { applyCors } = require('../../lib/http');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });

  const user = await requireUser(req);
  if (!user) return res.status(401).json({ error: 'invalid or missing ID token' });

  const tenant = await getTenant(user.uid);
  if (!tenant) return res.status(404).json({ error: 'no tenant for this account' });

  res.status(200).json({
    ok: true,
    tenant: {
      name: tenant.name,
      active: Boolean(tenant.active),
      provider: tenant.provider,
      hasKey: Boolean(tenant.providerKeyEnc),
      bridgeToken: tenant.bridgeToken,
      allowedActions: tenant.allowedActions,
    },
  });
};
