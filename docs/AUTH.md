# Auth

**Area:** Identity & credentials · **Last updated:** 2026-08-10

> Two credential systems, deliberately separate: humans authenticate with Firebase (email/password → ID tokens, verified server-side on every request); FiveM servers authenticate with a per-tenant random bridge token. Nothing is open.

---

## Customers (humans)

1. **Signup** — `POST /api/signup {email, password, name}` creates the Firebase Auth user **and** `tenants/{uid}` (**`active:true` — open access, no payment**) in one step. Duplicate email → 409 `EMAIL_TAKEN`. Password 8–128 chars. Per-IP throttled (hashed IPs, `SIGNUP_RATE_LIMIT_PER_HOUR`); a failed tenant write rolls the auth user back.
2. **Email verification (mandatory)** — every ID-token endpoint requires the `email_verified` claim (`requireVerifiedUser` → 403 `EMAIL_UNVERIFIED` otherwise). The pages send the verification email on signup (Firebase `sendEmailVerification` — templates customizable in Firebase console → Authentication → Templates), show a dedicated verify screen (resend with 60s cooldown / "I've verified — continue" which reloads the user and force-refreshes the token / switch account), and route 403s from any call back to that screen. A stale pre-verification token can never pass: the claim lives in the token itself.
3. **Password reset** — "Forgot password?" on the sign-in tab → `sendPasswordResetEmail`; the UI always answers neutrally ("if that email has an account…") so accounts can't be enumerated.
4. **Sign-in** — the pages use the Firebase web SDK (`signInWithEmailAndPassword`); the SDK manages refresh. Every API call fetches a fresh ID token via `getToken()`.
5. **Session persistence** — the SDK persists the session; each page's module script fires a `mirsal-auth-ready` event after the first `onAuthStateChanged`, and the page routes accordingly: signed-in reload lands in the console/dashboard (or the verify screen if unverified), signed-out lands on the site/auth screen.
6. **Expiry handling** — on any 401 the client retries **once** with a force-refreshed token (`getIdToken(true)`); if it still 401s it signs out cleanly and shows a translated "session expired" on the auth screen. The refresh path itself is covered by `tests/auth.test.js`.
7. **Token verification** — `lib/auth.js → requireUser()` runs `admin.auth().verifyIdToken()` on the `Authorization: Bearer` header. Invalid/missing → 401. The uid **is** the tenant id — no separate mapping to get wrong.

## FiveM servers (bridges)

- Each tenant has one `bridgeToken` (`brg_` + 48 hex, `crypto.randomBytes`), created at signup, shown in the dashboard, sent by the Lua resource as `x-bridge-token`.
- `requireBridgeTenant()` resolves it with an equality query. Unknown → 401; tenant inactive → 402 on poll.
- **Rotation** — `POST /api/tenant/rotate-bridge-token` generates a new token and returns it once; the old one stops working immediately (verified in smoke test #13). Customer updates `server.cfg` and restarts the resource.

## Statuses the clients understand

All errors arrive as `{ ok:false, error:{ code, message } }` — the full table lives in [API.md](API.md). The auth-relevant ones:

| HTTP / code | meaning | UI behavior |
|---|---|---|
| 401 `AUTH_REQUIRED` | bad/missing credential | one silent token-refresh retry → sign-out + "session expired — sign in again" / bridge log: invalid token |
| 402 `PLAN_INACTIVE` | tenant not active | locked pill + "View plan →" link / bridge log: renew plan |

## Local development

- Emulator: `useEmulator: true` in `app/firebase-config.js` connects the web SDK to Auth :9099 (`demo-mirsal` project); the Admin SDK follows `FIREBASE_AUTH_EMULATOR_HOST` automatically under `firebase emulators:exec`.
- Tests sign in via the emulator REST endpoint (`accounts:signInWithPassword`) to get real ID tokens without a browser.

## Legacy demo

`backend/` uses its own simpler pair — static `APP_SECRET` header + env bridge token with timing-safe compare — unchanged and isolated from the platform.
