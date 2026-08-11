// lib/scanner/buildResourceGraph.js - discovers every resource on disk and
// cross-references it with the cfg start list to produce the serverModel:
// the single structured object every detector and check reads from.
//
// A "resource" is any directory containing fxmanifest.lua or __resource.lua.
// FiveM category folders ([qb], [standalone], ...) are containers, not
// resources - they're transparent to naming and load order.
const path = require('path').posix;
const { parseManifest } = require('./parseManifest');

const BINARY_STREAM = /\.(ytd|yft|ydr|ymap|ymt|ybn|ycd|awc|rpf|dds|png|jpg|jpeg|ogg|oga|webm|mp3|dat|nametable)$/i;

function manifestDirs(adapter) {
  const dirs = new Map(); // resourceDir -> manifestPath
  for (const f of adapter.listFiles()) {
    const base = path.basename(f.path).toLowerCase();
    if (base === 'fxmanifest.lua' || base === '__resource.lua') {
      dirs.set(f.path.slice(0, f.path.lastIndexOf('/')), f.path);
    }
  }
  return dirs;
}

// resource NAME = the folder holding the manifest, ignoring [category] wrappers
const resourceName = (dir) => path.basename(dir);

function buildResourceGraph(adapter, cfg) {
  const dirs = manifestDirs(adapter);
  const resources = {};
  const nested = [];

  // order lookup from the cfg
  const orderOf = new Map(cfg.ensures.map((e) => [e.name, e.orderIndex]));

  for (const [dir, manifestPath] of dirs) {
    const name = resourceName(dir);

    // double-nested: resources/x/x/fxmanifest.lua where the OUTER x has no manifest
    const parent = dir.slice(0, dir.lastIndexOf('/'));
    if (path.basename(parent) === name && !dirs.has(parent)) {
      nested.push({ name, path: dir, expected: parent });
    }

    let manifest;
    try { manifest = parseManifest(adapter.readFile(manifestPath)); }
    catch (_) { manifest = { malformed: true, dependencies: [], scripts: { client: [], server: [], shared: [] } }; }

    // sizes: sum text bytes; stream/binary bytes counted separately (never read)
    let sizeBytes = 0;
    let streamBytes = 0;
    let escrow = false;
    for (const file of adapter.listFiles(dir)) {
      if (BINARY_STREAM.test(file.path)) streamBytes += file.size;
      else sizeBytes += file.size;
      if (/(^|\/)\.fxap$/.test(file.path)) escrow = true; // FiveM escrow marker
    }

    resources[name] = {
      name,
      relPath: dir,
      manifestPath,
      started: orderOf.has(name),
      orderIndex: orderOf.has(name) ? orderOf.get(name) : null,
      dependencies: manifest.dependencies || [],
      manifest,
      sizeBytes,
      streamBytes,
      escrow,
    };
  }

  // ghosts: ensured in cfg but no manifest on disk
  const ghosts = cfg.ensures
    .filter((e) => !resources[e.name])
    .map((e) => ({ name: e.name, file: e.file, orderIndex: e.orderIndex }));

  // dead weight: on disk but never started
  const deadWeight = Object.values(resources)
    .filter((r) => !r.started)
    .map((r) => r.name)
    .sort();

  // structure: directories under resources/ that contain files but no manifest
  const missingManifest = findMissingManifestDirs(adapter, dirs);

  return {
    resources,
    ghosts,
    deadWeight,
    structure: { nested, missingManifest },
    cfg,
  };
}

// A directory directly under resources/ (or a [category]) that holds files but
// no manifest anywhere beneath a same-named child = likely a broken drop-in.
function findMissingManifestDirs(adapter, dirs) {
  const resourceParents = new Set();
  for (const d of dirs.keys()) {
    // mark this dir and its ancestors as "covered"
    let cur = d;
    while (cur.includes('/')) { resourceParents.add(cur); cur = cur.slice(0, cur.lastIndexOf('/')); }
    resourceParents.add(cur);
  }
  const topDirs = new Map(); // firstTwoSegments -> hasManifestCovered
  const missing = [];
  const seen = new Set();
  for (const f of adapter.listFiles('resources')) {
    const parts = f.path.split('/'); // resources / <maybe [cat]> / <name> / ...
    // find the resource-level dir: skip [category] wrappers
    let idx = 1;
    while (idx < parts.length - 1 && /^\[.*\]$/.test(parts[idx])) idx += 1;
    const resDir = parts.slice(0, idx + 1).join('/');
    if (parts.length <= idx + 1) continue; // a file sitting directly in a [cat]
    if (seen.has(resDir)) continue;
    seen.add(resDir);
    if (!resourceParents.has(resDir)) missing.push(resDir);
  }
  return missing.sort();
}

module.exports = { buildResourceGraph };
