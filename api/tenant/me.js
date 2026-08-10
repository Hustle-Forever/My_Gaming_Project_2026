// GET /api/tenant/me - the tenant doc for the signed-in customer,
// WITHOUT providerKeyEnc. The key never leaves the server.
// lastPolledAt / firstCommandAt drive the dashboard setup checklist.
const { requireUser } = require('../../lib/auth');
const { getTenant } = require('../../lib/firestore');
const { endpoint, sendErr } = require('../../lib/http');

const toMillis = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : (typeof v === 'number' ? v : null));

module.exports = endpoint(['GET'], async (req, res) => {
  const user = await requireUser(req);
  if (!user) return sendErr(res, 401, 'AUTH_REQUIRED', 'invalid or missing ID token');

  const tenant = await getTenant(user.uid);
  if (!tenant) return sendErr(res, 404, 'NOT_FOUND', 'no tenant for this account');

  res.status(200).json({
    ok: true,
    tenant: {
      name: tenant.name,
      active: Boolean(tenant.active),
      provider: tenant.provider,
      hasKey: Boolean(tenant.providerKeyEnc),
      bridgeToken: tenant.bridgeToken,
      allowedActions: tenant.allowedActions,
      lastPolledAt: toMillis(tenant.lastPolledAt),
      firstCommandAt: toMillis(tenant.firstCommandAt),
    },
  });
});
