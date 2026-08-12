// scripts/browser-voice-check.js - REAL-browser verification of the voice state
// machine (TASK_M2_VOICE_FIX M3). Serves the shipped app/ via the dev-server,
// launches Edge (Chromium) headless with fake-media flags, and drives the ACTUAL
// page over CDP (Node's global WebSocket — no installs). It exercises the real
// modules (voice.js + speech.js), real speechSynthesis, real timers.
//
// The automation environment has no Google speech backend, so audio→text (STT)
// cannot produce transcripts here; we inject a FINAL transcript through the same
// code path a real result takes (M2Voice.injectTranscript) and verify everything
// downstream for real. That gap is disclosed in the report.
//
// Usage: node scripts/browser-voice-check.js  (spawns its own dev-server)
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const PORT = process.env.VOICE_CHECK_PORT || '3007';
const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HEADLESS = process.env.VOICE_CHECK_HEADED ? false : true;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitHttp(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok || r.status === 404) return true; } catch (e) {}
    await sleep(250);
  }
  throw new Error('timeout waiting for ' + url);
}

// ---- minimal CDP client over the page-level WebSocket ----
function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0; const pending = new Map();
  const ready = new Promise((res, rej) => { ws.onopen = () => res(); ws.onerror = (e) => rej(new Error('ws error')); });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { const { resolve, reject } = pending.get(msg.id); pending.delete(msg.id); msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result); }
  };
  function send(method, params) { return new Promise((resolve, reject) => { const mid = ++id; pending.set(mid, { resolve, reject }); ws.send(JSON.stringify({ id: mid, method, params: params || {} })); }); }
  async function evaluate(expression, awaitPromise = true) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true, allowUnsafeEvalBlocklistedAPI: true });
    if (r.exceptionDetails) throw new Error('page exception: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
    return r.result && r.result.value;
  }
  return { ready, send, evaluate, close: () => ws.close() };
}

