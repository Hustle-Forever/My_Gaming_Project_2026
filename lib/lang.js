// lib/lang.js - the single place that decides what language a message is in.
// Kept deliberately small so it can grow (a real language-ID library, more
// scripts) without touching callers. Today: Arabic script vs Latin, by letter
// share. A dominant script wins; a genuinely mixed or letter-less message
// falls back to the caller's default (the tenant's default language).
//
// The reply language must follow what the user actually wrote, per message —
// NOT any UI toggle. Callers pass the tenant default as the fallback only.

const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g;
const LATIN = /[A-Za-z]/g;

const DOMINANCE = 0.6; // one script must own ≥60% of the letters to win

function count(text, re) {
  const m = String(text || '').match(re);
  return m ? m.length : 0;
}

// Returns 'ar' or 'en'. `fallback` is used for mixed/ambiguous/letter-less input.
function detectLanguage(text, fallback = 'en') {
  const ar = count(text, ARABIC);
  const en = count(text, LATIN);
  const total = ar + en;
  if (total === 0) return fallback;
  if (ar > en && ar / total >= DOMINANCE) return 'ar';
  if (en > ar && en / total >= DOMINANCE) return 'en';
  return fallback;
}

module.exports = { detectLanguage };
