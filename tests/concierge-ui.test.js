// M7 (headless): drive the dashboard's Concierge section in jsdom with a stubbed
// authedFetch. Proves setup (enable/tone/check-in), the funnel + retention +
// arrivals + themes render from /stats, the empty state, and EN/AR.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { JSDOM } = require('jsdom');

const CONFIG = { enabled: true, tone: 'casual', languages: ['en', 'ar'], checkinSeconds: 300, features: {} };
const STATS = {
  funnel: { arrived: 5, greeted: 5, answered: 4, reached: 3, checkin: 2, dismissed: 1 },
  rates: { greet: 1, answer: 0.8, reach: 0.6, checkin: 0.4, dismiss: 0.2 },
  retention: { stillPlaying: 2, returned: 1, rate: 0.4 },
  themes: [{ theme: 'money', count: 2 }, { theme: 'getting_started', count: 1 }],
  arrivalsByDay: [{ day: '2026-08-10', arrived: 3, stillPlaying: 2 }, { day: '2026-08-11', arrived: 2, stillPlaying: 0 }],
  totals: { players: 6, events: 26 },
};

async function loadDash(stats = STATS, config = CONFIG) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'app', 'dashboard.html'), 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'http://localhost/dashboard',
    beforeParse(w) { w.matchMedia = () => ({ matches: false, addEventListener() {} }); },
  });
  await new Promise((r) => setTimeout(r, 150));
  const win = dom.window;
  win.authedFetch = async (p, opts) => {
    if (p.startsWith('/api/concierge/config')) return { ok: true, status: 200, json: async () => ({ ok: true, config }) };
    if (p.startsWith('/api/concierge/stats')) return { ok: true, status: 200, json: async () => ({ ok: true, stats }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return win;
}

test('setup reflects config: enabled, tone, check-in slider', async () => {
  const win = await loadDash();
  await win.cgLoad();
  await new Promise((r) => setTimeout(r, 30));
  const doc = win.document;
  assert.ok(doc.getElementById('cgOn').classList.contains('on'), 'enabled toggle on');
  const activeTone = doc.querySelector('#cgTone button.on');
  assert.equal(activeTone.dataset.tone, 'casual', 'casual tone marked');
  assert.equal(doc.getElementById('cgCheckin').value, '300');
  assert.match(doc.getElementById('cgCheckinVal').textContent, /5m 0s/);
});

test('funnel + retention + arrivals + themes render from /stats', async () => {
  const win = await loadDash();
  await win.cgLoad();
  await new Promise((r) => setTimeout(r, 30));
  const s = win.document.getElementById('cgStats');
  // funnel values
  assert.match(s.textContent, /Arrived/);
  const fills = [...s.querySelectorAll('.cg-fr .fill')].map((e) => e.style.width);
  assert.deepEqual(fills, ['100%', '100%', '80%', '60%', '40%'], 'funnel bar widths');
  // retention
  assert.match(s.textContent, /40%/, 'retention rate shown');
  // arrivals trend has one bar per day
  assert.equal(s.querySelectorAll('.cg-bar').length, 2, 'two arrival-day bars');
  // themes ranked, money on top with a readable label
  assert.match(s.textContent, /Money & jobs/);
  const themeVals = [...s.querySelectorAll('.cg-th .tv')].map((e) => e.textContent);
  assert.deepEqual(themeVals, ['2', '1'], 'theme counts, ranked');
});

test('empty state when there are no events', async () => {
  const EMPTY = { funnel: { arrived: 0, greeted: 0, answered: 0, reached: 0, checkin: 0, dismissed: 0 }, rates: {}, retention: { stillPlaying: 0, returned: 0, rate: 0 }, themes: [], arrivalsByDay: [], totals: { players: 0, events: 0 } };
  const win = await loadDash(EMPTY);
  await win.cgLoad();
  await new Promise((r) => setTimeout(r, 30));
  const s = win.document.getElementById('cgStats');
  assert.equal(s.querySelector('.cg-empty') != null, true, 'empty placeholder shown');
  assert.equal(s.querySelectorAll('.cg-fr').length, 0, 'no funnel rows');
});

test('Arabic: Concierge labels switch to AR', async () => {
  const win = await loadDash();
  await win.cgLoad();
  await new Promise((r) => setTimeout(r, 30));
  win.setLang('ar');
  await new Promise((r) => setTimeout(r, 20));
  const card = win.document.getElementById('concierge');
  assert.match(card.textContent, /المُضيف|مسار الترحيب|المال والوظائف/, 'Arabic concierge labels');
});
