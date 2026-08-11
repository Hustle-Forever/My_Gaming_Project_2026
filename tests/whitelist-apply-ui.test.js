// M4 (headless): drive app/apply.html in jsdom with a stubbed fetch, proving
// the applicant client renders the welcome, collects identity, walks the
// interview, and reaches the submitted screen — EN and AR.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { JSDOM } = require('jsdom');

const CONFIG = {
  serverName: 'Aziz Drift RP', slug: 'aziz', enabled: true, languages: ['en', 'ar'],
  identityFields: [{ key: 'discord', label: { en: 'Discord', ar: 'ديسكورد' }, required: true }],
  questionCount: 2, ageRequired: false, minAge: 16,
};

function makeFetch(script) {
  // script: sequence of {match, resp}. resp is the JSON body; ok defaults true.
  return async (url, opts) => {
    const u = String(url);
    for (const s of script) {
      if (u.includes(s.match)) {
        return { ok: s.ok !== false, status: s.status || 200, json: async () => s.resp };
      }
    }
    return { ok: false, status: 404, json: async () => ({ ok: false, error: { code: 'NOT_FOUND' } }) };
  };
}

async function loadApply(fetchImpl, pathname = '/apply/aziz') {
  const html = fs.readFileSync(path.join(__dirname, '..', 'app', 'apply.html'), 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'http://localhost' + pathname,
    beforeParse(w) {
      w.fetch = fetchImpl;
      w.SpeechRecognition = undefined;
      w.scrollTo = () => {};
    },
  });
  await new Promise((r) => setTimeout(r, 120));
  return dom.window;
}

test('welcome renders with server name + identity fields', async () => {
  const win = await loadApply(makeFetch([{ match: '/api/apply/config', resp: { ok: true, config: CONFIG } }]));
  const doc = win.document;
  assert.match(doc.getElementById('srv').textContent, /Aziz Drift RP/);
  assert.match(doc.getElementById('main').textContent, /Start application/);
  assert.ok(doc.getElementById('id_discord'), 'identity field rendered');
});

test('full interview flow: start -> answer -> submitted screen', async () => {
  const script = [
    { match: '/api/apply/config', resp: { ok: true, config: CONFIG } },
    { match: '/api/apply/start', resp: { ok: true, appId: 'a1', resumeToken: 'tok', step: { kind: 'question', questionId: 'q1', prompt: 'Q1?', progress: { index: 1, total: 2 } } } },
    { match: '/api/apply/answer', resp: { ok: true, step: { kind: 'done', progress: { index: 2, total: 2 } } } },
    { match: '/api/apply/submit', resp: { ok: true, status: 'submitted', overall: 70 } },
  ];
  const win = await loadApply(makeFetch(script));
  const doc = win.document;
  doc.getElementById('id_discord').value = 'me#1';
  await win.startApp();
  await new Promise((r) => setTimeout(r, 30));
  assert.match(doc.getElementById('feed').textContent, /Q1\?/, 'first question shown');

  doc.getElementById('ans').value = 'a detailed and thoughtful answer here';
  await win.sendAns();
  await new Promise((r) => setTimeout(r, 60));
  assert.match(doc.getElementById('main').textContent, /submitted/i, 'reached the submitted screen');
});

test('Arabic renders RTL with Arabic copy', async () => {
  const win = await loadApply(makeFetch([{ match: '/api/apply/config', resp: { ok: true, config: CONFIG } }]));
  win.setLang('ar');
  assert.equal(win.document.documentElement.getAttribute('dir'), 'rtl');
  assert.match(win.document.getElementById('main').textContent, /[؀-ۿ]/);
});

test('a closed/unknown application shows the not-open message', async () => {
  const win = await loadApply(makeFetch([{ match: '/api/apply/config', ok: false, status: 404, resp: { ok: false } }]));
  assert.match(win.document.getElementById('main').textContent, /isn't open|غير مفتوح/);
});
