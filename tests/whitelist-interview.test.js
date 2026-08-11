// M2: the interview state machine. Pure + deterministic: a `judge` decides
// whether an answer is sufficient (injected in tests; provider-backed in prod).
// ask -> judge -> follow-up (<=2) -> next question -> done, with hard caps.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createInterview, MAX_FOLLOWUPS, LIMITS } = require('../lib/whitelist/interview');

const CONFIG = {
  languages: ['en', 'ar'],
  questions: [
    { id: 'q1', order: 0, text: { en: 'Tell us about your RP experience.', ar: 'احكِ عن خبرتك.' } },
    { id: 'q2', order: 1, text: { en: 'What is VDM and what do you do about it?', ar: 'شو VDM وشو تسوي؟' } },
  ],
};

// judge that calls an answer "vague" if it is short, else sufficient
const shortIsVague = async ({ answer }) => ({
  sufficient: answer.trim().split(/\s+/).length >= 8,
  followUp: { en: 'Can you give a specific example?', ar: 'ممكن مثال محدد؟' },
});

test('first step asks question 1 with progress', async () => {
  const iv = createInterview(CONFIG, { language: 'en' });
  const step = iv.current();
  assert.equal(step.kind, 'question');
  assert.equal(step.questionId, 'q1');
  assert.match(step.prompt, /RP experience/);
  assert.deepEqual(step.progress, { index: 1, total: 2 });
});

test('a vague answer triggers a follow-up (same question)', async () => {
  const iv = createInterview(CONFIG, { language: 'en' });
  const next = await iv.answer('idk', shortIsVague);
  assert.equal(next.kind, 'followup');
  assert.equal(next.questionId, 'q1');
  assert.match(next.prompt, /specific example/);
});

test('a good answer advances to the next question, no follow-up', async () => {
  const iv = createInterview(CONFIG, { language: 'en' });
  const next = await iv.answer('I played on a serious RP server for two years as a paramedic and detective', shortIsVague);
  assert.equal(next.kind, 'question');
  assert.equal(next.questionId, 'q2');
});

test('follow-ups are capped at 2, then it moves on regardless', async () => {
  const iv = createInterview(CONFIG, { language: 'en' });
  assert.equal((await iv.answer('no', shortIsVague)).kind, 'followup');   // 1
  assert.equal((await iv.answer('no', shortIsVague)).kind, 'followup');   // 2
  const third = await iv.answer('no', shortIsVague);                      // capped -> next q
  assert.equal(third.kind, 'question');
  assert.equal(third.questionId, 'q2');
  assert.ok(MAX_FOLLOWUPS === 2);
});

test('finishing the last question completes the interview', async () => {
  const iv = createInterview(CONFIG, { language: 'en' });
  await iv.answer('a long enough first answer with plenty of detail here now', shortIsVague); // q1 -> q2
  const done = await iv.answer('VDM is vehicle deathmatch and I would report it and avoid retaliating myself', shortIsVague);
  assert.equal(done.kind, 'done');
  const tx = iv.transcript();
  assert.equal(tx.filter((t) => t.role === 'applicant').length, 2);
  assert.ok(tx.every((t) => t.questionId));
});

test('Arabic interview uses Arabic prompts', async () => {
  const iv = createInterview(CONFIG, { language: 'ar' });
  assert.match(iv.current().prompt, /[؀-ۿ]/);
  const f = await iv.answer('لا', shortIsVague);
  assert.match(f.prompt, /[؀-ۿ]/);
});

test('answer length is capped and session cannot run forever', async () => {
  const iv = createInterview(CONFIG, { language: 'en' });
  const huge = 'x '.repeat(5000);
  const res = await iv.answer(huge, async () => ({ sufficient: true }));
  // the stored answer is truncated to the cap
  const applicantTurn = iv.transcript().find((t) => t.role === 'applicant');
  assert.ok(applicantTurn.text.length <= LIMITS.maxAnswerChars);
  assert.ok(res.kind === 'question' || res.kind === 'done');
});

test('serialize/restore round-trips (resume after a dropped session)', async () => {
  const iv = createInterview(CONFIG, { language: 'en' });
  await iv.answer('short', shortIsVague); // now on a follow-up of q1
  const snap = iv.serialize();

  const resumed = createInterview(CONFIG, { restore: snap });
  const cur = resumed.current();
  assert.equal(cur.kind, 'followup');
  assert.equal(cur.questionId, 'q1');
  // continuing from the resumed state still advances correctly
  const next = await resumed.answer('here is a much longer and more detailed answer to satisfy the judge', shortIsVague);
  assert.equal(next.questionId, 'q2');
});
