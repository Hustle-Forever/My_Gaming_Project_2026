# Goal

**Area:** Product vision & status · **Last updated:** 2026-08-10

> M2 is a hosted, multi-tenant platform that lets FiveM roleplay server owners control their game world by voice or text, in Arabic or English. Customers bring their own server and their own AI key; we provide the console, the understanding, and the delivery pipe. `active` is the single pay-gate.

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

## Status (2026-08-12)

- ✅ Platform hardened and proven: **`npm test` 226/226** (auth + mandatory email verification, pay-gate cycle, key custody, interpretation incl. rogue-provider whitelist proof, queue, envelope, rate limiting, **the read-only Server Scanner, the Whitelist Officer, + the notify-only Concierge**) + `npm run smoke:emulator` 15/15.
- ✅ **Server Scanner** shipped (read-only) — M2 reads a customer's FiveM server and reports its identity, resources, and ranked problems in plain EN/AR. The shared foundation for the Doctor and the AI Installer. See [SCANNER.md](SCANNER.md).
- ✅ **Whitelist Officer** shipped — the whitelist form replaced by an AI interview (EN/AR): follows up on vague answers, scores against owner criteria with quoted evidence, flags copy-paste/hostile/AI answers, one-click owner decisions, Discord delivery. Public `/apply/{slug}` + dashboard review queue. Human decides by default. See [WHITELIST.md](WHITELIST.md).
- ✅ One coherent product surface: marketing site + console (`/`) and the owner dashboard (`/dashboard`, now with the Server Report) share one design system; email verification + password reset; session persistence; translated failure states everywhere.
- ✅ Legacy single-tenant demo (`backend/`) untouched and green: 7/7.
- ⏳ Awaiting (human): Vercel Deployment-Protection off + env vars + Firestore rules in the m2-gaming console; then the first real customer walks the checklist and runs a scan.

## Roadmap (not built yet, in rough order)

1. **The Doctor** — surface the scanner as a polished standalone diagnosis product; bridge-sourced scans (the read-only `scan_*` commands exist).
2. **The AI Installer** — write resources correctly using the scanner's `serverModel` (framework/inventory/jobs). This is Phase 1+: safe read→backup→change→restart→rollback first, no AI writes until that's proven.
3. Stripe checkout + webhook → automatic activation.
4. Claude as a second provider (`providers/claude.js` stub exists).
5. FTP/SFTP access adapter (credential-storage decision pending — `ftpAdapter` stub documents the contract).
