# UI / UX

**Area:** The design system — this file is the style guide · **Last updated:** 2026-08-10

> One system across the marketing site, console, dashboard, and showcase: dark-first surfaces, lime as the single signal color, violet for Ask, pink as tertiary; Space Grotesk display over the system sans; the iridescent orb as the living brand mark; full EN/AR with real RTL; mobile-first with safe-area insets. Anything new must be buildable from this page alone.

---

## Tokens (copy verbatim into any new page)

| token | dark | light | role |
|---|---|---|---|
| `--bg` / `--bg-2` | `#0A0B0E` / `#0C0E12` | `#F4F5F2` / `#FFFFFF` | page ground / shell gradient top |
| `--surface` / `-2` / `-3` | `#15181E` / `#1B1F27` / `#22262F` | `#FFFFFF` / `#F3F4F6` / `#E7E9ED` | cards / inset / segment-on |
| `--line` / `--line-2` | `rgba(255,255,255,.08/.15)` | `rgba(0,0,0,.09/.16)` | borders / focus borders |
| `--text` / `--dim` / `--faint` | `#F4F6F8` / `#9AA1AB` / `#616874` | `#161A20` / `#5B636E` / `#8A929C` | copy hierarchy |
| `--lime` (+`-ink`, `-soft`) | `#C4F042` / `#16240A` / 13% | `#8FBE18` / `#fff` / 15% | THE action color: primary buttons, Run, connected, done |
| `--violet` (+`-soft`) | `#A98BFB` | `#7C5CE6` | Ask mode, answers, "Soon" |
| `--pink` (+`-soft`) | `#F3A5C6` | `#D96BA0` | tertiary accents only |
| `--teal` / `--amber` / `--red` | `#7FE9EE` / `#F2C14E` / `#F0776F` | same | gradients / warn / error+locked |

Theme = `data-theme` on `<html>` (dark default; explicit toggle). **Theme + language persist in `localStorage` (`m2.theme`, `m2.lang`).**

## Type

- **Display** (`--display`): `"Space Grotesk"` 500–700 — headlines, card titles, numerals, brand. Negative tracking on large sizes (−1 to −2.4 px).
- **Body** (`--sans`): system stack ending in `"Noto Sans Arabic"` — UI copy in both languages.
- **Mono** (`--mono`): `ui-monospace/Cascadia/Consolas` — tokens, `server.cfg`, key inputs.
- Inputs are **16 px minimum** (blocks iOS zoom-on-focus).

## The orb (signature — recipe)

Layered radial gradients on a circle, 15 s spin, counter-spinning highlight via `::after` with `mix-blend-mode:screen`:
`radial-gradient(60% 55% at 32% 30%, #7FE9EE …), (72% 32%, #C7A3FF), (66% 74%, #F3A5C6), (30% 72%, #C4F042), #0f1219` + `blur(1px) saturate(1.2)`.
Appears: site hero (112px), auth screens (78px), console hero (104→44px when chatting), listening overlay (160px, scales with mic level), dashboard boot spinner (64px). The favicon is the same gradient as an SVG data-URI — keep it identical on every page.

## Component inventory

- **Cards** — `--surface`, 1px `--line`, radius 17px, padding 18px; staggered entrance (`rise` keyframe, 70ms steps).
- **Pills** — status: dot + label; lime dot glows (`box-shadow: 0 0 7-8px`), red for locked/inactive, no glow.
- **Buttons** — `.btn-p` lime/ink primary; `.btn-g` surface ghost; `.btn-r` red-text danger ghost; radius 11–13px; disabled = 50% + wait cursor.
- **Segments** (`.seg`/`.lng`/`.tabs`/`.mode`) — bordered pill group, active gets lime (mode/lang) or `--surface-3` (neutral).
- **Action badges** — every bot reply opens with a color-coded badge (Vehicle lime / Weather violet / Time pink / …) so outcomes scan at a glance.
- **Status chips** (`.chip2`) — one line under replies: sent-to-server (lime) / didn't-catch (dim) / couldn't-reach + rate-limited (amber) / expired + inactive + error (red). Specific, never generic.
- **Setup checklist** (dashboard hero) — numbered circles flip to lime ✓, done rows get a strikethrough, the next step pulses (`pu` keyframe), gradient progress bar (teal→lime) animates width; each row deep-links to its card with a 1.2s lime ring flash.
- **Notices** (console) — inline card, 3px lime start-border, title + body + dashboard link + ✕ dismiss. Used for "no AI key" and "server not connected". Never a toast, never blocking.
- **Confirm steps** — inline red-bordered block that swaps into the layout (rotate token). Native `confirm()`/`alert()` are banned.
- **Token box** — mono, masked `brg_••••…last4` with reveal-eye and copy; copy buttons flash a ✓ for 1.4s.
- **Net banner** (dashboard) — sticky top strip, red-soft, message + Retry button. Retry re-runs the loader.

## Language & direction

- Every string lives in the page's `I18N.en/.ar` map; markup carries `data-i` / `data-ip` keys. No hardcoded copy.
- `dir="rtl"` flips the whole layout; bubble corner radii and chevrons mirror via `html[dir="rtl"]` rules; **code stays LTR** (`direction:ltr` on token boxes, `server.cfg`, key inputs).
- Arabic is Gulf-flavored and human («ما سمعت شيء — قرّب من المايك», «الاشتراك موقوف») — never literal translation.

## Motion

- One entrance moment per screen: staggered card `rise` / bubble `pop`; 0.35–0.5s ease.
- Continuous motion is reserved for the orb and the listening waveform (26 bars, level-driven).
- `prefers-reduced-motion: reduce` kills all animation globally.

## Interaction rules

- **Run vs Ask is over-communicated**: toggle highlight (lime/violet), send-button color, and user-bubble color all switch together. Mode confusion = executed commands someone thought were questions.
- The pay-gate is a first-class UI state (locked pill, inactive plan card, "View plan →" link on 402 replies) — never a dead end, never a toast.
- Quick commands are full example phrases («أعطني سيارة شرطة») — they teach phrasing while being useful.
- Failure states always say **what happened + what to do next** (retry, dashboard link, sign in again), in the user's language.
- Thumb-first: console shell ≤460px, dashboard ≤560px, sticky bars respect `env(safe-area-inset-*)`.
