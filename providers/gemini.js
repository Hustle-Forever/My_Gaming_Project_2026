// providers/gemini.js - Gemini via @google/genai with FORCED function calling.
// The single declared function's `action` enum is built from actions.js
// (filtered by the tenant's allowedActions) + "none", so the model cannot
// name an action outside the whitelist - and the output is re-validated
// through actions.validateAction anyway. Same safety design as the original
// Claude forced-tool path.
const { GoogleGenAI, FunctionCallingConfigMode, Type } = require('@google/genai');
const actions = require('../backend/actions');

// gemini-3.6-flash is the current stable flash model (verified against
// ai.google.dev/gemini-api/docs/models). Override with GEMINI_MODEL.
const model = () => process.env.GEMINI_MODEL || 'gemini-3.6-flash';

const SYSTEM_PROMPT = [
  'أنت وحدة تحكم داخل سيرفر FiveM للرول بلاي. تقرأ طلب اللاعب (بالعربية أو الإنجليزية) وتختار إجراءً واحدًا فقط من قائمة الإجراءات المسموحة داخل اللعبة، مع استخراج المعاملات المطلوبة.',
  'You control a FiveM roleplay server. You can ONLY perform the in-game actions listed in the execute_action function - nothing else exists.',
  'Rules:',
  '- Pick exactly one action, or "none" if the request does not clearly match any listed action (general questions, chit-chat, or anything outside the list are always "none").',
  '- Never invent actions or parameters outside the schema.',
  '- Respond only by calling execute_action.',
].join('\n');

const ASK_PROMPT = [
  'You are Mirsal, the assistant of a FiveM roleplay server control panel.',
  'Answer the operator briefly (1-3 sentences), in the language they used (Arabic or English).',
  'You only answer questions here. In-game actions run in a separate Run mode restricted to a fixed whitelist: spawn a vehicle, change weather, set the clock, heal the player, spawn NPCs, repair the vehicle.',
  'Never claim to have performed an action, and never promise capabilities outside that list.',
].join('\n');

// actions.js param defs (JSON-schema style) -> Gemini schema
function toGeminiSchema(prop) {
  const out = { description: prop.description };
  out.type = prop.type === 'integer' ? Type.INTEGER : Type.STRING;
  if (prop.enum) out.enum = prop.enum;
  return out;
}

function buildFunctionDeclaration(allowedActions) {
  const defs = actions.listForClaude(allowedActions);
  const paramProps = {};
  for (const def of defs) {
    for (const [key, prop] of Object.entries(def.params)) paramProps[key] = toGeminiSchema(prop);
  }
  const lines = defs.map((d) => `- ${d.name}: ${d.description}`).join('\n');

  return {
    name: 'execute_action',
    description:
      'Execute exactly one whitelisted in-game roleplay action on the FiveM server, or "none" if nothing fits.\n' +
      `Available actions:\n${lines}`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          enum: [...defs.map((d) => d.name), 'none'],
          description: 'The single action to perform, or "none" if no listed action clearly matches.',
        },
        params: {
          type: Type.OBJECT,
          properties: paramProps,
          description: 'Parameters for the chosen action. Omit for actions that take none.',
        },
      },
      required: ['action'],
    },
  };
}

async function interpret(apiKey, text, allowedActions) {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: model(),
    contents: [{ role: 'user', parts: [{ text }] }],
    config: {
      systemInstruction: SYSTEM_PROMPT,
      tools: [{ functionDeclarations: [buildFunctionDeclaration(allowedActions)] }],
      toolConfig: {
        functionCallingConfig: {
          mode: FunctionCallingConfigMode.ANY,   // forced: the model MUST call the function
          allowedFunctionNames: ['execute_action'],
        },
      },
      temperature: 0,
    },
  });

  const call = (response.functionCalls || [])[0];
  if (!call || call.name !== 'execute_action' || !call.args) {
    return { action: 'none', params: {} };
  }

  // Trust nothing: re-validate against the whitelist + tenant allowlist.
  try {
    const valid = actions.validateAction(call.args.action, call.args.params || {}, allowedActions);
    return { action: valid.action, params: valid.params };
  } catch (err) {
    console.warn(`[gemini] rejected model output "${call.args.action}": ${err.message}`);
    return { action: 'none', params: {} };
  }
}

async function ask(apiKey, text) {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: model(),
    contents: [{ role: 'user', parts: [{ text }] }],
    config: { systemInstruction: ASK_PROMPT },
  });
  return (response.text || '').trim();
}

module.exports = { name: 'gemini', interpret, ask, buildFunctionDeclaration };
