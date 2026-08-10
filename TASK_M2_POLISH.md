# TASK_M2_POLISH.md — Unify, harden, and prove the M2 platform

> **How to run:** In Claude Code:
> *"Read TASK_M2_POLISH.md and complete all six milestones in order. Verify each ✅ before moving on. Update the relevant `docs/*.md` and append a dated `DAILY_PROGRESS.md` entry as you go (standing rule). Give me a full report at the end."*
>
> This is unattended work — the human is away. Do not wait for input. Where a decision is needed, choose the option that best serves the stated goal, do it, and note the choice in the final report.

---

## Context

M2 is a multi-tenant SaaS that lets FiveM server owners control their server in plain language (Arabic/English), by voice or text. The platform (Firebase + Vercel + Gemini, auth, pay-gate, encrypted per-tenant keys, Firestore command queue, Lua bridge) is built and emulator-green. A new marketing site + console (`app/index.html`) has just landed.

**What this task does:** make everything one coherent, production-ready product — consistent design, real error handling, no dead ends — and prove it with tests. **Do not** build the AI installer ("Build mode"); that's a later phase. **Do not** build Stripe; leave the existing seam.

**Design system (match exactly — it's already in `app/index.html`):** dark + light themes via CSS variables; lime `#C4F042` primary, violet `#A98BFB`, pink `#F3A5C6`; Space Grotesk for display, system sans for body; the iridescent orb as the signature element; EN/AR with full RTL; mobile-first with safe-area insets and 16px inputs.

---

## Milestone 1 — Rebuild the owner dashboard in the new design

`app/dashboard.html` currently uses the older look. Rebuild it to match `app/index.html` exactly (same variables, orb, themes, EN/AR, mobile-first), keeping all existing functionality and endpoints.

It must include:
- **Header** with M2 mark, tenant name, plan status pill, theme toggle, language toggle, sign out.
- **Setup checklist** — a visible progress list showing the customer exactly where they are: (1) account created ✓, (2) AI key added, (3) server connected, (4) first command run. Each item shows done/pending state and links to the relevant card. This is the single biggest UX win — make it the top of the page.
- **AI provider card** — provider selector (Gemini active; Claude shown as "Soon"), key input (password type, save via `/api/tenant/key`), and a clear "key saved · encrypted" state that never displays the key back.
- **Server connection card** — bridge token (masked with reveal + copy), copy-paste `server.cfg` lines with a one-click copy button, rotate-token action with a confirm step, and plain-language install instructions.
- **Plan card** — current status, what's included, and (since Stripe isn't wired) a clear "contact to activate" state when inactive.
- **Link to the console** and to `/docs/`.

✅ **Done when:** the dashboard is visually indistinguishable in style from the site/console, works on a 380px-wide viewport, and every existing endpoint still functions.

---

## Milestone 2 — Wire the frontend for production, end to end

- Set `LOCAL_PREVIEW = false` in `app/index.html`. Keep the constant and its comment so UI-only work is still possible, but the default path must be the real backend.
- Replace the placeholder auth calls with the **real Firebase Auth web SDK** flow (shared `app/firebase-config.js`), for both **sign up** and **sign in** on the site's auth screen. Signup must create the tenant via `/api/signup`; sign-in must obtain an ID token and use it as `Authorization: Bearer` on all API calls.
- **Persist the session** across refreshes (Firebase Auth persistence). A signed-in user who reloads should land in the console, not the marketing site. A signed-out visitor lands on the site.
- **Session expiry:** on a 401, refresh the ID token once and retry; if it still fails, return the user to the auth screen with a clear message.
- On console load, call `/api/tenant/me` and reflect real state: tenant name in the header, and the plan pill (`Connected` / `Plan inactive`).
- **Route by path** so links work: `/` → site (or console if signed in), `/dashboard` → dashboard, `/docs/` → the showcase. Update `vercel.json` if needed.
- If a signed-in tenant has **no AI key or no server connected yet**, the console should show a friendly inline prompt linking to the dashboard instead of failing silently.

✅ **Done when:** signup → dashboard setup → console → command works as one continuous flow against the emulators, and a page refresh keeps you signed in.

---

## Milestone 3 — Real error handling and empty states

