# M2 — FiveM AI control platform

**🟢 Live showcase:** _after the Vercel import, put your URL here →_ `https://YOUR-PROJECT.vercel.app/docs/` — that link will open the [M2 showcase](docs/index.html) as a real page in a new tab. Until then, GitHub shows the HTML as source code (GitHub never renders HTML files — only a hosting URL does).

A hosted, multi-tenant platform (branded **M2** in the UI): each customer signs in, connects **their own FiveM server** and **their own AI key**, and controls the game by voice/text in Arabic or English. **Open access today:** signup activates immediately — the `active` pay-gate stays in the code as the dormant Stripe seam and still blocks every path when flipped off.

```
Operator app ──(Firebase ID token)──► /api/command (Vercel fn)
                                         │ verify token · check tenant active (402 if not)
                                         │ decrypt tenant's Gemini key · interpret · validate
                                         ▼
                                    Firestore queue  ◄──poll/ack── FiveM bridge ──► game
```

- **Frontend:** `app/index.html` (operator console, EN/AR + dark/light) and `app/dashboard.html` (owner dashboard) — static, served by Vercel.
- **Backend:** Vercel serverless functions under `api/` (no always-on server).
- **State:** Firestore (`tenants/{uid}` + `tenants/{uid}/commands` queue). **Auth:** Firebase Authentication (email/password).
- **AI:** Gemini via `@google/genai` behind a provider seam (`providers/`) — `providers/claude.js` is the stub where Claude drops in later. No key? A deterministic Arabic/English keyword matcher keeps Run mode working.
- **Bridge:** `fivem-bridge/` Lua resource — polls `/api/bridge/poll` **outward only**; customers never open ports.

## Security model

- **Closed whitelist.** Every possible action is an in-game roleplay event defined in [`backend/actions.js`](backend/actions.js) (spawn_vehicle, set_weather, set_time, heal_player, spawn_npc, repair_vehicle). Gemini is *forced* to call one function whose `action` enum is that list + `none`, and the output is re-validated server-side with `validateAction` before queueing. The bridge executes only named handlers; unknown actions are logged and skipped.
- **Keys encrypted at rest.** Customer AI keys are AES-256-GCM encrypted with `ENCRYPTION_KEY` ([`lib/crypto.js`](lib/crypto.js)), decrypted only inside `/api/command`, never sent to any client, never logged.
- **Every request authenticated.** Apps send a Firebase ID token (`Authorization: Bearer`); bridges send `x-bridge-token`. Wrong/missing → 401.
- **Pay-gate everywhere.** `active:false` → 402 on `/api/command` **and** `/api/bridge/poll`.
- **Firestore rules deny all client access** ([`firestore.rules`](firestore.rules)) — clients can never read `providerKeyEnc` or write `active`; everything flows through the Admin SDK in the API functions.

## What the human sets up (one time)

**Firebase** (console.firebase.google.com):
1. Create a project.
2. Build → **Firestore Database** → create (production mode). Deploy the rules: `npx firebase deploy --only firestore:rules --project <project-id>` (or paste `firestore.rules` in the console).
3. Build → **Authentication** → Sign-in method → enable **Email/Password**.
4. Project settings → **Service accounts** → *Generate new private key* → keep the JSON **secret**.
5. Project settings → General → *Your apps* → add a **Web app** → copy the public web config.

