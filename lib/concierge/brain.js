// lib/concierge/brain.js - wires the Concierge message brain to the provider
// layer with an offline fallback (buildReply uses the deterministic templates
// when this returns null). Decrypts the tenant key only here, per request, and
// uses the cheapest configured model with a hard token budget.
const { decryptSecret } = require('../crypto');
const providers = require('../../providers');
const { systemPrompt } = require('./personality');
const { recommendJobs, recommendForChoice } = require('./recommend');

function tenantKey(tenant) {
  if (!tenant || !tenant.providerKeyEnc) return null;
  try { return decryptSecret(tenant.providerKeyEnc); } catch (_) { return null; }
}

// Returns a brain(ctx) or null. The brain asks the provider for a SHORT reply
// and returns { actions }; buildReply then re-validates through the closed set.
function makeBrain(tenant, server) {
  const key = tenantKey(tenant);
  if (!key || !providers.conciergeReply) return null;
  return async (ctx) => {
    const hints = {
      jobs: recommendJobs(ctx.config, ctx.report).map((j) => j.id),
      destination: ctx.choiceJobId ? recommendForChoice(ctx.config, ctx.report, ctx.choiceJobId, ctx.language) : null,
    };
    return providers.conciergeReply(tenant, key, {
      system: systemPrompt(ctx.config, server),
      phase: ctx.phase,
      language: ctx.language,
      playerMessage: ctx.playerMessage || '',
      hints,
    });
  };
}

module.exports = { makeBrain };
