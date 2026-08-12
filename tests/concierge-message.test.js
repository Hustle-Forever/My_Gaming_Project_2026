// M4: the message layer. Short, bilingual, tone-aware, deterministic fallback,
// and — the safety property — a CLOSED action set: nothing but send_message,
// set_waypoint, show_menu can ever be emitted, no matter what the model returns.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReply, validateAction, ACTIONS, MAX_MESSAGE_CHARS } = require('../lib/concierge/messages');
const { systemPrompt } = require('../lib/concierge/personality');

const CFG = {
  languages: ['en', 'ar'], tone: 'casual',
  greeting: { en: 'Welcome to Aziz RP!', ar: 'أهلًا في سيرفر عزيز!' },
  askPrompt: { en: 'What do you want to be?', ar: 'شو تبي تكون؟' },
  features: { greet: true, ask: true, guide: true, checkin: true, introduce: true },
  recommendJobs: [{ id: 'police', label: { en: 'Police', ar: 'شرطة' } }],
};
const SERVER = { name: 'Aziz RP' };

// ---- CLOSED ACTION SET (the headline safety test) ----
test('only send_message / set_waypoint / show_menu are valid actions', () => {
  assert.deepEqual([...ACTIONS].sort(), ['send_message', 'set_waypoint', 'show_menu']);
  assert.equal(validateAction({ type: 'send_message', text: 'hi' }).ok, true);
  assert.equal(validateAction({ type: 'set_waypoint', x: 1, y: 2 }).ok, true);
  assert.equal(validateAction({ type: 'show_menu', items: [] }).ok, true);
  for (const forbidden of ['spawn_vehicle', 'teleport', 'give_money', 'give_item', 'set_job', 'kick', 'ban', 'eval']) {
    assert.equal(validateAction({ type: forbidden, amount: 9999 }).ok, false, `${forbidden} must be rejected`);
  }
});

test('a rogue model action is neutralized — reply emits only whitelisted actions', async () => {
  // brain returns a mix of valid + forbidden actions
  const rogueBrain = async () => ({ actions: [
    { type: 'send_message', text: 'welcome' },
    { type: 'give_money', amount: 1000000 },
    { type: 'spawn_vehicle', model: 'adder' },
    { type: 'set_waypoint', x: 1, y: 2 },
  ] });
  const out = await buildReply({ phase: 'greet', config: CFG, server: SERVER, language: 'en' }, rogueBrain);
  assert.ok(out.actions.every((a) => ACTIONS.has(a.type)), `forbidden action leaked: ${JSON.stringify(out.actions)}`);
  assert.ok(!out.actions.some((a) => a.type === 'give_money' || a.type === 'spawn_vehicle'));
});

test('messages stay under the length cap (both fallback and model paths)', async () => {
  const longBrain = async () => ({ actions: [{ type: 'send_message', text: 'x'.repeat(5000) }] });
  const out = await buildReply({ phase: 'greet', config: CFG, server: SERVER, language: 'en' }, longBrain);
  const msg = out.actions.find((a) => a.type === 'send_message');
  assert.ok(msg.text.length <= MAX_MESSAGE_CHARS, `message ${msg.text.length} > cap`);

  const fb = await buildReply({ phase: 'greet', config: CFG, server: SERVER, language: 'en' }, null);
  const fbMsg = fb.actions.find((a) => a.type === 'send_message');
  assert.ok(fbMsg.text.length <= MAX_MESSAGE_CHARS);
});

test('deterministic fallback (no brain) produces the greeting', async () => {
  const out = await buildReply({ phase: 'greet', config: CFG, server: SERVER, language: 'en' }, null);
  const msg = out.actions.find((a) => a.type === 'send_message');
  assert.match(msg.text, /Aziz RP|Welcome/i);
});

test('Arabic path produces Arabic', async () => {
  const out = await buildReply({ phase: 'greet', config: CFG, server: SERVER, language: 'ar' }, null);
  const msg = out.actions.find((a) => a.type === 'send_message');
  assert.match(msg.text, /[؀-ۿ]/);
});

test('the guide phase emits a waypoint + a message (fallback)', async () => {
  const report = null;
  const out = await buildReply({ phase: 'guide', config: CFG, server: SERVER, language: 'en', choiceJobId: 'police', report }, null);
  assert.ok(out.actions.some((a) => a.type === 'set_waypoint'));
  assert.ok(out.actions.some((a) => a.type === 'send_message'));
});

test('the choose phase offers a menu of real jobs', async () => {
  const out = await buildReply({ phase: 'choose', config: CFG, server: SERVER, language: 'en' }, null);
  const menu = out.actions.find((a) => a.type === 'show_menu');
  assert.ok(menu && Array.isArray(menu.items) && menu.items.length >= 1);
});

test('system prompt carries tone + server name + the closed-action instruction', () => {
  const p = systemPrompt(CFG, SERVER);
  assert.match(p, /Aziz RP/);
  assert.match(p, /casual/i);
  assert.match(p, /send_message|waypoint|menu/i);
  // must forbid the dangerous stuff explicitly
  assert.match(p, /never|only/i);
});
