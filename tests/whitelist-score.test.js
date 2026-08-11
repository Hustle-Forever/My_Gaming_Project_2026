// M3: scoring. The AI's output is validated hard (evidence mandatory), a
// deterministic flag layer runs regardless of the model, confidence gates
// auto-decisions, and scoring is language-blind (bias guard).
const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreApplication, validateScoreObject, deterministicFlags, decide } = require('../lib/whitelist/score');

const CRITERIA = [
  { id: 'c1', label: { en: 'RP understanding', ar: 'فهم' }, description: { en: '', ar: '' } },
  { id: 'c2', label: { en: 'Effort', ar: 'جهد' }, description: { en: '', ar: '' } },
];

function transcript(pairs) {
  const t = [];
  pairs.forEach(([qid, q, a], i) => {
    t.push({ role: 'officer', questionId: qid, kind: 'question', text: q });
    t.push({ role: 'applicant', questionId: qid, kind: 'question', text: a });
  });
  return t;
}

// ---- validation: evidence is mandatory ----
test('a score without evidence is rejected by validation', () => {
  const bad = { scores: [{ criterion: 'c1', score: 80, evidence: '' }], flags: [], summary: 's', recommendation: 'approve' };
  const r = validateScoreObject(bad, CRITERIA);
  assert.equal(r.ok, false);
  assert.match(r.error, /evidence/i);
});

test('a valid object with per-criterion evidence passes', () => {
  const good = {
    scores: [
      { criterion: 'c1', score: 70, evidence: 'I played serious RP for two years' },
      { criterion: 'c2', score: 60, evidence: 'detailed paramedic backstory' },
    ],
    flags: [], summary: 'ok', recommendation: 'review', confidence: 0.8,
  };
  assert.equal(validateScoreObject(good, CRITERIA).ok, true);
});

test('scores outside 0-100 or unknown criteria are rejected', () => {
  assert.equal(validateScoreObject({ scores: [{ criterion: 'c1', score: 130, evidence: 'x' }] }, CRITERIA).ok, false);
  assert.equal(validateScoreObject({ scores: [{ criterion: 'nope', score: 50, evidence: 'x' }] }, CRITERIA).ok, false);
});

// ---- deterministic flags (run no matter what the model says) ----
test('copy-paste / near-duplicate answers raise a flag', () => {
  const boiler = 'I love roleplay and I will follow all the rules always for sure.';
  const tx = transcript([['q1', 'Q1', boiler], ['q2', 'Q2', boiler]]);
  const flags = deterministicFlags(tx, {});
  assert.ok(flags.some((f) => f.type === 'copy_paste'), JSON.stringify(flags));
});

test('a hostile answer is flagged, never silently scored', () => {
  const tx = transcript([['q1', 'Q1', 'I will kill everyone and grief the whole server lol rdm is fun']]);
  const flags = deterministicFlags(tx, {});
  assert.ok(flags.some((f) => f.type === 'hostile'));
});

test('a dodging / far-too-short answer is flagged', () => {
  const tx = transcript([['q1', 'Explain VDM in detail', 'idk']]);
  const flags = deterministicFlags(tx, {});
  assert.ok(flags.some((f) => f.type === 'dodge'));
});

test('under-age disclosure is flagged when the owner requires an age', () => {
  const tx = transcript([['q1', 'How old are you?', 'i am 14 years old']]);
  const flags = deterministicFlags(tx, { ageRequired: true, minAge: 16 });
  assert.ok(flags.some((f) => f.type === 'underage'));
  // and NOT flagged when no age requirement
  assert.ok(!deterministicFlags(tx, { ageRequired: false }).some((f) => f.type === 'underage'));
});

