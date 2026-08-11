// lib/whitelist/session.js - shared loader for the PUBLIC answer/submit/resume
// endpoints: resolve appId -> uid (private index), load the application, and
// verify the resume token. Never exposes the uid to the caller.
const { getApplicationUid, getApplication } = require('../firestore');
const { hashToken } = require('./apply');

// Returns { ok:true, uid, app } or { ok:false, status, code, message }.
async function loadSession(appId, resumeToken) {
  if (!appId || !resumeToken) return fail(400, 'BAD_INPUT', 'appId and resumeToken required');
  const uid = await getApplicationUid(String(appId));
  if (!uid) return fail(404, 'NOT_FOUND', 'no such application');
  const app = await getApplication(uid, String(appId));
  if (!app) return fail(404, 'NOT_FOUND', 'no such application');
  if (app.resumeTokenHash !== hashToken(resumeToken)) return fail(401, 'AUTH_REQUIRED', 'invalid resume token');
  return { ok: true, uid, app };
}
function fail(status, code, message) { return { ok: false, status, code, message }; }

module.exports = { loadSession };
