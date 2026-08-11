// lib/whitelist/config.js - the tenant's Whitelist Officer configuration:
// defaults, validation, and slug generation. Pure (no Firestore) so it's
// unit-testable and reusable by both the owner endpoints and the public flow.
const crypto = require('crypto');

const LANGS = ['en', 'ar'];
const MAX_QUESTIONS = 20;
const MAX_CRITERIA = 12;
const MAX_IDENTITY = 5;

// Sensible, shippable defaults (every string EN + AR).
const DEFAULTS = {
  enabled: false,
  languages: ['en', 'ar'],
  identityFields: [
    { key: 'discord', label: { en: 'Discord username', ar: 'اسم ديسكورد' }, required: true },
    { key: 'ingame', label: { en: 'In-game name', ar: 'الاسم داخل اللعبة' }, required: true },
  ],
  questions: [
    { text: { en: 'Have you roleplayed on a FiveM server before? Tell us about it.', ar: 'هل سبق ولعبت رول بلاي على سيرفر FiveM؟ احكِ لنا عنها.' } },
    { text: { en: 'What does "staying in character" mean to you, and why does it matter?', ar: 'شو يعني لك "الالتزام بالشخصية"، وليش هو مهم؟' } },
    { text: { en: 'A player kills you for no reason (VDM/RDM). What do you do?', ar: 'لاعب يقتلك بدون سبب (VDM/RDM). شو تسوي؟' } },
    { text: { en: 'Describe a character you would want to play. Give us some detail.', ar: 'صف شخصية تحب تلعبها. أعطنا بعض التفاصيل.' } },
  ],
  criteria: [
    { label: { en: 'Roleplay understanding', ar: 'فهم الرول بلاي' }, description: { en: 'Understands staying in character and immersive play.', ar: 'يفهم الالتزام بالشخصية والانغماس في اللعب.' } },
    { label: { en: 'Rule comprehension', ar: 'فهم القوانين' }, description: { en: 'Knows core rules (VDM/RDM, metagaming) and how to react.', ar: 'يعرف القوانين الأساسية (VDM/RDM، الميتاقيمنغ) وكيف يتصرف.' } },
    { label: { en: 'Effort & detail', ar: 'الجهد والتفصيل' }, description: { en: 'Answers are specific and thought-through, not one-liners.', ar: 'إجابات محددة ومدروسة، لا كلمة واحدة.' } },
    { label: { en: 'Communication clarity', ar: 'وضوح التواصل' }, description: { en: 'Expresses ideas clearly (in any language — proficiency is not scored).', ar: 'يعبّر بوضوح (بأي لغة — إتقان اللغة لا يُقيَّم).' } },
  ],
  thresholds: { autoApprove: null, autoReject: null }, // null = recommend only (human decides)
  ageRequired: false,
  minAge: 16,
  discordWebhook: '',
  decisionWebhook: '',
};

function slugify(name) {
  const base = String(name || 'server').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'server';
  return base;
}
function randomSuffix() { return crypto.randomBytes(2).toString('hex'); }

function bilingual(o) { return o && typeof o === 'object' && typeof o.en === 'string' && o.en.trim() && typeof o.ar === 'string' && o.ar.trim(); }

