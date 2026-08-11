// lib/scanner/parseManifest.js - fxmanifest.lua / __resource.lua reader.
// FiveM manifests are Lua, but a full Lua VM is overkill and unsafe on
// untrusted input. We extract exactly the directives the scanner needs with
// resilient regexes; anything we can't recognize is surfaced, never guessed.
// Never executes manifest code.

// value of a `directive '<value>'` (single or double quoted)
function scalar(src, directive) {
  const m = src.match(new RegExp(`(?:^|\\n)\\s*${directive}\\s+['"]([^'"]*)['"]`, 'i'));
  return m ? m[1] : null;
}

// all string literals inside `directive { ... }` OR a single `directive 'x'`
function stringList(src, directive) {
  const out = [];
  const block = src.match(new RegExp(`(?:^|\\n)\\s*${directive}\\s*\\{([\\s\\S]*?)\\}`, 'i'));
  if (block) {
    const re = /['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(block[1]))) out.push(m[1]);
    return out;
  }
  const single = src.match(new RegExp(`(?:^|\\n)\\s*${directive}\\s+['"]([^'"]+)['"]`, 'i'));
  if (single) out.push(single[1]);
  return out;
}

function parseManifest(source) {
  const src = String(source || '');
  const looksLikeManifest = /\b(fx_version|resource_manifest_version|game|client_script|server_script|shared_script|dependency|dependencies)\b/i.test(src);

  // dependency 'x'  +  dependencies { 'a', 'b' }  (dedup, preserve order)
  const deps = [...stringList(src, 'dependencies'), ...stringList(src, 'dependency')];
  const dependencies = [...new Set(deps)];

  return {
    fxVersion: scalar(src, 'fx_version'),
    name: scalar(src, 'name'),
    author: scalar(src, 'author'),
    version: scalar(src, 'version'),
    game: scalar(src, 'game'),
    dependencies,
    scripts: {
      client: [...stringList(src, 'client_script'), ...stringList(src, 'client_scripts')],
      server: [...stringList(src, 'server_script'), ...stringList(src, 'server_scripts')],
      shared: [...stringList(src, 'shared_script'), ...stringList(src, 'shared_scripts')],
    },
    // a manifest with none of the marker directives is malformed/not a manifest
    malformed: !looksLikeManifest,
  };
}

module.exports = { parseManifest };
