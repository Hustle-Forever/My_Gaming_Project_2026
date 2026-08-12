// M1: the old product name must be gone from the entire codebase — prompts,
// fallbacks, user-facing strings, docs, comments, internal identifiers, all of
// it. This scans every git-tracked text file for the old name and fails with a
// list of offenders. The needle is assembled from fragments so this test file
// is not itself an offender.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const NEEDLE = 'mir' + 'sal'; // avoid the literal substring living in this file
const ROOT = path.join(__dirname, '..');

// Text-ish files worth scanning. Skip lockfiles and binary/media.
const SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.mp3', '.mp4', '.zip', '.pdf']);
const SKIP_FILE = new Set(['package-lock.json']);

test('the old product name appears nowhere in the codebase', () => {
  const tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((f) => !SKIP_EXT.has(path.extname(f).toLowerCase()))
    .filter((f) => !SKIP_FILE.has(path.basename(f)))
    .filter((f) => path.basename(f) !== path.basename(__filename)); // this test names it to search for it

  const offenders = [];
  for (const rel of tracked) {
    const abs = path.join(ROOT, rel);
    let body;
    try { body = fs.readFileSync(abs, 'utf8'); } catch (_) { continue; }
    const lines = body.split('\n');
    lines.forEach((line, i) => {
      if (line.toLowerCase().includes(NEEDLE)) offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }

  assert.equal(offenders.length, 0, `old name still present in ${offenders.length} place(s):\n` + offenders.join('\n'));
});