// Validate a PARTIAL patch (merged onto current config by the caller). Returns
// { ok, config } for the validated subset, or { ok:false, error }.
function validateConfig(patch) {
  const out = {};
  if (patch == null || typeof patch !== 'object') return { ok: false, error: 'config must be an object' };

  if ('enabled' in patch) out.enabled = Boolean(patch.enabled);
  if ('ageRequired' in patch) out.ageRequired = Boolean(patch.ageRequired);
  if ('minAge' in patch) {
    const n = Number(patch.minAge);
    if (!Number.isInteger(n) || n < 13 || n > 99) return { ok: false, error: 'minAge must be 13-99' };
    out.minAge = n;
  }

  if ('languages' in patch) {
    const langs = Array.isArray(patch.languages) ? patch.languages : [];
    if (!langs.length || !langs.every((l) => LANGS.includes(l))) return { ok: false, error: 'languages must be a non-empty subset of en/ar' };
    out.languages = [...new Set(langs)];
  }

  if ('questions' in patch) {
    const qs = patch.questions;
    if (!Array.isArray(qs) || qs.length < 1) return { ok: false, error: 'at least one question is required' };
    if (qs.length > MAX_QUESTIONS) return { ok: false, error: `at most ${MAX_QUESTIONS} questions` };
    if (!qs.every((q) => q && bilingual(q.text))) return { ok: false, error: 'every question needs EN and AR text' };
    out.questions = qs.slice(0, MAX_QUESTIONS).map((q, i) => ({
      id: q.id || 'q_' + crypto.randomBytes(4).toString('hex'),
      order: i,
      text: { en: String(q.text.en).slice(0, 400), ar: String(q.text.ar).slice(0, 400) },
    }));
  }

  if ('criteria' in patch) {
    const cs = patch.criteria;
    if (!Array.isArray(cs) || cs.length < 1) return { ok: false, error: 'at least one criterion is required' };
    if (cs.length > MAX_CRITERIA) return { ok: false, error: `at most ${MAX_CRITERIA} criteria` };
    if (!cs.every((c) => c && bilingual(c.label))) return { ok: false, error: 'every criterion needs EN and AR label' };
    out.criteria = cs.slice(0, MAX_CRITERIA).map((c) => ({
      id: c.id || 'c_' + crypto.randomBytes(4).toString('hex'),
      label: { en: String(c.label.en).slice(0, 120), ar: String(c.label.ar).slice(0, 120) },
      description: bilingual(c.description) ? { en: String(c.description.en).slice(0, 400), ar: String(c.description.ar).slice(0, 400) } : { en: '', ar: '' },
    }));
  }

  if ('identityFields' in patch) {
    const fs = patch.identityFields;
    if (!Array.isArray(fs) || fs.length < 1) return { ok: false, error: 'at least one identity field is required' };
    if (fs.length > MAX_IDENTITY) return { ok: false, error: `at most ${MAX_IDENTITY} identity fields` };
    if (!fs.every((f) => f && typeof f.key === 'string' && /^[a-z0-9_]{2,20}$/.test(f.key) && bilingual(f.label))) {
      return { ok: false, error: 'identity fields need a key (a-z0-9_) and EN/AR label' };
    }
    out.identityFields = fs.slice(0, MAX_IDENTITY).map((f) => ({
      key: f.key, required: f.required !== false,
      label: { en: String(f.label.en).slice(0, 60), ar: String(f.label.ar).slice(0, 60) },
    }));
  }

  if ('thresholds' in patch) {
    const th = patch.thresholds || {};
    const norm = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
    const ap = norm(th.autoApprove), rj = norm(th.autoReject);
    for (const [v, n] of [[ap, 'autoApprove'], [rj, 'autoReject']]) {
      if (v !== null && (!Number.isFinite(v) || v < 0 || v > 100)) return { ok: false, error: `${n} must be 0-100 or empty` };
    }
    if (ap !== null && rj !== null && ap <= rj) return { ok: false, error: 'autoApprove must be greater than autoReject' };
    out.thresholds = { autoApprove: ap, autoReject: rj };
  }

  if ('discordWebhook' in patch) out.discordWebhook = validWebhook(patch.discordWebhook);
  if ('decisionWebhook' in patch) out.decisionWebhook = validWebhook(patch.decisionWebhook);

  return { ok: true, config: out };
}

function validWebhook(url) {
  const s = String(url || '').trim();
  if (!s) return '';
  return /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(s) ? s.slice(0, 300) : '';
}

// Public projection: what an unauthenticated applicant may see. Nothing about
// the tenant beyond display name + questions + identity fields + languages.
function publicView(config, serverName) {
  return {
    serverName: serverName || 'Server',
    slug: config.slug,
    enabled: !!config.enabled,
    languages: config.languages || DEFAULTS.languages,
    identityFields: (config.identityFields || DEFAULTS.identityFields).map((f) => ({ key: f.key, label: f.label, required: f.required })),
    questionCount: (config.questions || DEFAULTS.questions).length,
    ageRequired: !!config.ageRequired,
    minAge: config.minAge || DEFAULTS.minAge,
  };
}

module.exports = { DEFAULTS, LANGS, validateConfig, slugify, randomSuffix, publicView };
