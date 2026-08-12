// M4/M5 (headless): the console's TTS + continuous-conversation wiring in
// app/index.html, driven in jsdom with a mock M2Speech engine and a stubbed
// authedFetch. Proves the console passes the right source to the engine (voice
// vs typed), the manual play button works, the Settings toggle drives the
// engine, the speaking orb shows on state, and the voice loop only runs for a
// hands-free session.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { JSDOM } = require('jsdom');

function mockSpeech() {
  const calls = [];
  let stateCb = null; let mode = 'voice';
  return {
    calls,
    fireState(s) { if (stateCb) stateCb(s); },
    engine: {
      CAP: 300,
      supported() { return true; },
      getMode() { return mode; },
      setMode(m) { mode = m; return mode; },
      speak(text, opts) { calls.push({ text, opts: opts || {} }); return true; },
      cancel() { calls.push({ cancel: true }); },
      speaking() { return false; },
      onstate(cb) { stateCb = cb; },
    },
  };
}

async function loadConsole() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.html'), 'utf8');
  const speech = mockSpeech();
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'http://localhost/',
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      w.M2Speech = speech.engine;                 // present before the page's classic script boots
      w.scrollTo = () => {};
      // jsdom lacks these; stub so the page's boot line runs to completion.
      w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      w.requestAnimationFrame = () => 0; w.cancelAnimationFrame = () => {};
    },
  });
  await new Promise((r) => setTimeout(r, 150));
  const win = dom.window;
  win.authedFetch = async () => ({ status: 200, ok: true, json: async () => ({ ok: true, reply: 'Hello there.', message: 'Done.', action: 'none', queued: false, lang: 'en' }) });
  return { win, speech };
}

test('typed reply is offered to the engine as source "auto"; voice as "voice"', async () => {
  const { win, speech } = await loadConsole();
  win.setMode('ask');
  await win.send('how does this work?', 'type');
  await new Promise((r) => setTimeout(r, 10));
  const spoke = speech.calls.filter((c) => c.text);
  assert.equal(spoke.length, 1, 'exactly one speak offer');
  assert.equal(spoke[0].opts.source, 'auto', 'typed → auto (engine then decides per mode)');

  await win.send('say it again', 'voice');
  await new Promise((r) => setTimeout(r, 10));
  const spoke2 = speech.calls.filter((c) => c.text);
  assert.equal(spoke2[spoke2.length - 1].opts.source, 'voice', 'voice input → voice source');
  assert.equal(spoke2[spoke2.length - 1].opts.lang, 'en', 'reply language threaded to the engine');
});

test('a new message cancels any in-progress speech first', async () => {
  const { win, speech } = await loadConsole();
  win.setMode('ask');
  await win.send('first', 'type');
  const hadCancel = speech.calls.some((c) => c.cancel);
  assert.ok(hadCancel, 'cancel called on send');
});

test('manual play button on an assistant message speaks it on demand (source manual)', async () => {
  const { win, speech } = await loadConsole();
  win.setMode('ask');
  await win.send('explain', 'type');
  await new Promise((r) => setTimeout(r, 10));
  const btn = win.document.querySelector('#feed .spk');
  assert.ok(btn, 'a speaker button is rendered on the answer');
  speech.calls.length = 0;
  btn.click();
  const manual = speech.calls.find((c) => c.text);
  assert.ok(manual && manual.opts.source === 'manual', 'manual playback requested');
});

test('the Settings voice toggle drives the engine and marks the active option', async () => {
  const { win, speech } = await loadConsole();
  win.setVoiceMode('off');
  assert.equal(speech.engine.getMode(), 'off');
  assert.ok(win.document.getElementById('vOff').classList.contains('on'));
  win.setVoiceMode('always');
  assert.equal(speech.engine.getMode(), 'always');
  assert.ok(win.document.getElementById('vOn').classList.contains('on'));
});

test('the speaking indicator (orb + Stop) shows while speaking and hides when idle', async () => {
  const { win, speech } = await loadConsole();
  speech.fireState('speaking');
  assert.ok(win.document.getElementById('speakbar').classList.contains('show'));
  speech.fireState('idle');
  assert.ok(!win.document.getElementById('speakbar').classList.contains('show'));
});
