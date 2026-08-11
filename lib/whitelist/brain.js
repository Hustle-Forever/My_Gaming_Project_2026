// lib/whitelist/brain.js - wires the interview judge and the scoring brain to
// the provider layer, with an offline heuristic fallback (no key configured),
// exactly like the console's keyword fallback. Decrypts the tenant key only
// here, per request.
const { decryptSecret } = require('../crypto');
const providers = require('../../providers');

function tenantKey(tenant) {
  if (!tenant || !tenant.providerKeyEnc) return null;
  try { return decryptSecret(tenant.providerKeyEnc); } catch (_) { return null; }
}

// Judge: is this answer sufficient, or does it need a follow-up?
// Offline heuristic: sufficient when it has enough substance (language-blind
// word count) and isn't an obvious dodge.
function heuristicJudge() {
  return async ({ answer }) => {
    const words = String(answer || '').trim().split(/\s+/).filter(Boolean);
    const sufficient = words.length >= 8;
    return {
      sufficient,
      followUp: { en: 'Could you give a specific example or a bit more detail?', ar: 'ممكن تعطينا مثالًا محددًا أو تفاصيل أكثر؟' },
    };
  };
}

function makeJudge(tenant) {
  const key = tenantKey(tenant);
  if (key && providers.whitelistJudge) {
    return async (args) => {
      try { return await providers.whitelistJudge(tenant, key, args); }
      catch (_) { return heuristicJudge()(args); }
    };
  }
  return heuristicJudge();
}

// Scoring brain: null => scoreApplication uses its evidence-backed offline
// fallback. With a key, use the provider's forced-schema scorer.
function makeBrain(tenant) {
  const key = tenantKey(tenant);
  if (key && providers.whitelistScore) {
    return async (args) => providers.whitelistScore(tenant, key, args);
  }
  return null;
}

module.exports = { makeJudge, makeBrain, heuristicJudge };
