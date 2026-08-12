// M5 (headless): the hands-free continuous-conversation loop in app/index.html.
// Driven in jsdom with a mock SpeechRecognition (records .start / exposes the
// live instance) and a mock M2Speech (lets the test fire speaking→idle). Proves:
// a voice reply relistens when speech ends; a typed message never loops; the
// turn cap, silence, an error, and Stop each end the loop.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { JSDOM } = require('jsdom');

const tick = () => new Promise((r) => setTimeout(r, 10));

function mockSpeech() {
  let stateCb = null; let mode = 'voice'; const calls = [];
  return {
    calls, fireState(s) { if (stateCb) stateCb(s); },
    engine: {
      CAP: 300, supported() { return true; }, getMode() { return mode; }, setMode(m) { mode = m; return mode; },
      speak(text, opts) { calls.push({ text, opts: opts || {} }); return true; },
      cancel() { calls.push({ cancel: true }); }, speaking() { return false; }, onstate(cb) { stateCb = cb; },
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
      w.M2Speech = speech.engine;
      w.scrollTo = () => {};
      w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      w.requestAnimationFrame = () => 0; w.cancelAnimationFrame = () => {};
      w.__starts = 0;
      w.SpeechRecognition = function () {
        w.__rec = this; this.interimResults = false; this.continuous = false; this.lang = '';
        this.onresult = null; this.onend = null; this.onerror = null;
        this.start = function () { w.__starts++; }; this.stop = function () {};
      };
    },
  });
  await new Promise((r) => setTimeout(r, 150));
  const win = dom.window;
  win.authedFetch = async () => ({ status: 200, ok: true, json: async () => ({ ok: true, reply: 'Sure.', message: 'Done.', action: 'none', queued: false, lang: 'en' }) });
  return { win, speech };
}

test('a voice reply relistens once speech finishes (listen → think → speak → listen)', async () => {
  const { win, speech } = await loadConsole();
  win.setMode('ask');
  await win.send('what can you do?', 'voice');
  await tick();
  assert.equal(win.__starts, 0, 'not listening yet — still speaking');
  assert.equal(win.M2Conv.session, true, 'hands-free session active');
  speech.fireState('idle');            // speech ended
  await tick();
  assert.equal(win.__starts, 1, 'automatically listening again');
});

test('a typed message never starts the loop', async () => {
  const { win, speech } = await loadConsole();
  win.setMode('ask');
  await win.send('typed question', 'type');
  await tick();
  assert.equal(win.M2Conv.session, false, 'typing does not open a voice session');
  speech.fireState('idle');
  await tick();
  assert.equal(win.__starts, 0, 'no auto-listen after a typed exchange');
});

test('the turn cap ends the loop', async () => {
  const { win, speech } = await loadConsole();
  win.M2Conv.setMaxTurns(2);
  win.setMode('ask');
  await win.send('one', 'voice'); speech.fireState('idle'); await tick();   // turn 1 → relisten
  assert.equal(win.__starts, 1);
  await win.send('two', 'voice'); await tick();                              // turn 2 → cap hit
  assert.equal(win.M2Conv.session, false, 'loop stopped at the cap');
  speech.fireState('idle'); await tick();
  assert.equal(win.__starts, 1, 'no relisten past the cap');
});

test('Stop ends the loop immediately', async () => {
  const { win, speech } = await loadConsole();
  win.setMode('ask');
  await win.send('hello', 'voice');
  assert.equal(win.M2Conv.session, true);
  win.stopSpeak();                       // the speaking-bar Stop
  assert.equal(win.M2Conv.session, false);
  speech.fireState('idle'); await tick();
  assert.equal(win.__starts, 0, 'Stop cancels the pending relisten');
});

test('silence ends the loop (recognition ends with nothing heard)', async () => {
  const { win } = await loadConsole();
  win.setMode('ask');
  await win.toggleMic();                 // start listening
  await tick();
  assert.equal(win.M2Conv.session, true);
  assert.equal(win.__starts, 1);
  win.__rec.onend();                     // ended with no result → silence
  assert.equal(win.M2Conv.session, false, 'silence stops the hands-free loop');
});

test('a recognition error ends the loop', async () => {
  const { win } = await loadConsole();
  win.setMode('ask');
  await win.toggleMic();
  await tick();
  win.__rec.onerror({ error: 'network' });
  assert.equal(win.M2Conv.session, false, 'errors never leave the mic looping');
});
