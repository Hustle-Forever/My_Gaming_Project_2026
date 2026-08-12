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

// The Ask-mode persona lives in lib/ask-persona.js so the deterministic
// fallback (no AI key) can reuse the exact same product knowledge.
const { askSystemPrompt } = require('../lib/ask-persona');
function askPrompt(ctx = {}) { return askSystemPrompt(ctx); }

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

// ctx: { language, allowedActions, server } — language is the language the
// operator wrote in (reply MUST match it); allowedActions/server let the
// assistant be concrete about THIS server. All optional.
async function ask(apiKey, text, ctx = {}) {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: model(),
    contents: [{ role: 'user', parts: [{ text }] }],
    config: { systemInstruction: askPrompt(ctx) },
  });
  return (response.text || '').trim();
}

// ---- Whitelist Officer (forced structured output) ----
const WL_BIAS = 'Score ONLY what each criterion describes. IGNORE nationality, ethnicity, gender, accent, and language proficiency — a short answer in a second language is NOT a worse answer. Never invent an evidence quote; if you cannot judge a criterion, set abstained:true instead of guessing.';

// Judge answer sufficiency during the interview.
async function whitelistJudge(apiKey, { question, answer, language }) {
  const ai = new GoogleGenAI({ apiKey });
  const decl = {
    name: 'judge_answer',
    description: 'Decide whether the applicant answer is sufficient or needs one follow-up.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        sufficient: { type: Type.BOOLEAN, description: 'true if the answer meaningfully addresses the question' },
        followUpEn: { type: Type.STRING, description: 'a short follow-up question in English (only if not sufficient)' },
        followUpAr: { type: Type.STRING, description: 'the same follow-up in Arabic' },
      },
      required: ['sufficient'],
    },
  };
  const res = await ai.models.generateContent({
    model: model(),
    contents: [{ role: 'user', parts: [{ text: `Question: ${question.text[language] || question.text.en}\nApplicant answer: ${answer}` }] }],
    config: {
      systemInstruction: 'You are interviewing an applicant for a FiveM roleplay server. Judge if their answer is specific enough or dodges/is too vague. Reply only via judge_answer. ' + WL_BIAS,
      tools: [{ functionDeclarations: [decl] }],
      toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: ['judge_answer'] } },
      temperature: 0,
    },
  });
  const call = (res.functionCalls || [])[0];
  const a = (call && call.args) || {};
  return { sufficient: !!a.sufficient, followUp: { en: a.followUpEn || 'Could you add more detail?', ar: a.followUpAr || 'ممكن تفاصيل أكثر؟' } };
}

// Score the completed interview against the owner criteria.
async function whitelistScore(apiKey, { criteria, transcript, config }) {
  const ai = new GoogleGenAI({ apiKey });
  const critList = criteria.map((c) => `- ${c.id}: ${c.label.en}${c.description && c.description.en ? ' — ' + c.description.en : ''}`).join('\n');
  const convo = transcript.map((tn) => `${tn.role === 'officer' ? 'Q' : 'A'}: ${tn.text}`).join('\n');
  const decl = {
    name: 'submit_score',
    description: 'Return the structured evaluation of the applicant.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        scores: {
          type: Type.ARRAY,
          description: 'one entry per criterion id',
          items: {
            type: Type.OBJECT,
            properties: {
              criterion: { type: Type.STRING },
              score: { type: Type.INTEGER, description: '0-100' },
              evidence: { type: Type.STRING, description: "a direct quote from the applicant's own words" },
              abstained: { type: Type.BOOLEAN, description: 'true if unable to judge (then omit score)' },
            },
            required: ['criterion'],
          },
        },
        flags: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { type: { type: Type.STRING }, detail: { type: Type.STRING } }, required: ['type'] } },
        summary: { type: Type.STRING },
        recommendation: { type: Type.STRING, enum: ['approve', 'reject', 'review', 'reinterview'] },
        confidence: { type: Type.NUMBER, description: '0-1 overall confidence' },
      },
      required: ['scores', 'summary', 'recommendation', 'confidence'],
    },
  };
  const res = await ai.models.generateContent({
    model: model(),
    contents: [{ role: 'user', parts: [{ text: `Criteria:\n${critList}\n\nInterview transcript:\n${convo}` }] }],
    config: {
      systemInstruction: `You evaluate FiveM roleplay whitelist applicants. For EACH criterion give a 0-100 score and a direct evidence quote from the applicant. Flag copy_paste, likely_ai, contradiction, hostile, dodge, or underage where present. ${WL_BIAS} Reply only via submit_score.`,
      tools: [{ functionDeclarations: [decl] }],
      toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: ['submit_score'] } },
      temperature: 0,
    },
  });
  const call = (res.functionCalls || [])[0];
  if (!call || !call.args) throw new Error('no structured score returned');
  return call.args;
}

// ---- Concierge: short in-game onboarding reply, closed action set ----
async function conciergeReply(apiKey, { system, phase, language, playerMessage, hints }) {
  const ai = new GoogleGenAI({ apiKey });
  const decl = {
    name: 'concierge_reply',
    description: 'Produce the Concierge actions for this onboarding step. ONLY send_message, set_waypoint, show_menu are allowed.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        actions: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              type: { type: Type.STRING, enum: ['send_message', 'set_waypoint', 'show_menu'] },
              text: { type: Type.STRING, description: 'for send_message: ONE short line' },
              label: { type: Type.STRING },
              items: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { id: { type: Type.STRING }, label: { type: Type.STRING } }, required: ['id', 'label'] } },
            },
            required: ['type'],
          },
        },
      },
      required: ['actions'],
    },
  };
  const ctx = `Phase: ${phase}. Player language: ${language}. Player said: ${playerMessage || '(nothing yet)'}.\nAvailable jobs on this server: ${(hints && hints.jobs || []).join(', ') || 'unknown'}.` +
    (hints && hints.destination ? `\nSuggested destination: ${hints.destination.location} — ${hints.destination.line}` : '');
  const res = await ai.models.generateContent({
    model: model(),
    contents: [{ role: 'user', parts: [{ text: ctx }] }],
    config: {
      systemInstruction: system,
      tools: [{ functionDeclarations: [decl] }],
      toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: ['concierge_reply'] } },
      temperature: 0.4,
      maxOutputTokens: 300,
    },
  });
  const call = (res.functionCalls || [])[0];
  return (call && call.args) || { actions: [] };
}

module.exports = { name: 'gemini', interpret, ask, buildFunctionDeclaration, whitelistJudge, whitelistScore, conciergeReply };
