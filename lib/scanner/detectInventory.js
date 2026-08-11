// lib/scanner/detectInventory.js - which inventory the server runs.
// Multiple started inventories are a real (common) misconfig, so this returns
// the winner AND all candidates - the duplicates check reads the latter.
const KNOWN = [
  'ox_inventory', 'qb-inventory', 'qs-inventory', 'ps-inventory',
  'esx_inventoryhud', 'codem-inventory', 'core_inventory', 'tgiann-inventory',
];

function detectInventory(model, adapter) {
  const resources = model.resources || {};
  const candidates = KNOWN.filter((n) => resources[n]).map((n) => ({
    name: n,
    started: resources[n].started,
  }));

  // prefer a started inventory; among those, first known in the list
  const started = candidates.filter((c) => c.started);
  const winner = (started[0] || candidates[0]) || null;

  return {
    inventory: winner ? winner.name : 'unknown',
    confidence: winner ? (winner.started ? 0.9 : 0.6) : 0.2,
    candidates,
    evidence: candidates.map((c) => ({ kind: 'resource', detail: `${c.name} present${c.started ? ' (started)' : ''}` })),
  };
}

module.exports = { detectInventory, KNOWN };
