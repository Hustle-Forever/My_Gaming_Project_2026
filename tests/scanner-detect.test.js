// Milestone 3: identity detection. Evidence-based, confidence-scored, and it
// says "unknown" rather than guessing when the signals aren't there.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const access = require('../lib/serverAccess');
const { parseServerCfg } = require('../lib/scanner/parseServerCfg');
const { buildResourceGraph } = require('../lib/scanner/buildResourceGraph');
const { detectFramework } = require('../lib/scanner/detectFramework');
const { detectInventory } = require('../lib/scanner/detectInventory');
const { detectDependencies, detectJobs, detectItems } = require('../lib/scanner/detect');

const FIX = path.join(__dirname, 'fixtures', 'servers');
function model(name) {
  const a = access.fromDirectory(path.join(FIX, name));
  const m = buildResourceGraph(a, parseServerCfg(a));
  m._adapter = a;
  return m;
}

test('framework: QBCore identified with evidence + high confidence', () => {
  const m = model('qbcore-clean');
  const fw = detectFramework(m, m._adapter);
  assert.equal(fw.framework, 'qbcore');
  assert.ok(fw.confidence >= 0.8, `confidence ${fw.confidence}`);
  assert.ok(fw.evidence.length >= 1);
  assert.ok(fw.evidence.some((e) => /qb-core/.test(e.detail)));
  m._adapter.destroy();
});

test('framework: ESX identified with version', () => {
  const m = model('esx-clean');
  const fw = detectFramework(m, m._adapter);
  assert.equal(fw.framework, 'esx');
  assert.ok(fw.confidence >= 0.8);
  assert.equal(fw.version, '1.10.2', 'version pulled from es_extended manifest');
  m._adapter.destroy();
});

test('framework: ambiguous fixture -> unknown, NOT a guess', () => {
  const m = model('ambiguous');
  const fw = detectFramework(m, m._adapter);
  assert.equal(fw.framework, 'unknown');
  assert.ok(fw.confidence <= 0.3, `unknown must be low-confidence, got ${fw.confidence}`);
  m._adapter.destroy();
});

test('inventory: qb-inventory (clean) and conflicting set (broken)', () => {
  const clean = model('qbcore-clean');
  const inv = detectInventory(clean, clean._adapter);
  assert.equal(inv.inventory, 'qb-inventory');
  assert.ok(inv.evidence.length >= 1);
  clean._adapter.destroy();

  const broken = model('broken');
  const binv = detectInventory(broken, broken._adapter);
  // both qb-inventory and ox_inventory are started -> candidates list has 2
  assert.ok(binv.candidates.length >= 2, `expected multiple inventories, got ${binv.candidates}`);
  broken._adapter.destroy();
});

test('dependencies: core libs detected from started resources', () => {
  const m = model('qbcore-clean');
  const deps = detectDependencies(m);
  const names = deps.map((d) => d.id);
  assert.ok(names.includes('oxmysql'));
  assert.ok(names.includes('ox_lib'));
  assert.ok(deps.every((d) => d.evidence));
  m._adapter.destroy();
});

test('jobs: parsed from QBCore shared with grade structures', () => {
  const m = model('qbcore-clean');
  const jobs = detectJobs(m, m._adapter);
  const names = jobs.jobs.map((j) => j.name).sort();
  assert.deepEqual(names, ['ambulance', 'mechanic', 'police']);
  const police = jobs.jobs.find((j) => j.name === 'police');
  assert.equal(police.grades, 4);
  assert.ok(jobs.source.includes('qb-core'));
  m._adapter.destroy();
});

test('items: counted from inventory/framework definitions', () => {
  const qb = model('qbcore-clean');
  const qitems = detectItems(qb, qb._adapter);
  assert.ok(qitems.count >= 5, `qb items ${qitems.count}`);
  qb._adapter.destroy();

  const esx = model('esx-clean');
  const eitems = detectItems(esx, esx._adapter);
  assert.ok(eitems.count >= 3, `esx items ${eitems.count}`);
  assert.ok(eitems.source.includes('ox_inventory'));
  esx._adapter.destroy();
});
