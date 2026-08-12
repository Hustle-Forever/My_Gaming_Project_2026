// lib/concierge/session.js - the per-player onboarding state machine.
// Pure, serializable, hard-capped. The runtime feeds it events (a message was
// shown, the player chose a job / sent a message / dismissed, or a clock tick)
// and reads back the phase + a pendingMessage intent. It NEVER talks to a model
// or the network — message text is produced by the message layer (M4) from the
// phase; this file only owns the flow, the caps, and the transcript-free state.
//
// Phases: greet → choose → guide → await_checkin → checkin → done
//         (or dismissed / expired at any time). Feature flags skip phases.

const LIMITS = {
  maxMessages: 8,          // hard ceiling on messages per onboarding
  maxSessionSeconds: 1800, // a session can never run longer than 30 min
};

// Should the runtime start onboarding this player? New players yes; players who
// already completed or dismissed are left alone — UNLESS they've been away
// longer than the re-onboard window (a genuine "returning after a long absence").
const REONBOARD_AFTER_MS = 365 * 24 * 3600 * 1000; // ~1 year
function shouldOnboard(existing, { now } = { now: Date.now() }) {
  if (!existing) return true;
  if (existing.status === 'in_progress') return true;
  const last = existing.updatedAtMs || existing.arrivedAtMs || 0;
  return (now - last) >= REONBOARD_AFTER_MS;
}

function createSession(config, opts = {}) {
  const features = { greet: true, ask: true, guide: true, checkin: true, introduce: true, ...(config.features || {}) };
  const checkinMs = (config.checkinSeconds || 300) * 1000;

  let st;
  if (opts.restore) {
    st = { ...opts.restore };
  } else {
    st = {
      playerId: opts.playerId,
      language: opts.language || (config.languages || ['en'])[0],
      phase: 'greet',
      startedAtMs: opts.now || 0,
      lastPhaseAtMs: opts.now || 0,
      choiceJobId: null,
      messagesSent: 0,
      pendingMessage: null,
      status: 'in_progress',
    };
  }

  function done() { return st.phase === 'done' || st.phase === 'dismissed' || st.phase === 'expired'; }

  function setPhase(p, now, emit) {
    st.phase = p;
    st.lastPhaseAtMs = now != null ? now : st.lastPhaseAtMs;
    st.pendingMessage = emit ? { phase: p } : null;
    if (emit) st.messagesSent += 1;
    if (p === 'done' || p === 'dismissed' || p === 'expired') st.status = p === 'dismissed' ? 'dismissed' : (p === 'expired' ? 'done' : 'done');
    return snapshotState();
  }

  function snapshotState() {
    return { phase: st.phase, pendingMessage: st.pendingMessage, language: st.language, progress: phaseIndex() };
  }
  function phaseIndex() {
    const order = ['greet', 'choose', 'guide', 'await_checkin', 'checkin', 'done'];
    return { index: Math.max(0, order.indexOf(st.phase)) + 1, total: order.length };
  }

  // advance from a phase whose message was just shown
  function advanceAfterShown(now) {
    switch (st.phase) {
      case 'greet':
        return setPhase(features.ask ? 'choose' : 'await_checkin', now, false);
      case 'guide':
        return setPhase(features.checkin ? 'await_checkin' : 'done', now, false);
      case 'checkin':
        return setPhase('done', now, false);
      default:
        return snapshotState();
    }
  }

  function next(event) {
    if (done()) return snapshotState();
    const now = event && event.now != null ? event.now : st.lastPhaseAtMs;

    // global duration cap
    if (now - st.startedAtMs > LIMITS.maxSessionSeconds * 1000) {
      return setPhase('done', now, false);
    }
    // message cap: never emit beyond the ceiling
    if (st.messagesSent >= LIMITS.maxMessages && event.kind !== 'dismiss') {
      if (st.phase !== 'done') return setPhase('done', now, false);
      return snapshotState();
    }

    switch (event.kind) {
      case 'dismiss':
        return setPhase('dismissed', now, false);

      case 'shown':
        // the current phase's message was delivered; move on
        return advanceAfterShown(now);

      case 'choice':
        if (st.phase === 'choose') {
          st.choiceJobId = event.jobId || null;
          return setPhase(features.guide ? 'guide' : (features.checkin ? 'await_checkin' : 'done'), now, features.guide || features.checkin);
        }
        return snapshotState();

      case 'message':
        // free-text from the player during choose = treat as an answer
        if (st.phase === 'choose') {
          st.choiceJobId = event.jobId || st.choiceJobId;
          return setPhase(features.guide ? 'guide' : 'await_checkin', now, true);
        }
        return snapshotState();

      case 'tick':
        if (st.phase === 'await_checkin' && features.checkin) {
          if (now - st.lastPhaseAtMs >= checkinMs) return setPhase('checkin', now, true);
        }
        return snapshotState();

      default:
        return snapshotState();
    }
  }

  return {
    state: snapshotState,
    next,
    data: () => ({ playerId: st.playerId, language: st.language, choiceJobId: st.choiceJobId, status: st.status, phase: st.phase }),
    serialize: () => ({ ...st }),
    isDone: done,
    messagesSent: () => st.messagesSent,
    consumePending: () => { const p = st.pendingMessage; st.pendingMessage = null; return p; },
  };
}

module.exports = { createSession, shouldOnboard, LIMITS };
