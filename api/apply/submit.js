// POST /api/apply/submit - PUBLIC. { appId, resumeToken } -> finalize.
// Runs the scoring engine (provider brain or offline fallback), stores scores/
// flags/summary/recommendation, sets status (auto-approve/reject only if the
// owner enabled thresholds AND confidence is high AND no blocking flag), and
// notifies Discord if configured. Resume-token protected.
const { getTenant, getWhitelistConfig, updateApplication } = require('../../lib/firestore');
const { scoreApplication } = require('../../lib/whitelist/score');
const { makeBrain } = require('../../lib/whitelist/brain');
const { loadSession } = require('../../lib/whitelist/session');
const { notifyNewApplication } = require('../../lib/notify/discord');
const { endpoint, readJson, sendErr } = require('../../lib/http');

module.exports = endpoint(['POST'], async (req, res, { log }) => {
  const body = await readJson(req);
  const s = await loadSession(body.appId, body.resumeToken);
  if (!s.ok) return sendErr(res, s.status, s.code, s.message);
  if (s.app.status !== 'in_progress') return sendErr(res, 409, 'ALREADY_APPLIED', 'this application is already submitted');

  const tenant = await getTenant(s.uid);
  const config = await getWhitelistConfig(s.uid, tenant && tenant.name);

  const brain = makeBrain(tenant);
  const scored = await scoreApplication(
    { criteria: config.criteria, transcript: s.app.transcript, config },
    brain
  );
  if (!scored.ok) {
    // never trap the applicant on a scoring failure - store for human review
    log('error', { msg: 'scoring failed', uid: s.uid, appId: body.appId, err: scored.error });
    await updateApplication(s.uid, body.appId, { status: 'submitted', scores: [], flags: [{ type: 'scoring_error' }], summary: 'Automated scoring failed — please review the transcript.', recommendation: 'review' });
    return res.status(200).json({ ok: true, status: 'submitted' });
  }

  const r = scored.result;
  const status = r.autoDecision === 'approve' ? 'approved' : r.autoDecision === 'reject' ? 'rejected' : 'submitted';
  await updateApplication(s.uid, body.appId, {
    status,
    scores: r.scores,
    flags: r.flags,
    summary: r.summary,
    recommendation: r.recommendation,
    overall: r.overall,
    confidence: r.confidence,
    autoDecision: r.autoDecision || null,
    submittedAtMs: Date.now(),
  });
  log('log', { msg: 'application submitted', uid: s.uid, appId: body.appId, overall: r.overall, status });

  // fire-and-forget Discord notification (never blocks the applicant)
  notifyNewApplication(config, { appId: body.appId, identity: s.app.identity, overall: r.overall, summary: r.summary, status }).catch(() => {});

  return res.status(200).json({ ok: true, status, overall: r.overall });
});
