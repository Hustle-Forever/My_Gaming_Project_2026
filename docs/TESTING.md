# Testing

**Area:** What is proven, how to run it, and what each test guards · **Last updated:** 2026-08-12

> One command — `npm test` — boots the Firebase emulators and runs **185 tests**: 48 platform, 40 Server Scanner, 51 Whitelist Officer, and 46 Concierge. No mocks of our own code: HTTP tests talk to a spawned dev-server backed by emulator Auth + Firestore, exactly like production traffic.

---

## Running

```bash
npm test                 # the suite: 185 tests (needs Java ≥11 for the Firestore emulator)
npm run smoke:emulator   # the original 15-check end-to-end story, kept as a second opinion
cd backend && npm run smoke   # legacy standalone demo (7 checks)
```

`npm test` = `firebase emulators:exec --only auth,firestore "node --test tests/*.test.js"`. Each test file boots its own dev-server on a pid-derived port, so files run in parallel without collisions. The node test runner prints the pass/fail summary.

## Layout

```
tests/helpers.js        server boot, unique accounts, sign-in via emulator REST,
                        token refresh, api() helper, admin access for arranging state
tests/auth.test.js      signup→tenant, token accepted, 401 matrix, refresh path,
                        EMAIL_UNVERIFIED gate + verify-then-refresh unlock
tests/paygate.test.js   deactivate→402→reactivate→re-block cycle; ack stays open
tests/keys.test.js      encryption at rest, round-trip, response-body leak scan
tests/interpret.test.js AR/EN/diacritics/digits mapping; none queues nothing;
                        ROGUE-PROVIDER whitelist proof; per-tenant allowlist
tests/queue.test.js     poll-once/ack lifecycle, rotation, ask queues nothing,
                        lastPolledAt throttle, firstCommandAt permanence
tests/envelope.test.js  every error code returns the documented envelope
tests/hardening.test.js security headers, CSP on HTML, same-origin CORS,
                        64KB payload cap, secret-free health detail
tests/ratelimit.test.js per-tenant fixed window, isolation between tenants,
                        per-IP signup throttle
tests/scanner-access.test.js  read-only adapters, safety caps, zip-slip, cleanup
tests/scanner-model.test.js   parseManifest / parseServerCfg (exec) / resource graph
tests/scanner-detect.test.js  framework/inventory/deps/jobs/items; ambiguous→unknown
tests/scanner-checks.test.js  broken surfaces all planted faults; clean stays clean
tests/scanner-api.test.js     /api/scan + status (auth/verify/gate/rate/store); bridge read-only
tests/scanner-ui.test.js      jsdom drives the real dashboard render (EN/AR/filter/no-leak)
tests/whitelist-config.test.js   config validation, defaults, unique slugs, auth/gate
tests/whitelist-interview.test.js  interview state machine (follow-up cap, resume, EN/AR)
tests/whitelist-score.test.js    evidence-mandatory, deterministic flags, BIAS guard, decide()
tests/whitelist-apply.test.js    public flow e2e (EN/AR, resume, one-per-identity, rate limit, privacy)
tests/whitelist-apply-ui.test.js jsdom render of app/apply.html (welcome→interview→submitted)
tests/whitelist-review.test.js   owner queue/detail/decide/delete/stats, cross-tenant scoping
tests/whitelist-ui.test.js       jsdom render of the dashboard Whitelist section (EN/AR)
tests/whitelist-notify.test.js   Discord webhook interface (no-op unconfigured, rejects bad URL)
tests/concierge-config.test.js   config validation (tone/languages/check-in/retention), defaults, runtimeView
tests/concierge-session.test.js  onboarding state machine, message + duration caps, returning-player logic
tests/concierge-recommend.test.js scanner-report-driven job/destination recommendation + nearby player
tests/concierge-message.test.js  the CLOSED action set, sanitize-through-closed, deterministic no-key fallback
tests/concierge-bridge.test.js   bridge e2e (join→greeting→choice→waypoint→ack), auth/gate, /stats, LUA static grep
tests/concierge-analytics.test.js pure funnel/retention/arrivals/themes aggregation over a fixed cohort
tests/concierge-ui.test.js       jsdom render of the dashboard Concierge section (charts, empty state, EN/AR)
```

## What each area proves