// ---- BIAS GUARD: equivalent answers in AR and EN score comparably ----
test('bias guard: an equivalent short answer in AR and EN is treated the same', () => {
  const en = transcript([['q1', 'Why do you want to join?', 'because']]);
  const ar = transcript([['q1', 'ليش تبي تنضم؟', 'لأن']]);
  const fe = deterministicFlags(en, {}).filter((f) => f.type === 'dodge').length;
  const fa = deterministicFlags(ar, {}).filter((f) => f.type === 'dodge').length;
  assert.equal(fe, fa, 'language must not change the dodge outcome for equivalent answers');

  // a normal-length answer must not be dodge-flagged in either language
  const enOk = transcript([['q1', 'Why?', 'I want to join because I enjoy serious long-form roleplay and community']]);
  const arOk = transcript([['q1', 'ليش؟', 'أبي أنضم لأني أحب الرول بلاي الجاد والمجتمع وأستمتع بالقصص الطويلة معهم']]);
  assert.ok(!deterministicFlags(enOk, {}).some((f) => f.type === 'dodge'));
  assert.ok(!deterministicFlags(arOk, {}).some((f) => f.type === 'dodge'));
});

// ---- decision policy: human by default, confidence-gated ----
test('decide: recommend-only unless thresholds set; low confidence never auto-decides', () => {
  const scores = [{ criterion: 'c1', score: 95, evidence: 'x' }, { criterion: 'c2', score: 95, evidence: 'y' }];
  // no thresholds -> always human
  assert.equal(decide({ scores, confidence: 0.9, flags: [] }, { autoApprove: null, autoReject: null }).auto, false);
  // thresholds set + high confidence + clean -> auto-approve allowed
  assert.equal(decide({ scores, confidence: 0.9, flags: [] }, { autoApprove: 85, autoReject: 30 }).decision, 'approve');
  // low confidence -> human even with thresholds
  assert.equal(decide({ scores, confidence: 0.4, flags: [] }, { autoApprove: 85, autoReject: 30 }).auto, false);
  // a hostile flag blocks auto-approve regardless of score
  assert.equal(decide({ scores, confidence: 0.9, flags: [{ type: 'hostile' }] }, { autoApprove: 85, autoReject: 30 }).auto, false);
});

// ---- end to end with an injected brain (no real Gemini) ----
test('scoreApplication merges model output + deterministic flags, validates evidence', async () => {
  const tx = transcript([['q1', 'Q1', 'I roleplayed for years as a detective, staying in character always'], ['q2', 'Q2', 'VDM is vehicle deathmatch; I would calmly report it']]);
  const brain = async () => ({
    scores: [{ criterion: 'c1', score: 80, evidence: 'staying in character always' }, { criterion: 'c2', score: 75, evidence: 'calmly report it' }],
    flags: [], summary: 'Solid applicant.', recommendation: 'review', confidence: 0.85,
  });
  const r = await scoreApplication({ criteria: CRITERIA, transcript: tx, config: {} }, brain);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.result.scores.length, 2);
  assert.ok(typeof r.result.overall === 'number');
  assert.ok(Array.isArray(r.result.flags));
});

test('scoreApplication rejects a brain that returns evidence-free scores', async () => {
  const tx = transcript([['q1', 'Q1', 'answer one here'], ['q2', 'Q2', 'answer two here']]);
  const brain = async () => ({ scores: [{ criterion: 'c1', score: 90, evidence: '' }], flags: [], summary: 's', recommendation: 'approve' });
  const r = await scoreApplication({ criteria: CRITERIA, transcript: tx, config: {} }, brain);
  assert.equal(r.ok, false);
});

test('no-brain fallback still produces evidence-backed scores (offline/no key)', async () => {
  const tx = transcript([
    ['q1', 'Q1', 'I played serious roleplay for two years as a paramedic and I always stay in character during scenes'],
    ['q2', 'Q2', 'VDM means vehicle deathmatch and I would report it to admins instead of retaliating'],
  ]);
  const r = await scoreApplication({ criteria: CRITERIA, transcript: tx, config: {} }, null);
  assert.equal(r.ok, true, r.error);
  assert.ok(r.result.scores.every((s) => s.evidence && s.evidence.length > 0), 'fallback still quotes evidence');
  assert.ok(r.result.scores.every((s) => s.score >= 0 && s.score <= 100));
});
