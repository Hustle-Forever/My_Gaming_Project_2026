// GET /api/bridge/poll - the FiveM bridge pulls pending commands.
// Auth: x-bridge-token. Pay-gate: an inactive tenant's bridge gets 402 and
// nothing runs. Each poll refreshes tenants/{uid}.lastPolledAt (throttled to
// one write per minute) so the dashboard can show a live "server connected"
// indicator without a write on every 2.5s poll.
const { requireBridgeTenant } = require('../../lib/auth');
const { drainCommands, updateTenant, stampMs } = require('../../lib/firestore');
const { endpoint, sendErr } = require('../../lib/http');

const POLL_STAMP_MS = 60_000;

module.exports = endpoint(['GET'], async (req, res, { log }) => {
  const tenant = await requireBridgeTenant(req);
  if (!tenant) return sendErr(res, 401, 'AUTH_REQUIRED', 'invalid bridge token');
  if (!tenant.active) return sendErr(res, 402, 'PLAN_INACTIVE', 'subscription inactive');

  // Stamp (when due) and drain concurrently - neither depends on the other,
  // so the once-a-minute liveness write must not delay command delivery.
  const last = stampMs(tenant.lastPolledAt) || 0;
  const stamp = Date.now() - last >= POLL_STAMP_MS
    ? updateTenant(tenant.id, { lastPolledAt: Date.now() })
    : Promise.resolve();
  const [, commands] = await Promise.all([stamp, drainCommands(tenant.id)]);
  if (commands.length) {
    log('log', { msg: 'bridge pulled', uid: tenant.id, count: commands.length, actions: commands.map((c) => c.action) });
  }
  res.status(200).json({ commands });
});
