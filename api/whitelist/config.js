// GET/POST /api/whitelist/config - the owner's Whitelist Officer setup.
// Verified auth + pay-gate + error envelope. GET serves defaults (with an
// assigned stable slug); POST validates and merges a partial patch.
const { requireVerifiedUser } = require('../../lib/auth');
const { getTenant, getWhitelistConfig, setWhitelistConfig } = require('../../lib/firestore');
const { validateConfig } = require('../../lib/whitelist/config');
const { endpoint, readJson, sendErr } = require('../../lib/http');

// strip internal-only fields before returning to the client
function present(config) {
  const { publicView, updatedAt, ...rest } = config;
  return { ...rest, applyPath: `/apply/${config.slug}` };
}

module.exports = endpoint(['GET', 'POST'], async (req, res, { log }) => {
  const user = await requireVerifiedUser(req, res);
  if (!user) return;
  const tenant = await getTenant(user.uid);
  if (!tenant) return sendErr(res, 404, 'NOT_FOUND', 'no tenant for this account');
  if (!tenant.active) return sendErr(res, 402, 'PLAN_INACTIVE', 'subscription inactive');

  if (req.method === 'GET') {
    const config = await getWhitelistConfig(user.uid, tenant.name);
    return res.status(200).json({ ok: true, config: present(config) });
  }

  const body = await readJson(req);
  const v = validateConfig(body);
  if (!v.ok) return sendErr(res, 400, 'BAD_INPUT', v.error);
  await setWhitelistConfig(user.uid, v.config);
  log('log', { msg: 'whitelist config updated', uid: user.uid, keys: Object.keys(v.config) });
  const config = await getWhitelistConfig(user.uid, tenant.name);
  return res.status(200).json({ ok: true, config: present(config) });
});
