// POST /api/command - the app-facing runtime.
// Verify ID token -> load tenant -> PAY-GATE (402 if !active) -> per-tenant
// rate limit (429) -> ask mode: short text reply / run mode: interpret with
// the tenant's decrypted key, re-validate against the whitelist, queue for
// the bridge. First successful queue stamps firstCommandAt (setup checklist).
const actions = require('../backend/actions');
const { requireVerifiedUser } = require('../lib/auth');
const { getTenantAndCountCommand, enqueueCommand, updateTenant, listScans, getScan } = require('../lib/firestore');
const { decryptSecret } = require('../lib/crypto');
const { detectLanguage } = require('../lib/lang');
const providers = require('../providers');
const { endpoint, readJson, sendErr } = require('../lib/http');

const MAX_TEXT = 300;

// Best-effort: the latest scan's structural model, so Ask can be concrete about
// THIS server ("you're running QBCore with ox_inventory…"). Never fatal.
async function latestServerModel(uid) {
  try {
    const scans = await listScans(uid, 1);
    if (!scans || !scans.length) return undefined;
    const full = await getScan(uid, scans[0].scanId);
    if (!full || !full.identity) return undefined;
    const id = full.identity;
    return {
      framework: id.framework,
      inventory: id.inventory,
      jobs: id.jobs && id.jobs.jobs,
    };
  } catch (_) { return undefined; }
}

module.exports = endpoint(['POST'], async (req, res, { log }) => {
  const user = await requireVerifiedUser(req, res);
  if (!user) return;

  // One transactional read serves the tenant lookup AND the rate-limit count.
  // Math.max + ||30 guard: a typo'd env value (NaN/0/negative) must fall back
  // to the default, never silently disable limiting.
  const limit = Math.max(1, Number(process.env.RATE_LIMIT_PER_MIN) || 30);
  const { tenant, allowed } = await getTenantAndCountCommand(user.uid, limit);
  if (!tenant) return sendErr(res, 404, 'NOT_FOUND', 'no tenant for this account');
  if (!tenant.active) return sendErr(res, 402, 'PLAN_INACTIVE', 'subscription inactive');
  if (!allowed) {
    log('log', { msg: 'rate limited', uid: tenant.id });
    return sendErr(res, 429, 'RATE_LIMITED', `rate limit exceeded - max ${limit} commands per minute`);
  }

  const body = await readJson(req);
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const mode = body.mode === 'ask' ? 'ask' : 'run';
  if (!text || text.length > MAX_TEXT) {
    return sendErr(res, 400, 'BAD_INPUT', `text must be 1-${MAX_TEXT} characters`);
  }

  // Decrypt the tenant's provider key ONLY here, only for this request.
  let apiKey = null;
  if (tenant.providerKeyEnc) {
    try {
      apiKey = decryptSecret(tenant.providerKeyEnc);
    } catch (err) {
      log('error', { msg: 'key decrypt failed', uid: tenant.id, err: err.message });
    }
  }

  // The reply language ALWAYS follows the language the operator wrote in — not
  // any UI toggle. Mixed/ambiguous input falls back to the tenant default.
  const replyLang = detectLanguage(text, tenant.defaultLanguage || 'en');

  if (mode === 'ask') {
    const server = apiKey ? await latestServerModel(tenant.id) : undefined; // concreteness only helps the AI path
    const reply = await providers.askText(tenant, apiKey, text, { language: replyLang, server });
    log('log', { msg: 'ask', uid: tenant.id, textLen: text.length, lang: replyLang });
    return res.status(200).json({ ok: true, reply, lang: replyLang });
  }

  const interpreted = await providers.interpretText(tenant, apiKey, text);

  // Final gate: whitelist + tenant allowlist, no matter where the action came from.
  let valid;
  try {
    valid = actions.validateAction(interpreted.action, interpreted.params, tenant.allowedActions);
  } catch (err) {
    log('log', { msg: 'action rejected', uid: tenant.id, action: String(interpreted.action).slice(0, 40), err: err.message });
    valid = { action: 'none', params: {} };
  }

  if (valid.action === 'none') {
    return res.status(200).json({ ok: true, action: 'none', queued: false, message: actions.friendlyMessage('none', {}, replyLang), lang: replyLang });
  }

  const cmd = await enqueueCommand(tenant.id, valid.action, valid.params);
  if (!tenant.firstCommandAt) {
    await updateTenant(tenant.id, { firstCommandAt: Date.now() });
  }
  log('log', { msg: 'queued', uid: tenant.id, cmd: cmd.id, action: valid.action, text: text.slice(0, 80), lang: replyLang });
  return res.status(200).json({
    ok: true,
    action: valid.action,
    params: valid.params,
    queued: true,
    message: actions.friendlyMessage(valid.action, valid.params, replyLang),
    lang: replyLang,
  });
});