1. **Auth** — signup creates the tenant **active:true** (open access, no payment — a deliberate product decision; the task's original `active:false` expectation is superseded). All protected endpoints 401 without a token; the refresh-token → new ID token → API-accepts path works (the console's silent 401 retry rests on this).
2. **Pay-gate mechanism** — even with open signup, the gate itself is exercised end-to-end: deactivation 402s command *and* poll, reactivation restores both, deactivation re-blocks, and ack remains un-gated so in-flight commands settle. Stripe can flip one boolean and everything gates again.
3. **Key handling** — ciphertext ≠ plaintext, AES-GCM round-trips, and a scan of every endpoint's response body proves neither the key nor `providerKeyEnc` ever leaves the server.
4. **Interpretation** — «ابغى سيارة شرطة» → `spawn_vehicle{police}`; "make it rain" → `set_weather{rain}`; the diacritics case «صلّح سيارتي» → `repair_vehicle`; Arabic-Indic digits «خل الساعة ٥» → `set_time{5}`; «كم الساعة في طوكيو» → `none` with an empty queue.
5. **The whitelist guarantee** (the test that must fail loudly if the product's core promise breaks): a test-only `fake` provider returns `give_server_admin` — the response is `none` and **the queue is asserted empty**. A control test proves the fake provider is genuinely consulted (a valid action from it *is* queued), so the rogue test can't pass vacuously. A third case proves an illegal *param* (non-whitelisted vehicle model) also dies at the gate.
6. **Queue lifecycle** — poll delivers once (`inflight`, no double delivery), ack deletes, rotation kills the old token instantly, ask mode never queues.
7. **Error envelope** — each code (`BAD_INPUT`, `AUTH_REQUIRED`, `PLAN_INACTIVE`, `NOT_FOUND`, `METHOD_NOT_ALLOWED`, `EMAIL_TAKEN`, `PAYLOAD_TOO_LARGE`, `RATE_LIMITED`, `NOT_IMPLEMENTED`) returns the exact `{ok:false,error:{code,message}}` shape from the exact endpoint that should produce it.
8. **Rate limiting** — command #limit+1 within the window → 429 `RATE_LIMITED`; a second tenant is unaffected; ask mode counts (it spends provider money too). Signup: limit+1 from one IP → 429 while other IPs pass.
9. **Email verification** — an unverified account gets 403 `EMAIL_UNVERIFIED` on *every* human endpoint; after the admin flips the flag, the **stale** token stays blocked (the claim lives in the token itself) and only a refreshed token unlocks — exactly the client's continue-button flow. Test helpers create verified users by default; `{verified:false}` opts into the gate, and every test signup presents a unique synthetic IP so the shared emulator's signup throttle never trips on suite volume.

10. **Server Scanner** (40 tests, pure — no emulator) — the access layer's read-only guarantee and safety caps; parsers and detection against the four fixture servers (including ambiguous→unknown); the **broken fixture surfacing every planted fault while clean fixtures stay clean** (the headline scanner test); the scan API end-to-end (auth + verified email + pay-gate + rate limit + Firestore storage with **no raw source stored**); the **bridge read-only static assertion**; and a jsdom render of the actual dashboard Server Report code in EN + AR (RTL) with filtering and a no-secret-leak check. The last one is the durable stand-in for a browser screenshot.
11. **Whitelist Officer** (51 tests) — config validation + unique slugs; the interview state machine (follow-up cap, resume-after-drop, EN/AR); **evidence-mandatory scoring** (evidence-free scores rejected), deterministic flags (copy-paste/hostile/dodge/underage), the confidence-gated `decide()`, and the **bias guard** (equivalent AR/EN answers treated identically); the full public applicant flow end-to-end (EN/AR interviews, resume, one-per-identity, per-IP rate limit, and a privacy check that the public config leaks no uid/criteria/webhook); the owner review flow (queue/detail/decide/delete/stats, cross-tenant scoping); jsdom renders of both `apply.html` and the dashboard section; and the Discord webhook interface.

## Conventions

- **TDD:** new backend behavior lands as a red test first (`node --test` under the emulators), then the minimal implementation, then green. The rogue-provider control test exists specifically so the headline safety test can never silently stop testing.
- Tests arrange privileged state (deactivating tenants, wiring the fake provider, reading ciphertext) through the Admin SDK via `tests/helpers.js adminLibs()` — the public API deliberately refuses those operations.
- Keep `scripts/smoke-emulator.js` green too; it's the readable end-to-end narrative (health → signup → key → command → bridge → rotation → deactivation).
- Frontend behavior (session persistence, checklist, failure states) is verified with a driven real browser at 380–390 px; see DAILY_PROGRESS 2026-08-10 for the exact sweep.
