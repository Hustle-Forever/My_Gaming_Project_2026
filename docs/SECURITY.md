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

## 2. Key custody

- Customer AI keys: AES-256-GCM (`lib/crypto.js`) under `ENCRYPTION_KEY` (32 bytes, Vercel env). Decrypted only inside `/api/command`, per request; never returned to a client, never logged.
- Admin service account: `FIREBASE_SERVICE_ACCOUNT` env var only. `.gitignore` blocks `*firebase-adminsdk*.json` / `service-account*.json` patterns so a downloaded key can never be committed.
- The Firebase **web** config (`app/firebase-config.js`) is public by design — not a secret.

## 3. Authentication

- App → API: Firebase **ID token** (`Authorization: Bearer`), verified by the Admin SDK on every request.
- Bridge → API: per-tenant random `x-bridge-token` (`brg_` + 48 hex), rotatable from the dashboard; old token dies instantly.
- No open endpoints except `/api/health`, `/api/signup`, and the 501 Stripe stub.

## 4. Pay-gate — currently OPEN (no payment)

The mechanism is intact: `active:false` → **402** on `/api/command` and `/api/bridge/poll` (ack stays un-gated so in-flight commands settle, proven by smoke test #14). **But new signups are created `active:true`** (`api/signup.js`) — open access, no payment required, by product decision. To charge later: flip that default back to `false` (or let the Stripe webhook set it). Nothing else changes — the gate code and the `subscriptionStatus` seam stay in place.

## 5. Firestore rules

`firestore.rules` = deny all client reads and writes. The API (Admin SDK) is the only data path, so field-level secrets can't leak via queries.

## Operational notes

- Rate limiting exists in the legacy demo (20/min/IP). The platform currently relies on auth + pay-gate; per-tenant rate limiting is a known TODO before public launch.
- Known exposure to accept: a pasted GitHub token in chat/command history is treated as burned — use short-lived tokens and revoke after use.