Audit every failure path and make sure none of them dead-ends. At minimum:
- Network down / backend unreachable → clear message, retry affordance.
- 401 → token refresh, then sign-out with explanation.
- 402 (inactive plan) → explain and link to the plan card. Never just fail.
- No AI key configured → explain and link to the dashboard.
- Gemini quota/rate-limit or provider error → friendly message; log the real error server-side, never expose provider internals or key material to the client.
- Bridge not connected / never polled → the dashboard should show "server not connected yet" rather than implying success. Add a `lastPolledAt` timestamp on the tenant, updated on each poll, and surface it as a live/last-seen indicator.
- Mic unsupported, permission denied, or no speech detected → distinct, translated messages.
- Every user-facing string in **both EN and AR**.

✅ **Done when:** each failure above is deliberately triggered and produces a clear, translated, non-dead-end state.

---

## Milestone 4 — Backend hardening

- **Validate and sanitize** all inputs (text length cap, tenant/action shape). Reject oversized payloads.
- **Rate limit** `/api/command` per tenant (not just per IP) to protect against runaway cost.
- **Structured logging** with a request id; never log keys, tokens, or full prompts containing them.
- **Consistent error envelope** across all endpoints: `{ ok:false, error:{ code, message } }`, with codes the frontend switches on.
- **Security headers** on responses; confirm CORS is correct for the deployed origin.
- Confirm **Firestore rules** still deny all direct client access, and that `providerKeyEnc` can never be read by a client.
- Add `GET /api/health` detail: service ok, Firestore reachable, provider configured (no secrets).

✅ **Done when:** a security self-review passes and hardening is covered by tests in Milestone 5.

---

## Milestone 5 — Test suite (this is what makes it provable)

Extend beyond the existing smoke test into a real suite, runnable with one command (`npm test`), against the Firebase emulators.

Cover:
1. **Auth** — signup creates tenant with `active:false`; sign-in returns a usable token; protected endpoints 401 without one; token refresh path works.
2. **Pay-gate** — inactive tenant gets 402 on `/api/command` and `/api/bridge/poll`; activation flips both to working; deactivation re-blocks.
3. **Key handling** — key is encrypted at rest (verify ciphertext ≠ plaintext), never returned by any endpoint, decrypt round-trips correctly.
4. **Interpretation** — Arabic and English phrasing map to correct actions (include the diacritics case); out-of-scope input returns `none` and queues nothing; **an action outside the whitelist can never be queued**, even if the provider returns one (simulate it).
5. **Queue lifecycle** — enqueue → poll marks inflight → ack deletes; wrong bridge token 401; rotating the token invalidates the old one.
6. **Ask mode** — returns a reply and queues nothing.
7. **Error envelope** — each failure returns the documented shape and code.
8. **Rate limiting** — exceeding the per-tenant limit returns the right code.

Print a clear pass/fail summary. Keep the existing emulator smoke test working (or fold it in).

✅ **Done when:** `npm test` runs the full suite green, and it fails loudly if the whitelist guarantee is broken.

---

## Milestone 6 — Documentation sync + showcase update

Per the standing rule, bring all docs to match reality:
- Update `GOAL.md`, `ENGINEERING.md`, `DATABASE.md`, `SECURITY.md`, `FRONTEND.md`, `UIUX.md`, `AUTH.md` for everything changed here. `UIUX.md` should document the design system properly (tokens, colors, type, orb, RTL rules) — it doubles as the style guide.
- Add **`TESTING.md`** — what the suite covers, how to run it, what each test proves.
- Add **`API.md`** — every endpoint: method, auth, request, response, error codes.
- Append dated `DAILY_PROGRESS.md` entries as you work, not just at the end.
- Update `docs/index.html`: refresh the roadmap states and the "by the numbers" figures to the real current values (e.g. the new test count), keeping the existing design.
- Update `README.md` for the current setup and run instructions.

✅ **Done when:** a stranger could read `/docs` and understand the whole system, and nothing in the docs contradicts the code.

---

## Rules

**DO** keep the closed whitelist and pay-gate intact on every path; keep BYOK; keep the outward-polling bridge; keep EN/AR + RTL + dark/light everywhere; keep everything testable on the emulators; commit in logical chunks with clear messages.

**DON'T** build the AI installer or Stripe; don't weaken Firestore rules; don't log or expose secrets; don't change the app↔backend or bridge↔backend contracts without documenting it in `API.md`; don't push to GitHub (the human handles remote pushes).

**Final report:** what was built per milestone, the `npm test` result, any decisions you made on the human's behalf, anything you couldn't verify, and the exact next steps left for the human.
