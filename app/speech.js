// app/speech.js - M2's spoken-reply engine, built on the browser's built-in
// speechSynthesis (no API cost, offline, no dependency). Deliberately behind a
// tiny interface (window.M2Speech) so a premium voice provider could be swapped
// in later without touching the console — see docs/FRONTEND.md.
//
// Rules it enforces (the rest of the console just calls speak/cancel):
//   * Auto-speak only when the reply came from a VOICE input; typed input never
//     auto-speaks (the Settings toggle can widen/narrow this).
//   * The voice matches the reply language (ar-* / en-*), degrading silently if
//     no matching voice is installed.
//   * Never two utterances at once: every speak() cancels the one in progress.
//   * Markdown/symbols stripped and length capped before speaking.
//   * Voices can load asynchronously (voiceschanged) — never assume they're ready.
(function () {
  var CAP = 300;                 // max characters spoken per utterance
  var mode = 'voice';            // 'off' | 'always' | 'voice' (default: only when I speak)
  var state = 'idle';            // 'idle' | 'speaking'
  var listeners = [];

  function synth() { return (typeof window !== 'undefined') && window.speechSynthesis; }
  function Utter() { return window.SpeechSynthesisUtterance; }
  function supported() { return !!(synth() && Utter()); }

  // Prime the voice list and keep it fresh (some browsers populate late).
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
    return source === 'voice';            // 'voice' mode: only when the user spoke
  }

  function pickVoice(lang) {
    var target = lang === 'ar' ? 'ar' : 'en';
    var list;
    try { list = synth().getVoices() || []; } catch (e) { list = []; }
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].lang || '').toLowerCase().indexOf(target) === 0) return list[i];
    }
    return null;
  }

  function clean(text) {
    var t = String(text == null ? '' : text);
    t = t.replace(/!?\[([^\]]+)\]\([^)]*\)/g, '$1'); // [label](url) / ![alt](src) -> label
    t = t.replace(/[*_`#>~|]/g, '');                  // markdown emphasis/heading/quote/table
    t = t.replace(/\s+/g, ' ').trim();
    if (t.length > CAP) t = t.slice(0, CAP);
    return t;
  }

  function cancel() {
    if (supported()) { try { synth().cancel(); } catch (e) {} }
    setState('idle');
  }

  // speak(text, { lang:'en'|'ar', source:'voice'|'auto'|'manual' }) -> did it speak?
  function speak(text, opts) {
    opts = opts || {};
    var source = opts.source || 'auto';
    if (!supported()) return false;
    if (source !== 'manual' && !autoOk(source)) return false; // typed/auto respects the toggle
    var body = clean(text);
    if (!body) return false;

    cancel();                                // never overlap
    var u = new (Utter())(body);
    var v = pickVoice(opts.lang);
    u.lang = v ? v.lang : (opts.lang === 'ar' ? 'ar-SA' : 'en-US');
    if (v) u.voice = v;
    u.rate = 1;
    u.onstart = function () { setState('speaking'); };
    u.onend = function () { setState('idle'); };
    u.onerror = function () { setState('idle'); };
    try { synth().speak(u); } catch (e) { setState('idle'); return false; }
    return true;
  }

  window.M2Speech = {
    CAP: CAP,
    supported: supported,
    getMode: function () { return mode; },
    setMode: function (m) { if (m === 'off' || m === 'always' || m === 'voice') mode = m; if (m === 'off') cancel(); return mode; },
    speak: speak,
    cancel: cancel,
    speaking: function () { return state === 'speaking'; },
    onstate: function (cb) { if (typeof cb === 'function') listeners.push(cb); },
    // exposed for tests / future providers
    _pickVoice: pickVoice,
    _clean: clean,
  };
})();
