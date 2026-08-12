// GET /api/apply/config?slug=... - PUBLIC. What the applicant page needs to
// render the welcome + identity fields. Exposes NOTHING about the tenant
// beyond display name + questions + identity fields + languages. Disabled or
// unknown slug -> 404 (indistinguishable, so slugs can't be enumerated for
// "is this a real server").
const { getTenantBySlug, getTenant, getWhitelistConfig } = require('../../lib/firestore');
const { endpoint, sendErr } = require('../../lib/http');

module.exports = endpoint(['GET'], async (req, res) => {
  const slug = req.query && req.query.slug;
  if (!slug) return sendErr(res, 400, 'BAD_INPUT', 'slug required');
  const uid = await getTenantBySlug(String(slug));
  if (!uid) return sendErr(res, 404, 'NOT_FOUND', 'no such application');
  const tenant = await getTenant(uid);
  const config = await getWhitelistConfig(uid, tenant && tenant.name);
  if (!config.enabled || !tenant || !tenant.active) return sendErr(res, 404, 'NOT_FOUND', 'applications are not open');
  return res.status(200).json({ ok: true, config: config.publicView });
});
