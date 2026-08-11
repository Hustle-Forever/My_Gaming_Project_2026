// POST /api/tenant/key - store the customer's AI provider key, AES-256-GCM
// encrypted, server-side only. The key is never echoed back and never logged.
const { requireVerifiedUser } = require('../../lib/auth');
const { getTenant, updateTenant } = require('../../lib/firestore');
const { encryptSecret } = require('../../lib/crypto');
const { endpoint, readJson, sendErr } = require('../../lib/http');

const PROVIDERS = ['gemini', 'claude'];

module.exports = endpoint(['POST'], async (req, res, { log }) => {
  const user = await requireVerifiedUser(req, res);
  if (!user) return;
  const tenant = await getTenant(user.uid);
  if (!tenant) return sendErr(res, 404, 'NOT_FOUND', 'no tenant for this account');

  const body = await readJson(req);
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const provider = PROVIDERS.includes(body.provider) ? body.provider : tenant.provider || 'gemini';
  if (apiKey.length < 10 || apiKey.length > 300) {
    return sendErr(res, 400, 'BAD_INPUT', 'apiKey must be 10-300 characters');
  }

  await updateTenant(user.uid, { providerKeyEnc: encryptSecret(apiKey), provider });
  log('log', { msg: 'provider key stored (encrypted)', uid: user.uid, provider });
  res.status(200).json({ ok: true, provider, hasKey: true });
});
