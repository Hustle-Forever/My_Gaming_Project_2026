// GET /api/whitelist/applications - owner review queue + detail.
//   ?appId=..  -> full application (transcript, scores+evidence, flags)
//   (no id)    -> the queue: submitted first, ranked by score, summaries
// Verified auth + pay-gate. Never returns another tenant's data (scoped to uid).
const { requireVerifiedUser } = require('../../lib/auth');
const { getTenant, getApplication, listApplications } = require('../../lib/firestore');
const { endpoint, sendErr } = require('../../lib/http');

const STATUS_RANK = { submitted: 0, reinterview: 1, in_progress: 2, approved: 3, rejected: 4 };

module.exports = endpoint(['GET'], async (req, res) => {
  const user = await requireVerifiedUser(req, res);
  if (!user) return;
  const tenant = await getTenant(user.uid);
  if (!tenant) return sendErr(res, 404, 'NOT_FOUND', 'no tenant for this account');
  if (!tenant.active) return sendErr(res, 402, 'PLAN_INACTIVE', 'subscription inactive');

  const appId = req.query && req.query.appId;
  if (appId) {
    const a = await getApplication(user.uid, String(appId));
    if (!a) return sendErr(res, 404, 'NOT_FOUND', 'no such application');
    return res.status(200).json({ ok: true, application: a });
  }

  const all = await listApplications(user.uid);
  const applications = all
    .filter((a) => a.status !== 'in_progress') // in-flight interviews aren't in the queue yet
    .map((a) => ({
      appId: a.appId, identity: a.identity, language: a.language, status: a.status,
      overall: a.overall || 0, flags: (a.flags || []).map((f) => f.type), summary: a.summary || '',
      recommendation: a.recommendation, createdAtMs: a.createdAtMs, submittedAtMs: a.submittedAtMs,
    }))
    .sort((x, y) => (STATUS_RANK[x.status] - STATUS_RANK[y.status]) || (y.overall - x.overall));
  return res.status(200).json({ ok: true, applications });
});
