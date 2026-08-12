// POST /api/concierge/event - the FiveM bridge reports a player event
// (join / choice / message / dismiss). Bridge-token auth + pay-gate. Returns
// only closed-set actions for the bridge to display. (Reached via the
// api/concierge/[action].js catch-all.)
const { requireBridgeTenant } = require('../../lib/auth');
const { getConciergeConfig } = require('../../lib/firestore');
const { handleEvent } = require('../../lib/concierge/runtime');
const { endpoint, readJson, sendErr } = require('../../lib/http');

module.exports = endpoint(['POST'], async (req, res, { log }) => {
  const tenant = await requireBridgeTenant(req);
  if (!tenant) return sendErr(res, 401, 'AUTH_REQUIRED', 'invalid bridge token');
  if (!tenant.active) return sendErr(res, 402, 'PLAN_INACTIVE', 'subscription inactive');

  const config = await getConciergeConfig(tenant.id);
  if (!config.enabled) return res.status(200).json({ ok: true, onboard: false, actions: [] });

  const body = await readJson(req);
  const result = await handleEvent(tenant.id, tenant, config, body || {});
  log('log', { msg: 'concierge event', uid: tenant.id, type: body && body.type, onboard: result.onboard, actions: result.actions.length });
  return res.status(200).json({ ok: true, ...result });
});
