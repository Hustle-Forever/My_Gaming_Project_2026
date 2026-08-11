// lib/scanner/index.js - the orchestrator. Adapter in, report out.
// Pipeline: parse cfg -> build resource graph -> detect identity -> run every
// pluggable check -> rank into a report. Adding a check never touches this
// file (checks/index.js is the only registry). Strictly read-only throughout.
const { parseServerCfg } = require('./parseServerCfg');
const { buildResourceGraph } = require('./buildResourceGraph');
const { detectFramework } = require('./detectFramework');
const { detectInventory } = require('./detectInventory');
const { detectDependencies, detectJobs, detectItems } = require('./detect');
const checks = require('./checks');
const { buildReport } = require('./report');

function scan(adapter, opts = {}) {
  try {
    const cfg = parseServerCfg(adapter);
    const model = buildResourceGraph(adapter, cfg);
    const ctx = { adapter };

    const identity = {
      framework: detectFramework(model, adapter),
      inventory: detectInventory(model, adapter),
      dependencies: detectDependencies(model),
      jobs: detectJobs(model, adapter),
      items: detectItems(model, adapter),
    };

    const findings = [];
    for (const check of checks) {
      try {
        const results = check.run(model, ctx) || [];
        for (const f of results) findings.push(f);
      } catch (err) {
        // a broken check must never sink the whole scan
        findings.push({
          checkId: `check-error:${check.id}`, severity: 'info',
          title: { en: `Check ${check.id} could not run`, ar: `تعذّر تشغيل الفحص ${check.id}` },
          why: { en: String(err.message), ar: 'حدث خطأ داخلي أثناء هذا الفحص.' },
          fix: { en: 'This is an M2-side issue, not your server.', ar: 'هذه مشكلة من طرف M2 وليست من سيرفرك.' },
          evidence: [{ detail: 'internal check error' }],
        });
      }
    }

    // storable model: identity + structure only, NO raw source or secrets
    const storableModel = stripModel(model);
    return buildReport({ identity, findings, model: storableModel });
  } finally {
    if (opts.destroyAdapter && adapter && adapter.destroy) adapter.destroy();
  }
}

// Keep the useful structure; drop anything that could carry customer source.
function stripModel(model) {
  const resources = {};
  for (const [name, r] of Object.entries(model.resources)) {
    resources[name] = {
      name: r.name,
      relPath: r.relPath,
      started: r.started,
      orderIndex: r.orderIndex,
      dependencies: r.dependencies,
      sizeBytes: r.sizeBytes,
      streamBytes: r.streamBytes,
      escrow: r.escrow,
      // manifest metadata only — never the script bodies
      manifest: r.manifest && {
        name: r.manifest.name, version: r.manifest.version,
        author: r.manifest.author, fxVersion: r.manifest.fxVersion,
        malformed: !!r.manifest.malformed,
      },
    };
  }
  return {
    resources,
    ghosts: model.ghosts,
    deadWeight: model.deadWeight,
    structure: model.structure,
    ensureOrder: model.cfg.ensures.map((e) => e.name),
  };
}

module.exports = { scan };
