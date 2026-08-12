// app/speech.js - M2's spoken-reply device driver, built on the browser's
// speechSynthesis (no API cost, offline, no dependency). Behind a tiny interface
// (window.M2Speech) so a premium voice provider can swap in later. The voice
// STATE MACHINE lives in app/voice.js; this file is only the "speaker": it turns
// text into audio and GUARANTEES it reports completion exactly once.
//
// Hard-won real-browser rules this driver handles (jsdom never exposes them):
//   * speechSynthesis.onend does NOT reliably fire (cancel races, long text,
//     headless/no-voice). => every speak() arms a length-based WATCHDOG so the
//     caller's onDone always fires; the machine can never hang waiting on onend.
//   * Chrome silently pauses synthesis after ~15s. => a pause/resume KEEPALIVE.
//   * speechSynthesis.cancel() is asynchronous. => cancelAndWait() polls
//     `.speaking` until it is really false (capped) before the caller continues.
//   * getVoices() is empty on first call in Chrome. => ensureVoices() waits for
//     `voiceschanged` with a timeout, then proceeds with whatever exists.
(function () {
  var CAP = 260;                 // max characters spoken per utterance
  var mode = 'voice';            // 'off' | 'always' | 'voice' (default: only when I speak)
  var state = 'idle';            // 'idle' | 'speaking'
  var listeners = [];
  var current = null;            // { done, watchdog, keepalive, onDone }

  function synth() { return (typeof window !== 'undefined') && window.speechSynthesis; }
  function Utter() { return window.SpeechSynthesisUtterance; }
  function supported() { return !!(synth() && Utter()); }

  if (supported()) {
    try { synth().getVoices(); } catch (e) {}
    try { synth().onvoiceschanged = function () { try { synth().getVoices(); } catch (e) {} }; } catch (e) {}
  }

  function setState(s) {
    if (s === state) return;
    state = s;
    for (var i = 0; i < listeners.length; i++) { try { listeners[i](s); } catch (e) {} }
  }

  function autoOk(source) {
    if (mode === 'off') return false;
    if (mode === 'always') return true;
    return source === 'voice';
  }

  function voices() { try { return synth().getVoices() || []; } catch (e) { return []; } }
  function pickVoice(lang) {
    var target = lang === 'ar' ? 'ar' : 'en';
    var list = voices();
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].lang || '').toLowerCase().indexOf(target) === 0) return list[i];
    }
    return null;
  }
  function hasVoiceFor(lang) { return !!pickVoice(lang); }

  // Resolve cb(list) once voices exist, or after `timeout` with whatever there is.
  function ensureVoices(cb, timeout) {
    if (!supported()) { cb([]); return; }
    var list = voices();
    if (list.length) { cb(list); return; }
    var done = false;
    var to = setTimeout(function () { if (done) return; done = true; cb(voices()); }, timeout || 1500);
    try {
      synth().addEventListener('voiceschanged', function once() {
        if (done) return; done = true; clearTimeout(to);
        try { synth().removeEventListener('voiceschanged', once); } catch (e) {}
        cb(voices());
      });
    } catch (e) { /* addEventListener unsupported → the timeout still resolves */ }
  }

  function clean(text) {
    var t = String(text == null ? '' : text);
    t = t.replace(/!?\[([^\]]+)\]\([^)]*\)/g, '$1');
    t = t.replace(/[*_`#>~|]/g, '');
    t = t.replace(/\s+/g, ' ').trim();
    if (t.length > CAP) t = t.slice(0, CAP);
    return t;
  }

  // watchdog ms from text length — generous, but always finite.
  function watchdogMs(text) {
    var ms = 1200 + text.length * 60;      // ~16 chars/sec + base
    return Math.max(2500, Math.min(22000, ms));
  }

  function clearCurrentTimers() {
    if (!current) return;
    if (current.watchdog) { clearTimeout(current.watchdog); current.watchdog = null; }
    if (current.keepalive) { clearInterval(current.keepalive); current.keepalive = null; }
  }

  // Fire the caller's onDone exactly once (from onend / onerror / watchdog).
  function finish(reason) {
    if (!current || current.done) return;
    current.done = true;
    clearCurrentTimers();
    var cb = current.onDone;
    setState('idle');
    if (cb && reason !== 'cancel') { try { cb(reason); } catch (e) {} }
  }

  // Stop speaking WITHOUT reporting completion (used by the machine for
  // barge-in / stop — it drives the next state itself).
  function cancel() {
    if (current && !current.done) { current.done = true; clearCurrentTimers(); }
    current = null;
    if (supported()) { try { synth().cancel(); } catch (e) {} }
    setState('idle');
  }

  // cancel() and resolve cb once synthesis has really stopped (async in Chrome).
  function cancelAndWait(cb, capMs) {
    cancel();
    var cap = capMs || 1000, waited = 0, step = 25;
    function poll() {
      var speaking = false;
      try { speaking = !!(synth() && synth().speaking); } catch (e) {}
      if (!speaking || waited >= cap) { if (cb) cb(); return; }
      waited += step; setTimeout(poll, step);
    }
    poll();
  }

  // speak(text, { lang, source, onDone }) -> did speaking start?
  // onDone(reason) fires exactly once: 'end' | 'error' | 'watchdog'.
  function speak(text, opts) {
    opts = opts || {};
    var source = opts.source || 'auto';
    if (!supported()) { if (opts.onDone) opts.onDone('unsupported'); return false; }
    if (source !== 'manual' && !autoOk(source)) return false;
    var body = clean(text);
    if (!body) { if (opts.onDone) opts.onDone('empty'); return false; }

    cancel();                                          // never overlap
    var u = new (Utter())(body);
    var v = pickVoice(opts.lang);
    u.lang = v ? v.lang : (opts.lang === 'ar' ? 'ar-SA' : 'en-US');
    if (v) u.voice = v;
    u.rate = 1;

    current = { done: false, watchdog: null, keepalive: null, onDone: opts.onDone };
    u.onstart = function () { setState('speaking'); };
    u.onend = function () { finish('end'); };
    u.onerror = function () { finish('error'); };

    try { synth().speak(u); } catch (e) { finish('error'); return false; }

    // Watchdog: onend may never come — guarantee completion.
    current.watchdog = setTimeout(function () { finish('watchdog'); }, watchdogMs(body));
    // Keepalive: defeat Chrome's ~15s auto-pause.
    current.keepalive = setInterval(function () {
      try { if (synth().speaking && !synth().paused) { synth().pause(); synth().resume(); } } catch (e) {}
    }, 10000);
    return true;
  }

  window.M2Speech = {
    CAP: CAP,
    supported: supported,
    getMode: function () { return mode; },
    setMode: function (m) { if (m === 'off' || m === 'always' || m === 'voice') mode = m; if (m === 'off') cancel(); return mode; },
    speak: speak,
    cancel: cancel,
    cancelAndWait: cancelAndWait,
    speaking: function () { return state === 'speaking'; },
    onstate: function (cb) { if (typeof cb === 'function') listeners.push(cb); },
    ensureVoices: ensureVoices,
    hasVoiceFor: hasVoiceFor,
    voices: voices,
    // exposed for tests / future providers
    _pickVoice: pickVoice,
    _clean: clean,
    _watchdogMs: watchdogMs,
  };
})();
