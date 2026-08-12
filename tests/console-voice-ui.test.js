// Glue: the console (app/index.html) wires correctly to the M2Voice state
// machine + M2Speech driver. The machine/driver themselves are proven in
// voice-machine.test.js / speech.test.js and for real in the browser (M3); this
// only checks the console's bindings: mic tap → toggle, state → UI, error →
// visible message, the debug panel, and typed send (stop loop + speak per mode).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { JSDOM } = require('jsdom');

function mockVoice() {
  let cfg = {}; let state = 'idle'; let running = false; const calls = []; let sup = { recognition: true, synthesis: true, secure: true };
  return {
    calls, cfg: () => cfg, setSupported: (s) => { sup = s; },
    engine: {
      states: { IDLE: 'idle', LISTENING: 'listening', TRANSCRIBING: 'transcribing', THINKING: 'thinking', SPEAKING: 'speaking' },
      configure: (c) => { for (const k in c) cfg[k] = c[k]; },
      start: () => { calls.push('start'); running = true; return true; },
      stop: () => { calls.push('stop'); running = false; },
      toggle: () => { calls.push('toggle'); running = !running; return running; },
      bargeIn: () => { calls.push('barge'); return true; },
      state: () => state, running: () => running, turns: () => 0,
      setMaxTurns: () => {}, setDebug: (b) => { calls.push('debug:' + b); },
      snapshot: () => ({ state, running, turns: 0, lastEvent: 'result', lastError: null, elapsedMs: 12, recLang: 'en-US', recognizing: false, recognition: sup.recognition, synthesis: sup.synthesis, secure: sup.secure, voicesLoaded: 3 }),
      supported: () => sup,
      injectTranscript: () => true,
    },
  };
}
function mockSpeech() {
  const calls = []; let mode = 'voice';
  return { calls, engine: {
    CAP: 260, supported: () => true, getMode: () => mode, setMode: (m) => { mode = m; return mode; },
    speak: (t, o) => { calls.push({ t, o: o || {} }); return true; }, cancel: () => calls.push({ cancel: true }),
    cancelAndWait: (cb) => cb && cb(), speaking: () => false, onstate: () => {}, voices: () => [{ lang: 'en-US' }, { lang: 'ar-SA' }],
    ensureVoices: (cb) => cb([]), hasVoiceFor: () => true,
  } };
}

async function loadConsole() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.html'), 'utf8');
  const V = mockVoice(); const Sp = mockSpeech();
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'http://localhost/',
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      w.M2Voice = V.engine; w.M2Speech = Sp.engine;
      w.scrollTo = () => {};
      w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      w.requestAnimationFrame = () => 0; w.cancelAnimationFrame = () => {};
    },
  });
  await new Promise((r) => setTimeout(r, 150));
  const win = dom.window;
  win.authedFetch = async () => ({ status: 200, ok: true, json: async () => ({ ok: true, reply: 'Hi.', message: 'Done.', action: 'none', queued: false, lang: 'en' }) });
  return { win, V, Sp };
}

test('mic tap toggles the machine when supported', async () => {
  const { win, V } = await loadConsole();
  win.toggleMic();
  assert.ok(V.calls.includes('toggle'));
});

test('insecure context / no recognition → visible message, no toggle', async () => {
  const { win, V } = await loadConsole();
  V.setSupported({ recognition: true, synthesis: true, secure: false });
  win.toggleMic();
  assert.match(win.document.getElementById('feed').textContent, /secure/i);
  V.setSupported({ recognition: false, synthesis: true, secure: true });
  win.toggleMic();
  assert.ok(!V.calls.includes('toggle'), 'never toggled while unsupported');
});

test('state drives the UI: listening overlay, thinking/speaking pill, idle hides', async () => {
  const { win, V } = await loadConsole();
  const onState = V.cfg().onState; assert.equal(typeof onState, 'function');
  onState('listening'); assert.ok(win.document.getElementById('lis').classList.contains('show'));
  onState('thinking'); assert.ok(win.document.getElementById('speakbar').classList.contains('show'));
  assert.match(win.document.getElementById('speakState').textContent, /Thinking|أفكّر/);
  onState('speaking'); assert.match(win.document.getElementById('speakState').textContent, /Speaking|أتحدث/);
  onState('idle');
  assert.ok(!win.document.getElementById('lis').classList.contains('show'));
  assert.ok(!win.document.getElementById('speakbar').classList.contains('show'));
});

test('errors surface a visible message with the code', async () => {
  const { win, V } = await loadConsole();
  V.cfg().onError('not-allowed', 'mic-permission');
  assert.match(win.document.getElementById('feed').textContent, /not-allowed/);
});

test('voice debug toggle shows the panel and drives the machine', async () => {
  const { win, V } = await loadConsole();
  win.setVoiceDebug(true);
  assert.ok(win.document.getElementById('vdbg').classList.contains('show'));
  assert.ok(V.calls.includes('debug:true'));
  assert.match(win.document.getElementById('vdbg').textContent, /state|rec lang|voices/);
});

test('typed send stops any voice loop, renders, and speaks per the toggle', async () => {
  const { win, V, Sp } = await loadConsole();
  win.setMode('ask');
  await win.send('what can you do?');
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(V.calls.includes('stop'), 'typing interrupts the hands-free loop');
  assert.match(win.document.getElementById('feed').textContent, /Hi\./);
  const spoke = Sp.calls.find((c) => c.t);
  assert.ok(spoke && spoke.o.source === 'auto', 'typed reply offered to speak as auto');
});

test('the machine handler renders a turn and returns the speakable reply', async () => {
  const { win, V } = await loadConsole();
  win.setMode('ask');
  const handle = V.cfg().handle; assert.equal(typeof handle, 'function');
  const reply = await new Promise((res) => handle('hello', (r) => res(r)));
  assert.ok(reply && /Hi\./.test(reply.text), 'reply text handed back to the machine');
  assert.equal(reply.lang, 'en');
});

test('M5: thinking is visually distinct from speaking (class toggle)', async () => {
  const { win, V } = await loadConsole();
  const onState = V.cfg().onState;
  onState('thinking');
  assert.ok(win.document.getElementById('speakbar').classList.contains('thinking'));
  onState('speaking');
  assert.ok(!win.document.getElementById('speakbar').classList.contains('thinking'));
});

test('M4: a hidden tab stops the loop (never leave the mic open in the background)', async () => {
  const { win, V } = await loadConsole();
  win.M2Voice.start();                     // running
  Object.defineProperty(win.document, 'hidden', { value: true, configurable: true });
  win.document.dispatchEvent(new win.Event('visibilitychange'));
  assert.ok(V.calls.includes('stop'), 'loop stopped when the tab was hidden');
});

test('M4: no Arabic voice → one-time notice, never thrown', async () => {
  const { win, Sp } = await loadConsole();
  Sp.engine.hasVoiceFor = () => false;     // device has no ar voice
  assert.doesNotThrow(() => win.maybeWarnVoice('ar'));
  const feed = win.document.getElementById('feed').textContent;
  assert.match(feed, /Arabic voice|صوت عربي/);
  const count1 = (win.document.getElementById('feed').textContent.match(/Arabic voice|صوت عربي/g) || []).length;
  win.maybeWarnVoice('ar');                // second time: no new notice
  const count2 = (win.document.getElementById('feed').textContent.match(/Arabic voice|صوت عربي/g) || []).length;
  assert.equal(count1, count2, 'warned only once');
});
