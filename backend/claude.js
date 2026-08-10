// claude.js - turns free-form Arabic/English text into one whitelisted action.
// Primary path: Claude (BYOK - the tenant's own API key) with a single FORCED
// tool whose action enum is closed, so the model literally cannot return an
// action outside the whitelist. Fallback path: deterministic keyword stub,
// used when the tenant has no API key or the API call fails.
// Every result - from either path - still goes through actions.validateAction.

const Anthropic = require('@anthropic-ai/sdk');
const actions = require('./actions');

const MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = [
  'أنت وحدة تحكم داخل سيرفر FiveM للرول بلاي. تقرأ طلب اللاعب (بالعربية أو الإنجليزية) وتختار إجراءً واحدًا فقط من قائمة الإجراءات المسموحة داخل اللعبة، مع استخراج المعاملات المطلوبة (مثل نوع السيارة أو حالة الطقس أو الساعة).',
  'You control a FiveM roleplay server. You can ONLY perform the in-game actions listed in the execute_action tool - nothing else exists.',
  'Rules:',
  '- Pick exactly one action, or "none" if the request does not clearly match any listed action (general questions, chit-chat, or anything outside the list are always "none").',
  '- Never invent actions or parameters outside the schema.',
  '- Respond only with the execute_action tool call.',
].join('\n');

// One tool, forced. The action enum is built from the tenant's allowed
// actions + "none" - a closed list is the safety property, keep it.
function buildTool(tenant) {
  const defs = actions.listForClaude(tenant.allowedActions);
  const paramProps = {};
  for (const def of defs) Object.assign(paramProps, def.params);
  const lines = defs.map((d) => `- ${d.name}: ${d.description}`).join('\n');

  return {
    name: 'execute_action',
    description:
      'Execute exactly one whitelisted in-game roleplay action on the FiveM server, or "none" if nothing fits.\n' +
      `Available actions:\n${lines}`,
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [...defs.map((d) => d.name), 'none'],
          description: 'The single action to perform, or "none" if no listed action clearly matches.',
        },
        params: {
          type: 'object',
          description: 'Parameters for the chosen action. Omit for actions that take none.',
          properties: paramProps,
          additionalProperties: false,
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
  };
}

async function interpretWithClaude(tenant, text) {
  const client = new Anthropic({ apiKey: tenant.apiKey, timeout: 20_000, maxRetries: 1 });
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    tools: [buildTool(tenant)],
    tool_choice: { type: 'tool', name: 'execute_action', disable_parallel_tool_use: true },
    messages: [{ role: 'user', content: text }],
  });

  const toolUse = response.content.find((b) => b.type === 'tool_use' && b.name === 'execute_action');
  if (!toolUse || !toolUse.input) return { action: 'none', params: {} };

  // Trust nothing: re-validate the tool output against the whitelist.
  try {
    const valid = actions.validateAction(toolUse.input.action, toolUse.input.params, tenant.allowedActions);
    return { action: valid.action, params: valid.params };
  } catch (err) {
    console.warn(`[claude] rejected model output "${toolUse.input.action}": ${err.message}`);
    return { action: 'none', params: {} };
  }
}

// ---------- deterministic fallback (no API key / API failure) ----------
// Shared with the platform (lib/stub-interpret.js) so there is exactly one
// keyword matcher in the repo.
const { stubInterpret } = require('../lib/stub-interpret');

// Main entry point. BYOK: the key comes from the tenant record (resolved from
// env by auth.js today, from a DB row per customer later - same code path).
async function interpret(tenant, text) {
  if (!tenant.apiKey) {
    return stubInterpret(text);
  }
  try {
    return await interpretWithClaude(tenant, text);
  } catch (err) {
    console.error(`[claude] API call failed (${err.message}) - falling back to stub interpreter`);
    return stubInterpret(text);
  }
}

module.exports = { interpret, stubInterpret, buildTool, MODEL };
