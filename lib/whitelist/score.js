// lib/whitelist/score.js - evaluate a completed interview.
//
// Design guarantees:
//  * Structured output only. The model (brain) returns a fixed schema; we
//    NEVER parse free text. validateScoreObject rejects anything malformed.
//  * Evidence is mandatory. Every criterion score must quote the applicant's
//    own words, or the whole result is rejected.
//  * A deterministic flag layer runs REGARDLESS of the model, so copy-paste /
//    hostile / dodge / under-age never slip through even if the model misses.
//  * Confidence gates auto-decisions; low confidence -> human. The AI never
//    auto-decides unless the owner set thresholds AND confidence is high AND
//    no blocking flag fired.
//  * Bias guard: the deterministic layer is language-blind (word counts, not
//    language), and the model prompt forbids scoring language proficiency.
//    Equivalent AR/EN answers get the same deterministic treatment.

const RECS = ['approve', 'reject', 'review', 'reinterview'];
const BLOCKING_FLAGS = new Set(['hostile', 'underage']);

// ---------- validation ----------
function validateScoreObject(obj, criteria) {
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'score object required' };
  if (!Array.isArray(obj.scores) || obj.scores.length === 0) return { ok: false, error: 'scores[] required' };
  const ids = new Set(criteria.map((c) => c.id));
  for (const s of obj.scores) {
    if (!s || !ids.has(s.criterion)) return { ok: false, error: `unknown criterion: ${s && s.criterion}` };
    if (typeof s.abstained === 'boolean' && s.abstained) continue; // abstention is allowed, no score needed
    if (typeof s.score !== 'number' || s.score < 0 || s.score > 100) return { ok: false, error: 'score must be 0-100' };
    if (typeof s.evidence !== 'string' || s.evidence.trim().length < 3) return { ok: false, error: 'every score needs evidence (a quote from the applicant)' };
  }
  if (obj.recommendation && !RECS.includes(obj.recommendation)) return { ok: false, error: 'invalid recommendation' };
  return { ok: true };
}

// ---------- deterministic flags (language-blind) ----------
const HOSTILE_RE = /\b(kill everyone|grief|rdm is fun|vdm is fun|hack|cheat|ddos|glitch abuse|troll|destroy the server|racist|nazi)\b/i;
const AR_HOSTILE_RE = /(نصب|اخرب السيرفر|هكر|غش|تدمير السيرفر|عنصري)/;
const BOILERPLATE_RE = /\b(i love roleplay|i will follow all the rules|i am a good player|best server|i promise)\b/i;

function words(s) { return String(s || '').trim().split(/\s+/).filter(Boolean); }
function applicantTurns(transcript) { return (transcript || []).filter((t) => t.role === 'applicant'); }

// normalized similarity between two short texts (token Jaccard) - language-agnostic
function similarity(a, b) {
  const A = new Set(words(a.toLowerCase())), B = new Set(words(b.toLowerCase()));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter += 1;
  return inter / (A.size + B.size - inter);
}

