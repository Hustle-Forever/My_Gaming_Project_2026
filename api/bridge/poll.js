// GET /api/bridge/poll - the FiveM bridge pulls pending commands.
// Auth: x-bridge-token. Pay-gate: an inactive tenant's bridge gets 402 and
// nothing runs. Each poll refreshes tenants/{uid}.lastPolledAt (throttled to
// one write per minute) so the dashboard can show a live "server connected"
// indicator without a write on every 2.5s poll.
const { requireBridgeTenant } = require('../../lib/auth');
const { drainCommands, updateTenant } = require('../../lib/firestore');
const { endpoint, sendErr } = require('../../lib/http');

const POLL_STAMP_MS = 60_000;

module.exports = endpoint(['GET'], async (req, res, { log }) => {
  const tenant = await requireBridgeTenant(req);
  if (!tenant) return sendErr(res, 401, 'AUTH_REQUIRED', 'invalid bridge token');
  if (!tenant.active) return sendErr(res, 402, 'PLAN_INACTIVE', 'subscription inactive');

  const last = tenant.lastPolledAt && typeof tenant.lastPolledAt.toMillis === 'function'
    ? tenant.lastPolledAt.toMillis()
    : Number(tenant.lastPolledAt || 0);
  if (Date.now() - last >= POLL_STAMP_MS) {
    await updateTenant(tenant.id, { lastPolledAt: Date.now() });
  }

  const commands = await drainCommands(tenant.id);
  if (commands.length) {
    log('log', { msg: 'bridge pulled', uid: tenant.id, count: commands.length, actions: commands.map((c) => c.action) });
  }
  res.status(200).json({ commands });
});
