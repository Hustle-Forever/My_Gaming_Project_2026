# Database

**Area:** Firestore data model & rules · **Last updated:** 2026-08-10

> One document per customer under `tenants/{uid}` (keyed by Firebase Auth uid) plus a `commands` subcollection acting as the per-tenant delivery queue. Clients have zero direct Firestore access — every read/write goes through the API's Admin SDK.

---

## `tenants/{uid}`

| field | type | notes |
|---|---|---|
| `name` | string | server display name (≤80 chars) |
| `active` | bool | **the pay-gate.** Created `true` on signup today (open access, no payment); Stripe flips it later |
| `subscriptionStatus` | string | `"manual"` today — Stripe seam field |
| `provider` | string | `"gemini"` (or `"claude"` once implemented) |
| `providerKeyEnc` | string\|null | customer AI key, AES-256-GCM ciphertext — never plaintext, never sent to any client |
| `bridgeToken` | string | `brg_` + 48 hex chars; the FiveM resource authenticates with this |
| `allowedActions` | string[] | per-tenant whitelist subset (default: all six) |
| `lastPolledAt` | number\|absent | epoch ms of the last bridge poll, **throttled to one write per minute** (a 2.5s-polling bridge would otherwise write 34k times/day). Drives the dashboard "connected / last seen" indicator and checklist step 3 |
| `firstCommandAt` | number\|absent | epoch ms of the first *queued* command (a `none` doesn't count); permanent once set. Checklist step 4 |
| `rlWindowStart` / `rlCount` | number | per-tenant fixed-window rate-limit state, updated transactionally on `/api/command` (`RATE_LIMIT_PER_MIN`, default 30). Lives on the doc so limits hold across serverless instances |
| `rlScanWindowStart` / `rlScanCount` | number | per-tenant scan rate-limit state (`/api/scan`, `SCAN_RATE_LIMIT_PER_HOUR`, default 20) |
| `createdAt` / `updatedAt` | timestamp | server timestamps |

## `tenants/{uid}/commands/{cmdId}`

| field | type | notes |
|---|---|---|
| `action` | string | whitelisted action name |
| `params` | map | validated params |
| `status` | string | `pending` → `inflight` (on poll) → **deleted** (on ack) |
| `createdAt` / `polledAt` | timestamp | |

Lifecycle: `/api/command` writes `pending` → `/api/bridge/poll` batch-marks `inflight` and returns them (oldest first, ≤20) → `/api/bridge/ack` batch-deletes.

## `tenants/{uid}/scans/{scanId}`

Server-scanner reports (see [SCANNER.md](SCANNER.md)). **Derived data only — never raw customer source or secrets.**

| field | type | notes |
|---|---|---|
| `status` | string | `complete` (upload scans finish in-request) |
| `source` | string | `upload` / `bridge` |
| `createdAt` / `createdAtMs` | timestamp / number | |
| `identity` | map | framework/inventory/deps/jobs/items, each with evidence + confidence |
| `health` | map | `{ score 0–100, verdict{en,ar}, counts }` |
| `findings` | array | ranked findings; evidence carries **location** (resource/file/line), never verbatim source (sanitized in `report.js`) |
| `model` | map | structural `serverModel`: resource names/sizes/deps/order + structure flags |

## `rl_ip/{ipHash}`

Per-IP signup throttle counters (`windowStart`, `count`, `expireAt`); keyed by a SHA-256 hash of the client IP — raw IPs are never stored. TTL-ready via `expireAt`.

## Whitelist Officer

See [WHITELIST.md](WHITELIST.md). All applicant data is **personal data**: only owner-configured identity fields are stored, full transcripts never hit application logs, and delete-application is a first-class owner action.

| collection | shape |
|---|---|
| `tenants/{uid}/whitelist/config` | enabled, slug, questions[], criteria[], thresholds, languages[], identityFields[], ageRequired, discordWebhook |
| `tenants/{uid}/applications/{appId}` | identity{}, language, status (in_progress\|submitted\|approved\|rejected\|reinterview), transcript[], scores[] (each with evidence), flags[], summary, recommendation, overall, confidence, decidedBy, decidedAtMs, decisionNote |
| `whitelistSlugs/{slug}` | `{uid}` — unique public slug → tenant |
| `applicationIndex/{appId}` | `{uid}` — private appId → tenant (so the public endpoints never expose the uid) |
| `rl_apply/{ipHash}` | per-IP apply throttle (hashed IP, `expireAt`) |
| `tenants/{uid}` (added) | `rlScanWindowStart/rlScanCount` earlier; whitelist adds no tenant-doc fields |

## The Concierge

See [CONCIERGE.md](CONCIERGE.md). Player data is **minimized then purged**: session docs hold flow state only (never raw chat), and player questions are reduced to a coarse theme before storage. `purgeConciergeData(uid)` drops both collections on the retention window / owner request.

| collection | shape |
|---|---|
| `tenants/{uid}/concierge/config` | enabled (default false), tone, languages[], greeting{}, askPrompt{}, checkinSeconds, retentionDays, features{greet,ask,guide,checkin,introduce}, recommendJobs[] |
| `tenants/{uid}/conciergeSessions/{playerId}` | iv{} (serialized flow state), status (in_progress\|done\|dismissed), phase, language, choiceJobId, arrivedAtMs, stillPlaying, lastPhaseAtMs — **no raw chat** |
| `tenants/{uid}/conciergeEvents` | append-only funnel markers: type (arrived\|greeted\|answered\|reached\|checkin\|still_playing\|returned\|dismissed\|question), playerId, theme? (coarse only), atMs |

## Design choices

- **No composite indexes needed:** the poll query filters on `status` only (single-field, auto-indexed) and sorts client-side by `createdAt`.
- **Bridge lookup** is an equality query on `bridgeToken` (random 51-char value, `limit(1)`).
- **Rules deny everything** (`firestore.rules`): clients can never read `providerKeyEnc` or write `active` because they can't touch Firestore at all. The tenant's own view is served (key stripped) by `GET /api/tenant/me`.
- Swappability: all access goes through `lib/firestore.js` (`getTenant / createTenant / updateTenant / enqueueCommand / drainCommands / ackCommands`) — a different store slots in behind that interface.

## Emulator

`firebase.json` pins Auth :9099 and Firestore :8080, project `demo-m2` (demo prefix = emulator-only, no real project touched). `npm run seed:emulator` proves write/read-back.
