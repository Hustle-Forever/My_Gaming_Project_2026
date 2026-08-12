// M2: the voice state machine (app/voice.js), driven with a fake clock + fake
// recognition + injected speak/handle so every transition and timeout is
// deterministic. This is the machine's contract; M3 verifies it for real in a
// browser (jsdom/node timers can't prove real Web Speech behaviour).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'app', 'voice.js'), 'utf8');

function makeClock() {
  let seq = 1, t = 0; const m = new Map();
  return {
    now: () => t,
    setTimeout: (fn, ms) => { const id = seq++; m.set(id, { fn, at: t + (ms || 0) }); return id; },
    clearTimeout: (id) => m.delete(id),
    advance(ms) {
      t += ms;
      let ran = true;
      while (ran) {
        ran = false;
        const due = [...m.entries()].filter(([, x]) => x.at <= t).sort((a, b) => a[1].at - b[1].at);
        for (const [id, x] of due) { if (m.has(id)) { m.delete(id); ran = true; x.fn(); } }
      }
    },
    size: () => m.size,
  };
}

function finalResult(text) {
  const row = [{ transcript: text }]; row.isFinal = true; // row[0].transcript, row.isFinal
  const results = [row]; results.length = 1;
  return { resultIndex: 0, results };
}

function load(opts = {}) {
  opts = opts;
  const clk = makeClock();
  let lastRec = null;
  const recs = [];
  function Ctor() {
    lastRec = this; recs.push(this);
    this.started = 0; this.stopped = 0; this.aborted = 0; this.lang = '';
    this._startBehavior = opts.startBehavior || null;
    this._ended = true;
    // Real recognition ALWAYS fires onend after stop()/abort() — model that, so
    // `recognizing` clears exactly like a browser and the loop can relisten.
    this._end = function () { if (this._ended) return; this._ended = true; if (this.onend) this.onend(); };
    this.start = function () {
      this.started++; this._ended = false;
      if (this._startBehavior) { const b = this._startBehavior; this._startBehavior = null; b.call(this); }
      if (this.onstart) this.onstart();
    };
    this.stop = function () { this.stopped++; this._end(); };
    this.abort = function () { this.aborted++; this._end(); };
  }
  const states = [], events = [], errors = [];
  const handleCalls = [], speakCalls = [];
  let cancelSpeakCount = 0;

  const sandbox = { window: {}, console, setTimeout, clearTimeout, setInterval, clearInterval, Date };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  const V = sandbox.window.M2Voice;
  V.configure({
    recognitionCtor: Ctor,
    scheduler: { setTimeout: clk.setTimeout, clearTimeout: clk.clearTimeout, now: clk.now },
    timings: { LISTEN_MS: 9000, TRANSCRIBE_MS: 4000, THINK_MS: 15000, SPEAK_MAX_MS: 23000, SETTLE_MS: 350 },
    recLang: () => 'en-US',
    handle: (text, cb) => handleCalls.push({ text, cb }),
    speak: (text, lang, onDone) => { speakCalls.push({ text, lang, onDone }); return true; },
    ensureSilent: (cb) => cb(),
    cancelSpeak: () => { cancelSpeakCount++; },
    onState: (s) => states.push(s),
    onEvent: (e, d) => events.push({ e, d }),
    onError: (code, msg) => errors.push({ code, msg }),
  });
  return { V, clk, rec: () => lastRec, recs, states, events, errors, handleCalls, speakCalls, cancelSpeaks: () => cancelSpeakCount };
}

// convenience: drive a fresh machine up to the SPEAKING state
function toSpeaking(h) {
  h.V.start();
  h.rec().onresult(finalResult('hello'));
  h.handleCalls[h.handleCalls.length - 1].cb({ text: 'hi there', lang: 'en' });
}

test('start → listening and recognition is started once', () => {
  const h = load();
  assert.equal(h.V.start(), true);
  assert.equal(h.V.state(), 'listening');
  assert.equal(h.rec().started, 1);
});

test('final result → transcribing → thinking (handler receives the transcript)', () => {
  const h = load();
  h.V.start();
  h.rec().onresult(finalResult('spawn a car'));
  assert.equal(h.V.state(), 'thinking');
  assert.equal(h.handleCalls.length, 1);
  assert.equal(h.handleCalls[0].text, 'spawn a car');
  assert.ok(h.rec().stopped >= 1, 'recognition stopped after the final result');
});

test('reply → speaking; speech done → loops back to listening', () => {
  const h = load();
  toSpeaking(h);
  assert.equal(h.V.state(), 'speaking');
  assert.equal(h.speakCalls.length, 1);
  h.speakCalls[0].onDone('end');       // speech finished
  h.clk.advance(350);                  // settle delay
  assert.equal(h.V.state(), 'listening', 'loops back to listening');
  assert.equal(h.rec().started, 2, 'a fresh listen was started');
});

