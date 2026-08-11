// POST /api/apply/answer - PUBLIC. { appId, resumeToken, text } -> next step.
// Advances the interview state machine; the judge is provider-backed (offline
// heuristic fallback). Resume-token protected.
const { getTenant, getWhitelistConfig, updateApplication } = require('../../lib/firestore');
const { createInterview } = require('../../lib/whitelist/interview');
const { makeJudge } = require('../../lib/whitelist/brain');
const { loadSession } = require('../../lib/whitelist/session');
const { endpoint, readJson, sendErr } = require('../../lib/http');

module.exports = endpoint(['POST'], async (req, res) => {
  const body = await readJson(req);
  const s = await loadSession(body.appId, body.resumeToken);
  if (!s.ok) return sendErr(res, s.status, s.code, s.message);
  if (s.app.status !== 'in_progress') return sendErr(res, 409, 'ALREADY_APPLIED', 'this application is already submitted');

  const tenant = await getTenant(s.uid);
  const config = await getWhitelistConfig(s.uid, tenant && tenant.name);
  const iv = createInterview(config, { restore: s.app.ivState });

  const judge = makeJudge(tenant);
  const step = await iv.answer(String(body.text || ''), judge);

  await updateApplication(s.uid, body.appId, { ivState: iv.serialize(), transcript: iv.transcript() });
  return res.status(200).json({ ok: true, step });
});
