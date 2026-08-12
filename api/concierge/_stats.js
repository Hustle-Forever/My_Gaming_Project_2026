// GET /api/concierge/stats - the owner's Concierge funnel + retention summary,
// aggregated from the append-only funnel events. Verified auth + pay-gate.
// (Reached via the api/concierge/[action].js catch-all.)
const { requireVerifiedUser } = require('../../lib/auth');
const { getTenant, listConciergeEvents } = require('../../lib/firestore');
const { aggregate } = require('../../lib/concierge/analytics');
const { endpoint, sendErr } = require('../../lib/http');

module.exports = endpoint(['GET'], async (req, res) => {
  const user = await requireVerifiedUser(req, res);
  if (!user) return;
  const tenant = await getTenant(user.uid);
  if (!tenant) return sendErr(res, 404, 'NOT_FOUND', 'no tenant for this account');
  if (!tenant.active) return sendErr(res, 402, 'PLAN_INACTIVE', 'subscription inactive');

  const events = await listConciergeEvents(user.uid, 5000);
  const stats = aggregate(events);
  return res.status(200).json({ ok: true, stats });
});
