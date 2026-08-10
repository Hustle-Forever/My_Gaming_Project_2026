// POST /api/tenant/key - store the customer's AI provider key, AES-256-GCM
// encrypted, server-side only. The key is never echoed back and never logged.
const { requireUser } = require('../../lib/auth');
const { getTenant, updateTenant } = require('../../lib/firestore');
const { encryptSecret } = require('../../lib/crypto');
const { readJson, applyCors } = require('../../lib/http');

const PROVIDERS = ['gemini', 'claude'];

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const user = await requireUser(req);
  if (!user) return res.status(401).json({ error: 'invalid or missing ID token' });
  const tenant = await getTenant(user.uid);
  if (!tenant) return res.status(404).json({ error: 'no tenant for this account' });

  const body = await readJson(req);
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const provider = PROVIDERS.includes(body.provider) ? body.provider : tenant.provider || 'gemini';
  if (apiKey.length < 10 || apiKey.length > 300) {
    return res.status(400).json({ error: 'apiKey must be 10-300 characters' });
  }

  await updateTenant(user.uid, { providerKeyEnc: encryptSecret(apiKey), provider });
  console.log(`[tenant] ${user.uid} stored a ${provider} key (encrypted)`);
  res.status(200).json({ ok: true, provider, hasKey: true });
};
