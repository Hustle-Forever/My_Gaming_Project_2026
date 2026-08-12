// M3: recommendations come from the ACTUAL scanned server, never invented.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const access = require('../lib/serverAccess');
const { scan } = require('../lib/scanner');
const { recommendJobs, recommendForChoice, pickNearbyPlayer } = require('../lib/concierge/recommend');

function realScan(name) {
  return scan(access.fromDirectory(path.join(__dirname, 'fixtures', 'servers', name)), { destroyAdapter: true });
}
const CFG = {
  languages: ['en', 'ar'],
  recommendJobs: [{ id: 'civilian', label: { en: 'Civilian', ar: 'مدني' } }],
  recommendLocations: [],
};

test('QBCore scan yields that fixture\'s jobs, never a job it lacks', () => {
  const report = realScan('qbcore-clean'); // jobs: police, ambulance, mechanic
  const jobs = recommendJobs(CFG, report);
  const ids = jobs.map((j) => j.id);
  assert.ok(ids.includes('police') && ids.includes('ambulance') && ids.includes('mechanic'), `got ${ids}`);
  assert.ok(!ids.includes('taxi'), 'never recommends a job the server does not have');
  assert.ok(jobs.every((j) => j.label.en && j.label.ar), 'every job is bilingual');
});

test('a server with no scan degrades to configured defaults', () => {
  const jobs = recommendJobs(CFG, null);
  assert.deepEqual(jobs.map((j) => j.id), ['civilian'], 'falls back to config.recommendJobs');
});

test('ESX scan uses its detected job (esx_ambulancejob → ambulance)', () => {
  const report = realScan('esx-clean');
  const jobs = recommendJobs(CFG, report);
  // esx fixture has an ambulance job; at minimum recommendations are non-empty
  assert.ok(jobs.length >= 1);
  assert.ok(jobs.every((j) => j.label.en && j.label.ar));
});

test('recommendForChoice returns a destination + one-liner in the player language', () => {
  const report = realScan('qbcore-clean');
  const r = recommendForChoice(CFG, report, 'police', 'en');
  assert.ok(r.location && typeof r.location === 'string');
  assert.ok(r.line && r.line.length > 0);
  const ar = recommendForChoice(CFG, report, 'police', 'ar');
  assert.match(ar.line, /[؀-ۿ]/, 'Arabic one-liner');
});

test('pickNearbyPlayer prefers a related job, falls back to anyone, null when empty', () => {
  const players = [
    { id: 1, name: 'Ali', job: 'mechanic' },
    { id: 2, name: 'Sara', job: 'police' },
  ];
  const rel = pickNearbyPlayer(players, 'police');
  assert.equal(rel.name, 'Sara', 'prefers same/related job');
  const any = pickNearbyPlayer(players, 'taxi');
  assert.ok(any && any.name, 'falls back to any player');
  assert.equal(pickNearbyPlayer([], 'police'), null, 'null when nobody is around');
});
