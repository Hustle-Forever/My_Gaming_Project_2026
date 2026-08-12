// scripts/verify-deployed-routing.js - proves the voice scripts are routed +
// MIME-typed the way Vercel will serve them. It serves the repo through a
// static server that HONORS vercel.json's rewrites + headers (so /speech.js and
// /voice.js resolve to /app/*.js with a JavaScript content-type), then drives
// the shipped page in real Edge to confirm the modules actually execute (not a
// 404 text/plain body the browser refuses) and the voice loop runs.
const http = require('http');
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.ROUTING_PORT || '3009';
const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = { '.js': 'text/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

function buildRewrites() {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const map = new Map();
  for (const r of cfg.rewrites || []) if (!r.source.includes(':')) map.set(r.source, r.destination); // exact (skip param routes)
  return map;
}

function startServer() {
  const rewrites = buildRewrites();
  const server = http.createServer((req, res) => {
    let pathname = decodeURIComponent(new URL(req.url, `http://localhost:${PORT}`).pathname);
    if (rewrites.has(pathname)) pathname = rewrites.get(pathname);          // vercel rewrite
    const rel = pathname.replace(/^\/+/, '');
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return; // like a missing asset
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'x-content-type-options': 'nosniff' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

// minimal CDP over the page WebSocket
function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl); let id = 0; const pend = new Map();
  const ready = new Promise((res, rej) => { ws.onopen = () => res(); ws.onerror = () => rej(new Error('ws')); });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } };
  const send = (method, params) => new Promise((resolve, reject) => { const mid = ++id; pend.set(mid, { resolve, reject }); ws.send(JSON.stringify({ id: mid, method, params: params || {} })); });
  async function evaluate(expression, awaitPromise = true) { const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text); return r.result && r.result.value; }
  return { ready, send, evaluate, close: () => ws.close() };
}

async function main() {
  const report = { steps: [] };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'm2route-'));
  let server, edge, client;
  const killTree = (p) => { if (!p || !p.pid) return; try { if (process.platform === 'win32') spawn('taskkill', ['/F', '/T', '/PID', String(p.pid)], { stdio: 'ignore' }); else p.kill(); } catch (e) {} };
  const cleanup = () => { try { client && client.close(); } catch (e) {} killTree(edge); try { server && server.close(); } catch (e) {} };
  process.on('exit', cleanup);
  try {
    server = await startServer();
    report.steps.push('routing server up (honors vercel.json) on ' + PORT);

    edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=9223', `--user-data-dir=${tmp}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', `http://127.0.0.1:${PORT}/`], { stdio: 'ignore' });
    for (let i = 0; i < 60; i++) { try { const r = await fetch('http://127.0.0.1:9223/json/version'); if (r.ok) break; } catch (e) {} await sleep(250); }

    let target = null;
    for (let i = 0; i < 40 && !target; i++) { const list = await (await fetch('http://127.0.0.1:9223/json')).json(); target = list.find((t) => t.type === 'page' && (t.url || '').includes(String(PORT))); if (!target) await sleep(250); }
    if (!target) throw new Error('no page target');
    client = cdp(target.webSocketDebuggerUrl); await client.ready;
    await client.send('Runtime.enable');
    for (let i = 0; i < 40; i++) { if (await client.evaluate('!!(window.M2Voice && window.M2Speech)')) break; await sleep(250); }

    // 1. the two scripts return JavaScript (correct MIME) and are non-empty
    report.assets = await client.evaluate(`Promise.all(['/speech.js','/voice.js'].map(function(u){
      return fetch(u).then(function(r){ return r.text().then(function(b){ return { url:u, status:r.status, type:r.headers.get('content-type'), bytes:b.length, hasSymbol: /M2(Speech|Voice)/.test(b) }; }); });
    }))`);
    // 2. the modules actually executed (would be undefined if 404/text-plain)
    report.executed = await client.evaluate(`({ M2Voice: typeof window.M2Voice, M2Speech: typeof window.M2Speech })`);
    // 3. the voice loop runs under the deployed routing
    report.loop = await client.evaluate(`new Promise(function(resolve){
      window.__s=[];
      window.authedFetch=async function(){return {status:200,ok:true,json:async function(){return {ok:true,reply:'Yes, I can help.',message:'Done.',action:'none',queued:false,lang:'en'};}};};
      window.M2Speech.setMode('always');
      window.M2Voice.configure({onState:function(s){window.__s.push(s);}});
      window.M2Voice.setMaxTurns(2);
      window.M2Voice.start();
      var afterStart=window.M2Voice.state();
      window.M2Voice.injectTranscript('what can you do');
      var t0=Date.now();
      var iv=setInterval(function(){
        var st=window.M2Voice.state();
        if(st==='listening' && window.__s.indexOf('speaking')>=0){clearInterval(iv);window.M2Voice.stop();resolve({afterStart:afterStart,looped:true,states:window.__s.slice(),afterStop:window.M2Voice.state()});}
        else if(Date.now()-t0>20000){clearInterval(iv);resolve({afterStart:afterStart,looped:false,states:window.__s.slice()});}
      },80);
    })`);

    const a = report.assets || [];
    const mimeOk = a.length === 2 && a.every((x) => x.status === 200 && /javascript/.test(x.type || '') && x.hasSymbol);
    const execOk = report.executed && report.executed.M2Voice === 'object' && report.executed.M2Speech === 'object';
    const loopOk = report.loop && report.loop.looped && report.loop.afterStop === 'idle';
    report.pass = !!(mimeOk && execOk && loopOk);
    console.log(JSON.stringify(report, null, 2));
    console.log(report.pass ? '\nDEPLOYED ROUTING CHECK: PASS' : '\nDEPLOYED ROUTING CHECK: FAIL');
    cleanup(); process.exit(report.pass ? 0 : 1);
  } catch (err) {
    report.error = err.message; console.log(JSON.stringify(report, null, 2)); cleanup(); process.exit(1);
  }
}
main();
