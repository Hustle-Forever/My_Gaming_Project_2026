// lib/concierge/runtime.js - ties the session machine + message layer + brain
// together for the bridge endpoints. Loads/persists per-player session state,
// records funnel events, and returns ONLY closed-set actions. Shared by
// api/concierge/_event and _reply so both behave identically.
const { createSession, shouldOnboard } = require('./session');
const { buildReply } = require('./messages');
const { makeBrain } = require('./brain');
const store = require('../firestore');

// Build the reply actions for the session's current pending phase.
async function actionsFor(phase, { tenant, config, server, language, choiceJobId, report, players }) {
  const brain = makeBrain(tenant, server);
  const out = await buildReply({ phase, config, server, language, choiceJobId, report, players }, brain);
  return out.actions;
}

async function latestReport(uid) {
  try {
    const scans = await store.listScans(uid, 1);
    if (!scans.length) return null;
    const full = await store.getScan(uid, scans[0].scanId);
    return full ? { identity: full.identity, model: full.model } : null;
  } catch (_) { return null; }
}

// Process a bridge event. Returns { onboard, actions }.
async function handleEvent(uid, tenant, config, event) {
  const server = { name: tenant.name };
  const playerId = String(event.playerId || '');
  if (!playerId) return { onboard: false, actions: [] };
  const language = (config.languages || ['en']).includes(event.language) ? event.language : (config.languages || ['en'])[0];
  const existing = await store.getConciergeSession(uid, playerId);

  if (event.type === 'join') {
    if (!shouldOnboard(existing, { now: Date.now() })) {
      // returning player who already completed/dismissed - record the return, leave alone
      if (existing) await store.recordConciergeEvent(uid, { type: 'returned', playerId });
      return { onboard: false, actions: [] };
    }
    const s = createSession(config, { playerId, language, now: Date.now() });
    await store.recordConciergeEvent(uid, { type: 'arrived', playerId });
    const report = await latestReport(uid);
    const acts = [];
    // greeting
    acts.push(...await actionsFor('greet', { tenant, config, server, language, report }));
    s.next({ kind: 'shown', now: Date.now() });          // -> choose (or await_checkin if ask off)
    if (s.state().phase === 'choose') {
      acts.push(...await actionsFor('choose', { tenant, config, server, language, report }));
    }
    await store.recordConciergeEvent(uid, { type: 'greeted', playerId });
    await persist(uid, playerId, s, { language, arrivedAtMs: Date.now() });
    return { onboard: true, actions: closed(acts) };
  }

  // all other events need a live session
  if (!existing || existing.status !== 'in_progress') return { onboard: false, actions: [] };
  const s = createSession(config, { restore: restoreState(existing) });

  if (event.type === 'dismiss') {
    s.next({ kind: 'dismiss', now: Date.now() });
    await store.recordConciergeEvent(uid, { type: 'dismissed', playerId });
    await persist(uid, playerId, s, {});
    return { onboard: true, actions: [] };
  }

  if (event.type === 'choice' || event.type === 'message') {
    const before = s.state().phase;
    s.next({ kind: event.type === 'choice' ? 'choice' : 'message', jobId: event.jobId, text: event.text, now: Date.now() });
    if (event.text) await store.recordConciergeEvent(uid, { type: 'question', playerId, theme: theme(event.text) });
    if (before === 'choose') await store.recordConciergeEvent(uid, { type: 'answered', playerId, jobId: event.jobId || null });
    const report = await latestReport(uid);
    let acts = [];
    if (s.state().phase === 'guide') {
      acts = await actionsFor('guide', { tenant, config, server, language: existing.language, choiceJobId: s.data().choiceJobId, report, players: event.players });
      s.next({ kind: 'shown', now: Date.now() });       // guide shown -> await_checkin
      if (acts.some((a) => a.type === 'set_waypoint')) await store.recordConciergeEvent(uid, { type: 'reached', playerId });
    }
    await persist(uid, playerId, s, {});
    return { onboard: true, actions: closed(acts) };
  }

  return { onboard: true, actions: [] };
}

// Poll: deliver time-triggered actions (the check-in) and record retention.
async function handlePoll(uid, tenant, config, event) {
  const playerId = String(event.playerId || '');
  const existing = await store.getConciergeSession(uid, playerId);
  if (!existing || existing.status !== 'in_progress') return { actions: [] };
  const server = { name: tenant.name };
  const s = createSession(config, { restore: restoreState(existing) });

  // 10-minute retention marker (record once)
  if (!existing.stillPlaying && Date.now() - (existing.arrivedAtMs || 0) >= 600000) {
    await store.recordConciergeEvent(uid, { type: 'still_playing', playerId });
    await store.setConciergeSession(uid, playerId, { stillPlaying: true });
  }

  const st = s.next({ kind: 'tick', now: Date.now() });
  let acts = [];
  if (st.phase === 'checkin') {
    acts = await actionsFor('checkin', { tenant, config, server, language: existing.language });
    s.next({ kind: 'shown', now: Date.now() });
    await store.recordConciergeEvent(uid, { type: 'checkin', playerId });
    await persist(uid, playerId, s, {});
  }
  return { actions: closed(acts) };
}

// Rebuild the serialized state from a stored session doc. The persisted `iv` is
// the source of truth, but top-level phase/lastPhaseAtMs (which owners' tools and
// tests may adjust) win when present, so the timer stays authoritative.
function restoreState(existing) {
  const iv = existing.iv || {};
  return {
    ...iv,
    phase: existing.phase || iv.phase,
    lastPhaseAtMs: existing.lastPhaseAtMs != null ? existing.lastPhaseAtMs : iv.lastPhaseAtMs,
    language: existing.language || iv.language,
    choiceJobId: existing.choiceJobId != null ? existing.choiceJobId : iv.choiceJobId,
    status: existing.status || iv.status,
  };
}

async function persist(uid, playerId, session, extra) {
  const iv = session.serialize();
  await store.setConciergeSession(uid, playerId, {
    iv, status: iv.status, phase: iv.phase, language: iv.language, choiceJobId: iv.choiceJobId, ...extra,
  });
}

// belt to messages.js's suspenders: the endpoints only ever return closed set
const CLOSED = new Set(['send_message', 'set_waypoint', 'show_menu']);
function closed(acts) { return (acts || []).filter((a) => a && CLOSED.has(a.type)); }

// coarse question theme (for owner insight) - no raw chat stored
function theme(text) {
  const t = String(text).toLowerCase();
  if (/money|cash|job|rich|فلوس|وظيف|شغل/.test(t)) return 'money';
  if (/talk|voice|mic|chat|كلام|صوت|مايك/.test(t)) return 'communication';
  if (/eat|food|hungry|اكل|طعام|جوع/.test(t)) return 'food';
  if (/where|how|start|كيف|وين|ابدأ/.test(t)) return 'getting_started';
  if (/car|vehicle|drive|سيار|مركب/.test(t)) return 'vehicles';
  return 'other';
}

module.exports = { handleEvent, handlePoll };