**This repo:**
6. Paste the web config into [`app/firebase-config.js`](app/firebase-config.js) (one file, used by both pages — it's public and safe to embed).

**Vercel** (vercel.com):
7. Import the repo. Framework preset: **Other**. Add env vars:

   ```
   FIREBASE_SERVICE_ACCOUNT = <the service-account JSON, one line>   (secret)
   FIREBASE_PROJECT_ID      = <project id>
   ENCRYPTION_KEY           = <64 hex chars>                          (secret)
   PROVIDER                 = gemini
   RATE_LIMIT_PER_MIN       = 30            # optional, per-tenant /api/command limit
   ALLOWED_ORIGIN           =                # optional, ONLY if the app lives on another origin
   ```

   Generate the encryption key: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
8. Deploy. The site+console is at `/`, the dashboard at `/dashboard`, the showcase at `/docs/`.

**Per customer (self-serve, no payment):**
9. They sign up on `/` or `/dashboard` — the account is **active immediately** — then follow the dashboard's 4-step checklist: paste their **Gemini API key** (aistudio.google.com → API keys), copy the `server.cfg` lines, and run their first command. `node scripts/activate.js <email> --off` still exists to suspend a tenant by hand (the future Stripe switch).

## FiveM bridge install (customer side)

Copy `fivem-bridge/` into the server's `resources/` as `m2-bridge`, then in `server.cfg`:

```cfg
set airp_backend_url "https://your-app.vercel.app"    # no trailing slash
set airp_bridge_token "brg_..."                        # from the dashboard
ensure m2-bridge
```

The bridge polls `/api/bridge/poll` every 1.5 s (configurable via `airp_poll_interval_ms`), executes whitelisted commands via named handlers, and acks them. 401 = wrong token; 402 = subscription inactive.

## Local development & testing (no real Firebase, no deploy)

Everything runs on the **Firebase Emulator Suite**. Requirements: Node 18+, **Java 11+** (the Firestore emulator is a JAR — install [Temurin](https://adoptium.net) or any JDK/JRE).

```bash
npm install
cp .env.example .env          # set ENCRYPTION_KEY (any 64 hex chars for local)

npm test                      # THE gate: 48 integration tests (auth, pay-gate cycle,
                              # key custody, interpretation + rogue-provider whitelist
                              # proof, queue, error envelope, rate limiting)
npm run smoke:emulator        # the end-to-end story test (15 checks)
npm run seed:emulator         # just the data layer: seed + read back a tenant

# interactive local stack:
npm run emulators             # terminal 1: Auth + Firestore emulators
npm run dev                   # terminal 2: dev server on :3000 (Vercel stand-in)
# set useEmulator: true in app/firebase-config.js, open http://localhost:3000
```

Tests need no keys at all (interpretation falls back to the keyword matcher). Set `TEST_GEMINI_KEY=<real key>` to exercise live Gemini in the smoke run. What the suite proves, file by file: [docs/TESTING.md](docs/TESTING.md).

## Stripe seam (deliberately not built yet)

The `active` boolean is the **only** thing between free and paid. The seam is ready: tenants carry a `subscriptionStatus` field (currently `"manual"`), and [`api/stripe/webhook.js`](api/stripe/webhook.js) is a stub that returns 501. When payments land, that webhook verifies Stripe signatures and sets `active`/`subscriptionStatus` from subscription events — no other code changes. Until then, `scripts/activate.js` is the manual switch.

## Endpoints

Full contract (request/response shapes, the `{ok:false,error:{code,message}}` envelope, all 10 error codes, headers, CORS policy): **[docs/API.md](docs/API.md)**.

| endpoint | auth | notes |
|---|---|---|
| `POST /api/command` | ID token | pay-gate 402 · rate limit 429; `{text, mode}` → run: `{action, params, queued, message}` / ask: `{reply}` |
| `GET /api/bridge/poll` | `x-bridge-token` | 402 if inactive; drains queue, marks inflight, stamps `lastPolledAt` |
| `POST /api/bridge/ack` | `x-bridge-token` | `{ids:[...]}` → deletes |
| `POST /api/signup` | — | creates auth user + tenant (**`active:true` — open access**) |
| `GET /api/tenant/me` | ID token | tenant status **without** the key (+ `lastPolledAt`, `firstCommandAt`) |
| `POST /api/tenant/key` | ID token | encrypts + stores the AI key |
| `POST /api/tenant/rotate-bridge-token` | ID token | new token, old one dies |
| `POST /api/scan` | ID token (verified) | read-only server scan; stores derived report under `scans/{scanId}` — [SCANNER.md](docs/SCANNER.md) |
| `GET /api/scan-status` | ID token (verified) | full report by `scanId`, or scan history |
| `POST /api/stripe/webhook` | — | 501 stub (Stripe seam) |
| `GET /api/health` | — | firestore probe + config booleans, no secrets |

## Repo layout

```
api/          Vercel serverless functions (the platform backend)
app/          static frontend: index.html (site+console), dashboard.html, firebase-config.js
lib/          firebase admin init, firestore accessors, AES-GCM crypto, auth, http spine
lib/serverAccess/  read-only adapter layer for the scanner (zip/scan-pack/dir/bridge/ftp-stub)
lib/scanner/  the read-only Server Scanner (parsers, detectors, checks/, report) — docs/SCANNER.md
lib/whitelist/ the AI Whitelist Officer (interview, scoring, decide) — docs/WHITELIST.md
lib/concierge/ the notify-only in-game Concierge (session, recommend, messages, analytics) — docs/CONCIERGE.md
providers/    gemini.js (forced function calling) · claude.js (stub) · fake.js (test-only) · index.js
tests/        the 243-test suite (node:test × Firebase emulators) — docs/TESTING.md
scripts/      dev-server, seed, activate, smoke-emulator
fivem-bridge/ the Lua resource customers install (server bridge + concierge.lua)
backend/      the original standalone single-tenant demo (Express + Claude) — still works:
              cd backend && npm install && npm start · npm run smoke
firestore.rules · firebase.json · vercel.json · .env.example
```

## Explicitly out of scope — forever

All actions are in-game roleplay events from the closed whitelist. Never to be added: shell/file/OS access, `eval`/dynamic action names, arbitrary HTTP from the bridge, anything affecting other servers or players' machines. New actions go through `actions.js` review: in-game, whitelisted, validated.
