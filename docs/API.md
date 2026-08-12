# API

**Area:** HTTP contract — every endpoint, request, response, and error code · **Last updated:** 2026-08-10

> Nine serverless endpoints under `/api/`. Two credential types: the app sends a Firebase **ID token** (`Authorization: Bearer <token>`), the FiveM bridge sends its per-tenant **bridge token** (`x-bridge-token`). Every error, on every endpoint, uses one envelope. This file is the contract — changes to it must be deliberate.

---

## Error envelope (all endpoints)

```json
{ "ok": false, "error": { "code": "PLAN_INACTIVE", "message": "subscription inactive" } }
```

| code | HTTP | meaning | typical UI copy |
|---|---|---|---|
| `BAD_INPUT` | 400 | missing/invalid/over-long field | "didn't catch that" / field-specific |
| `AUTH_REQUIRED` | 401 | bad or missing ID token / bridge token | "session expired — sign in again" |
| `PLAN_INACTIVE` | 402 | tenant `active:false` | "subscription inactive" + plan link |
| `EMAIL_UNVERIFIED` | 403 | valid token but `email_verified:false` | verify-email screen (resend / continue) |
| `NOT_FOUND` | 404 | no tenant doc for this uid; unknown static path | generic |
| `METHOD_NOT_ALLOWED` | 405 | wrong HTTP verb | — |
| `EMAIL_TAKEN` | 409 | signup with a registered email | "that email is already registered" |
| `PAYLOAD_TOO_LARGE` | 413 | request body over 64 KB | generic |
| `RATE_LIMITED` | 429 | per-tenant command limit hit | "too many commands — wait a minute" |
| `INTERNAL` | 500 | unhandled server error (logged with request id) | "something went wrong" |
| `NOT_IMPLEMENTED` | 501 | Stripe webhook seam | — |

Messages are always English; clients translate by `code`. The Lua bridge switches on HTTP status only, so the envelope is invisible to it.

## Response headers (every endpoint)

`x-request-id` (uuid, matches the server log line) · `x-content-type-options: nosniff` · `x-frame-options: DENY` · `referrer-policy: strict-origin-when-cross-origin` · `cache-control: no-store`.

**CORS is same-origin by default** — no `Access-Control-*` headers are emitted. Deploying the app on a different origin than the API requires setting `ALLOWED_ORIGIN` (exact origin, or `*`) in the API's env. The bridge is server-side Lua; CORS never applies to it.

---

## Endpoints

### `GET /api/health` — open
Liveness + dependency detail. Never contains secrets.
```json
{ "ok": true, "firestore": "ok", "provider": "gemini",
  "config": { "serviceAccount": true, "encryptionKey": true } }
```
`ok` is false when the Firestore probe fails (1-doc read, 2.5 s timeout).

### `POST /api/signup` — open
`{ email, password, name? }` → creates the Firebase Auth user **and** `tenants/{uid}` in one step. **Open access: the tenant is created `active:true`** (no payment — flip in `api/signup.js` to re-gate). The account still can't use any other endpoint until its email is verified.
- Throttled per client IP (`SIGNUP_RATE_LIMIT_PER_HOUR`, default 20/h; IPs stored only as SHA-256 hashes in `rl_ip`) → 429 `RATE_LIMITED`.
- If the tenant write fails after user creation, the auth user is rolled back (no orphaned emails).
- 200 `{ ok:true, uid }`
- 400 `BAD_INPUT` (email format, password 8–128) · 409 `EMAIL_TAKEN` · 429 `RATE_LIMITED`

**Email verification (all ID-token endpoints):** `requireVerifiedUser` rejects any token whose `email_verified` claim is false with 403 `EMAIL_UNVERIFIED` — server-enforced, so no client can skip it. The client sends the verification email via the Firebase web SDK (`sendEmailVerification`), then refreshes the token after the link is clicked (`getIdToken(true)`); password resets use `sendPasswordResetEmail` with deliberately neutral UI copy (no account enumeration).

### `POST /api/command` — ID token
`{ text, mode? }` — `text` 1–300 chars; `mode` `"run"` (default) or `"ask"`. The client sends **no language** — the reply language is decided server-side from the message text (`lib/lang.js`), so the UI toggle can never change it. Mixed/ambiguous input falls back to `tenant.defaultLanguage` (or `en`).
Pipeline: verify token → tenant → pay-gate → **rate limit** (`RATE_LIMIT_PER_MIN`, default 30/min/tenant, Firestore-backed) → detect reply language → decrypt tenant key (never logged) → interpret (Run) / answer (Ask) → `actions.validateAction` (the whitelist gate — anything else becomes `none`) → queue.
- Run, matched: `{ ok:true, action, params, queued:true, message, lang }` — `message` is the friendly confirmation in the detected language (`lang` is `"en"`/`"ar"`)
- Run, unmatched: `{ ok:true, action:"none", queued:false, message, lang }`
- Ask: `{ ok:true, reply, lang }` — never an action, never queued. The assistant is a product-aware persona (`lib/ask-persona.js`) that explains and is concrete about the tenant's own server (latest scan model + `allowedActions`); with no AI key a deterministic, genuinely-helpful fallback answers in the same language.
- First successful queue stamps `firstCommandAt` on the tenant.
- 401 · 402 · 400 · 413 · 429 per the envelope table.

### `GET /api/tenant/me` — ID token
The tenant's own state, **without** any key material:
```json
{ "ok": true, "tenant": { "name", "active", "provider", "hasKey",
  "bridgeToken", "allowedActions", "lastPolledAt", "firstCommandAt" } }
```
`lastPolledAt` / `firstCommandAt` are epoch ms or `null` — they drive the dashboard setup checklist and the "server connected" indicator.

