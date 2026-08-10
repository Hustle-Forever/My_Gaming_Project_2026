# Goal

**Area:** Product vision & status · **Last updated:** 2026-08-10

> Mirsal is a hosted, multi-tenant platform that lets FiveM roleplay server owners control their game world by voice or text, in Arabic or English. Customers bring their own server and their own AI key; we provide the console, the understanding, and the delivery pipe. `active` is the single pay-gate.

---

## The product

- A server owner signs up, pastes their Gemini API key, installs one Lua resource, and their operators can say «ابغى سيارة شرطة» — a police car spawns in-game seconds later.
- Two modes: **Run** (executes a whitelisted in-game action) and **Ask** (answers a question, executes nothing).
- Everything the AI can ever do is a **closed whitelist of six in-game roleplay actions** — never anything outside the game world. That constraint is the product's trust story, not a limitation.

## Business model

- SaaS subscription per server (tenant). `active:false` → 402 on every path; nothing runs.
- **BYOK** (bring your own AI key): inference costs live with the customer; our costs stay flat per tenant.
- Activation is manual today (`scripts/activate.js`); Stripe drops into the same single `active` boolean later (see the seam in [ENGINEERING.md](ENGINEERING.md)).

## Status (2026-08-10)

- ✅ Platform built and green: `npm run smoke:emulator` 16/16; full browser E2E on the emulators.
- ✅ Legacy single-tenant demo (`backend/`) still green: 7/7.
- ⏳ Awaiting: Firebase console setup (m2-gaming project created; web config wired), Vercel deploy, first real customer activation.

## Roadmap (not built yet, in rough order)

1. Stripe checkout + webhook → automatic activation.
2. Claude as a second provider (`providers/claude.js` stub exists).
3. Command→player routing (today: first connected player; weather/time are global).
4. Command history view in the console (queue is already per-tenant in Firestore).
