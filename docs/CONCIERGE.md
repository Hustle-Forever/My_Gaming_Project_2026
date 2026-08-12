# The Concierge

**Area:** in-game AI onboarding — the first five minutes a new player ever spends on the server · **Last updated:** 2026-08-12

> FiveM's retention death spiral: a new player spawns into an empty street, has no idea what to do, and leaves inside five minutes — so the server looks dead, so the next arrival leaves too. The Concierge greets every newcomer the moment they join, asks what character they want to be, drops a waypoint to a matching destination, points out a nearby player, and checks back in around the five-minute mark — in **Arabic or English**. It is **notify-only** by construction: it can send a message, open a menu, or set a waypoint, and nothing else. No account, no server file access, demoable today.

---

## The safety contract (the whole point)

The Concierge touches a live server full of players, so its power is deliberately tiny. There is a **closed action set of exactly three verbs**:

- `send_message` — a chat line to one player (≤240 chars)
- `show_menu` — a client-rendered choice list
- `set_waypoint` — a marker on that player's own map

It can **never** spawn, teleport, give money/items, change jobs, kick, ban, or write a file. This is enforced in three independent places, so no single bug can widen it:

1. **The AI schema** (`providers/gemini.js`) — forced function calling whose enum only contains the three verbs; the model literally cannot name a fourth.
2. **The message layer** (`lib/concierge/messages.js`) — `sanitizeActions` drops anything not in `ACTIONS` after the brain runs, whatever it returned.
3. **The runtime** (`lib/concierge/runtime.js`) — a final `closed()` filter before any action leaves the endpoint.
4. **The bridge** (`fivem-bridge/concierge.lua`) — only ever calls `TriggerClientEvent` / `chatMessage` / `SetNewWaypoint`; a static test greps the file and fails if a single write/spawn/teleport/give primitive appears.

## Flow

`greet → choose → guide → await_checkin → checkin → done` (with `dismissed` / `expired` reachable at any time; feature flags skip phases). The player joins → greeting + a "what do you want to be?" menu → they pick (or type) → a waypoint to a matching destination + one nearby player to say hi to → ~5 min later a single check-in → done. Hard caps: **≤8 messages** and **≤30 min** per onboarding, so it can never nag. A **dismissed** player is left alone; a **returning** player who already onboarded is not re-onboarded (unless absent ~1 year).

## Engines (pure, provider-injected, offline-capable)

- `lib/concierge/config.js` — `DEFAULTS` (disabled by default), `validateConfig` (tone ∈ serious/casual/neutral, languages must include a base, check-in 60–1800s, retention 1–365 days), `runtimeView`.
- `lib/concierge/session.js` — the per-player state machine. Pure, serializable (`serialize`/`restore` for resume across polls), transcript-free, hard-capped. It owns the *flow*; it never talks to a model or the network.
- `lib/concierge/recommend.js` — reads the read-only **scanner** report (`report.identity.jobs`) to recommend real destinations on *this* server, with a bilingual `KNOWN` fallback (police/ambulance/mechanic/taxi/civilian…) and `pickNearbyPlayer`.
- `lib/concierge/messages.js` — the closed action set, `buildReply` (runs the brain then **always** sanitizes), and deterministic `fallbackActions` per phase so it works with **no AI key at all**.
- `lib/concierge/personality.js` + `brain.js` — tone-aware system prompt + the provider brain (decrypts the tenant key, or returns `null` → deterministic fallback).
- `lib/concierge/analytics.js` — pure aggregation of the funnel events into the owner's numbers (below).

The cheapest model, `maxOutputTokens: 300`, temperature 0.4 — cost is bounded by the message cap, not the model.

## API

**Bridge (x-bridge-token auth + pay-gate + envelope):**
- `POST /api/concierge/event` `{type: join|choice|message|dismiss, playerId, playerName?, jobId?, text?, language?}` → `{onboard, actions[]}` (closed set only). Disabled concierge → `{onboard:false, actions:[]}`; inactive plan → 402.
- `POST /api/concierge/reply` `{playerId}` → `{actions[]}` — the bridge polls this on the existing outward loop for the time-triggered check-in. No new ports.

**Owner (verified auth + pay-gate + envelope):**
- `GET/POST /api/concierge/config` — read/update the setup.
- `GET /api/concierge/stats` — the aggregated funnel/retention/arrivals/themes.

The whole group is one Vercel function (`api/concierge/[action].js` dispatches to `_config`/`_event`/`_reply`/`_stats`), keeping the Hobby 12-function budget (11/12).

## Owner dashboard

The **Concierge** card in `app/dashboard.html`: enable toggle, tone, check-in-delay slider, and a live read-out — the onboarding **funnel** (arrived → greeted → answered → reached → checked-in), **retention** tiles (stayed 10+ min, came back, retention %), **arrivals over time** bars, and ranked **question themes**. Design-system styled, EN/AR (full RTL), 380px mobile-first, with an empty state for fresh tenants.

## Data & privacy (minimize, then purge)

`tenants/{uid}/concierge/config`, `tenants/{uid}/conciergeSessions/{playerId}` (flow state only — phase, language, chosen job, timers; **no raw chat**), and append-only `tenants/{uid}/conciergeEvents` (funnel markers: arrived/greeted/answered/reached/checkin/still_playing/returned/dismissed, plus a **coarse question theme** — never the player's words). `purgeConciergeData(uid)` drops both collections for the retention window / owner request. Firestore rules stay deny-all; everything flows through the API. Player chat is relayed for a reply and reduced to a theme — it is never stored verbatim.

## Tests

`tests/concierge-{config,session,recommend,message,bridge,analytics,ui}.test.js` — 46 tests: config validation, the state machine + caps + returning-player logic, scanner-driven recommendations, the closed action set (incl. a mock-bridge join→greeting→choice→waypoint→ack e2e and a **static grep proving the Lua has no write/spawn/teleport/give primitive**), pure funnel aggregation against a fixed cohort, and jsdom renders of the dashboard section (funnel/retention/arrivals/themes, empty state, EN/AR). See [TESTING.md](TESTING.md).

## Not verified here / left for the human

Live Gemini replies (the deterministic fallback is what tests exercise — set a real key for the AI path). A real FiveM server round-trip (a mock bridge stands in; the Lua is static-analysed, not run in-game). A browser screenshot of the dashboard section (the `chrome-devtools` daemon is broken in this environment; jsdom render tests stand in).
