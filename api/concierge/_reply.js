// POST /api/concierge/reply - the bridge polls for time-triggered actions (the
// ~5-minute check-in) per active player. Bridge-token auth + pay-gate. Returns
// only closed-set actions.
const { requireBridgeTenant } = require('../../lib/auth');
const { getConciergeConfig } = require('../../lib/firestore');
const { handlePoll } = require('../../lib/concierge/runtime');
const { endpoint, readJson, sendErr } = require('../../lib/http');

module.exports = endpoint(['POST'], async (req, res) => {
  const tenant = await requireBridgeTenant(req);
  if (!tenant) return sendErr(res, 401, 'AUTH_REQUIRED', 'invalid bridge token');
  if (!tenant.active) return sendErr(res, 402, 'PLAN_INACTIVE', 'subscription inactive');

  const config = await getConciergeConfig(tenant.id);
  if (!config.enabled) return res.status(200).json({ ok: true, actions: [] });

  const body = await readJson(req);
  const result = await handlePoll(tenant.id, tenant, config, body || {});
  return res.status(200).json({ ok: true, ...result });
});
