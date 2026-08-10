# Engineering

**Area:** Architecture, stack & workflows · **Last updated:** 2026-08-10

> Static frontend + Vercel serverless functions + Firestore + an outward-polling FiveM Lua bridge. No always-on server anywhere. Everything is testable locally on the Firebase Emulator Suite before any deploy.

---

## Architecture

```
Operator app ──(Firebase ID token)──► /api/command (Vercel fn)
                                         │ verify token · check tenant active (402)
                                         │ decrypt tenant key · interpret · validate
                                         ▼
                                    Firestore queue  ◄──poll/ack── FiveM bridge ──► game
```

The bridge only ever makes **outbound** HTTP requests — customers never open ports.

## Stack

| layer | choice |
|---|---|
| Hosting | Vercel (static + functions under `api/`) |
| Data | Firestore (`tenants/{uid}` + `commands` subcollection queue) |
| Auth | Firebase Authentication (email/password) — see [AUTH.md](AUTH.md) |
| AI | Gemini via `@google/genai`, forced function calling; provider seam in `providers/` |
| Game side | FiveM Lua resource (`fivem-bridge/`), convar-configured |

## Repo layout

```
api/          serverless functions        lib/        admin init, firestore, crypto, auth, http
app/          index.html (console), dashboard.html, firebase-config.js
providers/    gemini.js · claude.js (stub) · index.js (fallback logic)
scripts/      dev-server · seed · activate · smoke-emulator
fivem-bridge/ the customer-installed resource
backend/      original standalone demo (Express + Claude BYOK) — still maintained
docs/         this documentation + showcase page
```

## Commands

```bash
npm run smoke:emulator   # THE acceptance test (needs Java for the Firestore emulator)
npm run seed:emulator    # data-layer sanity
npm run emulators        # interactive: Auth + Firestore emulators
npm run dev              # interactive: dev server on :3000 (Vercel stand-in)
node scripts/activate.js <email> [--off]
cd backend && npm run smoke   # legacy demo acceptance test
```

Env vars: see `.env.example`. Production values live in Vercel project settings only.

## Conventions

- Every AI-visible action definition lives in `backend/actions.js` — single source of truth for both products.
- Any code path that produces an action re-validates through `actions.validateAction` before queueing. No exceptions.
- **Docs discipline:** after every change, update the relevant `docs/*.md` and append a dated entry to [DAILY_PROGRESS.md](DAILY_PROGRESS.md) describing what changed and why.
- Windows note: child-process teardown races libuv on exit — use the exit-safe shutdown pattern from `scripts/smoke-emulator.js` in any new test harness.
