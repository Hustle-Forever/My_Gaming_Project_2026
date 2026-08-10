# UI / UX

**Area:** Design system & interaction language · **Last updated:** 2026-08-10

> One design system across console, dashboard, and showcase: dark-first surfaces with a lime signal color, violet for Ask/answers, pink as a tertiary accent; full EN/AR bilingualism with real RTL; the animated orb as the brand's living mark.

---

## Tokens (CSS variables, both themes)

| token | dark | light | role |
|---|---|---|---|
| `--bg` / `--surface(-2/-3)` | `#0A0B0E` / `#15181E`… | `#F4F5F2` / `#FFFFFF`… | ground & cards |
| `--lime` | `#C4F042` | `#AEDC2E` | primary action, Run mode, "connected" |
| `--violet` | `#A98BFB` | `#7C5CE6` | Ask mode, answers |
| `--pink` | `#F3A5C6` | `#D96BA0` | tertiary accents |
| `--amber` / `--red` | `#F2C14E` / `#F0776F` | same | warn / error & locked states |

Theme = `data-theme` on `<html>` (explicit toggle, dark default). Type is the system stack with `Noto Sans Arabic` fallback in-app; the showcase page may use display faces.

## Language & direction

- EN/AR toggle everywhere; `dir="rtl"` flips the whole layout. All copy lives in per-page `I18N` maps — no hardcoded strings in markup (elements carry `data-i18n` keys).
- Arabic copy is Gulf-flavored and human («ما فهمت الطلب», «الاشتراك موقوف») — not literal translation.

## Signature elements

- **The orb** — layered radial-gradient sphere, slow spin; speeds up + lime glow while listening. Appears at login, hero, and (small) during voice capture.
- **Action badges** — every bot reply opens with a color-coded badge (Vehicle/Weather/Time/Heal/NPCs/Repair) so outcomes scan at a glance.
- **Status chips** — one-line state under each reply: sent-to-server / didn't-catch-that / session-expired / couldn't-reach / subscription-inactive. Errors are specific, never generic.
- **Run vs Ask** — mode is visible three ways at once: toggle highlight (lime/violet), send-button color, and user-bubble color. Mode confusion = executed commands someone thought were questions, so it's over-communicated on purpose.

## Interaction rules

- The pay-gate is a first-class UI state (locked pill, inactive copy), not an error toast.
- Quick commands are full example phrases (e.g. «أعطني سيارة شرطة») — they teach the phrasing while being useful.
- Everything is thumb-reachable mobile-first; the console is a single-column shell ≤460px, dashboard ≤560px.
