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
| `createdAt` / `updatedAt` | timestamp | server timestamps |

## `tenants/{uid}/commands/{cmdId}`

| field | type | notes |
|---|---|---|
| `action` | string | whitelisted action name |
| `params` | map | validated params |
| `status` | string | `pending` → `inflight` (on poll) → **deleted** (on ack) |
| `createdAt` / `polledAt` | timestamp | |

Lifecycle: `/api/command` writes `pending` → `/api/bridge/poll` batch-marks `inflight` and returns them (oldest first, ≤20) → `/api/bridge/ack` batch-deletes.

## Design choices

- **No composite indexes needed:** the poll query filters on `status` only (single-field, auto-indexed) and sorts client-side by `createdAt`.
- **Bridge lookup** is an equality query on `bridgeToken` (random 51-char value, `limit(1)`).
- **Rules deny everything** (`firestore.rules`): clients can never read `providerKeyEnc` or write `active` because they can't touch Firestore at all. The tenant's own view is served (key stripped) by `GET /api/tenant/me`.
- Swappability: all access goes through `lib/firestore.js` (`getTenant / createTenant / updateTenant / enqueueCommand / drainCommands / ackCommands`) — a different store slots in behind that interface.

## Emulator

`firebase.json` pins Auth :9099 and Firestore :8080, project `demo-mirsal` (demo prefix = emulator-only, no real project touched). `npm run seed:emulator` proves write/read-back.
