// lib/auth.js - the two auth models of the platform.
// App requests carry a Firebase ID token (Authorization: Bearer <token>);
// bridge requests carry the tenant's random bridge token (x-bridge-token).
// Every endpoint verifies one of the two - nothing is open. Human endpoints
// additionally require a VERIFIED email (the email_verified claim), enforced
// server-side so a client can never skip it.
const { auth } = require('./firebase');
const { getTenantByBridgeToken } = require('./firestore');
const { sendErr } = require('./http');

// Returns the decoded ID token ({ uid, email, ... }) or null.
async function requireUser(req) {
  const header = String(req.headers['authorization'] || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  try {
    return await auth.verifyIdToken(match[1]);
  } catch (_) {
    return null;
  }
}

// The standard prologue for human endpoints: valid token AND verified email.
// Returns the decoded token, or null AFTER writing the 401/403 envelope.
async function requireVerifiedUser(req, res) {
  const user = await requireUser(req);
  if (!user) {
    sendErr(res, 401, 'AUTH_REQUIRED', 'invalid or missing ID token');
    return null;
  }
  if (!user.email_verified) {
    sendErr(res, 403, 'EMAIL_UNVERIFIED', 'verify your email address to continue');
    return null;
  }
  return user;
}

// Returns the tenant doc matching x-bridge-token, or null.
async function requireBridgeTenant(req) {
  const token = req.headers['x-bridge-token'];
  if (!token) return null;
  return getTenantByBridgeToken(String(token));
}

module.exports = { requireUser, requireVerifiedUser, requireBridgeTenant };
