// M5 (headless): drive the dashboard's Whitelist Officer section in jsdom with
// a stubbed authedFetch. Proves the queue, detail (transcript + per-criterion
// evidence + decision buttons), setup, and stats render — EN and AR.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { JSDOM } = require('jsdom');

const CONFIG = {
  enabled: true, slug: 'aziz',
  questions: [{ id: 'q1', order: 0, text: { en: 'Q1', ar: 'س1' } }],
  criteria: [{ id: 'c1', label: { en: 'Effort', ar: 'الجهد' }, description: { en: '', ar: '' } }],
  discordWebhook: '',
};
const QUEUE = [{ appId: 'a1', identity: { discord: 'user#1' }, language: 'en', status: 'submitted', overall: 72, flags: ['dodge'], summary: 'Solid.' }];
const DETAIL = {
  appId: 'a1', identity: { discord: 'user#1' }, language: 'en', status: 'submitted', overall: 72,
  scores: [{ criterion: 'c1', score: 72, evidence: 'two years as a paramedic' }],
  flags: [{ type: 'dodge' }], summary: 'Solid applicant.', recommendation: 'review',
  transcript: [{ role: 'officer', text: 'Q1' }, { role: 'applicant', text: 'my detailed answer' }],
};
const STATS = { received: 5, backlog: 2, decided: 3, approved: 2, approvalRate: 67, avgDecisionMinutes: 12 };

function authedFetchStub(routes) {
  return async (pathname) => {
    for (const [match, resp] of routes) {
      if (pathname.startsWith(match)) return { ok: true, status: 200, json: async () => resp };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

async function loadDash() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'app', 'dashboard.html'), 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'http://localhost/dashboard',
    beforeParse(w) { w.matchMedia = () => ({ matches: false, addEventListener() {} }); },
  });
  await new Promise((r) => setTimeout(r, 150));
  const win = dom.window;
  // route the whitelist calls; appId detail vs queue differ by querystring
  win.authedFetch = async (p) => {
    if (p.startsWith('/api/whitelist/config')) return { ok: true, status: 200, json: async () => ({ ok: true, config: CONFIG }) };
    if (p.startsWith('/api/whitelist/applications?appId=')) return { ok: true, status: 200, json: async () => ({ ok: true, application: DETAIL }) };
    if (p.startsWith('/api/whitelist/applications')) return { ok: true, status: 200, json: async () => ({ ok: true, applications: QUEUE }) };
    if (p.startsWith('/api/whitelist/stats')) return { ok: true, status: 200, json: async () => ({ ok: true, stats: STATS }) };
    if (p.startsWith('/api/whitelist/decide')) return { ok: true, status: 200, json: async () => ({ ok: true, status: 'approved' }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return win;
}

test('queue + stats render from the API', async () => {
  const win = await loadDash();
  await win.wlLoad();
  await new Promise((r) => setTimeout(r, 30));
  const doc = win.document;
  assert.match(doc.getElementById('wlStats').textContent, /67%/, 'approval rate shown');
  assert.match(doc.getElementById('wlList').textContent, /user#1/, 'applicant in queue');
  assert.match(doc.getElementById('wlList').textContent, /72/, 'score shown');
});

test('detail shows transcript + per-criterion evidence + decision buttons', async () => {
  const win = await loadDash();
  await win.wlLoad();
  await win.wlOpen('a1');
  await new Promise((r) => setTimeout(r, 30));
  const d = win.document.getElementById('wlDetail');
  assert.equal(d.classList.contains('hide'), false, 'detail visible');
  assert.match(d.textContent, /two years as a paramedic/, 'evidence quoted');
  assert.match(d.textContent, /my detailed answer/, 'transcript shown');
  assert.match(d.textContent, /Approve/, 'decision buttons present');
  assert.match(d.textContent, /dodge/, 'flag surfaced');
});

test('Arabic: whitelist section switches to AR', async () => {
  const win = await loadDash();
  await win.wlLoad();
  win.setLang('ar');
  await win.wlOpen('a1');
  await new Promise((r) => setTimeout(r, 30));
  assert.match(win.document.getElementById('wlDetail').textContent, /قبول|النص|الجهد/, 'Arabic detail labels');
});

test('setup shows the shareable apply link when enabled', async () => {
  const win = await loadDash();
  await win.wlLoad();
  win.wlTab('setup');
  await new Promise((r) => setTimeout(r, 20));
  assert.match(win.document.getElementById('wlLink').textContent, /\/apply\/aziz/);
});
