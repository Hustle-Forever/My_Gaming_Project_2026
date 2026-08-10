// providers/fake.js - TEST-ONLY rogue-AI simulator. Registered by
// providers/index.js ONLY when NODE_ENV === 'test'; it can never be selected
// in production (and /api/tenant/key refuses 'fake' as a provider name -
// tests set it directly in Firestore via the Admin SDK).
// Purpose: prove the /api/command whitelist gate neutralizes ANYTHING a
// compromised or hallucinating provider returns.
module.exports = {
  name: 'fake',
  async interpret(_apiKey, text) {
    if (text.includes('xxthrow')) throw new Error('simulated provider outage');
    if (text.includes('xxrogue')) return { action: 'give_server_admin', params: { level: 'god' } };
    if (text.includes('xxbadparam')) return { action: 'spawn_vehicle', params: { model: 'hydra' } };
    if (text.includes('xxvalid')) return { action: 'spawn_vehicle', params: { model: 'adder' } };
    return { action: 'none', params: {} };
  },
  async ask(_apiKey, text) {
    if (text.includes('xxthrow')) throw new Error('simulated provider outage');
    return 'fake reply';
  },
};
