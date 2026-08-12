// providers/index.js - provider selection + deterministic fallback.
// The tenant's decrypted key comes in as an argument; it is never stored,
// never logged, and dies with the request.
const gemini = require('./gemini');
const claude = require('./claude');
const { stubInterpret } = require('../lib/stub-interpret');

const PROVIDERS = { gemini, claude };
// Rogue-AI simulator for the test suite ONLY - see providers/fake.js.
if (process.env.NODE_ENV === 'test') PROVIDERS.fake = require('./fake');
const isArabic = (text) => /[؀-ۿ]/.test(String(text));

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
async function askText(tenant, apiKey, text) {
  if (apiKey) {
    const provider = PROVIDERS[tenant.provider] || gemini;
    try {
      const reply = await provider.ask(apiKey, text);
      if (reply) return reply;
    } catch (err) {
      console.error(`[providers] ${provider.name} ask failed (${err.message}) - using canned reply`);
    }
  }
  return isArabic(text)
    ? 'وضع «سؤال» يحتاج مفتاح AI — أضِفه من لوحة التحكم. أوامر «تنفيذ» تعمل بدون مفتاح عبر المطابقة النصية.'
    : 'Ask mode needs an AI key - add yours in the dashboard. Run commands still work without one via keyword matching.';
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
