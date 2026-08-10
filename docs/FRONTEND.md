# Frontend

**Area:** Pages, wiring & deploy shape · **Last updated:** 2026-08-10

> A single-page marketing site + auth + console (`app/index.html`), the owner dashboard (`app/dashboard.html`), and one shared config file. No framework, no build step; Vercel serves them as-is next to the `api/` functions.

---

## Pages

| page | URL | purpose |
|---|---|---|
| `app/index.html` | `/` | **one page, three views:** marketing site (hero, features, live demo, pricing, docs, FAQ) → auth modal (sign up / sign in) → operator console (Run/Ask, quick commands, full-screen voice overlay with live waveform, feed). Views swap client-side; no navigation. |
| `app/dashboard.html` | `/dashboard` | owner setup: create account, AI key, bridge token + `server.cfg` lines, plan status |
| `app/firebase-config.js` | `/firebase-config.js` | ONE paste point for the public Firebase web config (both pages load it) |
| `docs/index.html` | `/docs/` | project showcase page |

`app/index.html` is `LOCAL_PREVIEW=false` (production) — sign-in uses the real backend + Firebase Auth, so it needs the deployed site or `npm run dev`; there is no offline demo mode. Rewrites live in `vercel.json`; `scripts/dev-server.js` mirrors them locally.

Note: `app/app.js`, `app/style.css`, `app/voice.js` are dead leftovers from the earlier standalone console — nothing loads them.

## Wiring (both pages)

- A `<script type="module">` initializes Firebase Auth from `window.FIREBASE_CONFIG` and exposes `window.__mirsalFirebase = { signIn, getToken, signOut }` to the page's classic script. `useEmulator: true` in the config connects to the Auth emulator (127.0.0.1:9099).
- **Auth flow (index + dashboard):** sign-up → `POST /api/signup` (creates the Firebase user + tenant) → Firebase `signIn` for the ID token → `GET /api/tenant/me` for name + active. Sign-in → Firebase `signIn` → `/api/tenant/me`. This is the correction to the shipped `index.html`, which originally POSTed to a non-existent `/auth/login` and expected the backend to mint tokens.
- API calls send `Authorization: Bearer <ID token>` (fetched fresh per call via `getToken()` — auto-refresh included).
- Console → `POST /api/command` with `{text, mode}`; renders `{action, message, queued}` (Run) or `{reply}` (Ask); 401 → "session expired", 402 → "subscription inactive" (not reached today — see pay-gate note below).
- Dashboard → `/api/tenant/me`, `/api/tenant/key`, `/api/tenant/rotate-bridge-token`.
- `LOCAL_PREVIEW` is a UI-preview flag for opening the file with no backend. **`false` in production** — the offline demo path is off.
- **Pay-gate is open:** new accounts are `active:true` on signup (no payment), so the 402 path isn't hit in normal use. See [SECURITY.md](SECURITY.md) / [GOAL.md](GOAL.md).

## Voice

Web Speech API (`SpeechRecognition`), `ar-AE` when the UI language is Arabic, `en-US` otherwise. Transcript fills the box and auto-sends. Needs Chrome/Edge/Safari and HTTPS (or localhost); the mic control degrades gracefully elsewhere.

## Leftovers

`app/app.js`, `app/style.css`, `app/voice.js` are orphaned files from the pre-Mirsal مرسال UI — nothing references them; safe to delete whenever.
