# Auth

**Area:** Identity & credentials · **Last updated:** 2026-08-10

> Two credential systems, deliberately separate: humans authenticate with Firebase (email/password → ID tokens, verified server-side on every request); FiveM servers authenticate with a per-tenant random bridge token. Nothing is open.

---

## Customers (humans)

1. **Signup** — `POST /api/signup {email, password, name}` creates the Firebase Auth user **and** `tenants/{uid}` (`active:false`) in one step. Duplicate email → 409. Password ≥ 8 chars.
2. **Sign-in** — the pages use the Firebase web SDK (`signInWithEmailAndPassword`); the SDK manages refresh. Every API call fetches a fresh ID token via `getToken()`.
3. **Verification** — `lib/auth.js → requireUser()` runs `admin.auth().verifyIdToken()` on the `Authorization: Bearer` header. Invalid/missing → 401. The uid **is** the tenant id — no separate mapping to get wrong.

## FiveM servers (bridges)

- Each tenant has one `bridgeToken` (`brg_` + 48 hex, `crypto.randomBytes`), created at signup, shown in the dashboard, sent by the Lua resource as `x-bridge-token`.
- `requireBridgeTenant()` resolves it with an equality query. Unknown → 401; tenant inactive → 402 on poll.
- **Rotation** — `POST /api/tenant/rotate-bridge-token` generates a new token and returns it once; the old one stops working immediately (verified in smoke test #13). Customer updates `server.cfg` and restarts the resource.

## Statuses the clients understand

| code | meaning | UI copy |
|---|---|---|
| 401 | bad/missing credential | "session expired — sign in" / bridge log: invalid token |
| 402 | tenant not active | "subscription inactive" / bridge log: renew plan |

## Local development

- Emulator: `useEmulator: true` in `app/firebase-config.js` connects the web SDK to Auth :9099 (`demo-mirsal` project); the Admin SDK follows `FIREBASE_AUTH_EMULATOR_HOST` automatically under `firebase emulators:exec`.
- Tests sign in via the emulator REST endpoint (`accounts:signInWithPassword`) to get real ID tokens without a browser.

## Legacy demo

`backend/` uses its own simpler pair — static `APP_SECRET` header + env bridge token with timing-safe compare — unchanged and isolated from the platform.
