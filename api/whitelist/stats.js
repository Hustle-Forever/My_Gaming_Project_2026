// GET /api/whitelist/stats - the numbers that are the sales pitch: received,
// average time-to-decision, approval rate, backlog. Verified auth + pay-gate.
const { requireVerifiedUser } = require('../../lib/auth');
const { getTenant, listApplications } = require('../../lib/firestore');
const { endpoint, sendErr } = require('../../lib/http');

module.exports = endpoint(['GET'], async (req, res) => {
  const user = await requireVerifiedUser(req, res);
  if (!user) return;
  const tenant = await getTenant(user.uid);
  if (!tenant) return sendErr(res, 404, 'NOT_FOUND', 'no tenant for this account');
  if (!tenant.active) return sendErr(res, 402, 'PLAN_INACTIVE', 'subscription inactive');

  const all = await listApplications(user.uid, 1000);
  const decided = all.filter((a) => a.status === 'approved' || a.status === 'rejected');
  const approved = all.filter((a) => a.status === 'approved').length;
  const backlog = all.filter((a) => a.status === 'submitted' || a.status === 'reinterview').length;
  const received = all.filter((a) => a.status !== 'in_progress').length;

  // average time-to-decision (submitted -> decided), in minutes
  const times = decided
    .filter((a) => a.submittedAtMs && a.decidedAtMs && a.decidedAtMs >= a.submittedAtMs)
    .map((a) => (a.decidedAtMs - a.submittedAtMs) / 60000);
  const avgMinutes = times.length ? Math.round(times.reduce((x, y) => x + y, 0) / times.length) : null;

  return res.status(200).json({
    ok: true,
    stats: {
      received,
      backlog,
      decided: decided.length,
      approved,
      approvalRate: decided.length ? Math.round((approved / decided.length) * 100) : 0,
      avgDecisionMinutes: avgMinutes,
    },
  });
});
