// lib/whitelist/apply.js - shared server-side helpers for the PUBLIC applicant
// endpoints: resume-token hashing, identity hashing/validation, and loading a
// tenant's whitelist context by slug. Public endpoints are unauthenticated, so
// these keep the surface tight.
const crypto = require('crypto');

function newResumeToken() { return 'apt_' + crypto.randomBytes(24).toString('hex'); }
function hashToken(token) { return crypto.createHash('sha256').update(String(token)).digest('hex'); }

// stable hash of the applicant identity (for one-per-identity), tenant-scoped
function identityHash(uid, identity) {
  const norm = Object.keys(identity || {}).sort().map((k) => `${k}=${String(identity[k]).trim().toLowerCase()}`).join('&');
  return crypto.createHash('sha256').update(uid + '|' + norm).digest('hex').slice(0, 40);
}

// Validate the submitted identity against the tenant's configured fields.
// Returns { ok, identity } (only configured keys kept) or { ok:false, error }.
function cleanIdentity(fields, submitted) {
  const out = {};
  submitted = submitted || {};
  for (const f of fields) {
    const v = String(submitted[f.key] == null ? '' : submitted[f.key]).trim().slice(0, 80);
    if (f.required && !v) return { ok: false, error: `${f.key} is required` };
    if (v) out[f.key] = v;
  }
  if (!Object.keys(out).length) return { ok: false, error: 'identity is required' };
  return { ok: true, identity: out };
}

module.exports = { newResumeToken, hashToken, identityHash, cleanIdentity };
