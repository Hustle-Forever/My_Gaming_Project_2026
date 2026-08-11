// Milestone 1: the server-access layer. One adapter contract, three sources:
// zip upload (in-memory - no temp files on serverless), directory (fixtures/
// local), ftp (documented stub). Safety limits and traversal protection are
// proven here, not promised.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const AdmZip = require('adm-zip');
const access = require('../lib/serverAccess');

const FIX = path.join(__dirname, 'fixtures', 'servers');

function zipOfFixture(name) {
  const zip = new AdmZip();
  zip.addLocalFolder(path.join(FIX, name));
  return zip.toBuffer();
}

test('uploadAdapter: a fixture ZIP unpacks and lists files', async () => {
  const adapter = access.fromZipBuffer(zipOfFixture('qbcore-clean'));
  const files = adapter.listFiles();
  assert.ok(files.length >= 15, `expected the fixture's files, got ${files.length}`);
  assert.ok(files.every((f) => typeof f.path === 'string' && typeof f.size === 'number'));

  const cfg = adapter.readFile('server.cfg');
  assert.match(cfg, /ensure qb-core/);
  assert.equal(adapter.exists('resources/[qb]/qb-core/fxmanifest.lua'), true);
  assert.equal(adapter.exists('resources/[qb]/nope/fxmanifest.lua'), false);
  const st = adapter.stat('resources/[qb]/qb-core/shared/jobs.lua');
  assert.ok(st.size > 100 && st.isText === true);
  adapter.destroy();
});

test('uploadAdapter: binary assets are listed (name+size) but never readable', async () => {
  const adapter = access.fromZipBuffer(zipOfFixture('broken'));
  const ytd = adapter.listFiles().find((f) => f.path.endsWith('stream/big.ytd'));
  assert.ok(ytd, 'binary file must appear in the listing');
  assert.equal(ytd.size, 2048);
  assert.equal(adapter.stat(ytd.path).isText, false);
  assert.throws(() => adapter.readFile(ytd.path), /NOT_TEXT/);
  adapter.destroy();
});

test('uploadAdapter: entry-count limit is enforced', async () => {
  assert.throws(
    () => access.fromZipBuffer(zipOfFixture('qbcore-clean'), { maxEntries: 3 }),
    /LIMIT_EXCEEDED/
  );
});

test('uploadAdapter: over-cap text file is listed but not readable', async () => {
  const zip = new AdmZip();
  zip.addFile('server.cfg', Buffer.from('ensure tiny\n'));
  zip.addFile('resources/big/fxmanifest.lua', Buffer.from('x'.repeat(500)));
  const adapter = access.fromZipBuffer(zip.toBuffer(), { maxFileBytes: 100 });
  assert.ok(adapter.exists('resources/big/fxmanifest.lua'), 'still listed');
  assert.throws(() => adapter.readFile('resources/big/fxmanifest.lua'), /TOO_LARGE/);
  assert.equal(adapter.readFile('server.cfg'), 'ensure tiny\n');
  adapter.destroy();
});

test('path traversal is rejected and recorded, never ingested', async () => {
  // The scan-pack path is the real attack surface: client-built JSON reaches
  // this layer unfiltered. (adm-zip pre-sanitizes zip entry names on read;
  // the same safeRelative belt still guards that path.)
  const adapter = access.fromScanPack({
    files: [
      { path: 'server.cfg', content: 'ensure ok\n', size: 10 },
      { path: '../../evil.lua', content: 'os.execute("boom")', size: 18 },
      { path: 'resources/a/../../../evil2.cfg', content: 'bad', size: 3 },
    ],
  });
  const paths = adapter.listFiles().map((f) => f.path);
  assert.deepEqual(paths, ['server.cfg'], `traversal entries must be dropped, got ${paths}`);
  assert.equal(adapter.violations.length, 2, 'both hostile entries recorded');
  adapter.destroy();

  // and a zip built from hostile names arrives with nothing escaping either
  const zip = new AdmZip();
  zip.addFile('server.cfg', Buffer.from('ensure ok\n'));
  zip.addFile('../../evil.lua', Buffer.from('x'));
  const zAdapter = access.fromZipBuffer(zip.toBuffer());
  assert.ok(zAdapter.listFiles().every((f) => !f.path.includes('..')), 'no escaped paths from zips');
  zAdapter.destroy();
});

test('uploadAdapter: total-text-bytes budget is enforced', async () => {
  const zip = new AdmZip();
  for (let i = 0; i < 10; i++) zip.addFile(`resources/r${i}/fxmanifest.lua`, Buffer.from('y'.repeat(300)));
  assert.throws(() => access.fromZipBuffer(zip.toBuffer(), { maxTotalTextBytes: 1000 }), /LIMIT_EXCEEDED/);
});

test('destroy() releases the workspace', async () => {
  const adapter = access.fromZipBuffer(zipOfFixture('ambiguous'));
  assert.ok(adapter.listFiles().length > 0);
  adapter.destroy();
  assert.throws(() => adapter.listFiles(), /DESTROYED/);
  assert.throws(() => adapter.readFile('server.cfg'), /DESTROYED/);
});

test('fromDirectory: fixtures load with the same contract (drives the scanner tests)', async () => {
  const adapter = access.fromDirectory(path.join(FIX, 'esx-clean'));
  assert.match(adapter.readFile('server.cfg'), /ensure es_extended/);
  assert.equal(adapter.exists('resources/[core]/es_extended/fxmanifest.lua'), true);
  adapter.destroy();
});

test('ftpAdapter: documented stub fails clearly, never guesses', async () => {
  assert.throws(() => access.ftpAdapter({ host: 'x' }), /NOT_IMPLEMENTED/);
});
