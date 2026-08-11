// POST /api/whitelist/decide - the owner's approve / reject / re-interview /
// delete action. { appId, decision, note? }. Records who decided and when.
// Verified auth + pay-gate; scoped to the caller's own applications.
const { requireVerifiedUser } = require('../../lib/auth');
const { getTenant, getWhitelistConfig, getApplication, updateApplication, deleteApplication } = require('../../lib/firestore');
const { notifyDecision } = require('../../lib/notify/discord');
const { endpoint, readJson, sendErr } = require('../../lib/http');

const DECISIONS = { approve: 'approved', reject: 'rejected', reinterview: 'reinterview' };

module.exports = endpoint(['POST'], async (req, res, { log }) => {
  const user = await requireVerifiedUser(req, res);
  if (!user) return;
  const tenant = await getTenant(user.uid);
  if (!tenant) return sendErr(res, 404, 'NOT_FOUND', 'no tenant for this account');
  if (!tenant.active) return sendErr(res, 402, 'PLAN_INACTIVE', 'subscription inactive');

  const body = await readJson(req);
  const appId = String(body.appId || '');
  const decision = String(body.decision || '');
  const note = String(body.note || '').slice(0, 500);

  const app = await getApplication(user.uid, appId);
  if (!app) return sendErr(res, 404, 'NOT_FOUND', 'no such application');

  if (decision === 'delete') {
    await deleteApplication(user.uid, appId);
    log('log', { msg: 'application deleted', uid: user.uid, appId });
    return res.status(200).json({ ok: true, deleted: true });
  }

  const status = DECISIONS[decision];
  if (!status) return sendErr(res, 400, 'BAD_INPUT', 'decision must be approve, reject, reinterview, or delete');

  await updateApplication(user.uid, appId, {
    status,
    decidedBy: user.uid,
    decidedAtMs: Date.now(),
    decisionNote: note || null,
  });
  log('log', { msg: 'application decided', uid: user.uid, appId, decision });

  const config = await getWhitelistConfig(user.uid, tenant.name);
  notifyDecision(config, { identity: app.identity, decision: status, decidedBy: tenant.name || 'admin' }).catch(() => {});

  // on approve/reject, hand back the identifier list the owner can act on
  const identifiers = status === 'approved' ? app.identity : null;
  return res.status(200).json({ ok: true, status, identifiers });
});
