// POST /api/apply/start - PUBLIC. Begin (or resume) an application.
// { slug, language, identity:{...} } -> { appId, resumeToken, step }.
// Hard per-IP rate limit; one active application per identity; nothing about
// the tenant beyond questions is returned.
const crypto = require('crypto');
const { getTenantBySlug, getTenant, getWhitelistConfig, findApplicationByIdentity, createApplication, updateApplication, allowApply } = require('../../lib/firestore');
const { createInterview } = require('../../lib/whitelist/interview');
const { newResumeToken, hashToken, identityHash, cleanIdentity } = require('../../lib/whitelist/apply');
const { endpoint, readJson, sendErr } = require('../../lib/http');

module.exports = endpoint(['POST'], async (req, res, { log }) => {
  const body = await readJson(req);
  const uid = await getTenantBySlug(String(body.slug || ''));
  if (!uid) return sendErr(res, 404, 'NOT_FOUND', 'no such application');
  const tenant = await getTenant(uid);
  const config = await getWhitelistConfig(uid, tenant && tenant.name);
  if (!config.enabled || !tenant || !tenant.active) return sendErr(res, 404, 'NOT_FOUND', 'applications are not open');

  // per-IP throttle
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || 'unknown';
  const ipHash = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 32);
  const limit = Math.max(1, Number(process.env.APPLY_RATE_LIMIT_PER_HOUR) || 10);
  if (!(await allowApply(ipHash, limit))) return sendErr(res, 429, 'RATE_LIMITED', 'too many applications from this network - try again later');

  const language = (config.languages || ['en']).includes(body.language) ? body.language : (config.languages || ['en'])[0];
  const ident = cleanIdentity(config.identityFields, body.identity);
  if (!ident.ok) return sendErr(res, 400, 'BAD_INPUT', ident.error);
  const idHash = identityHash(uid, ident.identity);

  // one active application per identity
  const existing = await findApplicationByIdentity(uid, idHash);
  if (existing) {
    if (existing.status !== 'in_progress') return sendErr(res, 409, 'ALREADY_APPLIED', 'you already have an application on file');
    // resume: rotate the token (the applicant restarting proves the identity)
    const token = newResumeToken();
    await updateApplication(uid, existing.appId, { resumeTokenHash: hashToken(token) });
    const iv = createInterview(config, { restore: existing.ivState });
    return res.status(200).json({ ok: true, appId: existing.appId, resumeToken: token, step: iv.current(), resumed: true });
  }

  const iv = createInterview(config, { language });
  const token = newResumeToken();
  const appId = await createApplication(uid, {
    identity: ident.identity,
    identityHash: idHash,
    language,
    slug: config.slug,
    ivState: iv.serialize(),
    transcript: iv.transcript(),
    resumeTokenHash: hashToken(token),
  });
  log('log', { msg: 'application started', uid, appId, language });
  return res.status(200).json({ ok: true, appId, resumeToken: token, step: iv.current() });
});
