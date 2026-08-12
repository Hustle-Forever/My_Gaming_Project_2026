// M4-driver: the TTS device driver (app/speech.js). Driven in a vm sandbox with
// a mock speechSynthesis + a controllable clock, proving the real-browser
// guarantees the state machine relies on: onDone ALWAYS fires (end / error /
// watchdog), cancel() suppresses onDone, cancelAndWait() waits for `.speaking`
// to clear, voices load async (voiceschanged) with a timeout, the voice matches
// the language, markdown is stripped + capped, and missing voices degrade.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'app', 'speech.js'), 'utf8');

function makeClock() {
  let seq = 1, t = 0; const timers = new Map(); const intervals = new Map();
  return {
    now: () => t,
    setTimeout: (fn, ms) => { const id = seq++; timers.set(id, { fn, at: t + (ms || 0) }); return id; },
    clearTimeout: (id) => timers.delete(id),
    setInterval: (fn, ms) => { const id = seq++; intervals.set(id, { fn, ms }); return id; },
    clearInterval: (id) => intervals.delete(id),
    advance(ms) { t += ms; const due = [...timers.entries()].filter(([, x]) => x.at <= t); for (const [id, x] of due) { if (timers.has(id)) { timers.delete(id); x.fn(); } } },
    timers: () => timers.size,
    intervals: () => intervals.size,
  };
}

function makeEnv(voices = []) {
  const spoken = []; let cancels = 0; let speakingFlag = false; let vcHandler = null;
  const clk = makeClock();
  const synth = {
    _voices: voices,
    get speaking() { return speakingFlag; },
    getVoices() { return this._voices; },
    speak(u) { spoken.push(u); speakingFlag = true; u._u = u; if (u.onstart) u.onstart({}); },
    cancel() { cancels++; speakingFlag = false; },
    pause() {}, resume() {},
    addEventListener(name, fn) { if (name === 'voiceschanged') vcHandler = fn; },
    removeEventListener() { vcHandler = null; },
  };
  function Utt(text) { this.text = text; this.lang = ''; this.voice = null; this.rate = 1; this.onstart = null; this.onend = null; this.onerror = null; }
  const win = { speechSynthesis: synth, SpeechSynthesisUtterance: Utt, isSecureContext: true };
  const sandbox = { window: win, speechSynthesis: synth, SpeechSynthesisUtterance: Utt, console,
    setTimeout: clk.setTimeout, clearTimeout: clk.clearTimeout, setInterval: clk.setInterval, clearInterval: clk.clearInterval };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return {
    S: win.M2Speech, spoken, synth, clk,
    endLast() { const u = spoken[spoken.length - 1]; speakingFlag = false; if (u && u.onend) u.onend({}); },
    errLast() { const u = spoken[spoken.length - 1]; speakingFlag = false; if (u && u.onerror) u.onerror({}); },
    fireVoicesChanged(v) { synth._voices = v; if (vcHandler) vcHandler(); },
    isSpeaking() { return speakingFlag; },
    get cancels() { return cancels; },
  };
}
const enVoice = { name: 'Samantha', lang: 'en-US' };
const arVoice = { name: 'Majed', lang: 'ar-SA' };

test('onDone fires once on natural end', () => {
  const env = makeEnv([enVoice]); const reasons = [];
  const ok = env.S.speak('hello there', { lang: 'en', source: 'voice', onDone: (r) => reasons.push(r) });
  assert.equal(ok, true);
  env.endLast();
  assert.deepEqual(reasons, ['end']);
});

test('onDone fires via WATCHDOG when onend never comes (the core hang fix)', () => {
  const env = makeEnv([enVoice]); const reasons = [];
  env.S.speak('a fairly ordinary reply', { lang: 'en', source: 'voice', onDone: (r) => reasons.push(r) });
  // never call endLast(); advance past the watchdog
  env.clk.advance(25000);
  assert.deepEqual(reasons, ['watchdog'], 'the machine can never hang waiting on onend');
});

test('cancel() suppresses onDone (the machine drives the next state itself)', () => {
  const env = makeEnv([enVoice]); let called = false;
  env.S.speak('speaking now', { lang: 'en', source: 'voice', onDone: () => { called = true; } });
  env.S.cancel();
  env.clk.advance(30000);
  assert.equal(called, false, 'no onDone after an explicit cancel');
});

test('a new speak cancels the previous utterance (never overlap)', () => {
  const env = makeEnv([enVoice]);
  env.S.speak('first', { lang: 'en', source: 'manual' });
  env.S.speak('second', { lang: 'en', source: 'manual' });
  assert.ok(env.cancels >= 1);
  assert.equal(env.spoken.length, 2);
});

test('cancelAndWait resolves after speaking clears', () => {
  const env = makeEnv([enVoice]); let resolved = false;
  env.S.speak('talking', { lang: 'en', source: 'voice' });
  assert.equal(env.isSpeaking(), true);
  env.S.cancelAndWait(() => { resolved = true; });
  assert.equal(env.isSpeaking(), false, 'cancel cleared speaking');
  assert.equal(resolved, true);
});

test('voice matches the reply language; missing → degrades (no throw, lang still set)', () => {
  const env = makeEnv([enVoice, arVoice]);
  env.S.speak('مرحبا', { lang: 'ar', source: 'manual' });
  assert.equal(env.spoken[0].voice, arVoice);
  const none = makeEnv([]);
  assert.doesNotThrow(() => none.S.speak('hello', { lang: 'en', source: 'manual' }));
  assert.equal(none.spoken[0].voice, null);
  assert.match(none.spoken[0].lang, /en/);
});

test('markdown/symbols stripped and length capped', () => {
  const env = makeEnv([enVoice]);
  env.S.speak('**Bold** _it_ `c` [link](http://x) # h', { lang: 'en', source: 'manual' });
  assert.ok(!/[*_`#]/.test(env.spoken[0].text));
  env.S.speak('a'.repeat(2000), { lang: 'en', source: 'manual' });
  assert.ok(env.spoken[1].text.length <= env.S.CAP);
});

test('voiceschanged: ensureVoices waits then resolves with loaded voices', () => {
  const env = makeEnv([]); let got = null;
  env.S.ensureVoices((v) => { got = v; }, 1500);
  assert.equal(got, null, 'not resolved while empty');
  env.fireVoicesChanged([arVoice]);
  assert.ok(got && got.length === 1, 'resolved once voices arrived');
});

test('ensureVoices resolves on timeout even if voiceschanged never fires', () => {
  const env = makeEnv([]); let got = null;
  env.S.ensureVoices((v) => { got = v; }, 1500);
  env.clk.advance(1600);
  assert.ok(got !== null, 'resolved after the timeout');
});

test('source gate: voice speaks in default mode, typed does not; off/always respected', () => {
  const env = makeEnv([enVoice]);
  assert.equal(env.S.speak('x', { lang: 'en', source: 'voice' }), true);
  env.S.cancel();
  assert.equal(env.S.speak('x', { lang: 'en', source: 'auto' }), false);
  env.S.setMode('always');
  assert.equal(env.S.speak('x', { lang: 'en', source: 'auto' }), true);
  env.S.setMode('off');
  assert.equal(env.S.speak('x', { lang: 'en', source: 'voice' }), false);
});