async function main() {
  const report = { headless: HEADLESS, steps: [] };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'm2edge-'));
  let dev, edge, client;
  const cleanup = () => { try { client && client.close(); } catch (e) {} try { edge && edge.kill(); } catch (e) {} try { dev && dev.kill(); } catch (e) {} };
  process.on('exit', cleanup);

  try {
    // 1. dev-server serving app/ (localhost = secure context for Web Speech)
    dev = spawn(process.execPath, [path.join(__dirname, 'dev-server.js')], { env: { ...process.env, PORT }, stdio: 'ignore' });
    await waitHttp(`http://127.0.0.1:${PORT}/`);
    report.steps.push('dev-server up on ' + PORT);

    // 2. launch Edge headless with fake media + a page open on the console
    const args = [
      HEADLESS ? '--headless=new' : '--new-window',
      '--remote-debugging-port=9222', `--user-data-dir=${tmp}`,
      '--no-first-run', '--no-default-browser-check', '--disable-gpu',
      '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      `http://127.0.0.1:${PORT}/`,
    ];
    edge = spawn(EDGE, args, { stdio: 'ignore' });
    await waitHttp('http://127.0.0.1:9222/json/version');

    // find the page target on our URL
    let target = null;
    for (let i = 0; i < 40 && !target; i++) {
      const list = await (await fetch('http://127.0.0.1:9222/json')).json();
      target = list.find((t) => t.type === 'page' && (t.url || '').includes(String(PORT)));
      if (!target) await sleep(250);
    }
    if (!target) throw new Error('no page target found');
    report.steps.push('edge page target attached');

    client = cdp(target.webSocketDebuggerUrl);
    await client.ready;
    await client.send('Runtime.enable');
    await client.send('Page.enable');

    // wait for the modules to load
    for (let i = 0; i < 40; i++) {
      const ok = await client.evaluate('!!(window.M2Voice && window.M2Speech)');
      if (ok) break; await sleep(250);
    }

    // ---- capability probe ----
    report.caps = await client.evaluate(`(function(){
      var s=window.M2Voice.supported();
      return { recognition:s.recognition, synthesis:s.synthesis, secure:s.secure,
        hasWebkitSR: !!(window.SpeechRecognition||window.webkitSpeechRecognition),
        hasSynth: !!window.speechSynthesis, voices: (window.M2Speech?window.M2Speech.voices().length:0) };
    })()`);

    // ---- REAL synthesis completion (the core hang fix): onDone must fire ----
    report.synthesis = await client.evaluate(`new Promise(function(resolve){
      if(!window.M2Speech.supported()){resolve({supported:false});return;}
      var t0=Date.now();
      var ok=window.M2Speech.speak('This is a short real spoken test.',{lang:'en',source:'manual',onDone:function(reason){
        resolve({supported:true, started:true, reason:reason, ms:Date.now()-t0});
      }});
      if(!ok){resolve({supported:true, started:false});}
      setTimeout(function(){resolve({supported:true, started:ok, reason:'no-callback-30s'});},30000);
    })`);

    // ---- drive the machine through a full loop on the shipped page ----
    report.loop = await client.evaluate(`(function(){
      window.__states=[]; window.__events=[];
      window.authedFetch=async function(){return {status:200, ok:true, json:async function(){return {ok:true, reply:'Sure, I can help with that.', message:'Done.', action:'none', queued:false, lang:'en'};}};};
      window.M2Speech.setMode('always');
      window.M2Voice.configure({ onState:function(s){window.__states.push(s);}, onEvent:function(e){window.__events.push(e);} });
      window.M2Voice.setMaxTurns(3);
      window.M2Voice.start();
      return { afterStart: window.M2Voice.state(), supported: window.M2Voice.supported() };
    })()`, false);

    // inject a transcript and watch the real downstream loop
    report.afterStart = report.loop.afterStart;
    if (report.loop.afterStart === 'listening') {
      await client.evaluate(`window.M2Voice.injectTranscript('what can you do')`, false);
      // wait for speaking then loop back to listening (real synth end / watchdog)
      const seq = await client.evaluate(`new Promise(function(resolve){
        var start=Date.now();
        var iv=setInterval(function(){
          var st=window.M2Voice.state();
          if(st==='listening' && window.__states.indexOf('speaking')>=0){ clearInterval(iv); resolve({looped:true, states:window.__states.slice(), events:window.__events.slice(), ms:Date.now()-start}); }
          else if(Date.now()-start>28000){ clearInterval(iv); resolve({looped:false, states:window.__states.slice(), events:window.__events.slice(), ms:Date.now()-start}); }
        },100);
      })`);
      report.loopSequence = seq;
      // real recognition was actually started (onstart fired) and re-started for the relisten:
      report.recognitionStarts = (seq.events || []).filter((e) => e === 'start').length;
      // stop from listening
      report.afterStop = await client.evaluate(`(function(){window.M2Voice.stop();return window.M2Voice.state();})()`, false);
    } else {
      report.note = 'recognition ctor missing — could not reach listening; see disclosure';
    }

    // ---- barge-in (M5): interrupt the assistant mid-speech, in a real browser ----
    report.bargeIn = await client.evaluate(`new Promise(function(resolve){
      window.__st2=[];
      window.M2Voice.configure({ onState:function(s){window.__st2.push(s);} });
      window.M2Voice.start();
      window.M2Voice.injectTranscript('tell me a long story about the city and the players and the jobs');
      var start=Date.now(), barged=false;
      var iv=setInterval(function(){
        var st=window.M2Voice.state();
        if(!barged && st==='speaking'){ barged=true; window.M2Voice.bargeIn(); }
        else if(barged && st==='listening'){ clearInterval(iv); resolve({barged:true, backToListening:true, states:window.__st2.slice(), ms:Date.now()-start}); }
        else if(Date.now()-start>15000){ clearInterval(iv); resolve({barged:barged, backToListening:(st==='listening'), states:window.__st2.slice(), timedOut:true}); }
      },40);
    })`);
    await client.evaluate(`window.M2Voice.stop()`, false);

    // ---- stop-from-each-state ----
    report.stopMatrix = await client.evaluate(`(function(){
      var out={};
      window.M2Voice.start(); out.listening = window.M2Voice.state(); window.M2Voice.stop(); out.listening_stopped = window.M2Voice.state();
      window.M2Voice.start(); window.M2Voice.injectTranscript('go'); out.after_inject = window.M2Voice.state(); window.M2Voice.stop(); out.mid_stopped = window.M2Voice.state();
      window.M2Voice.stop(); out.double_stop = window.M2Voice.state();
      return out;
    })()`, false);

    // ---- permission handling: disclosed limitation ----
    // The fake-media flags AUTO-GRANT the mic, so a real 'not-allowed' cannot be
    // produced in automation. The not-allowed → visible-error mapping is proven
    // in tests/voice-machine.test.js and tests/console-voice-ui.test.js; a human
    // must DENY mic permission in a real browser to see the live toast.
    report.permission = { note: 'auto-granted by fake-media flags; not-allowed path is unit-tested; human must deny mic to see the live message' };

    fs.writeFileSync(path.join(os.tmpdir(), 'm2-voice-browser-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    // success criteria
    const s = report.synthesis || {}; const loop = report.loopSequence || {}; const bi = report.bargeIn || {};
    const sm = report.stopMatrix || {};
    const ok = s.started && (s.reason === 'end' || s.reason === 'watchdog') &&
      loop.looped && report.afterStop === 'idle' &&
      sm.listening_stopped === 'idle' && sm.mid_stopped === 'idle' && sm.double_stop === 'idle' &&
      bi.backToListening === true;
    console.log(ok ? '\nVOICE BROWSER CHECK: PASS' : '\nVOICE BROWSER CHECK: PARTIAL (see report + disclosure)');
    cleanup();
    process.exit(ok ? 0 : 2);
  } catch (err) {
    report.error = err.message;
    console.log(JSON.stringify(report, null, 2));
    console.error('browser voice check failed:', err.stack || err.message);
    cleanup();
    process.exit(1);
  }
}
main();
