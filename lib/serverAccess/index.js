// lib/serverAccess - how the scanner reads a customer's FiveM server.
// ONE adapter contract, multiple sources. Everything above this layer works
// identically regardless of where the files came from.
//
//   adapter.listFiles(prefix?) -> [{ path, size }]   (ALL files incl. binary names)
//   adapter.readFile(path)     -> string             (text files only, size-capped)
//   adapter.stat(path)         -> { size, isText }
//   adapter.exists(path)       -> boolean
//   adapter.capabilities       -> { list, read, cfg }
//   adapter.violations         -> [{ entry, reason }] (hostile zip entries etc.)
//   adapter.destroy()          -> frees the workspace; further calls throw DESTROYED
//
// STRICTLY READ-ONLY by construction: no adapter exposes any write/move/delete.
// Safety: only text formats are ever readable (manifests, .lua, .cfg, .json,
// .sql); binary assets are listed by name+size but their content is never
// loaded; per-file and total byte budgets are hard limits; zip paths are
// normalized and traversal entries dropped; symlink entries are skipped.
const path = require('path');
const fs = require('fs');

const TEXT_EXTENSIONS = new Set(['.lua', '.cfg', '.json', '.sql', '.txt', '.md']);
const LIMITS = {
  maxEntries: 8000,          // total files in the workspace
  maxFileBytes: 1024 * 1024, // per readable text file
  maxTotalTextBytes: 24 * 1024 * 1024,
};

function err(code, message) {
  const e = new Error(`${code}: ${message}`);
  e.code = code;
  return e;
}

const norm = (p) => String(p).replace(/\\/g, '/').replace(/^\/+/, '');
const isTextPath = (p) => TEXT_EXTENSIONS.has(path.posix.extname(norm(p).toLowerCase()))
  || /(^|\/)(fxmanifest\.lua|__resource\.lua|server\.cfg)$/i.test(norm(p));

// Traversal-safe join: resolves "." and ".." INSIDE the virtual workspace;
// anything that escapes the root is hostile.
function safeRelative(entryPath) {
  const cleaned = norm(entryPath);
  const parts = [];
  for (const part of cleaned.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return null; // escape attempt
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.length ? parts.join('/') : null;
}

// The shared core: an immutable in-memory workspace. No temp directories -
// nothing to leak on serverless, destroy() just drops the references.
function memoryAdapter({ files, violations, source }) {
  let dead = false;
  const alive = () => { if (dead) throw err('DESTROYED', 'adapter has been destroyed'); };
  return {
    source,
    capabilities: { list: true, read: true, cfg: true },
    violations,
    listFiles(prefix = '') {
      alive();
      const p = norm(prefix);
      const out = [];
      for (const [fp, entry] of files) {
        if (!p || fp === p || fp.startsWith(p.endsWith('/') ? p : p + '/')) {
          out.push({ path: fp, size: entry.size });
        }
      }
      return out;
    },
    readFile(fp) {
      alive();
      const entry = files.get(norm(fp));
      if (!entry) throw err('NOT_FOUND', fp);
      if (!entry.isText) throw err('NOT_TEXT', `${fp} is a binary asset - content is never read`);
      if (entry.content === null) throw err('TOO_LARGE', `${fp} exceeds the per-file read limit`);
      return entry.content;
    },
    stat(fp) {
      alive();
      const entry = files.get(norm(fp));
      if (!entry) throw err('NOT_FOUND', fp);
      return { size: entry.size, isText: entry.isText };
    },
    exists(fp) {
      alive();
      return files.has(norm(fp));
    },
    destroy() {
      dead = true;
      files.clear();
    },
  };
}

// ---- uploadAdapter: ZIP buffer -> workspace ----
function fromZipBuffer(buffer, opts = {}) {
  const AdmZip = require('adm-zip');
  const limits = { ...LIMITS, ...opts };
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  if (entries.length > limits.maxEntries) {
    throw err('LIMIT_EXCEEDED', `zip has ${entries.length} files (max ${limits.maxEntries})`);
  }

  const files = new Map();
  const violations = [];
  let totalTextBytes = 0;

  for (const entry of entries) {
    // adm-zip already sanitizes entry names on read; this is the belt to its
    // suspenders - anything that still looks like an escape is dropped.
    const rel = safeRelative(entry.entryName);
    if (rel === null || norm(entry.entryName).includes('..')) {
      violations.push({ entry: entry.entryName, reason: 'path traversal' });
      continue;
    }
    // symlink entries (unix mode S_IFLNK in external attributes): skip
    const unixMode = (entry.header.attr >>> 16) & 0xf000;
    if (unixMode === 0xa000) {
      violations.push({ entry: entry.entryName, reason: 'symlink' });
      continue;
    }
    const size = entry.header.size;
    const isText = isTextPath(rel);
    let content = null;
    if (isText && size <= limits.maxFileBytes) {
      totalTextBytes += size;
      if (totalTextBytes > limits.maxTotalTextBytes) {
        throw err('LIMIT_EXCEEDED', `total text content exceeds ${limits.maxTotalTextBytes} bytes`);
      }
      content = entry.getData().toString('utf8');
    }
    files.set(rel, { size, isText, content });
  }
  return memoryAdapter({ files, violations, source: 'upload' });
}

// ---- directory adapter (fixtures, local runs) - same contract ----
function fromDirectory(rootDir, opts = {}) {
  const limits = { ...LIMITS, ...opts };
  const files = new Map();
  let count = 0;
  let totalTextBytes = 0;
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const st = fs.lstatSync(full);
      if (st.isSymbolicLink()) continue; // never follow symlinks
      if (st.isDirectory()) { walk(full); continue; }
      count += 1;
      if (count > limits.maxEntries) throw err('LIMIT_EXCEEDED', `more than ${limits.maxEntries} files`);
      const rel = norm(path.relative(rootDir, full));
      const isText = isTextPath(rel);
      let content = null;
      if (isText && st.size <= limits.maxFileBytes) {
        totalTextBytes += st.size;
        if (totalTextBytes > limits.maxTotalTextBytes) throw err('LIMIT_EXCEEDED', 'total text budget exceeded');
        content = fs.readFileSync(full, 'utf8');
      }
      files.set(rel, { size: st.size, isText, content });
    }
  };
  walk(rootDir);
  return memoryAdapter({ files, violations: [], source: 'directory' });
}

