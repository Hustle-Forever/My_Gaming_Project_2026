// Milestone 6 (headless): drive the ACTUAL dashboard.html Server Report code
// in jsdom with a real scanner report, in EN and AR. This is the durable
// stand-in for a screenshot - it proves the shipped render logic produces the
// right DOM (and can't silently regress).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { JSDOM } = require('jsdom');
const access = require('../lib/serverAccess');
const { scan } = require('../lib/scanner');

// a real report, exactly the shape /api/scan-status returns as `scan`
function reportFor(name) {
  const r = scan(access.fromDirectory(path.join(__dirname, 'fixtures', 'servers', name)), { destroyAdapter: true });
  return { scanId: 'test', status: 'complete', source: 'upload', createdAtMs: 1, ...r };
}

async function loadDashboard() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'app', 'dashboard.html'), 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://localhost/dashboard', // gives the page an origin -> localStorage
    // no resource loading -> the firebase module import rejects inside its own
    // try/catch and dispatches mirsal-auth-ready(signedIn:false); the classic
    // script then defines all the report functions we exercise.
    beforeParse(window) {
      window.matchMedia = () => ({ matches: false, addEventListener() {} });
    },
  });
  await new Promise((r) => setTimeout(r, 150)); // let inline scripts run
  return dom.window;
}

test('report renders: score, verdict, identity, findings (EN)', async () => {
  const win = await loadDashboard();
  assert.equal(typeof win.rpRender, 'function', 'dashboard exposes rpRender');
  win.rpRender(reportFor('broken'));

  const doc = win.document;
  assert.equal(doc.getElementById('rpResult').classList.contains('hide'), false, 'result view shown');
  assert.ok(Number(doc.getElementById('rpScore').textContent) < 60, 'broken score shown and low');
  assert.ok(doc.getElementById('rpVerdict').textContent.length > 0, 'verdict present');
  assert.match(doc.getElementById('rpIdentity').textContent, /qbcore/i, 'framework in identity card');

  const findings = doc.querySelectorAll('#rpFindings .rp-f');
  assert.ok(findings.length >= 10, `findings rendered: ${findings.length}`);
  // resource table populated
  assert.ok(doc.querySelectorAll('#rpResList table tbody tr').length >= 5, 'resource table rows');
});

test('clean server renders a healthy score with no critical/high findings', async () => {
  const win = await loadDashboard();
  win.rpRender(reportFor('qbcore-clean'));
  const doc = win.document;
  assert.ok(Number(doc.getElementById('rpScore').textContent) >= 90, 'clean score high');
  assert.equal(doc.querySelectorAll('#rpFindings .rp-f .dot.critical').length, 0);
  assert.equal(doc.querySelectorAll('#rpFindings .rp-f .dot.high').length, 0);
});

test('Arabic: findings + identity switch to AR and layout flips RTL', async () => {
  const win = await loadDashboard();
  win.rpRender(reportFor('broken'));
  win.setLang('ar');
  const doc = win.document;
  assert.equal(doc.documentElement.getAttribute('dir'), 'rtl', 'RTL applied');
  // the report re-renders in Arabic (setLang calls rpRender when RP_LAST set)
  assert.match(doc.getElementById('rpVerdict').textContent, /[؀-ۿ]/, 'verdict is Arabic');
  assert.match(doc.getElementById('rpFindings').textContent, /[؀-ۿ]/, 'findings are Arabic');
});

test('severity filter narrows the findings list', async () => {
  const win = await loadDashboard();
  win.rpRender(reportFor('broken'));
  const doc = win.document;
  const all = doc.querySelectorAll('#rpFindings .rp-f').length;
  win.rpSetFilter('critical');
  const crit = doc.querySelectorAll('#rpFindings .rp-f').length;
  assert.ok(crit >= 1 && crit < all, `critical filter narrows (${crit} of ${all})`);
  assert.equal(doc.querySelectorAll('#rpFindings .rp-f .dot:not(.critical)').length, 0, 'only critical shown');
});

test('stored/rendered findings carry NO raw source or secrets', async () => {
  const win = await loadDashboard();
  win.rpRender(reportFor('broken'));
  const html = win.document.getElementById('rpFindings').innerHTML;
  assert.ok(!html.includes('os.execute'), 'no raw source in the rendered report');
  assert.ok(!html.includes('SuperSecret123'), 'no secret in the rendered report');
});
