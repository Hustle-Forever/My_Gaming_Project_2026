# TASK_M2_WHITELIST.md — The Whitelist Officer

> Unattended build. Six milestones in order, TDD, on the existing M2 platform.

## 1. Why
Joining a roleplay server means a form + 24–72h wait; applicants quit, admins drown in a backlog. The Whitelist Officer replaces the form with an AI interview (EN/AR) that asks the owner's questions, follows up on vague answers, scores against owner criteria with quoted evidence, flags copy-paste / AI-written / contradictory / hostile answers, and hands the admin one-click approve/reject/re-interview with a written justification. Needs **no server file access** — unblocked, additive, demoable. Build on Firebase + Vercel + tenant model + provider layer + pay-gate.

## 2. Experiences
**A) Applicant** — public page `/apply/{slug}`, no account: welcome (server name, time, EN/AR) → identity capture (owner-configured fields) → conversational interview (one question at a time, ≤2 follow-ups on vague/short/dodging answers, progress, voice input, typing always available) → submitted confirmation. Anti-abuse: per-IP rate limit, one active application per identity, resume token, answer-length + session-time caps.
**B) Owner** — dashboard Whitelist section: setup (enable, edit question set with defaults, plain-language criteria, auto-approve/reject thresholds, languages, shareable link), queue (ranked by score), detail (transcript + per-criterion scoring with quoted evidence + flags + recommendation; Approve/Reject/Re-interview + note), decision output (identifier list, decidedBy/At), stats (received, avg time-to-decision, approval rate, backlog).

## 3. Scoring
Forced structured output `{scores:[{criterion,score,evidence}],flags:[],summary,recommendation}`. Evidence mandatory (quote applicant words; evidence-free score invalid). Owner-defined criteria with sensible defaults. Flags: copy-paste/boilerplate, likely-AI, contradiction, hostile/rule-breaking, dodging, under-age (if age required). Confidence + abstention → low confidence to human, never auto. AI never auto-decides unless owner enabled thresholds (default recommend). Bias guard: score only the criteria; ignore nationality/ethnicity/gender/accent/language proficiency — a short second-language answer is not a bad answer. Test: equivalent AR and EN answers score comparably.

## 4. Data
`tenants/{uid}/whitelist/config` (enabled, slug, questions[], criteria[], thresholds, languages[], identityFields[], updatedAt). `tenants/{uid}/applications/{appId}` (identity{}, language, status in_progress|submitted|approved|rejected|reinterview, transcript[], scores[], flags[], summary, recommendation, decidedBy, decidedAt, createdAt). Public endpoints unauthenticated but hard rate-limited, payload-capped, slug-validated, expose nothing beyond server display name + questions. Owner endpoints keep auth+gate+envelope. Applicant data is personal: store only configured fields, never log full transcripts, add delete-application. Firestore rules stay deny-all.

## 5. Discord
Webhook-based (no bot): owner pastes webhook URL; new submission → compact card (applicant, score, summary, review link); decision → outcome post; test-send button. Optional, behind `lib/notify/discord.js`.

## 6. Milestones
1. Config+data: schema, defaults, owner read/update endpoints, slug gen+uniqueness. ✅ round-trip; slug collisions; validation rejects bad sets.
2. Interview engine `lib/whitelist/interview.js`: ask→sufficiency→follow-up≤2→next, provider-backed, EN/AR, caps. ✅ vague→follow-up; good→none; capped; session limits.
3. Scoring `lib/whitelist/score.js`: forced schema, evidence validation, flags, confidence/abstention. ✅ evidence-free rejected; copy-paste + contradiction fixtures flag; bias test; hostile flagged.
4. Public flow `app/apply.html` + endpoints, rate limits, resume token, voice. ✅ EN+AR E2E, resume, rate limit.
5. Owner UI: Whitelist dashboard section. ✅ configure→apply→review→approve→stats.
6. Discord + docs: WHITELIST.md + sync ENGINEERING/API/DATABASE/SECURITY/FRONTEND/UIUX/TESTING; DAILY_PROGRESS; showcase. ✅ npm test green (keep 88) + smoke.

## 7. Rules
Human decides by default; evidence per score; EN/AR everywhere; applicant data = personal; hard rate-limit public endpoints; reuse provider/design/auth/gate/envelope; commit in chunks. DON'T auto-decide without owner thresholds; don't over-store/log applicant data; webhooks not a bot; don't weaken Firestore rules; don't touch scanner read-only guarantees; don't push.
