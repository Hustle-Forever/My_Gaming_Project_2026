// POST /api/scan - run a read-only server scan for the authenticated tenant.
// Auth (verified email) + pay-gate + per-tenant rate limit. Body:
//   { source: 'upload', pack: { files: [{ path, content?, size }] } }
// The pack is built client-side from the owner's chosen resources/ folder
// (text files only; the browser never uploads binary streams). The scan runs
// server-side through the same read-only adapter/scanner as the tests, and
// only the DERIVED report is stored - never raw source.
const { requireVerifiedUser } = require('../lib/auth');
const { getTenant, allowScan, createScan } = require('../lib/firestore');
const { endpoint, readJson, sendErr, HttpError } = require('../lib/http');
const access = require('../lib/serverAccess');
const { scan } = require('../lib/scanner');

module.exports = endpoint(['POST'], async (req, res, { log }) => {
  const user = await requireVerifiedUser(req, res);
  if (!user) return;
  const tenant = await getTenant(user.uid);
  if (!tenant) return sendErr(res, 404, 'NOT_FOUND', 'no tenant for this account');
  if (!tenant.active) return sendErr(res, 402, 'PLAN_INACTIVE', 'subscription inactive');

  const limit = Math.max(1, Number(process.env.SCAN_RATE_LIMIT_PER_HOUR) || 20);
  if (!(await allowScan(tenant.id, limit))) {
    return sendErr(res, 429, 'RATE_LIMITED', `scan limit reached - max ${limit} per hour`);
  }

  const body = await readJson(req);
  const source = body.source === 'bridge' ? 'bridge' : 'upload';
  if (!body.pack || !Array.isArray(body.pack.files)) {
    return sendErr(res, 400, 'BAD_INPUT', 'a scan pack with a files array is required');
  }

  let adapter;
  try {
    adapter = access.fromScanPack(body.pack);
  } catch (err) {
    if (err.code === 'LIMIT_EXCEEDED') return sendErr(res, 413, 'PAYLOAD_TOO_LARGE', 'server too large for a single scan');
    return sendErr(res, 400, 'BAD_INPUT', 'could not read the uploaded server');
  }

  // read-only scan; adapter is destroyed inside scan()
  const report = scan(adapter, { destroyAdapter: true });
  const scanId = await createScan(tenant.id, report, { source });
  log('log', { msg: 'scan complete', uid: tenant.id, scanId, score: report.health.score, findings: report.findings.length });

  return res.status(200).json({
    ok: true,
    scanId,
    status: 'complete',
    health: report.health,
    identity: report.identity,
    findingCount: report.findings.length,
  });
});
