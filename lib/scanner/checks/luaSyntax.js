// Best-effort Lua syntax screening without a Lua VM. We can't fully parse Lua
// in JS safely, but the highest-value class - unbalanced block keywords
// (function/if/for/while/do ... end) - catches the most common "resource
// crashes on load" cause. Comments and strings are stripped first to avoid
// false positives. Reported at medium confidence; never claims to be a full
// parser.
const OPENERS = /\b(function|if|for|while|do)\b/g;
const CLOSERS = /\bend\b/g;

function stripLua(src) {
  return src
    .replace(/--\[\[[\s\S]*?\]\]/g, ' ')   // block comments
    .replace(/--[^\n]*/g, ' ')             // line comments
    .replace(/\[\[[\s\S]*?\]\]/g, ' ')     // long strings
    .replace(/"(?:\\.|[^"\\])*"/g, '""')   // double strings
    .replace(/'(?:\\.|[^'\\])*'/g, "''");  // single strings
}

// `do` inside `for/while ... do` is paired with the same `end`, so counting
// raw `do` double-counts. Remove the `do` that follows for/while headers.
function normalize(src) {
  return src.replace(/\b(for|while)\b[^\n]*?\bdo\b/g, '$1');
}

module.exports = {
  id: 'lua-syntax',
  title: { en: 'Lua syntax error', ar: 'خطأ صياغة Lua' },
  severity: 'critical',
  run(model, ctx) {
    const out = [];
    if (!ctx || !ctx.adapter) return out;
    for (const res of Object.values(model.resources)) {
      for (const file of ctx.adapter.listFiles(res.relPath)) {
        if (!file.path.endsWith('.lua')) continue;
        let src;
        try { src = ctx.adapter.readFile(file.path); } catch (_) { continue; }
        const clean = normalize(stripLua(src));
        const opens = (clean.match(OPENERS) || []).length;
        const ends = (clean.match(CLOSERS) || []).length;
        if (opens !== ends) {
          out.push({
            checkId: 'lua-syntax',
            severity: 'critical',
            title: { en: `${res.name}: unbalanced Lua blocks`, ar: `${res.name}: كتل Lua غير متوازنة` },
            why: {
              en: `${file.path} has ${opens} block openers (function/if/for/while) but ${ends} \`end\`s. A missing or extra \`end\` stops the whole resource from loading.`,
              ar: `${file.path} فيه ${opens} فاتحة كتلة مقابل ${ends} \`end\`. نقص أو زيادة \`end\` يمنع تحميل المورد بالكامل.`,
            },
            fix: {
              en: `Open ${file.path} and match each function/if/for/while with exactly one \`end\`.`,
              ar: `افتح ${file.path} ووازِن كل function/if/for/while مع \`end\` واحدة.`,
            },
            evidence: [{ resource: res.name, file: file.path, detail: `${opens} openers vs ${ends} ends` }],
          });
        }
      }
    }
    return out;
  },
};
