# Frontend

**Area:** Pages, wiring & deploy shape · **Last updated:** 2026-08-10

> A single-page marketing site + auth + console (`app/index.html`), the owner dashboard (`app/dashboard.html`), and one shared config file. No framework, no build step; Vercel serves them as-is next to the `api/` functions.

---

## Pages

| page | URL | purpose |
|---|---|---|
| `app/index.html` | `/` | **one page, three views:** marketing site (hero, features, live demo, pricing, docs, FAQ) → auth modal (sign up / sign in) → operator console (Run/Ask, quick commands, full-screen voice overlay with live waveform, feed, setup notices). Views swap client-side; a persisted session skips straight to the console on load. |
| `app/dashboard.html` | `/dashboard` | owner dashboard **in the same design system**: 4-step setup checklist, AI-key card, server card (masked token, `server.cfg` copy, inline rotate confirm, live last-seen), **Server Report** card (read-only scanner: folder picker → health gauge + identity + filterable findings + resource table + export + history — see [SCANNER.md](SCANNER.md)), plan card (`#plan` anchor), console + docs links |
| `app/firebase-config.js` | `/firebase-config.js` | ONE paste point for the public Firebase web config (both pages load it) |
| `docs/index.html` | `/docs/` | project showcase page (dev server serves it too) |

`app/index.html` is `LOCAL_PREVIEW=false` (production) — sign-in uses the real backend + Firebase Auth, so it needs the deployed site or `npm run dev`; there is no offline demo mode. Rewrites live in `vercel.json` (which also sets the security headers/CSP); `scripts/dev-server.js` mirrors both locally. The old `app/app.js`/`style.css`/`voice.js` leftovers are deleted.

## Wiring (both pages)

- A `<script type="module">` initializes Firebase Auth from `window.FIREBASE_CONFIG`, exposes `window.__mirsalFirebase = { signIn, getToken(force), signOut }`, and fires **`mirsal-auth-ready`** after the first `onAuthStateChanged` — that's the session-persistence handshake the classic script boots on. `useEmulator: true` connects to the Auth emulator (127.0.0.1:9099).
- **Auth flow:** sign-up → `POST /api/signup` (creates the Firebase user + tenant, `active:true`) → Firebase `signIn` → `GET /api/tenant/me`. Sign-in → Firebase `signIn` → `/api/tenant/me`.
- **`authedFetch`** (both pages): fresh ID token per call; on 401 it retries once with a force-refreshed token, then signs out with a translated "session expired".
- Console: `POST /api/command` renders `{action, message, queued}` (Run) or `{reply}` (Ask); envelope codes drive the chips — 402 locked + "View plan →" (`/dashboard#plan`), 429 "wait a minute", BAD_INPUT vs INTERNAL split; network failure → Offline pill + retry copy. Setup notices (no key / server never polled) link to the dashboard and are dismissible.
- Dashboard: `/api/tenant/me` (checklist + last-seen), `/api/tenant/key`, `/api/tenant/rotate-bridge-token`; 45s auto-refresh while open; offline → sticky banner with Retry.
- `LOCAL_PREVIEW` is a UI-preview flag for opening the file with no backend. **`false` in production** — the offline demo path is off.
- Theme + language persist in `localStorage` (`m2.theme`, `m2.lang`) across both pages.
- **Pay-gate is open:** new accounts are `active:true` on signup (no payment); the 402 UI states exist and are E2E-verified for when Stripe re-gates. See [SECURITY.md](SECURITY.md) / [GOAL.md](GOAL.md).

## Voice

Web Speech API (`SpeechRecognition`), `ar-AE` when the UI language is Arabic, `en-US` otherwise. Transcript fills the box and auto-sends. Needs Chrome/Edge/Safari and HTTPS (or localhost); the mic control degrades gracefully elsewhere.

## Leftovers

`app/app.js`, `app/style.css`, `app/voice.js` are orphaned files from the pre-Mirsal مرسال UI — nothing references them; safe to delete whenever.