test('recognition end WITHOUT a final result = silence → idle', () => {
  const h = load();
  h.V.start();
  h.rec().onend();
  assert.equal(h.V.state(), 'idle');
  assert.equal(h.V.running(), false);
});

test('a final result THEN end does not double-advance', () => {
  const h = load();
  h.V.start();
  h.rec().onresult(finalResult('heal me'));
  assert.equal(h.V.state(), 'thinking');
  h.rec().onend();                     // late end after success
  assert.equal(h.V.state(), 'thinking', 'still thinking, not restarted');
  assert.equal(h.handleCalls.length, 1);
});

test('double start is a no-op (never two recognitions)', () => {
  const h = load();
  h.V.start();
  const started = h.rec().started;
  assert.equal(h.V.start(), false);
  assert.equal(h.rec().started, started, 'recognition not started again');
  assert.equal(h.V.state(), 'listening');
});

test('start() throwing InvalidStateError → abort then retry', () => {
  const h = load({ startBehavior: function () { throw Object.assign(new Error('already started'), { name: 'InvalidStateError' }); } });
  h.V.start();                         // first start() throws
  assert.equal(h.rec().aborted, 1, 'aborted the stuck session');
  h.clk.advance(150);                  // retry timer
  assert.equal(h.V.state(), 'listening');
  assert.ok(h.rec().started >= 2, 'retried start');
});

test('listen timeout (no speech) lands in idle', () => {
  const h = load();
  h.V.start();
  h.clk.advance(9000);
  assert.equal(h.V.state(), 'idle');
});

test('think timeout → visible error + idle, and the late reply is ignored', () => {
  const h = load();
  h.V.start();
  h.rec().onresult(finalResult('what can you do'));
  assert.equal(h.V.state(), 'thinking');
  h.clk.advance(15000);
  assert.equal(h.V.state(), 'idle');
  assert.ok(h.errors.some((e) => e.code === 'timeout'));
  h.handleCalls[0].cb({ text: 'late', lang: 'en' });   // arrives after timeout
  assert.equal(h.V.state(), 'idle', 'late reply ignored');
});

test('speak watchdog backstop: if onDone never fires, SPEAK_MAX recovers the loop', () => {
  const h = load();
  toSpeaking(h);
  h.clk.advance(23000);                // machine-level speaking backstop
  h.clk.advance(350);                  // settle
  assert.equal(h.V.state(), 'listening', 'recovered — never hangs in speaking');
});

test('turn cap ends the loop', () => {
  const h = load();
  h.V.setMaxTurns(1);
  toSpeaking(h);
  h.speakCalls[0].onDone('end');
  assert.equal(h.V.state(), 'idle');
  assert.equal(h.V.running(), false);
});

test('stop from listening / thinking / speaking all reach idle; stop is idempotent', () => {
  for (const at of ['listening', 'thinking', 'speaking']) {
    const h = load();
    h.V.start();
    if (at !== 'listening') h.rec().onresult(finalResult('go'));
    if (at === 'speaking') h.handleCalls[0].cb({ text: 'ok', lang: 'en' });
    assert.equal(h.V.state(), at, 'reached ' + at);
    h.V.stop();
    assert.equal(h.V.state(), 'idle', 'stop from ' + at + ' → idle');
    assert.equal(h.V.running(), false);
    assert.doesNotThrow(() => h.V.stop());   // idempotent
    assert.equal(h.V.state(), 'idle');
  }
});

test('barge-in from speaking cancels speech and starts listening', () => {
  const h = load();
  toSpeaking(h);
  assert.equal(h.V.state(), 'speaking');
  const before = h.rec().started;
  assert.equal(h.V.bargeIn(), true);
  assert.ok(h.cancelSpeaks() >= 1, 'speech cancelled');
  assert.equal(h.V.state(), 'listening');
  assert.ok(h.rec().started > before, 'listening again');
});

test('permission error surfaces a visible error and lands in idle', () => {
  const h = load();
  h.V.start();
  h.rec().onerror({ error: 'not-allowed' });
  assert.equal(h.V.state(), 'idle');
  assert.ok(h.errors.some((e) => e.code === 'not-allowed' && e.msg === 'mic-permission'));
});

test('network error surfaces and lands in idle', () => {
  const h = load();
  h.V.start();
  h.rec().onerror({ error: 'network' });
  assert.equal(h.V.state(), 'idle');
  assert.ok(h.errors.some((e) => e.msg === 'network'));
});

test('reply handler returning nothing → error + idle (not a hang)', () => {
  const h = load();
  h.V.start();
  h.rec().onresult(finalResult('hi'));
  h.handleCalls[0].cb(null, 'server down');
  assert.equal(h.V.state(), 'idle');
  assert.ok(h.errors.some((e) => e.code === 'reply'));
});
