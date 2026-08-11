// GET /api/scan-status - full result for ?scanId=..., or the tenant's scan
// history (summaries) with no id. Auth (verified) + pay-gate.
const { requireVerifiedUser } = require('../lib/auth');
const { getTenant, getScan, listScans } = require('../lib/firestore');
const { endpoint, sendErr } = require('../lib/http');

const toMs = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : (typeof v === 'number' ? v : null));

module.exports = endpoint(['GET'], async (req, res) => {
  const user = await requireVerifiedUser(req, res);
  if (!user) return;
  const tenant = await getTenant(user.uid);
  if (!tenant) return sendErr(res, 404, 'NOT_FOUND', 'no tenant for this account');
  if (!tenant.active) return sendErr(res, 402, 'PLAN_INACTIVE', 'subscription inactive');

  const scanId = req.query && req.query.scanId;
  if (scanId) {
    const doc = await getScan(tenant.id, String(scanId));
    if (!doc) return sendErr(res, 404, 'NOT_FOUND', 'no such scan');
    return res.status(200).json({
      ok: true,
      scan: {
        scanId: doc.scanId,
        status: doc.status,
        source: doc.source,
        createdAtMs: doc.createdAtMs || toMs(doc.createdAt),
        identity: doc.identity,
        health: doc.health,
        findings: doc.findings,
        model: doc.model,
      },
    });
  }

  const scans = await listScans(tenant.id);
  return res.status(200).json({ ok: true, scans });
});
