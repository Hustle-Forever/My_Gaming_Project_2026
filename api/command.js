// POST /api/command - the app-facing runtime.
// Verify ID token -> load tenant -> PAY-GATE (402 if !active) -> per-tenant
// rate limit (429) -> ask mode: short text reply / run mode: interpret with
// the tenant's decrypted key, re-validate against the whitelist, queue for
// the bridge. First successful queue stamps firstCommandAt (setup checklist).
const actions = require('../backend/actions');
const { requireUser } = require('../lib/auth');
const { getTenant, enqueueCommand, allowCommand, updateTenant } = require('../lib/firestore');
const { decryptSecret } = require('../lib/crypto');
const providers = require('../providers');
const { endpoint, readJson, sendErr } = require('../lib/http');

const MAX_TEXT = 300;

module.exports = endpoint(['POST'], async (req, res, { log }) => {
  const user = await requireUser(req);
  if (!user) return sendErr(res, 401, 'AUTH_REQUIRED', 'invalid or missing ID token');

  const tenant = await getTenant(user.uid);
  if (!tenant) return sendErr(res, 404, 'NOT_FOUND', 'no tenant for this account');
  if (!tenant.active) return sendErr(res, 402, 'PLAN_INACTIVE', 'subscription inactive');

  const body = await readJson(req);
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const mode = body.mode === 'ask' ? 'ask' : 'run';
  if (!text || text.length > MAX_TEXT) {
    return sendErr(res, 400, 'BAD_INPUT', `text must be 1-${MAX_TEXT} characters`);
  }

  const limit = Number(process.env.RATE_LIMIT_PER_MIN || 30);
  if (!(await allowCommand(tenant.id, limit))) {
    log('log', { msg: 'rate limited', uid: tenant.id });
    return sendErr(res, 429, 'RATE_LIMITED', `rate limit exceeded - max ${limit} commands per minute`);
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

  if (mode === 'ask') {
    const reply = await providers.askText(tenant, apiKey, text);
    log('log', { msg: 'ask', uid: tenant.id, textLen: text.length });
    return res.status(200).json({ ok: true, reply });
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
    return res.status(200).json({ ok: true, action: 'none', queued: false, message: actions.friendlyMessage('none') });
  }

  const cmd = await enqueueCommand(tenant.id, valid.action, valid.params);
  if (!tenant.firstCommandAt) {
    await updateTenant(tenant.id, { firstCommandAt: Date.now() });
  }
  log('log', { msg: 'queued', uid: tenant.id, cmd: cmd.id, action: valid.action, text: text.slice(0, 80) });
  return res.status(200).json({
    ok: true,
    action: valid.action,
    params: valid.params,
    queued: true,
    message: actions.friendlyMessage(valid.action, valid.params),
  });
});
