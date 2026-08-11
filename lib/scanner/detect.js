// lib/scanner/detect.js - dependency, job, and item detection.
// All evidence-based; jobs/items are parsed from framework/inventory data
// files with resilient key extraction (no Lua execution).

const CORE_DEPS = {
  oxmysql: ['oxmysql'],
  'mysql-async': ['mysql-async'],
  ox_lib: ['ox_lib'],
  PolyZone: ['PolyZone'],
  qb_target: ['qb-target'],
  ox_target: ['ox_target'],
  menuv: ['menuv'],
  'pma-voice': ['pma-voice'],
};

function detectDependencies(model) {
  const resources = model.resources || {};
  const out = [];
  for (const [id, names] of Object.entries(CORE_DEPS)) {
    const hit = names.find((n) => resources[n]);
    if (hit) {
      out.push({
        id,
        started: resources[hit].started,
        evidence: { kind: 'resource', detail: `${hit} present`, file: resources[hit].manifestPath },
      });
    }
  }
  return out;
}

// count top-level keys of a Lua table assigned to `<var>.Jobs` / `Jobs =`
function detectJobs(model, adapter) {
  const resources = model.resources || {};
  const candidates = [];
  // QBCore: qb-core/shared/jobs.lua ; ESX often DB-driven (jobs table)
  for (const name of ['qb-core', 'qbx_core', 'qbcore']) {
    if (resources[name]) candidates.push({ res: name, file: findFile(adapter, resources[name].relPath, /jobs\.lua$/i) });
  }
  const found = candidates.find((c) => c.file);
  if (!found) return { jobs: [], source: null, note: 'jobs may be database-driven (not in files)' };

  const text = safeRead(adapter, found.file);
  const jobs = parseJobsTable(text);
  return { jobs, source: found.file };
}

function detectItems(model, adapter) {
  const resources = model.resources || {};
  const sources = [];
  // ox_inventory data/items.lua ; qb-core shared/items.lua
  for (const name of ['ox_inventory', 'qb-core', 'qbx_core']) {
    if (resources[name]) {
      const f = findFile(adapter, resources[name].relPath, /items\.lua$/i);
      if (f) sources.push(f);
    }
  }
  let count = 0;
  let source = null;
  for (const f of sources) {
    const c = countItems(safeRead(adapter, f));
    if (c > count) { count = c; source = f; }
  }
  return { count, source: source || null };
}

// ---- helpers ----
function findFile(adapter, dir, re) {
  const f = adapter.listFiles(dir).find((x) => re.test(x.path));
  return f ? f.path : null;
}
function safeRead(adapter, file) { try { return adapter.readFile(file); } catch (_) { return ''; } }

// count entries in a `Jobs = { key = { ... grades = { ... } } }` structure by
// scanning top-level keys and, per key, counting grade entries.
function parseJobsTable(text) {
  const start = text.search(/\.?Jobs\s*=\s*\{/);
  if (start < 0) return [];
  const body = sliceBalanced(text, text.indexOf('{', start));
  const jobs = [];
  const keyRe = /(?:\[['"]([^'"]+)['"]\]|(\w+))\s*=\s*\{/g;
  // only top-level keys: walk with brace depth == 1
  let depth = 0, i = 0;
  const topKeys = [];
  const reAll = /[{}]|(?:\[['"][^'"]+['"]\]|\b\w+)\s*=\s*\{/g;
  // simpler: iterate chars tracking depth, capture identifiers at depth 1
  const src = body;
  let m;
  const tokenRe = /\[['"]([^'"]+)['"]\]\s*=\s*\{|(\w+)\s*=\s*\{|\{|\}/g;
  while ((m = tokenRe.exec(src))) {
    if (m[0] === '{') { depth++; continue; }
    if (m[0] === '}') { depth--; continue; }
    const key = m[1] || m[2];
    if (depth === 1 && key) {
      const inner = sliceBalanced(src, tokenRe.lastIndex - 1);
      const grades = (inner.match(/\[['"]?\d+['"]?\]\s*=\s*\{|grade\s*=/gi) || []).length;
      topKeys.push({ name: key, grades: grades || countGradeKeys(inner) });
    }
    depth++; // entering this key's own table
  }
  return topKeys.map((k) => ({ name: k.name, grades: k.grades }));
}

function countGradeKeys(inner) {
  const g = inner.match(/grades\s*=\s*\{/);
  if (!g) return 0;
  const body = sliceBalanced(inner, inner.indexOf('{', g.index + g[0].length - 1));
  return (body.match(/\[['"]?\d+['"]?\]\s*=/g) || []).length;
}

function countItems(text) {
  // items file: count top-level entries ['key'] = { ... } or key = { ... }
  const start = text.search(/(?:\.Items\s*=\s*\{|return\s*\{)/);
  if (start < 0) return 0;
  const body = sliceBalanced(text, text.indexOf('{', start));
  // body includes the outer brace, so top-level entries sit at depth 1
  let depth = 0, count = 0, m;
  const tokenRe = /\[['"]([^'"]+)['"]\]\s*=\s*\{|(\w+)\s*=\s*\{|\{|\}/g;
  while ((m = tokenRe.exec(body))) {
    if (m[0] === '{') { depth++; continue; }
    if (m[0] === '}') { depth--; continue; }
    if (depth === 1) count++; // a `key = {` entry inside the outer table
    depth++;                   // its own value brace was consumed by the match
  }
  return count;
}

// return the substring of the balanced {...} beginning at openIdx (inclusive)
function sliceBalanced(text, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) return text.slice(openIdx, i + 1); }
  }
  return text.slice(openIdx);
}

module.exports = { detectDependencies, detectJobs, detectItems, CORE_DEPS };
