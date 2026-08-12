# Frontend

**Area:** Pages, wiring & deploy shape · **Last updated:** 2026-08-10

> A single-page marketing site + auth + console (`app/index.html`), the owner dashboard (`app/dashboard.html`), and one shared config file. No framework, no build step; Vercel serves them as-is next to the `api/` functions.

---

## Pages

| page | URL | purpose |
|---|---|---|
| `app/index.html` | `/` | **one page, three views:** marketing site (hero, features, live demo, pricing, docs, FAQ) → auth modal (sign up / sign in) → operator console (Run/Ask, quick commands, full-screen voice overlay with live waveform, feed, setup notices). Views swap client-side; a persisted session skips straight to the console on load. |
| `app/dashboard.html` | `/dashboard` | owner dashboard **in the same design system**: 4-step setup checklist, AI-key card, server card, **Server Report** card ([SCANNER.md](SCANNER.md)), **Whitelist Officer** card (queue / detail with transcript + evidence + decisions / setup / stats — [WHITELIST.md](WHITELIST.md)), **Concierge** card (enable/tone/check-in setup + live funnel / retention / arrivals-over-time / question themes — [CONCIERGE.md](CONCIERGE.md)), plan card, console + docs links |
| `app/firebase-config.js` | `/firebase-config.js` | ONE paste point for the public Firebase web config (both pages load it) |
| `app/apply.html` | `/apply/{slug}` | **public** Whitelist Officer interview page — no account: welcome, identity, conversational AI interview (EN/AR, voice, localStorage resume), submitted. Reads only `/api/apply/*`. See [WHITELIST.md](WHITELIST.md) |
| `docs/index.html` | `/docs/` | project showcase page (dev server serves it too) |

`app/index.html` is `LOCAL_PREVIEW=false` (production) — sign-in uses the real backend + Firebase Auth, so it needs the deployed site or `npm run dev`; there is no offline demo mode. Rewrites live in `vercel.json` (which also sets the security headers/CSP); `scripts/dev-server.js` mirrors both locally.

> **Static assets need a rewrite.** The pages live under `app/` but load their scripts at the site root (`/fx.js`, `/speech.js`, `/voice.js`, `/firebase-config.js`). The dev-server serves `app/` as the web root automatically, but **Vercel needs one explicit rewrite per root asset** in `vercel.json` (`/voice.js → /app/voice.js`, …). Miss one and it 404s (served as `text/plain`, which the browser refuses to execute). `npm run voice:browser` and `scripts/verify-deployed-routing.js` verify the voice scripts load as `text/javascript` and the loop runs under the real routing.

## Wiring (both pages)

- A `<script type="module">` initializes Firebase Auth from `window.FIREBASE_CONFIG`, exposes `window.__m2Firebase = { signIn, getToken(force), signOut }`, and fires **`m2-auth-ready`** after the first `onAuthStateChanged` — that's the session-persistence handshake the classic script boots on. `useEmulator: true` connects to the Auth emulator (127.0.0.1:9099).
- **Auth flow:** sign-up → `POST /api/signup` (creates the Firebase user + tenant, `active:true`) → Firebase `signIn` → `GET /api/tenant/me`. Sign-in → Firebase `signIn` → `/api/tenant/me`.
- **`authedFetch`** (both pages): fresh ID token per call; on 401 it retries once with a force-refreshed token, then signs out with a translated "session expired".
- Console: `POST /api/command` renders `{action, message, queued}` (Run) or `{reply}` (Ask); envelope codes drive the chips — 402 locked + "View plan →" (`/dashboard#plan`), 429 "wait a minute", BAD_INPUT vs INTERNAL split; network failure → Offline pill + retry copy. Setup notices (no key / server never polled) link to the dashboard and are dismissible.
- Dashboard: `/api/tenant/me` (checklist + last-seen), `/api/tenant/key`, `/api/tenant/rotate-bridge-token`; 45s auto-refresh while open; offline → sticky banner with Retry.
- `LOCAL_PREVIEW` is a UI-preview flag for opening the file with no backend. **`false` in production** — the offline demo path is off.
- Theme + language persist in `localStorage` (`m2.theme`, `m2.lang`) across both pages.
- **Pay-gate is open:** new accounts are `active:true` on signup (no payment); the 402 UI states exist and are E2E-verified for when Stripe re-gates. See [SECURITY.md](SECURITY.md) / [GOAL.md](GOAL.md).

## Voice — the state machine (in + out)

