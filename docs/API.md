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
`{ email, password, name? }` → creates the Firebase Auth user **and** `tenants/{uid}` in one step. **Open access: the tenant is created `active:true`** (no payment — flip in `api/signup.js` to re-gate).
- 200 `{ ok:true, uid }`
- 400 `BAD_INPUT` (email format, password 8–128) · 409 `EMAIL_TAKEN`

### `POST /api/command` — ID token
`{ text, mode? }` — `text` 1–300 chars; `mode` `"run"` (default) or `"ask"`.
Pipeline: verify token → tenant → pay-gate → **rate limit** (`RATE_LIMIT_PER_MIN`, default 30/min/tenant, Firestore-backed) → decrypt tenant key (never logged) → interpret → `actions.validateAction` (the whitelist gate — anything else becomes `none`) → queue.
- Run, matched: `{ ok:true, action, params, queued:true, message }` (message is the friendly Arabic template)
- Run, unmatched: `{ ok:true, action:"none", queued:false, message }`
- Ask: `{ ok:true, reply }` — never an action, never queued
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

### `POST /api/stripe/webhook` — open (stub)
Always 501 `NOT_IMPLEMENTED`. The seam where subscription events will flip `active` / `subscriptionStatus`.

---

## Test seam

With `NODE_ENV=test` only, `providers/index.js` registers `providers/fake.js` — a scripted rogue-AI simulator the suite uses to prove non-whitelisted provider output can never reach the queue. It does not exist in production and `/api/tenant/key` refuses `fake` as a provider name.
