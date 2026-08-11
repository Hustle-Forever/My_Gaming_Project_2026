// lib/scanner/detectFramework.js - which framework the server runs.
// Evidence-based: signals are the presence + started state of marker
// resources and their manifests. Confidence reflects signal strength.
// Returns { framework:'qbcore'|'esx'|'standalone'|'unknown', version, confidence, evidence }.

const SIGNATURES = {
  qbcore: ['qb-core', 'qbx_core', 'qbcore'],
  esx: ['es_extended', 'esx_menu_default', 'essentialmode'],
};

function detectFramework(model, adapter) {
  const evidence = [];
  const resources = model.resources || {};
  const has = (name) => resources[name];

  let framework = 'unknown';
  let confidence = 0;
  let version = null;

  // QBCore / QBox
  const qbHit = SIGNATURES.qbcore.find((n) => has(n));
  const esxHit = SIGNATURES.esx.find((n) => has(n));

  if (qbHit) {
    framework = 'qbcore';
    const r = resources[qbHit];
    confidence = r.started ? 0.95 : 0.7;
    evidence.push({ kind: 'resource', detail: `${qbHit} resource present`, file: r.manifestPath, started: r.started });
    version = r.manifest && r.manifest.version;
    if (qbHit === 'qbx_core') { evidence.push({ kind: 'variant', detail: 'QBox (qbx_core) variant' }); }
    // corroborating: exports['qb-core']:GetCoreObject usage anywhere
    if (usesExport(adapter, 'qb-core') || usesExport(adapter, 'qbx_core')) {
      confidence = Math.min(0.99, confidence + 0.03);
      evidence.push({ kind: 'usage', detail: "exports['qb-core']:GetCoreObject() referenced" });
    }
  } else if (esxHit) {
    framework = 'esx';
    const r = resources[esxHit];
    confidence = r.started ? 0.95 : 0.7;
    evidence.push({ kind: 'resource', detail: `${esxHit} resource present`, file: r.manifestPath, started: r.started });
    version = r.manifest && r.manifest.version;
  } else {
    // no framework markers at all. Could be genuinely standalone, but we do
    // NOT assert that without a signal - default to unknown/low confidence.
    framework = 'unknown';
    confidence = 0.2;
    evidence.push({ kind: 'absence', detail: 'no QBCore/ESX marker resources found' });
  }

  return { framework, version: version || null, confidence: round(confidence), evidence };
}

function usesExport(adapter, resource) {
  const needle = `exports['${resource}']`;
  const needle2 = `exports["${resource}"]`;
  for (const f of adapter.listFiles()) {
    if (!f.path.endsWith('.lua')) continue;
    let txt;
    try { txt = adapter.readFile(f.path); } catch (_) { continue; }
    if (txt.includes(needle) || txt.includes(needle2)) return true;
  }
  return false;
}

const round = (n) => Math.round(n * 100) / 100;
module.exports = { detectFramework };
