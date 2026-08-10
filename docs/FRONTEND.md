# Frontend

**Area:** Pages, wiring & deploy shape · **Last updated:** 2026-08-10

> Two self-contained static pages — the operator console (`app/index.html`) and the owner dashboard (`app/dashboard.html`) — plus one shared config file. No framework, no build step; Vercel serves them as-is next to the `api/` functions.

---

## Pages

| page | URL | purpose |
|---|---|---|
| `app/index.html` | `/` | operator console: sign in, Run/Ask modes, quick commands, voice input, feed |
| `app/dashboard.html` | `/dashboard` | owner setup: create account, AI key, bridge token + `server.cfg` lines, plan status |
| `app/firebase-config.js` | `/firebase-config.js` | ONE paste point for the public Firebase web config (both pages load it) |
| `docs/index.html` | `/docs/` | project showcase page |

Rewrites live in `vercel.json`; `scripts/dev-server.js` mirrors them locally.

## Wiring (both pages)

- A `<script type="module">` initializes Firebase Auth from `window.FIREBASE_CONFIG` and exposes `window.__mirsalFirebase = { signIn, getToken, signOut }` to the page's classic script. `useEmulator: true` in the config connects to the Auth emulator (127.0.0.1:9099).
- API calls send `Authorization: Bearer <ID token>` (fetched fresh per call via `getToken()` — auto-refresh included).
- Console → `POST /api/command` with `{text, mode}`; renders `{action, message, queued}` (Run) or `{reply}` (Ask); 401 → "session expired", 402 → "subscription inactive".
- Dashboard → `/api/tenant/me`, `/api/tenant/key`, `/api/tenant/rotate-bridge-token`.
- `LOCAL_PREVIEW` (console only) is a UI-preview flag for opening the file with no backend. **Stays `false` in production.**

## Voice

Web Speech API (`SpeechRecognition`), `ar-AE` when the UI language is Arabic, `en-US` otherwise. Transcript fills the box and auto-sends. Needs Chrome/Edge/Safari and HTTPS (or localhost); the mic control degrades gracefully elsewhere.

## Leftovers

`app/app.js`, `app/style.css`, `app/voice.js` are orphaned files from the pre-Mirsal مرسال UI — nothing references them; safe to delete whenever.
