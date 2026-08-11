// Milestone 2: manifests + server.cfg -> serverModel. Every claim the
// scanner later makes traces back to what these parsers extracted.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const access = require('../lib/serverAccess');
const { parseManifest } = require('../lib/scanner/parseManifest');
const { parseServerCfg } = require('../lib/scanner/parseServerCfg');
const { buildResourceGraph } = require('../lib/scanner/buildResourceGraph');

const FIX = path.join(__dirname, 'fixtures', 'servers');
const open = (name) => access.fromDirectory(path.join(FIX, name));

test('parseManifest: dependencies (both forms), scripts, metadata', () => {
  const a = open('qbcore-clean');
  const police = parseManifest(a.readFile('resources/[qb]/qb-policejob/fxmanifest.lua'));
  assert.equal(police.fxVersion, 'cerulean');
  assert.deepEqual(police.dependencies, ['qb-core', 'ox_lib']); // dependencies { ... }
  const inv = parseManifest(a.readFile('resources/[qb]/qb-inventory/fxmanifest.lua'));
  assert.deepEqual(inv.dependencies, ['qb-core']);               // dependency '...'
  const core = parseManifest(a.readFile('resources/[qb]/qb-core/fxmanifest.lua'));
  assert.ok(core.scripts.shared.includes('shared/jobs.lua'));
  assert.ok(core.scripts.shared.includes('shared/items.lua'));
  a.destroy();

  const b = open('esx-clean');
  const esx = parseManifest(b.readFile('resources/[core]/es_extended/fxmanifest.lua'));
  assert.equal(esx.name, 'es_extended');
  assert.equal(esx.version, '1.10.2');
  b.destroy();

  const junk = parseManifest('this is not a manifest at all');
  assert.equal(junk.malformed, true);
});

test('parseServerCfg: ensure order, exec recursion, convars', () => {
  const a = open('qbcore-clean');
  const cfg = parseServerCfg(a);
  const names = cfg.ensures.map((e) => e.name);
  // extras.cfg is exec'd BEFORE the ensures in server.cfg, so qb-garages loads first
  assert.deepEqual(names, ['qb-garages', 'oxmysql', 'ox_lib', 'qb-core', 'qb-inventory', 'qb-policejob']);
  assert.equal(cfg.ensures[0].file, 'extras.cfg');
  assert.ok(cfg.ensures.every((e, i) => e.orderIndex === i));
  assert.ok(cfg.convars.mysql_connection_string, 'convars captured');
  assert.equal(cfg.convars.sv_hostname.value, 'Clean QBCore RP');
  a.destroy();
});

test('parseServerCfg: missing exec noted, no crash', () => {
  const a = access.fromScanPack({ files: [{ path: 'server.cfg', content: 'exec "gone.cfg"\nensure thing\n', size: 30 }] });
  const cfg = parseServerCfg(a);
  assert.deepEqual(cfg.ensures.map((e) => e.name), ['thing']);
  assert.equal(cfg.missingExecs.length, 1);
  a.destroy();
});

test('buildResourceGraph: clean fixture - resources, categories, sizes, started', () => {
  const a = open('qbcore-clean');
  const model = buildResourceGraph(a, parseServerCfg(a));
  const names = Object.keys(model.resources).sort();
  assert.deepEqual(names, ['ox_lib', 'oxmysql', 'qb-core', 'qb-garages', 'qb-inventory', 'qb-policejob']);
  const core = model.resources['qb-core'];
  assert.equal(core.started, true);
  assert.ok(core.sizeBytes > 200);
  assert.ok(core.relPath.includes('[qb]/qb-core'), 'category dirs resolved');
  assert.equal(typeof core.orderIndex, 'number');
  assert.deepEqual(model.ghosts, []);
  assert.deepEqual(model.deadWeight, []);
  assert.deepEqual(model.structure.nested, []);
  assert.deepEqual(model.structure.missingManifest, []);
  a.destroy();
});

test('buildResourceGraph: broken fixture - ghosts, dead weight, nesting, missing manifests', () => {
  const a = open('broken');
  const model = buildResourceGraph(a, parseServerCfg(a));
  assert.deepEqual(model.ghosts.map((g) => g.name), ['qb-heists'], 'ensured but not on disk');
  assert.deepEqual(model.deadWeight, ['unused-lib'], 'on disk but never ensured');
  assert.equal(model.structure.nested.length, 1);
  assert.equal(model.structure.nested[0].name, 'mx-nested');
  assert.deepEqual(model.structure.missingManifest, ['resources/no-manifest-here']);
  // escrow marker recorded
  assert.equal(model.resources['sketchy'].escrow, true);
  // stream bytes recorded without reading content
  assert.equal(model.resources['streams-heavy'].streamBytes, 2048);
  a.destroy();
});
