# Goal

**Area:** Product vision & status · **Last updated:** 2026-08-10

> Mirsal is a hosted, multi-tenant platform that lets FiveM roleplay server owners control their game world by voice or text, in Arabic or English. Customers bring their own server and their own AI key; we provide the console, the understanding, and the delivery pipe. `active` is the single pay-gate.

---

## The product

- A server owner signs up, pastes their Gemini API key, installs one Lua resource, and their operators can say «ابغى سيارة شرطة» — a police car spawns in-game seconds later.
- Two modes: **Run** (executes a whitelisted in-game action) and **Ask** (answers a question, executes nothing).
- Everything the AI can ever do is a **closed whitelist of six in-game roleplay actions** — never anything outside the game world. That constraint is the product's trust story, not a limitation.

## Business model

- **Open access right now — no payment.** New accounts sign up and work immediately (`active:true`). The `active` pay-gate and `subscriptionStatus` field stay in the code as a dormant seam; charging is a one-line default flip + Stripe later.
- SaaS subscription per server (tenant) is the *future* model: `active:false` → 402 on every path.
- **BYOK** (bring your own AI key): inference costs live with the customer; our costs stay flat per tenant.
- `scripts/activate.js` still exists to toggle any tenant's `active` flag by hand.

## Status (2026-08-10, post-polish)

- ✅ Platform hardened and proven: **`npm test` 48/48** (auth, pay-gate cycle, key custody, interpretation incl. rogue-provider whitelist proof, queue, envelope, rate limiting) + `npm run smoke:emulator` 15/15.
- ✅ One coherent product surface: marketing site + console (`/`) and the rebuilt owner dashboard (`/dashboard`) share one design system (see [UIUX.md](UIUX.md)); session persistence, translated failure states everywhere, 4-step setup checklist.
- ✅ Backend: error envelope, security headers/CSP, per-tenant rate limit, request-id logs, `lastPolledAt`/`firstCommandAt` telemetry ([API.md](API.md)).
- ✅ Legacy single-tenant demo (`backend/`) untouched and green: 7/7.
- ⏳ Awaiting (human): Vercel deploy + paste Firestore rules in the m2-gaming console; then the first real customer walks the checklist.

## Roadmap (not built yet, in rough order)

1. Stripe checkout + webhook → automatic activation.
2. Claude as a second provider (`providers/claude.js` stub exists).
3. Command→player routing (today: first connected player; weather/time are global).
4. Command history view in the console (queue is already per-tenant in Firestore).
