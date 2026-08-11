// M4: the public applicant flow. Unauthenticated but hard-limited; exposes
// nothing about the tenant beyond name + questions; resume-token protected;
// one active application per identity; per-IP rate limited.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, stopServer, BASE, json, freshTenant, api, adminLibs } = require('./helpers');

test.before(async () => { await startServer({ APPLY_RATE_LIMIT_PER_HOUR: '5' }); });
test.after(async () => { await stopServer(); });

// unique per-run IP prefix: rl_apply counters persist in the shared emulator
// across runs inside the 1h window, so fixed IPs would carry stale counts.
const RUN = require('crypto').randomBytes(2);
const ipFor = (n) => `${100 + RUN[0] % 100}.${RUN[1] % 256}.${n}.1`;

async function enabledTenant() {
  const t = await freshTenant();
  await api(t.idToken)('/api/whitelist/config', { method: 'POST', body: JSON.stringify({ enabled: true }) });
  const cfg = (await api(t.idToken)('/api/whitelist/config')).body.config;
  return { ...t, slug: cfg.slug, questionCount: cfg.questions.length };
}

const post = async (path, body, headers = {}) => json(await fetch(`${BASE}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
}));
const get = async (path, headers = {}) => json(await fetch(`${BASE}${path}`, { headers }));

// walk an interview to completion; returns {appId, resumeToken, steps}
async function runInterview(slug, language, ip) {
  const h = { 'x-forwarded-for': ip };
  const start = await post('/api/apply/start', { slug, language, identity: { discord: 'user#' + Math.random().toString(36).slice(2, 7), ingame: 'Ingame' } }, h);
  assert.equal(start.status, 200, JSON.stringify(start.body));
  const { appId, resumeToken } = start.body;
  let step = start.body.step;
  let guard = 0;
  while (step && step.kind !== 'done' && guard++ < 30) {
    const ans = language === 'ar'
      ? 'لعبت رول بلاي جاد لمدة سنتين كمسعف وألتزم بالشخصية دائمًا وأبلغ الإدارة عند المخالفات'
      : 'I roleplayed seriously for two years as a paramedic, I always stay in character, and I report rule breaks to admins';
    const r = await post('/api/apply/answer', { appId, resumeToken, text: ans }, h);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    step = r.body.step;
  }
  return { appId, resumeToken, ip };
}

test('GET apply/config exposes only public info; unknown/disabled slug -> 404', async () => {
  const t = await enabledTenant();
  const c = await get(`/api/apply/config?slug=${t.slug}`);
  assert.equal(c.status, 200);
  assert.ok(c.body.config.serverName && c.body.config.questionCount >= 3);
  const dump = JSON.stringify(c.body);
  assert.ok(!dump.includes(t.uid), 'never leaks the uid');
  assert.ok(!dump.includes('criteria'), 'never leaks scoring criteria');
  assert.ok(!dump.includes('Webhook'), 'never leaks webhooks');

  assert.equal((await get('/api/apply/config?slug=does-not-exist')).status, 404);
});

test('full EN interview: start -> answer -> submit; scored with evidence', async () => {
  const t = await enabledTenant();
  const { appId, resumeToken } = await runInterview(t.slug, 'en', ipFor(1));
  const sub = await post('/api/apply/submit', { appId, resumeToken }, { 'x-forwarded-for': ipFor(1) });
  assert.equal(sub.status, 200, JSON.stringify(sub.body));
  assert.equal(sub.body.status, 'submitted');

  // owner sees it scored with evidence
  const { firestore } = adminLibs();
  const app = await firestore.getApplication(t.uid, appId);
  assert.equal(app.status, 'submitted');
  assert.ok(app.scores.length >= 1);
  assert.ok(app.scores.every((s) => s.evidence), 'every score has evidence');
  assert.ok(app.transcript.length >= 2);
});

test('Arabic interview runs end to end', async () => {
  const t = await enabledTenant();
  const { appId, resumeToken } = await runInterview(t.slug, 'ar', ipFor(2));
  const sub = await post('/api/apply/submit', { appId, resumeToken }, { 'x-forwarded-for': ipFor(2) });
  assert.equal(sub.status, 200);
  const { firestore } = adminLibs();
  const app = await firestore.getApplication(t.uid, appId);
  assert.equal(app.language, 'ar');
});

test('resume after a dropped session returns the current step; wrong token -> 401', async () => {
  const t = await enabledTenant();
  const start = await post('/api/apply/start', { slug: t.slug, language: 'en', identity: { discord: 'resume#1', ingame: 'R' } }, { 'x-forwarded-for': ipFor(3) });
  const { appId, resumeToken } = start.body;
  const resume = await get(`/api/apply/resume?appId=${appId}&resumeToken=${resumeToken}`);
  assert.equal(resume.status, 200);
  assert.ok(resume.body.step && resume.body.step.kind);
  assert.equal((await get(`/api/apply/resume?appId=${appId}&resumeToken=wrong`)).status, 401);
  assert.equal((await post('/api/apply/answer', { appId, resumeToken: 'wrong', text: 'hi there friends' }, { 'x-forwarded-for': ipFor(3) })).status, 401);
});

test('one active application per identity', async () => {
  const t = await enabledTenant();
  const identity = { discord: 'dupe#9', ingame: 'Dupe' };
  const h = { 'x-forwarded-for': ipFor(4) };
  const a = await post('/api/apply/start', { slug: t.slug, language: 'en', identity }, h);
  const b = await post('/api/apply/start', { slug: t.slug, language: 'en', identity }, h);
  assert.equal(a.status, 200);
  // second attempt resumes the same application rather than creating a new one
  assert.equal(b.body.appId, a.body.appId, 'same identity reuses the in-progress application');
});

test('per-IP rate limit on start -> 429', async () => {
  const t = await enabledTenant();
  const ip = ipFor(9);
  for (let i = 0; i < 5; i++) {
    const r = await post('/api/apply/start', { slug: t.slug, language: 'en', identity: { discord: 'rl#' + i, ingame: 'X' } }, { 'x-forwarded-for': ip });
    assert.equal(r.status, 200, `start ${i}`);
  }
  const blocked = await post('/api/apply/start', { slug: t.slug, language: 'en', identity: { discord: 'rl#last', ingame: 'X' } }, { 'x-forwarded-for': ip });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error.code, 'RATE_LIMITED');
});

test('applying to a disabled tenant is refused', async () => {
  const t = await freshTenant(); // never enabled
  const cfg = (await api(t.idToken)('/api/whitelist/config')).body.config;
  const r = await post('/api/apply/start', { slug: cfg.slug, language: 'en', identity: { discord: 'x#1', ingame: 'X' } }, { 'x-forwarded-for': ipFor(5) });
  assert.equal(r.status, 404, 'disabled whitelist is not publicly applyable');
});
