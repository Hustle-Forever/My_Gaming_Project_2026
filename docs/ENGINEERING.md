# Engineering

**Area:** Architecture, stack & workflows · **Last updated:** 2026-08-10

> Static frontend + Vercel serverless functions + Firestore + an outward-polling FiveM Lua bridge. No always-on server anywhere. Everything is testable locally on the Firebase Emulator Suite before any deploy.

---

## Architecture

```
Operator app ──(Firebase ID token)──► /api/command (Vercel fn)
                                         │ verify token · pay-gate (402) · rate limit (429)
                                         │ decrypt tenant key · interpret · validate (whitelist)
                                         ▼
                                    Firestore queue  ◄──poll/ack── FiveM bridge ──► game
```

The bridge only ever makes **outbound** HTTP requests — customers never open ports. Every endpoint rides `lib/http.js endpoint()`: one error envelope, security headers, request-id JSON logs, body caps (contract in [API.md](API.md)).

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
api/          serverless functions (incl. scan.js, scan-status.js)
lib/          admin init, firestore, crypto, auth, http spine
lib/serverAccess/  read-only adapter layer (zip/scan-pack/dir/bridge/ftp-stub)
lib/scanner/  the Server Scanner: parsers, detectors, checks/, report, orchestrator
app/          index.html (site+console), dashboard.html (+ Server Report), firebase-config.js
providers/    gemini.js · claude.js (stub) · fake.js (test-only rogue simulator) · index.js
tests/        the suite (node:test × emulators; scanner tests are pure) — see TESTING.md
tests/fixtures/servers/  qbcore-clean · esx-clean · broken · ambiguous
scripts/      dev-server · seed · activate · smoke-emulator
fivem-bridge/ the customer-installed resource (server.lua + read-only scan.lua)
backend/      original standalone demo (Express + Claude BYOK) — still maintained
docs/         this documentation + showcase page (served at /docs/)
```

The **Server Scanner** (read-only FiveM analysis — foundation for the Doctor and AI Installer) has its own doc: [SCANNER.md](SCANNER.md).

## Commands

```bash
npm test                 # THE acceptance gate: 44 tests on the emulators (needs Java ≥11)
npm run smoke:emulator   # end-to-end story test (15 checks), kept green alongside
npm run seed:emulator    # data-layer sanity
npm run emulators        # interactive: Auth + Firestore emulators
npm run dev              # interactive: dev server on :3000 (Vercel stand-in, serves /docs/ too)
node scripts/activate.js <email> [--off]
cd backend && npm run smoke   # legacy demo acceptance test
```

Env vars: see `.env.example`. Production values live in Vercel project settings only.

## Conventions

- Every AI-visible action definition lives in `backend/actions.js` — single source of truth for both products.
- Any code path that produces an action re-validates through `actions.validateAction` before queueing. No exceptions.
- New endpoints use `endpoint(methods, handler)` from `lib/http.js` and speak the [API.md](API.md) envelope; new failure modes get a code there first.
- **TDD:** backend behavior lands as a failing test in `tests/` before the implementation (see [TESTING.md](TESTING.md)).
- **Docs discipline:** after every change, update the relevant `docs/*.md` and append a dated entry to [DAILY_PROGRESS.md](DAILY_PROGRESS.md) describing what changed and why.
- Windows note: child-process teardown races libuv on exit — use the exit-safe shutdown pattern from `scripts/smoke-emulator.js` in any new test harness.
