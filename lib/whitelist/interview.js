// lib/whitelist/interview.js - the conversational interview state machine.
// Pure and deterministic: sufficiency is decided by an injected async `judge`
// ({question, answer, language, followUpCount}) -> { sufficient, followUp? }.
// In production the judge is provider-backed (providers layer); tests inject a
// deterministic one. The engine owns the flow, the caps, and the transcript -
// never the model, so it's fully testable offline.
const MAX_FOLLOWUPS = 2;
const LIMITS = {
  maxAnswerChars: 2000,     // hard cap per applicant answer
  maxTurns: 60,             // absolute ceiling on transcript turns (safety)
  maxFollowupsPerQuestion: MAX_FOLLOWUPS,
};

function createInterview(config, opts = {}) {
  const questions = [...(config.questions || [])].sort((a, b) => a.order - b.order);
  const language = (opts.restore && opts.restore.language) || opts.language || (config.languages || ['en'])[0];

  // state
  let qIndex = 0;         // which question we're on
  let followups = 0;      // follow-ups used on the current question
  let phase = 'question'; // 'question' | 'followup' | 'done'
  let transcript = [];    // [{role:'officer'|'applicant', questionId, kind, text}]

  if (opts.restore) {
    const r = opts.restore;
    qIndex = r.qIndex || 0;
    followups = r.followups || 0;
    phase = r.phase || 'question';
    transcript = Array.isArray(r.transcript) ? r.transcript.slice() : [];
  }

  function q() { return questions[qIndex]; }

  function prompt(kind, followUp) {
    if (kind === 'done') return language === 'ar' ? 'شكرًا، انتهت المقابلة.' : 'Thanks — the interview is complete.';
    if (kind === 'followup' && followUp) return followUp[language] || followUp.en;
    return q().text[language] || q().text.en;
  }

  function current() {
    if (phase === 'done' || qIndex >= questions.length) {
      return { kind: 'done', prompt: prompt('done'), progress: { index: questions.length, total: questions.length } };
    }
    return {
      kind: phase === 'followup' ? 'followup' : 'question',
      questionId: q().id,
      prompt: lastOfficerPrompt || prompt(phase === 'followup' ? 'followup' : 'question', lastFollowUp),
      progress: { index: qIndex + 1, total: questions.length },
    };
  }

  // track the exact officer prompt currently on screen (so follow-up text is stable)
  let lastOfficerPrompt = phase === 'done' ? null : prompt('question');
  let lastFollowUp = null;
  // seed the opening officer turn if starting fresh
  if (!opts.restore && questions.length) {
    transcript.push({ role: 'officer', questionId: q().id, kind: 'question', text: lastOfficerPrompt });
  } else if (opts.restore) {
    const lastOfficer = [...transcript].reverse().find((t) => t.role === 'officer');
    lastOfficerPrompt = lastOfficer ? lastOfficer.text : prompt(phase === 'followup' ? 'followup' : 'question');
  }

  async function answer(rawText, judge) {
    if (phase === 'done') return current();
    const text = String(rawText || '').slice(0, LIMITS.maxAnswerChars);
    transcript.push({ role: 'applicant', questionId: q().id, kind: phase, text });

    // safety ceiling
    if (transcript.length >= LIMITS.maxTurns) return finish();

    let verdict = { sufficient: true };
    try {
      verdict = (await judge({ question: q(), answer: text, language, followUpCount: followups })) || { sufficient: true };
    } catch (_) { verdict = { sufficient: true }; } // judge failure => don't trap the applicant

    if (!verdict.sufficient && followups < MAX_FOLLOWUPS) {
      followups += 1;
      phase = 'followup';
      lastFollowUp = verdict.followUp || defaultFollowUp();
      lastOfficerPrompt = prompt('followup', lastFollowUp);
      transcript.push({ role: 'officer', questionId: q().id, kind: 'followup', text: lastOfficerPrompt });
      return { kind: 'followup', questionId: q().id, prompt: lastOfficerPrompt, progress: { index: qIndex + 1, total: questions.length } };
    }

    // advance to next question (or finish)
    return advance();
  }

  function advance() {
    qIndex += 1;
    followups = 0;
    if (qIndex >= questions.length) return finish();
    phase = 'question';
    lastFollowUp = null;
    lastOfficerPrompt = prompt('question');
    transcript.push({ role: 'officer', questionId: q().id, kind: 'question', text: lastOfficerPrompt });
    return { kind: 'question', questionId: q().id, prompt: lastOfficerPrompt, progress: { index: qIndex + 1, total: questions.length } };
  }

  function finish() {
    phase = 'done';
    return { kind: 'done', prompt: prompt('done'), progress: { index: questions.length, total: questions.length } };
  }

  function defaultFollowUp() {
    return language === 'ar'
      ? { en: 'Could you add more detail?', ar: 'ممكن تعطينا تفاصيل أكثر؟' }
      : { en: 'Could you add more detail?', ar: 'ممكن تعطينا تفاصيل أكثر؟' };
  }

  function serialize() {
    return { language, qIndex, followups, phase, transcript: transcript.slice() };
  }

  return {
    current,
    answer,
    transcript: () => transcript.slice(),
    serialize,
    isDone: () => phase === 'done',
    language: () => language,
  };
}

module.exports = { createInterview, MAX_FOLLOWUPS, LIMITS };
