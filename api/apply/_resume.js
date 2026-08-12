// GET /api/apply/resume?appId=..&resumeToken=.. - PUBLIC. The current step, so
// a dropped connection doesn't lose progress. Resume-token protected.
const { getTenant, getWhitelistConfig } = require('../../lib/firestore');
const { createInterview } = require('../../lib/whitelist/interview');
const { loadSession } = require('../../lib/whitelist/session');
const { endpoint, sendErr } = require('../../lib/http');

module.exports = endpoint(['GET'], async (req, res) => {
  const q = req.query || {};
  const s = await loadSession(q.appId, q.resumeToken);
  if (!s.ok) return sendErr(res, s.status, s.code, s.message);

  if (s.app.status !== 'in_progress') {
    return res.status(200).json({ ok: true, status: s.app.status, step: { kind: 'done' } });
  }
  const tenant = await getTenant(s.uid);
  const config = await getWhitelistConfig(s.uid, tenant && tenant.name);
  const iv = createInterview(config, { restore: s.app.ivState });
  return res.status(200).json({ ok: true, status: 'in_progress', step: iv.current() });
});
