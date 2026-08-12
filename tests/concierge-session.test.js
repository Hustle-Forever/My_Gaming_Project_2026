// M2: the per-player onboarding state machine. Pure, serializable, capped.
// arrival → greet → choose → guide → checkin → done, with dismiss permanent,
// caps enforced, resume works, and a returning player is NOT re-onboarded.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSession, LIMITS } = require('../lib/concierge/session');

const CFG = {
  languages: ['en', 'ar'],
  checkinSeconds: 300,
  features: { greet: true, ask: true, guide: true, checkin: true, introduce: true },
  recommendJobs: [{ id: 'police', label: { en: 'Police', ar: 'شرطة' } }, { id: 'ems', label: { en: 'EMS', ar: 'إسعاف' } }],
};

test('happy path: greet -> choose -> guide -> checkin -> done', () => {
  const s = createSession(CFG, { playerId: 'p1', language: 'en', now: 0 });
  assert.equal(s.state().phase, 'greet');
  assert.equal(s.next({ kind: 'shown' }).phase, 'choose');          // greeting delivered
  const guide = s.next({ kind: 'choice', jobId: 'police' });         // player picks a job
  assert.equal(guide.phase, 'guide');
  assert.equal(s.data().choiceJobId, 'police');
  assert.equal(s.next({ kind: 'shown' }).phase, 'await_checkin');    // destination given
  // check-in is time-gated
  assert.equal(s.next({ kind: 'tick', now: 100 * 1000 }).phase, 'await_checkin'); // too early
  assert.equal(s.next({ kind: 'tick', now: 301 * 1000 }).phase, 'checkin');       // due
  assert.equal(s.next({ kind: 'shown' }).phase, 'done');
  assert.equal(s.isDone(), true);
});

test('dismiss stops everything, permanently', () => {
  const s = createSession(CFG, { playerId: 'p2', language: 'en', now: 0 });
  s.next({ kind: 'shown' });
  const d = s.next({ kind: 'dismiss' });
  assert.equal(d.phase, 'dismissed');
  assert.equal(s.isDone(), true);
  // any further input stays dismissed and emits nothing
  assert.equal(s.next({ kind: 'choice', jobId: 'police' }).phase, 'dismissed');
  assert.equal(s.next({ kind: 'tick', now: 999999 }).phase, 'dismissed');
});

test('message cap: the session can never emit more than the hard limit', () => {
  const s = createSession(CFG, { playerId: 'p3', language: 'en', now: 0 });
  let emitted = 0;
  for (let i = 0; i < 100; i++) {
    const st = s.state();
    if (st.pendingMessage) emitted += 1;
    if (s.isDone()) break;
    s.next({ kind: 'tick', now: i * 400 * 1000 });
  }
  assert.ok(s.messagesSent() <= LIMITS.maxMessages, `emitted ${s.messagesSent()} > cap ${LIMITS.maxMessages}`);
});

test('session hard duration cap ends it', () => {
  const s = createSession(CFG, { playerId: 'p4', language: 'en', now: 0 });
  s.next({ kind: 'shown' });
  const late = s.next({ kind: 'tick', now: (LIMITS.maxSessionSeconds + 10) * 1000 });
  assert.equal(s.isDone(), true, 'past the max duration the session is done');
  assert.ok(['done', 'expired'].includes(late.phase));
});

test('serialize/restore continues correctly (resume after reconnect)', () => {
  const s = createSession(CFG, { playerId: 'p5', language: 'en', now: 0 });
  s.next({ kind: 'shown' });              // now at choose
  const snap = s.serialize();
  const r = createSession(CFG, { restore: snap });
  assert.equal(r.state().phase, 'choose');
  const guide = r.next({ kind: 'choice', jobId: 'ems' });
  assert.equal(guide.phase, 'guide');
  assert.equal(r.data().choiceJobId, 'ems');
});

test('a completed/dismissed session is not re-onboarded on return', () => {
  // helper the runtime uses to decide whether to greet a returning player
  const { shouldOnboard } = require('../lib/concierge/session');
  assert.equal(shouldOnboard(null, { now: 1000 }), true, 'brand-new player is onboarded');
  assert.equal(shouldOnboard({ status: 'done', updatedAtMs: 1000 }, { now: 2000 }), false, 'completed player left alone');
  assert.equal(shouldOnboard({ status: 'dismissed', updatedAtMs: 1000 }, { now: 2000 }), false, 'dismissed player left alone');
  // a long absence past the re-onboard window MAY re-welcome (returning player)
  const yearMs = 400 * 24 * 3600 * 1000;
  assert.equal(shouldOnboard({ status: 'done', updatedAtMs: 1000 }, { now: 1000 + yearMs }), true, 'long-absent player can be re-welcomed');
});

test('Arabic session carries language through', () => {
  const s = createSession(CFG, { playerId: 'p6', language: 'ar', now: 0 });
  assert.equal(s.data().language, 'ar');
  assert.equal(s.serialize().language, 'ar');
});

test('features off skip their phases (guide disabled -> straight to checkin path)', () => {
  const cfg = { ...CFG, features: { greet: true, ask: true, guide: false, checkin: true, introduce: false } };
  const s = createSession(cfg, { playerId: 'p7', language: 'en', now: 0 });
  s.next({ kind: 'shown' });                       // choose
  const afterChoice = s.next({ kind: 'choice', jobId: 'police' });
  // with guide disabled, it should not enter a guide phase
  assert.notEqual(afterChoice.phase, 'guide');
});
