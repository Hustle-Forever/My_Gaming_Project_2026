// lib/concierge/config.js - the tenant's Concierge onboarding configuration:
// bilingual defaults, validation, and the public projection the bridge needs.
// Pure (no Firestore), so it's unit-testable and shared by the owner endpoints
// and the runtime.
const crypto = require('crypto');

const LANGS = ['en', 'ar'];
const TONES = ['serious', 'casual', 'neutral'];
const MAX_RECS = 12;

const DEFAULTS = {
  enabled: false,
  tone: 'neutral',
  languages: ['en', 'ar'],
  greeting: {
    en: 'Welcome to the city! I can help you find your feet — want a hand getting started?',
    ar: 'أهلًا بك في المدينة! أقدر أساعدك تبدأ — تبي مساعدة؟',
  },
  askPrompt: {
    en: 'What kind of character do you want to be?',
    ar: 'أي نوع شخصية تبي تكون؟',
  },
  checkinSeconds: 300,     // ~5 minutes
  retentionDays: 30,       // player-data window (configurable)
  features: { greet: true, ask: true, guide: true, checkin: true, introduce: true },
  // recommendations pre-fill from the latest scan; editable here
  recommendJobs: [
    { id: 'police', label: { en: 'Law enforcement', ar: 'شرطة' } },
    { id: 'ems', label: { en: 'Paramedic / EMS', ar: 'إسعاف' } },
    { id: 'mechanic', label: { en: 'Mechanic', ar: 'ميكانيكي' } },
    { id: 'civilian', label: { en: 'Civilian / freelance', ar: 'مدني / حر' } },
  ],
  recommendLocations: [],
};

function bilingual(o) { return o && typeof o === 'object' && typeof o.en === 'string' && o.en.trim() && typeof o.ar === 'string' && o.ar.trim(); }

function validateConfig(patch) {
  const out = {};
  if (patch == null || typeof patch !== 'object') return { ok: false, error: 'config must be an object' };

  if ('enabled' in patch) out.enabled = Boolean(patch.enabled);

  if ('tone' in patch) {
    if (!TONES.includes(patch.tone)) return { ok: false, error: `tone must be one of ${TONES.join(', ')}` };
    out.tone = patch.tone;
  }

  if ('languages' in patch) {
    const l = Array.isArray(patch.languages) ? patch.languages : [];
    if (!l.length || !l.every((x) => LANGS.includes(x))) return { ok: false, error: 'languages must be a non-empty subset of en/ar' };
    out.languages = [...new Set(l)];
  }

  for (const key of ['greeting', 'askPrompt']) {
    if (key in patch) {
      if (!bilingual(patch[key])) return { ok: false, error: `${key} needs EN and AR text` };
      out[key] = { en: String(patch[key].en).slice(0, 300), ar: String(patch[key].ar).slice(0, 300) };
    }
  }

  if ('checkinSeconds' in patch) {
    const n = Number(patch.checkinSeconds);
    if (!Number.isFinite(n) || n < 60 || n > 1800) return { ok: false, error: 'checkinSeconds must be 60-1800' };
    out.checkinSeconds = Math.round(n);
  }

  if ('retentionDays' in patch) {
    const n = Number(patch.retentionDays);
    if (!Number.isInteger(n) || n < 1 || n > 365) return { ok: false, error: 'retentionDays must be 1-365' };
    out.retentionDays = n;
  }

  if ('features' in patch) {
    const f = patch.features || {};
    out.features = {};
    for (const k of ['greet', 'ask', 'guide', 'checkin', 'introduce']) out.features[k] = f[k] !== false;
  }

  for (const key of ['recommendJobs', 'recommendLocations']) {
    if (key in patch) {
      const arr = patch[key];
      if (!Array.isArray(arr)) return { ok: false, error: `${key} must be an array` };
      if (arr.length > MAX_RECS) return { ok: false, error: `at most ${MAX_RECS} ${key}` };
      if (!arr.every((r) => r && bilingual(r.label))) return { ok: false, error: `every ${key} entry needs an EN/AR label` };
      out[key] = arr.slice(0, MAX_RECS).map((r) => ({
        id: r.id || (key === 'recommendJobs' ? 'job_' : 'loc_') + crypto.randomBytes(3).toString('hex'),
        label: { en: String(r.label.en).slice(0, 80), ar: String(r.label.ar).slice(0, 80) },
      }));
    }
  }

  return { ok: true, config: out };
}

// What the bridge runtime needs (no owner-only internals leaked into the game).
function runtimeView(config) {
  return {
    enabled: !!config.enabled,
    tone: config.tone || 'neutral',
    languages: config.languages || DEFAULTS.languages,
    greeting: config.greeting || DEFAULTS.greeting,
    askPrompt: config.askPrompt || DEFAULTS.askPrompt,
    checkinSeconds: config.checkinSeconds || DEFAULTS.checkinSeconds,
    features: { ...DEFAULTS.features, ...(config.features || {}) },
    recommendJobs: config.recommendJobs || DEFAULTS.recommendJobs,
    recommendLocations: config.recommendLocations || DEFAULTS.recommendLocations,
  };
}

module.exports = { DEFAULTS, LANGS, TONES, validateConfig, runtimeView };
