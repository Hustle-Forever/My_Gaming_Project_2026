# Whitelist Officer

**Area:** AI-interviewed whitelist applications — the form replaced by a conversation · **Last updated:** 2026-08-12

> Applicants used to write an essay, submit a form, and wait 24–72h. The Whitelist Officer interviews them (EN/AR), follows up on vague answers, scores them against the owner's criteria with **quoted evidence**, flags copy-paste / AI-written / contradictory / hostile answers, and hands the admin one-click **approve / reject / re-interview** with a written justification. **No server file access** — additive to the platform, demoable today. The human always decides by default.

---

## Two experiences

**Applicant** — public page `/apply/{slug}`, no account. Welcome (server name, ~time, EN/AR) → identity capture (owner-configured fields) → conversational interview (one question at a time, ≤2 follow-ups on vague answers, progress, **voice input**, typing always available) → submitted. `app/apply.html`, full design system.

**Owner** — the **Whitelist Officer** card in `app/dashboard.html`: **Queue** (ranked by score) · **Detail** (transcript + per-criterion scoring with quoted evidence + flags + recommendation; Approve/Reject/Re-interview + note + Delete) · **Setup** (enable, shareable link, editable criteria/questions, Discord webhook + test) · **Stats** (received, backlog, approval rate, avg time-to-decision — the sales pitch).

## Engines (pure, provider-injected, offline-capable)

- `lib/whitelist/interview.js` — the state machine: ask → injected `judge` (sufficient? follow-up?) → follow-up (≤2) → next → done. Per-answer char cap + absolute turn ceiling. `serialize()/restore` powers resume-after-drop. The judge is provider-backed with an offline heuristic fallback (`lib/whitelist/brain.js`).
- `lib/whitelist/score.js` — **evidence-mandatory** structured scoring. `validateScoreObject` rejects any evidence-free or out-of-range score. `deterministicFlags` (language-blind) always runs: copy-paste (token-Jaccard near-duplicate + boilerplate), hostile (EN+AR), dodge (word-count), under-age (only if the owner requires an age). `decide()` keeps the human in charge — auto-approve/reject **only** when the owner set thresholds **and** confidence ≥ 0.7 **and** no blocking flag (hostile/underage). Offline fallback still quotes evidence and stays low-confidence (always → human). **Bias guard:** the deterministic layer is language-blind and the model prompt forbids scoring language proficiency; a test asserts equivalent AR/EN answers are treated identically.
- Provider path: `providers/gemini.js` `whitelistJudge` / `whitelistScore` — forced function calling (fixed schema, never free-text), with the bias instruction in the system prompt.

## API

**Public (unauthenticated, hard-limited, exposes only name+questions):**
- `GET /api/apply/config?slug=` → public view (unknown/disabled → 404, indistinguishable).
- `POST /api/apply/start` `{slug, language, identity}` → `{appId, resumeToken, step}`. Per-IP throttle (`APPLY_RATE_LIMIT_PER_HOUR`, default 10, hashed IPs), one active application per identity (rotates the resume token on re-start).
- `POST /api/apply/answer` `{appId, resumeToken, text}` → next step.
- `POST /api/apply/submit` `{appId, resumeToken}` → scores, stores, auto-decides only on owner thresholds, fires Discord.
- `GET /api/apply/resume?appId=&resumeToken=` → current step (dropped-session recovery).

`appId → uid` is resolved via a private `applicationIndex` so the tenant uid never reaches the applicant; resume tokens are stored hashed.

**Owner (verified auth + pay-gate + envelope):**
- `GET/POST /api/whitelist/config` — read/update config (validated; stable slug).
- `GET /api/whitelist/applications` — queue, or `?appId=` for full detail.
- `POST /api/whitelist/decide` — `{appId, decision(approve|reject|reinterview|delete), note?}`; records `decidedBy`/`decidedAtMs`; approve returns the identifier list.
- `GET /api/whitelist/stats` — the numbers.
- `POST /api/whitelist/test-webhook` — verify a Discord webhook.

## Data & privacy

`tenants/{uid}/whitelist/config` and `tenants/{uid}/applications/{appId}` (identity, language, status, transcript, scores, flags, summary, recommendation, decidedBy/At). Slug uniqueness via `whitelistSlugs/{slug}→uid`; `applicationIndex/{appId}→uid` for public resolution; `rl_apply/{ipHash}` throttle. **Applicant data is personal data:** only owner-configured identity fields are stored, full transcripts are never written to application logs, and **delete-application** is a first-class owner action. Firestore rules stay deny-all — everything flows through the API.

## Discord (distribution)

`lib/notify/discord.js` — webhook only, no bot. New submission → compact card; decision → outcome post; dashboard **test-send** button. Optional, safe unconfigured (no-op), never throws into a request. Behind a clean interface so other channels can be added.

## Tests

`tests/whitelist-{config,interview,score,apply,apply-ui,review,ui,notify}.test.js` — 53 tests: config validation + slugs, the interview state machine, evidence-mandatory scoring + flags + **bias guard**, the full public flow (EN/AR e2e, resume, one-per-identity, rate limit, privacy), the owner review flow (queue/detail/decide/delete/stats/cross-tenant), and jsdom renders of both `apply.html` and the dashboard section. See [TESTING.md](TESTING.md).

## Not verified here / left for the human

Live Gemini judging/scoring (the offline fallback is what tests exercise — set a real key to use the AI path). A browser screenshot of the dashboard section (the `chrome-devtools` daemon is broken in this environment; jsdom render tests stand in). Real Discord delivery (test-send hits the network; unit tests cover the interface only).
