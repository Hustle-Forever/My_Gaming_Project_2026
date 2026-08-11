// POST /api/whitelist/test-webhook - verify a Discord webhook from the
// dashboard "test send" button. { url } -> posts a hello message and reports
// success/failure. Verified auth + pay-gate; does not persist the URL.
const { requireVerifiedUser } = require('../../lib/auth');
const { getTenant } = require('../../lib/firestore');
const { testSend } = require('../../lib/notify/discord');
const { endpoint, readJson, sendErr } = require('../../lib/http');

module.exports = endpoint(['POST'], async (req, res) => {
  const user = await requireVerifiedUser(req, res);
  if (!user) return;
  const tenant = await getTenant(user.uid);
  if (!tenant) return sendErr(res, 404, 'NOT_FOUND', 'no tenant for this account');
  if (!tenant.active) return sendErr(res, 402, 'PLAN_INACTIVE', 'subscription inactive');

  const body = await readJson(req);
  const url = String(body.url || '');
  if (!/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(url)) {
    return sendErr(res, 400, 'BAD_INPUT', 'not a valid Discord webhook URL');
  }
  const r = await testSend(url);
  return res.status(200).json({ ok: true, delivered: !!r.ok });
});
