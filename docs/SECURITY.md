# Security

**Area:** Trust boundaries & non-negotiables · **Last updated:** 2026-08-10

> Five load-bearing walls: a closed action whitelist, encrypted BYOK keys, authenticated everything, a 402 pay-gate on every path, and deny-all Firestore rules. If a change weakens any of these, it doesn't ship.

---

## 1. Closed whitelist (the product's core safety property)

- Every possible action is an **in-game roleplay event** defined in `backend/actions.js` — six actions, strict per-param validators.
- The AI is **forced** to call a single function whose `action` enum is that list (filtered per tenant) + `"none"` — it cannot even name anything else.
- Regardless of source (Gemini, keyword fallback, future providers), output is re-validated by `actions.validateAction` before queueing.
- The Lua bridge dispatches only to named handlers; unknown actions are logged, skipped, and acked so they can't loop.

**Explicitly out of scope, forever:** shell/file/OS access, `eval`/dynamic action names, arbitrary HTTP from the bridge, anything affecting other servers or players' machines.

### Server Scanner is read-only by construction

The scanner ([SCANNER.md](SCANNER.md)) reads a customer's server; it never writes, moves, or deletes. Enforced, not promised: the access layer exposes only `listFiles/readFile/stat/exists` (no write method exists); only text files are ever loaded and binaries never leave the customer's machine; path-traversal and symlinks are dropped; and the bridge's `scan.lua` uses only read APIs — a test statically asserts the whole `fivem-bridge/` directory contains no `SaveResourceFile`/`io.write`/`os.remove`/`os.rename`/`os.execute`/`io.popen`. Stored scans carry the derived report only — **never raw source or secrets** (findings hold locations, and a storage-time sanitizer redacts secret-shaped evidence; asserted by tests).

## 2. Key custody

- Customer AI keys: AES-256-GCM (`lib/crypto.js`) under `ENCRYPTION_KEY` (32 bytes, Vercel env). Decrypted only inside `/api/command`, per request; never returned to a client, never logged.
- Admin service account: `FIREBASE_SERVICE_ACCOUNT` env var only. `.gitignore` blocks `*firebase-adminsdk*.json` / `service-account*.json` patterns so a downloaded key can never be committed.
- The Firebase **web** config (`app/firebase-config.js`) is public by design — not a secret.

## 3. Authentication

- App → API: Firebase **ID token** (`Authorization: Bearer`), verified by the Admin SDK on every request, **plus a mandatory verified email**: `requireVerifiedUser` rejects `email_verified:false` tokens with 403 `EMAIL_UNVERIFIED` on every human endpoint — server-enforced, unskippable from the client.
- Signup is per-IP throttled (`SIGNUP_RATE_LIMIT_PER_HOUR`, default 20/h; only SHA-256 IP hashes are stored) and rolls back the auth user if the tenant write fails — no orphaned emails.
- Password reset uses neutral wording end-to-end (no account enumeration from our UI). Recommended console toggle: Authentication → Settings → **Email enumeration protection ON**.
- Bridge → API: per-tenant random `x-bridge-token` (`brg_` + 48 hex), rotatable from the dashboard; old token dies instantly.
- No open endpoints except `/api/health`, `/api/signup`, and the 501 Stripe stub.

## 4. Pay-gate — currently OPEN (no payment)

The mechanism is intact: `active:false` → **402** on `/api/command` and `/api/bridge/poll` (ack stays un-gated so in-flight commands settle, proven by smoke test #14). **But new signups are created `active:true`** (`api/signup.js`) — open access, no payment required, by product decision. To charge later: flip that default back to `false` (or let the Stripe webhook set it). Nothing else changes — the gate code and the `subscriptionStatus` seam stay in place.

## 5. Firestore rules

`firestore.rules` = deny all client reads and writes. The API (Admin SDK) is the only data path, so field-level secrets can't leak via queries.

## 6. Request hardening (2026-08-10)

- **One spine:** every endpoint runs through `lib/http.js endpoint()` — uniform error envelope (`{ok:false,error:{code,message}}`, codes in [API.md](API.md)), crash containment (unhandled → 500 `INTERNAL`, never a stack trace to the client).
- **Headers on every response:** `nosniff`, `X-Frame-Options: DENY`, strict referrer policy, `cache-control: no-store`, `x-request-id`. HTML pages additionally get a CSP (self + inline + gstatic/fonts + Firebase Auth endpoints, `frame-ancestors 'none'`) and a Permissions-Policy limiting mic to self, camera/geolocation off — in `vercel.json` for prod, mirrored by the dev server.
- **Input caps:** 64 KB body limit (413), command text ≤300 chars, email/password/key length bounds. Oversized streams are aborted mid-read.
- **Per-tenant rate limit** on `/api/command` (`RATE_LIMIT_PER_MIN`, default 30/min): Firestore transactional fixed window on the tenant doc, so it holds across serverless instances and covers ask mode (provider cost) too. 429 `RATE_LIMITED`.
- **CORS same-origin by default** — zero `Access-Control-*` headers unless `ALLOWED_ORIGIN` is deliberately set.
- **Structured logs, no secrets:** single-line JSON with a request id; keys, tokens, and Authorization material never enter `fields`; command text is truncated. Provider errors are logged server-side and never surfaced to clients (suite-verified).

## Public applicant endpoints (Whitelist Officer)

The `/api/apply/*` endpoints are unauthenticated by design (applicants have no account), so they carry their own guards: per-IP throttle (`APPLY_RATE_LIMIT_PER_HOUR`, hashed IPs), body caps (shared `endpoint()` spine), slug validation, and **they expose nothing about the tenant beyond the server name + questions** (a test scans the config response for the uid/criteria/webhook). `appId→uid` resolves through a private index so the uid never reaches the applicant; resume tokens are stored hashed. Applicant data is treated as personal data: only owner-configured fields are stored, transcripts are never logged, and delete-application exists. The AI never auto-decides unless the owner set thresholds AND confidence is high AND no blocking flag fired. See [WHITELIST.md](WHITELIST.md).

## The Concierge — notify-only in a live world

The Concierge runs against a server full of real players, so its authority is a **closed action set of exactly three verbs**: `send_message`, `show_menu`, `set_waypoint` — nothing else. The boundary is enforced four times over, so no single defect can widen it: (1) the AI's forced-function-calling schema only enumerates the three verbs; (2) `sanitizeActions` drops anything else after the brain runs; (3) a final `closed()` filter in the runtime; (4) the bridge Lua physically contains no write/spawn/teleport/give primitive — a **static test greps `fivem-bridge/concierge.lua`** and fails if `SaveResourceFile`/`SetEntityCoords`/`GiveMoney`/`AddItem`/`CreateVehicle`/`CreatePed`/`DropPlayer`/`SetJob`/… ever appears. The bridge auth (`x-bridge-token`) and pay-gate are reused unchanged; player data is minimized (flow state only, coarse question themes, no raw chat) and purgeable. See [CONCIERGE.md](CONCIERGE.md).

## Proven by tests

`npm test` (44) locks the walls in place: the **rogue-provider test** proves a non-whitelisted action from the AI itself can never be queued (with a live-control test so it can't pass vacuously); the key-leak scan proves no endpoint ever returns key material; the pay-gate cycle proves deactivation gates command + poll while ack settles; the hardening file pins headers, caps, CORS, and the secret-free health check. See [TESTING.md](TESTING.md).

## Operational notes

- Known exposure to accept: a pasted GitHub token in chat/command history is treated as burned — use short-lived tokens and revoke after use.
