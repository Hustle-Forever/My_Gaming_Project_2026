// app/voice.js - THE voice state machine (window.M2Voice). One explicit FSM that
// owns recognition + the conversation loop and drives synthesis through the
// app/speech.js driver. Every transition is deliberate and EVERY state has a
// timeout that lands somewhere safe — the machine can never hang.
//
//   idle → listening → transcribing → thinking → speaking → (listening | idle)
//
// Real-browser truths this machine is built around (see docs/FRONTEND.md):
//   * recognition.onend fires for success, silence, AND errors — so we track
//     whether a FINAL result arrived and branch on that, never on onend alone.
//   * recognition.start() throws InvalidStateError if already running — every
//     start is guarded and wrapped, with an abort-then-retry fallback.
//   * We never start recognition while synthesis is speaking (the mic would hear
//     the assistant) — speaking fully settles first (cancelAndWait + a delay).
//   * synthesis onend is unreliable — the speech driver guarantees onDone via a
//     watchdog, so "speaking" always ends.
//   * stop() is idempotent from any state: abort recognition, cancel synthesis,
//     clear timers, land in idle. Calling it twice is harmless.
(function () {
  var S = { IDLE: 'idle', LISTENING: 'listening', TRANSCRIBING: 'transcribing', THINKING: 'thinking', SPEAKING: 'speaking' };
  var DEFAULT_TIMINGS = { LISTEN_MS: 9000, TRANSCRIBE_MS: 4000, THINK_MS: 15000, SPEAK_MAX_MS: 23000, SETTLE_MS: 350 };

  var cfg = {};
  var state = S.IDLE, running = false, stopping = false, recognizing = false;
  var rec = null, turns = 0, MAX_TURNS = 12;
  var stateTimer = null, stateStart = 0, lastEvent = '', lastError = null;
  var gotFinal = false, finalText = '', thinkSeq = 0, debug = false, restarting = false;

  // ---- injectable environment (defaults = real browser) ----
  function sched() { return cfg.scheduler || null; }
  function setT(fn, ms) { var s = sched(); return s ? s.setTimeout(fn, ms) : setTimeout(fn, ms); }
  function clrT(id) { var s = sched(); if (id != null) { s ? s.clearTimeout(id) : clearTimeout(id); } }
  function now() { var s = sched(); return s && s.now ? s.now() : Date.now(); }
  function T(name) { return (cfg.timings && cfg.timings[name] != null) ? cfg.timings[name] : DEFAULT_TIMINGS[name]; }
  function recCtor() { return cfg.recognitionCtor || window.SpeechRecognition || window.webkitSpeechRecognition; }
  function recLang() { return cfg.recLang ? cfg.recLang() : 'en-US'; }

  function log(evt, detail) {
    lastEvent = evt;
    if (debug && typeof console !== 'undefined') { try { console.log('[voice]', now(), evt, detail || ''); } catch (e) {} }
    if (cfg.onEvent) { try { cfg.onEvent(evt, detail || {}); } catch (e) {} }
  }
  function emitState(meta) {
    stateStart = now();
    if (cfg.onState) { try { cfg.onState(state, meta || {}); } catch (e) {} }
  }
  function emitError(code, message, detail) {
    lastError = { code: code, message: message, detail: detail || null, at: now() };
    log('machine-error', lastError);
    if (cfg.onError) { try { cfg.onError(code, message, detail || null); } catch (e) {} }
  }
  // Map a getUserMedia / recognition DOMException to a stable code + message.
  function micErrorInfo(err) {
    var name = (err && err.name) || '';
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return { code: 'not-allowed', msg: 'mic-permission' };
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'NotReadableError' || name === 'TrackStartError') return { code: 'audio-capture', msg: 'mic-missing' };
    return { code: 'start-failed', msg: (err && err.message) || 'start failed' };
  }

  function clearStateTimer() { if (stateTimer != null) { clrT(stateTimer); stateTimer = null; } }
  function go(next, meta) {
    clearStateTimer();
    state = next;
    emitState(meta);
    armTimeout();
  }
  function armTimeout() {
    if (state === S.LISTENING) stateTimer = setT(onListenTimeout, T('LISTEN_MS'));
    else if (state === S.TRANSCRIBING) stateTimer = setT(function () { if (state === S.TRANSCRIBING) beginThinking(); }, T('TRANSCRIBE_MS'));
    else if (state === S.THINKING) stateTimer = setT(onThinkTimeout, T('THINK_MS'));
    else if (state === S.SPEAKING) stateTimer = setT(onSpeakTimeout, T('SPEAK_MAX_MS'));
  }

  // ---------------- recognition ----------------
  function ensureRec() {
    if (rec) return rec;
    var Ctor = recCtor();
    if (!Ctor) return null;
    rec = new Ctor();
    try { rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1; } catch (e) {}
    rec.onstart = function () { recognizing = true; log('start'); };
    rec.onaudiostart = function () { log('audiostart'); };
    rec.onsoundstart = function () { log('soundstart'); };
    rec.onspeechstart = function () { log('speechstart'); };
    rec.onresult = onRecResult;
    rec.onnomatch = function () { log('nomatch'); };
    rec.onspeechend = function () { log('speechend'); };
    rec.onsoundend = function () { log('soundend'); };
    rec.onaudioend = function () { log('audioend'); };
    rec.onend = function () { recognizing = false; log('end'); onRecEnd(); };
    rec.onerror = function (e) { log('error', { error: e && e.error }); onRecError(e && e.error); };
    return rec;
  }

  function onRecResult(e) {
    var it = '', fi = '';
    try {
      for (var i = e.resultIndex; i < e.results.length; i++) {
        var s = e.results[i][0].transcript;
        if (e.results[i].isFinal) fi += s; else it += s;
      }
    } catch (err) {}
    log('result', { interim: it, final: fi });
    if (cfg.onInterim) { try { cfg.onInterim((fi || it).trim()); } catch (e2) {} }
    if (fi.trim()) {
      gotFinal = true; finalText = fi.trim();
      try { rec.stop(); } catch (e3) {}          // stop capturing; onend will no-op (gotFinal)
      if (state === S.LISTENING) { go(S.TRANSCRIBING, { transcript: finalText }); beginThinking(); }
    }
  }

  function onRecEnd() {
    if (stopping || restarting) return;            // intentional teardown/restart
    if (!running) return;                          // conversation already ended
    if (gotFinal) return;                          // success path already advanced
    if (state === S.LISTENING) onSilence();        // ended with no result → silence
  }

  function onRecError(code) {
    if (stopping) return;
    if (code === 'no-speech') { onSilence(); return; }
    if (code === 'aborted') { if (state === S.LISTENING) safeIdle('aborted'); return; }
    var msg;
    if (code === 'not-allowed' || code === 'service-not-allowed') msg = 'mic-permission';
    else if (code === 'audio-capture') msg = 'mic-missing';
    else if (code === 'network') msg = 'network';
    else msg = 'recognition';
    emitError(code || 'recognition', msg);
    safeIdle('error');
  }

  function onSilence() {
    if (!running) return;                          // idempotent: don't end twice
    log('silence');
    if (cfg.onSilence) { try { cfg.onSilence(); } catch (e) {} }
    safeIdle('silence');
  }

  function startRecognition() {
    var r = ensureRec();
    if (!r) { emitError('unsupported', 'no-recognition'); safeIdle('unsupported'); return; }
    if (recognizing) return;                        // already running — never double-start
    try { r.lang = recLang(); } catch (e) {}
    try {
      r.start();
    } catch (err) {
      var name = err && err.name;
      // Permission / device errors are not transient — surface them, don't retry.
      if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'NotFoundError' || name === 'NotReadableError') {
        var info = micErrorInfo(err);
        emitError(info.code, info.msg, { name: name, message: err && err.message });
        safeIdle(info.code); return;
      }
      // Anything other than InvalidStateError won't be fixed by a retry either.
      if (name && name !== 'InvalidStateError') {
        emitError('start-failed', err && err.message, { name: name, message: err && err.message });
        safeIdle('start-failed'); return;
      }
      // InvalidStateError: an old session lingers → abort then retry once. The
      // abort fires onend synchronously; `restarting` keeps that from being read
      // as silence and ending the conversation.
      log('start-threw', { name: name, message: err && err.message });
      restarting = true;
      try { r.abort(); } catch (e2) {}
      restarting = false;
      setT(function () {
        if (state !== S.LISTENING) return;
        try { r.start(); } catch (e3) {
          var i2 = micErrorInfo(e3);
          emitError(i2.code, i2.msg, { name: e3 && e3.name, message: e3 && e3.message });
          safeIdle(i2.code);
        }
      }, 150);
    }
  }

  function startListening() {
    gotFinal = false; finalText = '';
    go(S.LISTENING);
    // Request mic permission BEFORE recognition.start() (when the host provides
    // requestMic). This gives a clean permission prompt + a precise error to
    // surface, instead of an opaque start() throw. No requestMic → start directly.
    if (cfg.requestMic) {
      var handled = false;
      var fail = function (err) {
        if (handled || state !== S.LISTENING) return; handled = true;
        var info = micErrorInfo(err);
        emitError(info.code, info.msg, { name: err && err.name, message: err && err.message });
        safeIdle(info.code);
      };
      try {
        Promise.resolve(cfg.requestMic()).then(function () {
          if (handled || state !== S.LISTENING) return; handled = true;
          startRecognition();
        }, fail);
      } catch (e) { fail(e); }
    } else {
      startRecognition();
    }
  }

  function onListenTimeout() { if (state === S.LISTENING) { log('listen-timeout'); try { rec && rec.stop(); } catch (e) {} onSilence(); } }

  // ---------------- thinking ----------------
  function beginThinking() {
    if (state !== S.TRANSCRIBING && state !== S.LISTENING) return;
    var token = ++thinkSeq;
    go(S.THINKING, { transcript: finalText });
    if (!cfg.handle) { emitError('no-handler', 'no handle configured'); safeIdle('no-handler'); return; }
    try {
      cfg.handle(finalText, function (reply, errMsg) {
        if (token !== thinkSeq || state !== S.THINKING) return;   // superseded / stopped / timed out
        if (!reply || !reply.text) { if (errMsg) emitError('reply', errMsg); safeIdle('reply-error'); return; }
        beginSpeaking(reply.text, reply.lang);
      });
    } catch (e) { emitError('handle-threw', e && e.message); safeIdle('handle-error'); }
  }
  function onThinkTimeout() {
    if (state !== S.THINKING) return;
    thinkSeq++;                                     // invalidate the late callback
    emitError('timeout', 'reply-timeout');
    safeIdle('think-timeout');
  }

  // ---------------- speaking ----------------
  function beginSpeaking(text, lang) {
    go(S.SPEAKING, { text: text, lang: lang });
    turns++;
    var done = false;
    function onSpoken(reason) {
      if (done) return; done = true;
      log('speak-done', { reason: reason });
      afterSpeak();
    }
    var speakFn = cfg.speak || defaultSpeak;
    var started = speakFn(text, lang, onSpoken);
    if (started === false) onSpoken('skipped');     // nothing spoke → still continue the loop
  }
  function defaultSpeak(text, lang, onDone) {
    if (!window.M2Speech) { onDone('no-driver'); return false; }
    return window.M2Speech.speak(text, { lang: lang, source: 'voice', onDone: onDone });
  }
  function onSpeakTimeout() { if (state === S.SPEAKING) { log('speak-timeout'); afterSpeak(); } }  // backstop

  function afterSpeak() {
    if (state !== S.SPEAKING) return;
    clearStateTimer();
    if (!running) { state = S.IDLE; emitState({ reason: 'stopped' }); return; }
    if (turns >= MAX_TURNS) { finalizeEnd('turn-cap'); return; }
    // ensure synthesis has truly stopped, settle, then listen again.
    var relisten = function () { setT(function () { if (running) startListening(); }, T('SETTLE_MS')); };
    if (cfg.ensureSilent) cfg.ensureSilent(relisten);
    else if (window.M2Speech && window.M2Speech.cancelAndWait) window.M2Speech.cancelAndWait(relisten);
    else relisten();
  }

  // ---------------- lifecycle ----------------
  function safeIdle(reason) { finalizeEnd(reason); }
  function finalizeEnd(reason) {
    clearStateTimer();
    running = false; turns = 0; gotFinal = false;
    try { if (rec) rec.abort(); } catch (e) {}
    recognizing = false;
    state = S.IDLE;
    emitState({ reason: reason || 'end' });
  }

  function start() {
    if (running && state !== S.IDLE) return false;
    running = true; stopping = false; turns = 0; lastError = null;
    log('conversation-start');
    startListening();
    return true;
  }

  // Idempotent stop from ANY state → idle.
  function stop() {
    stopping = true;
    clearStateTimer();
    running = false; turns = 0; gotFinal = false;
    try { if (rec) rec.abort(); } catch (e) {}
    recognizing = false;
    if (cfg.cancelSpeak) { try { cfg.cancelSpeak(); } catch (e) {} }
    else if (window.M2Speech) { try { window.M2Speech.cancel(); } catch (e) {} }
    state = S.IDLE;
    emitState({ reason: 'stop' });
    stopping = false;
    log('conversation-stop');
  }

  // Barge-in: user speaks while the assistant is talking → cut speech, listen.
  function bargeIn() {
    if (state !== S.SPEAKING || !running) return false;
    log('barge-in');
    clearStateTimer();
    if (cfg.cancelSpeak) { try { cfg.cancelSpeak(); } catch (e) {} }
    else if (window.M2Speech) { try { window.M2Speech.cancel(); } catch (e) {} }
    startListening();
    return true;
  }

  window.M2Voice = {
    states: S,
    configure: function (c) { for (var k in c) if (Object.prototype.hasOwnProperty.call(c, k)) cfg[k] = c[k]; },
    start: start,
    stop: stop,
    toggle: function () { if (!running || state === S.IDLE) return start(); stop(); return false; },
    bargeIn: bargeIn,
    state: function () { return state; },
    running: function () { return running; },
    turns: function () { return turns; },
    setMaxTurns: function (n) { if (n > 0) MAX_TURNS = n; },
    setDebug: function (b) { debug = !!b; },
    snapshot: function () {
      var sup = supported();
      return {
        state: state, running: running, turns: turns,
        lastEvent: lastEvent, lastError: lastError,
        elapsedMs: now() - stateStart, recLang: recLang(),
        recognizing: recognizing,
        recognition: sup.recognition, synthesis: sup.synthesis, secure: sup.secure,
        voicesLoaded: (window.M2Speech ? window.M2Speech.voices().length : 0),
      };
    },
    supported: supported,
    // Feed a FINAL transcript through the real result code path — used by the
    // real-browser harness where the automation env has no speech backend.
    injectTranscript: function (text) {
      if (!running) return false;
      gotFinal = true; finalText = String(text || '');
      try { rec && rec.stop(); } catch (e) {}
      if (state === S.LISTENING) { go(S.TRANSCRIBING, { transcript: finalText }); beginThinking(); return true; }
      return false;
    },
  };

  function supported() {
    var recOk = !!recCtor();
    var synOk = !!(window.speechSynthesis && window.SpeechSynthesisUtterance);
    var secure = (typeof window.isSecureContext === 'undefined') ? true : !!window.isSecureContext;
    return { recognition: recOk, synthesis: synOk, secure: secure };
  }
})();
