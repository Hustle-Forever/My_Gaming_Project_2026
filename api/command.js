// POST /api/command - the app-facing runtime.
// Verify ID token -> load tenant -> PAY-GATE (402 if !active) -> ask mode:
// short text reply / run mode: interpret with the tenant's decrypted key,
// re-validate against the whitelist, queue for the bridge.
const actions = require('../backend/actions');
const { requireUser } = require('../lib/auth');
const { getTenant, enqueueCommand } = require('../lib/firestore');
const { decryptSecret } = require('../lib/crypto');
const providers = require('../providers');
const { readJson, applyCors } = require('../lib/http');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const user = await requireUser(req);
  if (!user) return res.status(401).json({ error: 'invalid or missing ID token' });

  const tenant = await getTenant(user.uid);
  if (!tenant) return res.status(404).json({ error: 'no tenant for this account' });
  if (!tenant.active) return res.status(402).json({ error: 'subscription inactive' });

  const body = await readJson(req);
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const mode = body.mode === 'ask' ? 'ask' : 'run';
  if (!text || text.length > 300) {
    return res.status(400).json({ error: 'text must be 1-300 characters' });
  }

  // Decrypt the tenant's provider key ONLY here, only for this request.
  let apiKey = null;
  if (tenant.providerKeyEnc) {
    try {
      apiKey = decryptSecret(tenant.providerKeyEnc);
    } catch (err) {
      console.error(`[command] key decrypt failed for ${tenant.id}: ${err.message}`);
    }
  }

  if (mode === 'ask') {
    const reply = await providers.askText(tenant, apiKey, text);
    return res.status(200).json({ ok: true, reply });
  }

  const interpreted = await providers.interpretText(tenant, apiKey, text);

  // Final gate: whitelist + tenant allowlist, no matter where the action came from.
  let valid;
  try {
    valid = actions.validateAction(interpreted.action, interpreted.params, tenant.allowedActions);
  } catch (err) {
    console.warn(`[command] rejected action "${interpreted.action}": ${err.message}`);
    valid = { action: 'none', params: {} };
  }

  if (valid.action === 'none') {
    return res.status(200).json({ ok: true, action: 'none', queued: false, message: actions.friendlyMessage('none') });
  }

  const cmd = await enqueueCommand(tenant.id, valid.action, valid.params);
  console.log(`[command] ${tenant.id} "${text}" -> ${cmd.id} ${valid.action} ${JSON.stringify(valid.params)}`);
  return res.status(200).json({
    ok: true,
    action: valid.action,
    params: valid.params,
    queued: true,
    message: actions.friendlyMessage(valid.action, valid.params),
  });
};
