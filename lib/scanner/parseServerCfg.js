// lib/scanner/parseServerCfg.js - server.cfg reader with exec recursion.
// Extracts the ORDERED start list (ensure / start), resolves exec'd sub-cfgs
// depth-first so the real load order is preserved, and captures convars
// (set / setr / sv_hostname) for later credential + config checks.
// Reads only through the access adapter - never the filesystem directly.

const CFG_CANDIDATES = ['server.cfg', 'resources/server.cfg'];

function findRootCfg(adapter) {
  for (const c of CFG_CANDIDATES) if (adapter.exists(c)) return c;
  // else: first *.cfg at the top of the listing
  const anyCfg = adapter.listFiles().find((f) => /(^|\/)server\.cfg$/i.test(f.path))
    || adapter.listFiles().find((f) => f.path.toLowerCase().endsWith('.cfg'));
  return anyCfg ? anyCfg.path : null;
}

function stripInlineComment(line) {
  // '#' and ';' start comments; naive but fine for cfg files
  const hash = line.indexOf('#');
  const semi = line.indexOf(';');
  let cut = -1;
  if (hash >= 0) cut = hash;
  if (semi >= 0 && (cut < 0 || semi < cut)) cut = semi;
  return cut >= 0 ? line.slice(0, cut) : line;
}

// quote-aware token split
function tokenize(line) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

function parseServerCfg(adapter) {
  const ensures = [];
  const convars = {};
  const missingExecs = [];
  const seen = new Set();
  const started = new Set();

  const root = findRootCfg(adapter);
  const walk = (cfgPath) => {
    if (!cfgPath || seen.has(cfgPath)) return; // guard exec loops
    seen.add(cfgPath);
    let text;
    try { text = adapter.readFile(cfgPath); } catch (_) { return; }
    for (const raw of text.split(/\r?\n/)) {
      const line = stripInlineComment(raw).trim();
      if (!line) continue;
      const tok = tokenize(line);
      const cmd = (tok[0] || '').toLowerCase();
      if ((cmd === 'ensure' || cmd === 'start') && tok[1]) {
        const name = tok[1];
        if (!started.has(name)) { // first mention wins the order slot
          started.add(name);
          ensures.push({ name, file: cfgPath, orderIndex: ensures.length });
        }
      } else if (cmd === 'exec' && tok[1]) {
        // resolve relative to the cfg dir, then repo root
        const dir = cfgPath.includes('/') ? cfgPath.slice(0, cfgPath.lastIndexOf('/') + 1) : '';
        const candidates = [dir + tok[1], tok[1]];
        const target = candidates.find((c) => adapter.exists(c));
        if (target) walk(target);
        else missingExecs.push({ file: cfgPath, target: tok[1] });
      } else if ((cmd === 'set' || cmd === 'setr' || cmd === 'sets') && tok[1]) {
        convars[tok[1]] = { value: tok.slice(2).join(' '), file: cfgPath, raw: line };
      } else if (cmd.startsWith('sv_') || cmd.startsWith('sets')) {
        convars[cmd] = { value: tok.slice(1).join(' '), file: cfgPath, raw: line };
      }
    }
  };
  walk(root);

  // re-index in case duplicates were skipped
  ensures.forEach((e, i) => { e.orderIndex = i; });
  return { rootCfg: root, ensures, convars, missingExecs };
}

module.exports = { parseServerCfg };
