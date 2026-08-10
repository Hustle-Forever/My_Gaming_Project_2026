// lib/auth.js - the two auth models of the platform.
// App requests carry a Firebase ID token (Authorization: Bearer <token>);
// bridge requests carry the tenant's random bridge token (x-bridge-token).
// Every endpoint verifies one of the two - nothing is open.
const { auth } = require('./firebase');
const { getTenantByBridgeToken } = require('./firestore');

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

// Returns the tenant doc matching x-bridge-token, or null.
async function requireBridgeTenant(req) {
  const token = req.headers['x-bridge-token'];
  if (!token) return null;
  return getTenantByBridgeToken(String(token));
}

module.exports = { requireUser, requireBridgeTenant };
