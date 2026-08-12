// providers/index.js - provider selection + deterministic fallback.
// The tenant's decrypted key comes in as an argument; it is never stored,
// never logged, and dies with the request.
const gemini = require('./gemini');
const claude = require('./claude');
const { stubInterpret } = require('../lib/stub-interpret');
const { fallbackAnswer } = require('../lib/ask-persona');

const PROVIDERS = { gemini, claude };
// Rogue-AI simulator for the test suite ONLY - see providers/fake.js.
if (process.env.NODE_ENV === 'test') PROVIDERS.fake = require('./fake');

// Free-form text -> validated whitelisted action (or none).
async function interpretText(tenant, apiKey, text) {
  if (apiKey) {
    const provider = PROVIDERS[tenant.provider] || gemini;
    try {
      return await provider.interpret(apiKey, text, tenant.allowedActions);
    } catch (err) {
      console.error(`[providers] ${provider.name} interpret failed (${err.message}) - using keyword fallback`);
    }
  }
  return stubInterpret(text);
}

// Ask mode: a short text answer, no action, nothing queued.
// `ctx` carries { language, server } — language is the language the operator
// wrote in (the reply MUST match it), server is the latest scan's model (for
// concreteness). allowedActions come from the tenant.
async function askText(tenant, apiKey, text, ctx = {}) {
  const askCtx = { language: ctx.language === 'ar' ? 'ar' : 'en', allowedActions: tenant.allowedActions, server: ctx.server };
  if (apiKey) {
    const provider = PROVIDERS[tenant.provider] || gemini;
    try {
      const reply = await provider.ask(apiKey, text, askCtx);
      if (reply) return reply;
    } catch (err) {
      console.error(`[providers] ${provider.name} ask failed (${err.message}) - using deterministic fallback`);
    }
  }
  // No key (or the call failed): a genuinely helpful, language-correct answer.
  return fallbackAnswer(askCtx);
}

// ---- Whitelist Officer: provider-backed judge + scorer (BYOK). Fall back is
// handled upstream (lib/whitelist/brain.js) when there's no key. ----
async function whitelistJudge(tenant, apiKey, args) {
  const provider = PROVIDERS[tenant.provider] || gemini;
  return provider.whitelistJudge ? provider.whitelistJudge(apiKey, args) : { sufficient: true };
}
async function whitelistScore(tenant, apiKey, args) {
  const provider = PROVIDERS[tenant.provider] || gemini;
  if (!provider.whitelistScore) throw new Error('provider has no whitelistScore');
  return provider.whitelistScore(apiKey, args);
}

async function conciergeReply(tenant, apiKey, args) {
  const provider = PROVIDERS[tenant.provider] || gemini;
  if (!provider.conciergeReply) throw new Error('provider has no conciergeReply');
  return provider.conciergeReply(apiKey, args);
}

module.exports = { interpretText, askText, whitelistJudge, whitelistScore, conciergeReply };