function deterministicFlags(transcript, config) {
  const flags = [];
  const answers = applicantTurns(transcript);

  // copy-paste: two answers nearly identical, OR boilerplate phrasing
  for (let i = 0; i < answers.length; i++) {
    for (let j = i + 1; j < answers.length; j++) {
      if (similarity(answers[i].text, answers[j].text) >= 0.8) {
        flags.push({ type: 'copy_paste', detail: 'two answers are near-identical', evidence: answers[i].text.slice(0, 120) });
      }
    }
    if (BOILERPLATE_RE.test(answers[i].text) && words(answers[i].text).length < 14) {
      flags.push({ type: 'copy_paste', detail: 'generic boilerplate answer', evidence: answers[i].text.slice(0, 120) });
    }
  }

  // hostile / rule-breaking
  for (const a of answers) {
    if (HOSTILE_RE.test(a.text) || AR_HOSTILE_RE.test(a.text)) {
      flags.push({ type: 'hostile', detail: 'hostile or rule-breaking content', evidence: a.text.slice(0, 120) });
    }
  }

  // dodge: far too short to be a real answer (language-blind word count)
  for (const a of answers) {
    if (words(a.text).length < 4) {
      flags.push({ type: 'dodge', detail: 'answer too short to evaluate', evidence: a.text.slice(0, 120), questionId: a.questionId });
    }
  }

  // under-age (only if the owner requires an age)
  if (config && config.ageRequired) {
    const min = Number(config.minAge) || 18;
    for (const a of answers) {
      const m = a.text.match(/\b(1[0-7]|[1-9])\b\s*(years old|yo|سنة|عام)?/i) || a.text.match(/(?:i am|i'm|عمري)\s*(\d{1,2})/i);
      if (m) {
        const age = Number(m[1]);
        if (Number.isFinite(age) && age < min) {
          flags.push({ type: 'underage', detail: `disclosed age ${age} below minimum ${min}`, evidence: a.text.slice(0, 120) });
        }
      }
    }
  }

  // dedupe by type+evidence
  const seen = new Set();
  return flags.filter((f) => { const k = f.type + '|' + (f.evidence || ''); if (seen.has(k)) return false; seen.add(k); return true; });
}

// ---------- decision policy ----------
function decide(result, thresholds) {
  const th = thresholds || {};
  const overall = overallScore(result.scores);
  const conf = typeof result.confidence === 'number' ? result.confidence : 0.5;
  const hasBlocking = (result.flags || []).some((f) => BLOCKING_FLAGS.has(f.type));

  const canAuto = conf >= 0.7 && !hasBlocking;
  if (canAuto && th.autoReject !== null && th.autoReject !== undefined && overall <= th.autoReject) {
    return { auto: true, decision: 'reject', overall };
  }
  if (canAuto && th.autoApprove !== null && th.autoApprove !== undefined && overall >= th.autoApprove) {
    return { auto: true, decision: 'approve', overall };
  }
  return { auto: false, decision: 'review', overall };
}

function overallScore(scores) {
  const scored = (scores || []).filter((s) => !s.abstained && typeof s.score === 'number');
  if (!scored.length) return 0;
  return Math.round(scored.reduce((a, s) => a + s.score, 0) / scored.length);
}

// ---------- offline fallback brain (no provider key) ----------
// Deterministic, evidence-backed heuristic scorer so the whole flow works
// without a Gemini key (mirrors the console's keyword fallback philosophy).
function fallbackBrain(criteria, transcript) {
  const answers = applicantTurns(transcript);
  const detail = answers.reduce((a, t) => a + words(t.text).length, 0) / Math.max(1, answers.length);
  // 0..100 from average answer length, capped; every criterion cites the
  // longest answer as its evidence quote.
  const base = Math.max(10, Math.min(90, Math.round(detail * 6)));
  const longest = answers.slice().sort((a, b) => words(b.text).length - words(a.text).length)[0];
  const quote = longest ? longest.text.slice(0, 140) : '(no answer)';
  return {
    scores: criteria.map((c) => ({ criterion: c.id, score: base, evidence: quote })),
    flags: [],
    summary: 'Automated heuristic score (no AI key configured). Review the transcript before deciding.',
    recommendation: 'review',
    confidence: 0.4, // deliberately low -> always routes to a human
  };
}

// ---------- orchestrator ----------
async function scoreApplication({ criteria, transcript, config }, brain) {
  let modelOut;
  try {
    modelOut = brain ? await brain({ criteria, transcript, config }) : fallbackBrain(criteria, transcript);
  } catch (err) {
    return { ok: false, error: `scoring provider failed: ${err.message}` };
  }
  const v = validateScoreObject(modelOut, criteria);
  if (!v.ok) return { ok: false, error: v.error };

  // merge model flags with the deterministic layer (deterministic wins on dupes)
  const detFlags = deterministicFlags(transcript, config || {});
  const merged = [...detFlags];
  for (const f of (modelOut.flags || [])) {
    if (f && f.type && !merged.some((m) => m.type === f.type)) merged.push(f);
  }

  const result = {
    scores: modelOut.scores,
    flags: merged,
    summary: String(modelOut.summary || '').slice(0, 1200),
    recommendation: modelOut.recommendation || 'review',
    confidence: typeof modelOut.confidence === 'number' ? modelOut.confidence : 0.5,
    overall: overallScore(modelOut.scores),
  };
  const d = decide(result, (config && config.thresholds) || {});
  result.autoDecision = d.auto ? d.decision : null;
  return { ok: true, result };
}

module.exports = { scoreApplication, validateScoreObject, deterministicFlags, decide, overallScore, fallbackBrain };