// ---- scan-pack adapter (dashboard folder-picker path; gzip'd JSON of
// pre-filtered text files built client-side) ----
function fromScanPack(pack, opts = {}) {
  const limits = { ...LIMITS, ...opts };
  if (!pack || !Array.isArray(pack.files)) throw err('BAD_PACK', 'scan pack must carry a files array');
  if (pack.files.length > limits.maxEntries) throw err('LIMIT_EXCEEDED', 'too many files in pack');
  const files = new Map();
  const violations = [];
  let totalTextBytes = 0;
  for (const f of pack.files) {
    // scan packs are CLIENT-built JSON - this is the layer's real traversal
    // surface, so escapes are dropped and recorded, never ingested
    const rel = safeRelative(f.path || '');
    if (rel === null || norm(f.path || '').includes('..')) {
      violations.push({ entry: String(f.path), reason: 'path traversal' });
      continue;
    }
    const isText = isTextPath(rel) && typeof f.content === 'string';
    const size = Number(f.size) || (typeof f.content === 'string' ? Buffer.byteLength(f.content) : 0);
    let content = null;
    if (isText && size <= limits.maxFileBytes) {
      totalTextBytes += size;
      if (totalTextBytes > limits.maxTotalTextBytes) throw err('LIMIT_EXCEEDED', 'total text budget exceeded');
      content = f.content;
    }
    files.set(rel, { size, isText, content });
  }
  return memoryAdapter({ files, violations, source: 'upload' });
}

// ---- ftpAdapter: interface stub, deliberately unimplemented ----
// Credential storage policy is a human decision (see TASK_M2_SCANNER §3).
// When built it must return the same contract as memoryAdapter and remain
// strictly read-only.
function ftpAdapter() {
  throw err('NOT_IMPLEMENTED', 'ftpAdapter is a documented stub - credential storage is a pending human decision');
}

module.exports = { TEXT_EXTENSIONS, LIMITS, fromZipBuffer, fromDirectory, fromScanPack, ftpAdapter };