Voice is the product's core promise ("talk to your server"), so it is built as **one explicit state machine** in `app/voice.js` (`window.M2Voice`) that owns recognition + the conversation loop and drives synthesis through the `app/speech.js` driver (`window.M2Speech`). The console only *wires* the machine to the UI (`onState`/`onEvent`/`onError`) and provides the "thinking" step (`handle` → `/api/command` → the speakable reply).

**States & transitions:**

```
idle ──start()──▶ listening ──final result──▶ transcribing ──▶ thinking ──reply──▶ speaking ──done──▶ (listening | idle)
  ▲                  │ silence/no-speech/error          │ error/timeout        │ turn-cap/stopped
  └───────────────── stop() / silence / error / turn-cap ◀──────────────────────┘
```

**Every state has a timeout that lands somewhere safe** (defaults): listening 9s (→ silence → idle), transcribing 4s (→ thinking), thinking 15s (→ visible "took too long" → idle), speaking 23s machine backstop (→ continue). The reply language for both recognition (`ar-AE`/`en-US`) and the spoken voice follows the message, not the UI toggle.

**Guarantees the machine enforces** (learned from real-browser behaviour, not the mock):
- Branches on whether a **final result** arrived — `recognition.onend` fires for success, silence, *and* errors, so onend alone is never trusted.
- **`speechSynthesis.onend` is unreliable** (long text / cancel races / no audio device) — the speech driver arms a length-based **watchdog** so `onDone` always fires; the loop can never hang in "speaking". *(Verified: in headless Edge, real synthesis completed via the watchdog at ~3.2s because onend never fired.)*
- **Never double-starts recognition** — `recognition.start()` throws `InvalidStateError` if already running; every start is guarded and wrapped with abort-then-retry, and the intentional abort's `onend` is suppressed so it isn't misread as silence.
- **Never listens while speaking** — after speech, `cancelAndWait()` polls `speechSynthesis.speaking` (it's async) and a settle delay elapses before the mic reopens, so the assistant never hears itself.
- **Keepalive** `pause()`/`resume()` every 10s defeats Chrome's ~15s auto-pause; utterances are capped regardless.
- **Idempotent `stop()`** from any state: abort recognition, cancel synthesis, clear timers, land in idle; calling it twice is harmless.
- **Barge-in:** while speaking, an echo-cancelled mic analyser watches for the user talking over the assistant → cut speech, listen. Best-effort (a headset is ideal; open speakers may not fully suppress the assistant).

**TTS driver** (`M2Speech`) stays behind a tiny interface so a **premium voice provider can swap in later** without touching the console. It picks a voice matching the reply language (degrading silently if none — with a one-time "no Arabic voice" notice), strips markdown, caps length, and never overlaps. A **Settings** toggle governs auto-speak: *Voice replies — off / when I speak / on* (default: when I speak, `localStorage m2.voice`). Each assistant message has a speaker button for on-demand playback.

**Instrumentation:** a **Voice debug** setting (off by default, `m2.vdebug`) shows a live panel — state, last event, elapsed, recognition language, voices loaded, support flags, last error — and logs every Web Speech event to the console. Every recognition/synthesis error is shown in chat with its code (`not-allowed`, `no-speech`, `network`, `audio-capture`, `service-not-allowed`, `aborted`).

**Real-browser support matrix** (observed):

| Browser | Recognition | Synthesis | Notes |
|---|---|---|---|
| Chrome / Edge (desktop) | ✅ (online, Google/MS backend) | ✅ | Primary target. `onend` for synthesis is flaky → watchdog covers it. Verified end-to-end in Edge via `npm run voice:browser`. |
| Safari (macOS) | ✅ (limited) | ✅ | Works; voice list differs. |
| Firefox | ❌ (`SpeechRecognition` absent) | ✅ | Mic tap shows "voice isn't supported"; **text stays fully functional**; TTS still works. |
| iOS Safari | ⚠️ limited/absent | ✅ (needs a user gesture) | The mic tap is the gesture. Recognition support is inconsistent; degrade to text, spoken replies still play. |
| Insecure origin (http) | ❌ | ❌ | Speech APIs require HTTPS/localhost — the mic tap says so plainly instead of failing. |

**Verification:** `npm run voice:browser` serves the shipped `app/` and drives it in real Edge (CDP + fake-media flags) through a full loop; `tests/voice-machine.test.js` (state machine), `tests/speech.test.js` (driver guarantees), and `tests/console-voice-ui.test.js` (console wiring) cover the logic deterministically.

## Leftovers

`app/app.js`, `app/style.css` are orphaned files from the pre-M2 UI — nothing references them; safe to delete whenever. (`app/voice.js` is **not** a leftover — it is the voice state machine.)
