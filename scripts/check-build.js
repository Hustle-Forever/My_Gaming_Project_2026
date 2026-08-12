// scripts/check-build.js - the local "build" gate. Vercel doesn't run a build
// step for this static+functions project, so this stands in: it (1) requires
// every deployable Serverless Function so a syntax/require error fails fast,
// and (2) enforces the Hobby-plan limit of 12 functions, which is what a
// too-many-functions deploy fails on. Run: npm run build.
const fs = require('fs');
const path = require('path');

const API = path.join(__dirname, '..', 'api');
const LIMIT = 12;

// A file is a deployable Serverless Function unless it (or a path segment)
// starts with '_' or '.'. Bracketed [action].js catch-alls DO count.
function isFunctionFile(rel) {
  return rel.endsWith('.js') && !rel.split(/[\\/]/).some((seg) => seg.startsWith('_') || seg.startsWith('.'));
}

function walk(dir, base = '') {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = base ? base + '/' + name : name;
    if (fs.statSync(full).isDirectory()) out.push(...walk(full, rel));
    else out.push({ full, rel });
  }
  return out;
}

const files = walk(API);
const functions = files.filter((f) => isFunctionFile(f.rel));

let failed = 0;
for (const f of files) {
  if (!f.rel.endsWith('.js')) continue;
  try { require(f.full); }
  catch (err) { console.error(`✖ ${f.rel}: ${err.message}`); failed += 1; }
}

console.log(`Serverless functions: ${functions.length} / ${LIMIT}`);
functions.forEach((f) => console.log(`  • api/${f.rel}`));

if (failed) { console.error(`\n✖ ${failed} file(s) failed to load`); process.exit(1); }
if (functions.length > LIMIT) {
  console.error(`\n✖ ${functions.length} functions exceeds the ${LIMIT}-function Hobby limit — consolidate into api/<group>/[action].js catch-alls.`);
  process.exit(1);
}
console.log('\n✓ build check passed');
