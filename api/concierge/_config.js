// GET/POST /api/concierge/config - the owner's Concierge onboarding setup.
// Verified auth + pay-gate + error envelope. (Reached via the
// api/concierge/[action].js catch-all so the whole group is one function.)
const { requireVerifiedUser } = require('../../lib/auth');
const { getTenant, getConciergeConfig, setConciergeConfig } = require('../../lib/firestore');
const { validateConfig } = require('../../lib/concierge/config');
const { endpoint, readJson, sendErr } = require('../../lib/http');

function present(config) {
  const { runtimeView, updatedAt, ...rest } = config;
  return rest;
}

module.exports = endpoint(['GET', 'POST'], async (req, res, { log }) => {
  const user = await requireVerifiedUser(req, res);
  if (!user) return;
  const tenant = await getTenant(user.uid);
  if (!tenant) return sendErr(res, 404, 'NOT_FOUND', 'no tenant for this account');
  if (!tenant.active) return sendErr(res, 402, 'PLAN_INACTIVE', 'subscription inactive');

  if (req.method === 'GET') {
    const config = await getConciergeConfig(user.uid);
    return res.status(200).json({ ok: true, config: present(config) });
  }

  const body = await readJson(req);
  const v = validateConfig(body);
  if (!v.ok) return sendErr(res, 400, 'BAD_INPUT', v.error);
  await setConciergeConfig(user.uid, v.config);
  log('log', { msg: 'concierge config updated', uid: user.uid, keys: Object.keys(v.config) });
  const config = await getConciergeConfig(user.uid);
  return res.status(200).json({ ok: true, config: present(config) });
});
