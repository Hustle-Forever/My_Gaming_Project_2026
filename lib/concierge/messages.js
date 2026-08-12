// lib/concierge/messages.js - turns a phase into concrete actions for the
// bridge, with the CLOSED ACTION SET enforced. The Concierge may ONLY:
//   send_message  {text}                 – one short line to one player
//   set_waypoint  {x, y, label}          – mark a place on their map
//   show_menu     {title, items:[{id,label}]}
// Anything else a model returns is dropped. This is the same whitelist-gate
// philosophy as the console's action layer, re-validated server-side.
const { recommendJobs, recommendForChoice, pickNearbyPlayer } = require('./recommend');

const ACTIONS = new Set(['send_message', 'set_waypoint', 'show_menu']);
const MAX_MESSAGE_CHARS = 240;   // hard cap — these are one-liners
const MAX_MENU_ITEMS = 6;

// Validate + sanitize a single action. Returns {ok:true, action} or {ok:false}.
function validateAction(a) {
  if (!a || !ACTIONS.has(a.type)) return { ok: false };
  if (a.type === 'send_message') {
    const text = String(a.text || '').slice(0, MAX_MESSAGE_CHARS);
    if (!text.trim()) return { ok: false };
    return { ok: true, action: { type: 'send_message', text } };
  }
  if (a.type === 'set_waypoint') {
    const x = Number(a.x), y = Number(a.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false };
    return { ok: true, action: { type: 'set_waypoint', x, y, label: String(a.label || '').slice(0, 60) } };
  }
  if (a.type === 'show_menu') {
    const items = (Array.isArray(a.items) ? a.items : []).slice(0, MAX_MENU_ITEMS)
      .map((it) => ({ id: String(it.id || '').slice(0, 40), label: String(it.label || '').slice(0, 60) }))
      .filter((it) => it.label);
    return { ok: true, action: { type: 'show_menu', title: String(a.title || '').slice(0, 80), items } };
  }
  return { ok: false };
}

// The final gate every reply passes through — drops anything not whitelisted.
function sanitizeActions(actions) {
  const out = [];
  for (const a of (Array.isArray(actions) ? actions : [])) {
    const v = validateAction(a);
    if (v.ok) out.push(v.action);
  }
  return out;
}

// Deterministic fallback: build the phase's actions from templates + the
// recommendation engine (works with no AI key).
function fallbackActions(ctx) {
  const { phase, config, server, language, choiceJobId, report, players } = ctx;
  const L = language === 'ar' ? 'ar' : 'en';
  const name = (server && server.name) || (L === 'ar' ? 'السيرفر' : 'the server');

  if (phase === 'greet') {
    const g = (config.greeting && (config.greeting[L] || config.greeting.en)) ||
      (L === 'ar' ? `أهلًا بك في ${name}!` : `Welcome to ${name}!`);
    return [{ type: 'send_message', text: g }];
  }
  if (phase === 'choose') {
    const ask = (config.askPrompt && (config.askPrompt[L] || config.askPrompt.en)) || (L === 'ar' ? 'شو تبي تكون؟' : 'What do you want to be?');
    const jobs = recommendJobs(config, report).map((j) => ({ id: j.id, label: j.label[L] || j.label.en }));
    return [{ type: 'send_message', text: ask }, { type: 'show_menu', title: ask, items: jobs }];
  }
  if (phase === 'guide') {
    const rec = recommendForChoice(config, report, choiceJobId || 'civilian', L);
    const acts = [{ type: 'send_message', text: rec.line }, { type: 'set_waypoint', x: 0, y: 0, label: rec.location }];
    const nearby = (config.features && config.features.introduce) ? pickNearbyPlayer(players, choiceJobId) : null;
    if (nearby) {
      acts.push({ type: 'send_message', text: L === 'ar'
        ? `${nearby.name} قريب منك ويشتغل ${nearby.job || 'هناك'} — سلّم عليه!`
        : `${nearby.name} is nearby working as ${nearby.job || 'a local'} — say hi!` });
    }
    return acts;
  }
  if (phase === 'checkin') {
    return [{ type: 'send_message', text: L === 'ar'
      ? 'كل شيء تمام؟ لو تبي تعرف كيف تتكلم أو تكسب فلوس أو تلاقي ناس، قل لي.'
      : 'Still with us? If you want to know how to talk, make money, or find people, just ask.' }];
  }
  return [];
}

// buildReply: run the brain (if any), then ALWAYS sanitize through the closed
// action set. A brain failure or missing key => deterministic fallback.
async function buildReply(ctx, brain) {
  let raw;
  if (brain) {
    try { raw = await brain(ctx); } catch (_) { raw = null; }
  }
  let actions = raw && Array.isArray(raw.actions) ? raw.actions : fallbackActions(ctx);
  // if the model returned nothing usable after sanitizing, fall back
  let safe = sanitizeActions(actions);
  if (!safe.length) safe = sanitizeActions(fallbackActions(ctx));
  return { actions: safe };
}

module.exports = { buildReply, validateAction, sanitizeActions, fallbackActions, ACTIONS, MAX_MESSAGE_CHARS };