### `POST /api/tenant/key` — ID token
`{ apiKey, provider? }` — key 10–300 chars; provider `gemini|claude` (anything else falls back to the tenant's current provider). Stores AES-256-GCM ciphertext; the key is never echoed back by any endpoint, ever.
- 200 `{ ok:true, provider, hasKey:true }`

### `POST /api/tenant/rotate-bridge-token` — ID token
Generates a fresh `bridgeToken`, returned **once**: `{ ok:true, bridgeToken }`. The old token 401s immediately.

### `GET /api/bridge/poll` — bridge token
Returns pending commands (oldest first, ≤20) and marks them `inflight`:
`{ "commands": [ { "id", "action", "params" } ] }`
Pay-gated (402 when inactive). Stamps `lastPolledAt` on the tenant, throttled to **one write per minute** regardless of poll rate.

### `POST /api/bridge/ack` — bridge token
`{ ids: [...] }` (≤50) → deletes executed commands: `{ ok:true, acked }`.
**Deliberately not pay-gated** so in-flight commands can settle after deactivation.

### `POST /api/scan` — ID token (verified) + pay-gate
Run a **read-only** server scan. `{ source:'upload', pack:{ files:[{ path, content?, size }] } }` — the pack is built client-side from the owner's chosen server folder (text files only; binaries are listed by name+size but never uploaded). Verified-auth + pay-gate + per-tenant rate limit (`SCAN_RATE_LIMIT_PER_HOUR`, default 20/h). Stores the derived report at `tenants/{uid}/scans/{scanId}` — **never raw source**.
- 200 `{ ok:true, scanId, status:'complete', health, identity, findingCount }`
- 400 `BAD_INPUT` (no pack) · 402 `PLAN_INACTIVE` · 403 `EMAIL_UNVERIFIED` · 413 `PAYLOAD_TOO_LARGE` (server too large) · 429 `RATE_LIMITED`

### `GET /api/scan-status` — ID token (verified) + pay-gate
`?scanId=…` → the full stored report `{ ok:true, scan:{ identity, health, findings, model, … } }`. Without `scanId` → the tenant's scan history: `{ ok:true, scans:[{ scanId, createdAtMs, source, health, framework }] }`.
- 404 `NOT_FOUND` (no such scan) · 402 · 403 per the table.

See [SCANNER.md](SCANNER.md) for the full pipeline, checks, and the read-only bridge commands.

### Whitelist Officer — public applicant endpoints (unauthenticated, hard-limited)
- `GET /api/apply/config?slug=` → `{serverName, questionCount, identityFields, languages}` only. Unknown/disabled slug → 404.
- `POST /api/apply/start` `{slug, language, identity}` → `{appId, resumeToken, step}`. Per-IP throttle (`APPLY_RATE_LIMIT_PER_HOUR`), one active application per identity.
- `POST /api/apply/answer` `{appId, resumeToken, text}` → `{step}`.
- `POST /api/apply/submit` `{appId, resumeToken}` → `{status, overall}`.
- `GET /api/apply/resume?appId=&resumeToken=` → `{step}`.
Resume-token protected; `appId`→uid via a private index so the uid never reaches the applicant. 401 `AUTH_REQUIRED` on a bad token.

### Whitelist Officer — owner endpoints (ID token verified + pay-gate)
- `GET/POST /api/whitelist/config` — read/update the interview config (validated).
- `GET /api/whitelist/applications` → queue; `?appId=` → full detail (transcript + evidence + flags).
- `POST /api/whitelist/decide` `{appId, decision(approve|reject|reinterview|delete), note?}` → records `decidedBy`/`decidedAtMs`.
- `GET /api/whitelist/stats` → received / backlog / approvalRate / avgDecisionMinutes.
- `POST /api/whitelist/test-webhook` `{url}` → verifies a Discord webhook.

See [WHITELIST.md](WHITELIST.md).

### The Concierge — bridge endpoints (x-bridge-token + pay-gate)
- `POST /api/concierge/event` `{type(join|choice|message|dismiss), playerId, playerName?, jobId?, text?, language?}` → `{onboard, actions[]}`. `actions[]` is **only ever** `send_message` / `set_waypoint` / `show_menu`. Disabled concierge → `{onboard:false, actions:[]}`; inactive plan → 402.
- `POST /api/concierge/reply` `{playerId}` → `{actions[]}` — polled on the existing outward loop for the ~5-min check-in (no new ports).

### The Concierge — owner endpoints (ID token verified + pay-gate)
- `GET/POST /api/concierge/config` — read/update setup (enabled, tone, languages, check-in seconds, retention days; validated).
- `GET /api/concierge/stats` → funnel (arrived→greeted→answered→reached→checkin), retention (still-playing / returned / rate), arrivals-by-day, ranked question themes.

The whole group is one Vercel function (`api/concierge/[action].js`). See [CONCIERGE.md](CONCIERGE.md).

### `POST /api/stripe/webhook` — open (stub)
Always 501 `NOT_IMPLEMENTED`. The seam where subscription events will flip `active` / `subscriptionStatus`.

---

## Test seam

With `NODE_ENV=test` only, `providers/index.js` registers `providers/fake.js` — a scripted rogue-AI simulator the suite uses to prove non-whitelisted provider output can never reach the queue. It does not exist in production and `/api/tenant/key` refuses `fake` as a provider name.
