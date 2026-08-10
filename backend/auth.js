// auth.js - tenant lookup by bridge token + app-side shared-secret check.
// Tenants live in config/tenants.json (no secrets); each record names the env
// vars holding its real bridge token and Claude API key. That indirection is
// the multi-tenant seam: later these resolve from a DB row, code unchanged.
const crypto = require('crypto');
const tenantsConfig = require('./config/tenants.json');

// Constant-time string compare. Hashing both sides first means lengths always
// match, so timingSafeEqual never throws and never leaks length information.
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Overlay the secrets from env onto the committed tenant record.
function resolveTenant(record) {
  return {
    ...record,
    bridgeToken: process.env[record.bridgeTokenEnv] || null,
    apiKey: process.env[record.apiKeyEnv] || null,
  };
}

function getTenant(tenantId) {
  const record = tenantsConfig[tenantId];
  return record ? resolveTenant(record) : null;
}

function tenantByBridgeToken(token) {
  if (!token) return null;
  for (const id of Object.keys(tenantsConfig)) {
    const tenant = resolveTenant(tenantsConfig[id]);
    if (tenant.bridgeToken && safeEqual(token, tenant.bridgeToken)) return tenant;
  }
  return null;
}

function checkAppSecret(secret) {
  const expected = process.env.APP_SECRET;
  return Boolean(expected && secret && safeEqual(secret, expected));
}

module.exports = { getTenant, tenantByBridgeToken, checkAppSecret };
