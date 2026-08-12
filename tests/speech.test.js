// M4: the browser-TTS engine (app/speech.js). Driven in jsdom with a mocked
// speechSynthesis. Proves: auto-speak fires for voice input and NOT for typed;
// manual play always works; the voice matches the reply language; a new
// utterance cancels the previous one; the Settings toggle is respected;
// markdown is stripped and length capped; missing voices degrade silently;
// async voice loading (voiceschanged) is handled.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'app', 'speech.js'), 'utf8');

// A fake speechSynthesis + utterance, capturing what would be spoken.
function makeEnv(voices = []) {
  const spoken = [];
  let cancels = 0;
  let voicesChangedHandler = null;
  const synth = {
    _voices: voices,
    getVoices() { return this._voices; },
    speak(u) { spoken.push(u); u._started = true; if (u.onstart) u.onstart({}); },
    cancel() { cancels++; const last = spoken[spoken.length - 1]; if (last && !last._ended && last.onend) { last._ended = true; last.onend({}); } },
    set onvoiceschanged(fn) { voicesChangedHandler = fn; },
    get onvoiceschanged() { return voicesChangedHandler; },
  };
  function Utt(text) { this.text = text; this.lang = ''; this.voice = null; this.rate = 1; this.onstart = null; this.onend = null; this.onerror = null; }
  const win = {};
  const sandbox = {
    window: win,
    speechSynthesis: synth,
    SpeechSynthesisUtterance: Utt,
    setTimeout, clearTimeout, console,
  };
  sandbox.window.speechSynthesis = synth;
  sandbox.window.SpeechSynthesisUtterance = Utt;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return { S: sandbox.window.M2Speech, spoken, synth, fireVoicesChanged: (v) => { synth._voices = v; if (voicesChangedHandler) voicesChangedHandler(); }, get cancels() { return cancels; } };
}

const arVoice = { name: 'Majed', lang: 'ar-SA' };
const enVoice = { name: 'Samantha', lang: 'en-US' };

test('default mode "voice": auto-speaks a voice-sourced reply, skips a typed one', () => {
  const { S, spoken } = makeEnv([enVoice]);
  assert.equal(S.getMode(), 'voice');
  assert.equal(S.speak('hello there', { lang: 'en', source: 'voice' }), true);
  assert.equal(spoken.length, 1);
  assert.equal(S.speak('typed reply', { lang: 'en', source: 'auto' }), false, 'typed input does not auto-speak');
  assert.equal(spoken.length, 1);
});

test('manual play always speaks regardless of source', () => {
  const { S, spoken } = makeEnv([enVoice]);
  assert.equal(S.speak('play me', { lang: 'en', source: 'manual' }), true);
  assert.equal(spoken.length, 1);
});

test('mode "always" speaks typed replies too; mode "off" speaks nothing automatically', () => {
  const a = makeEnv([enVoice]);
  a.S.setMode('always');
  assert.equal(a.S.speak('x', { lang: 'en', source: 'auto' }), true);

  const b = makeEnv([enVoice]);
  b.S.setMode('off');
  assert.equal(b.S.speak('x', { lang: 'en', source: 'voice' }), false);
  assert.equal(b.spoken.length, 0);
});

test('voice matches the reply language', () => {
  const { S, spoken } = makeEnv([enVoice, arVoice]);
  S.speak('مرحبا', { lang: 'ar', source: 'manual' });
  assert.equal(spoken[0].voice, arVoice, 'picked the ar-* voice');
  S.speak('hello', { lang: 'en', source: 'manual' });
  assert.equal(spoken[1].voice, enVoice, 'picked the en-* voice');
});

test('a new utterance cancels the in-progress one (never overlap)', () => {
  const env = makeEnv([enVoice]);
  env.S.speak('first', { lang: 'en', source: 'manual' });
  env.S.speak('second', { lang: 'en', source: 'manual' });
  assert.ok(env.cancels >= 1, 'cancel called before the second utterance');
  assert.equal(env.spoken.length, 2);
});

test('markdown/symbols are stripped and length is capped before speaking', () => {
  const { S, spoken } = makeEnv([enVoice]);
  S.speak('**Bold** _italic_ `code` [link](http://x) # heading', { lang: 'en', source: 'manual' });
  const t = spoken[0].text;
  assert.ok(!/[*_`#]/.test(t), 'symbols stripped: ' + t);
  assert.ok(/Bold/.test(t) && /italic/.test(t) && /link/.test(t));

  const long = 'a'.repeat(2000);
  S.speak(long, { lang: 'en', source: 'manual' });
  assert.ok(spoken[1].text.length <= S.CAP, 'capped to ' + S.CAP);
});

test('missing voices degrade silently — still speaks, no throw', () => {
  const { S, spoken } = makeEnv([]); // no voices installed
  assert.doesNotThrow(() => S.speak('hello', { lang: 'en', source: 'manual' }));
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].voice, null, 'no voice object, but lang is still set');
  assert.ok(/en/.test(spoken[0].lang));
});

test('voices that load asynchronously (voiceschanged) are picked up', () => {
  const env = makeEnv([]); // empty at first
  env.S.speak('مرحبا', { lang: 'ar', source: 'manual' });
  assert.equal(env.spoken[0].voice, null, 'no ar voice yet');
  env.fireVoicesChanged([arVoice]); // voices arrive
  env.S.speak('مرحبا', { lang: 'ar', source: 'manual' });
  assert.equal(env.spoken[1].voice, arVoice, 'ar voice used once loaded');
});

test('state callback fires speaking → idle across an utterance', () => {
  const { S, synth } = makeEnv([enVoice]);
  const states = [];
  S.onstate((s) => states.push(s));
  S.speak('hi', { lang: 'en', source: 'manual' }); // onstart → speaking
  assert.equal(S.speaking(), true);
  synth.cancel(); // simulate end
  assert.deepEqual(states, ['speaking', 'idle']);
  assert.equal(S.speaking(), false);
});
