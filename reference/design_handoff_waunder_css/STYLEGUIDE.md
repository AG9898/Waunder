# Waunder — Styleguide & Visual Direction

A quiet, warm, utilitarian interface for a single-user job-application
assistant. It should feel like a focused personal operations tool — dense enough
for daily repeated use, calm, and personal. Not a marketing site.

---

## 1. Principles

1. **Quiet over loud.** Color is restrained; structure comes from spacing and
   hairlines, not from boxes inside boxes. No hero sections, no gradient
   decoration, no orbs.
2. **Warm & personal.** Warm paper background, soft generous rounding, a humanist
   sans. The accent is a calm sage green, not a saturated brand blue.
3. **Utilitarian rhythm.** Tiny uppercase section labels give an ops-tool cadence
   without shouting. Numbers (match scores) use tabular figures.
4. **Dense but breathable.** Tight enough to scan a feed quickly; never cramped.
5. **One elevation level.** Cards are used only for list rows and discrete items
   (contacts, answers). Detail screens use hairlines + spacing, never nested
   cards.

---

## 2. Color

The palette is warm paper + sage, anchored on the existing PWA theme color
`#2d2c2c` (used as primary ink).

| Role | Hex | Notes |
|---|---|---|
| Paper (page) | `#f4efe8` | warm, low-glare background |
| Surface | `#fbf8f3` | cards & inputs, a touch lighter than paper |
| Sunken | `#ece5da` | read-only wells (autofill, read-only message) |
| Ink | `#2d2c2c` | primary text — matches PWA `ThemeColor` |
| Ink soft | `#5d584f` | secondary text, body copy on detail screens |
| Ink faint | `#8c8579` | labels, meta, placeholders |
| Hairline | `#e4dccd` | section dividers, card borders |
| Hairline strong | `#d4c9b6` | input borders |
| **Sage** | `#5e7d6a` | primary action, links, positive accent |
| Sage strong | `#4c6a58` | hover/active |
| Sage soft | `#e7ede7` | score pills, link wash, button hover fill |
| Sage ink | `#3a5446` | text on sage-soft |
| Danger | `#a8533f` / soft `#f4e3dc` / ink `#843d2c` | warm clay, not a fire-engine red |
| Success | `#4c6a58` / soft `#e3ece4` / ink `#36513f` | a deeper sage family |

**Usage rules**
- Sage is the only chromatic accent for actions. Don't introduce blues/purples.
- Status colors (danger/success) appear only in messages and red-flag bullets —
  never as decoration.
- Match scores are intentionally **quiet**: a single sage-soft pill for every
  value and status. We do not color-code high vs. low scores (avoids a noisy,
  judgmental feed).

---

## 3. Typography

**Hanken Grotesk** throughout — a warm, friendly humanist sans that stays highly
legible at small sizes. (Self-host for the offline PWA shell; keep the family
name so nothing else changes.)

| Token | px | Weight | Used for |
|---|---|---|---|
| `--text-xl` | 28 | 700 | login wordmark |
| `--text-lg` | 22 | 700 | screen titles (`h1`) |
| `--text-md` | 17 | 600 | row titles, route type, contact name |
| `--text-base` | 15 | 400 | body copy, inputs, list items |
| `--text-sm` | 13 | 500–600 | meta, field labels, back links |
| `--text-xs` | 12 | 600 | uppercase section labels, score pills |

- **Section labels** (`h2` on detail/draft/profile): 12px, 600, uppercase,
  letter-spacing `.07em`, faint ink. This is the signature "ops tool" detail.
- **Body line-height** `1.55`; titles `~1.2` with slight negative tracking.
- Numbers use `font-variant-numeric: tabular-nums`.

---

## 4. Shape, spacing & elevation

- **Rounding (medium-soft):** 8 / 12 / 16 / 22 px, plus pill (999). Inputs &
  buttons 12; cards & panels 16; the system uses 22 for large containers. This
  is the source of the warm, personal feel — be generous, never sharp.
- **Spacing scale:** 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40. Sections on detail
  screens are separated by `20px` vertical padding + a 1px hairline.
- **Elevation:** one soft, warm-tinted shadow for resting cards
  (`--shadow-sm`) and a slightly deeper one on hover (`--shadow-md`). Shadows are
  low-contrast — warmth, not drama. No hard drop shadows.

---

## 5. Components

- **Primary button** — sage fill, white text, `radius 12`, `padding 12px 22px`,
  600. Hover → `#4c6a58`; active → nudge down 1px. Full-width on mobile forms,
  auto width ≥768px. Disabled/loading → `opacity .55`, `cursor: progress`.
- **Secondary / outline button** — surface fill, 1px strong-hairline border, ink
  text. Used for "Turn off notifications", "Copy draft". In-flow action links
  (`job-route-link`, `job-contacts-link`) are outline buttons in **sage**.
- **Inputs / textareas** — surface fill, 1px strong-hairline border, `radius 12`.
  Focus: sage border + 3px sage focus ring. Textareas `min-height 104px`,
  vertically resizable.
- **List row card** — surface fill, hairline border, `radius 16`, soft shadow;
  grid `1fr auto` with a score pill on the right; lifts on hover.
- **Score pill** — sage-soft fill, sage-ink text, pill radius, tabular nums.
- **Status messages** — danger/success soft-background pills, `radius 12`.
- **Section** (detail/draft/profile) — top hairline + 20px padding + tiny
  uppercase label. Never wrap these in cards.
- **Sunken panel** — used once per screen at most (approve-and-submit block,
  read-only outreach message): `#ece5da` fill, `radius 16`.

---

## 6. Interaction & motion

- Transitions are short and unfussy: `~140ms ease` for color/shadow/transform.
- Hover lifts list cards `1px` and deepens the shadow; outline buttons gain a
  sage wash; primary buttons darken.
- Focus is always visible (`:focus-visible`) with the sage ring — accessibility
  first on a tool used every day.
- Loading uses a gentle opacity pulse, not a spinner.

---

## 7. Don'ts (from the brief)

- ✗ No large hero sections.
- ✗ No gradient blobs / orbs / decorative gradients.
- ✗ No nested card-heavy layouts — one elevation level, hairlines for the rest.
- ✗ No new framework (React/Tailwind/MUI). Plain CSS on the go-app classes.
- ✗ No emoji as UI.
- ✗ Don't color-code scores or over-decorate with stats/icons.

---

## 8. Extending the system

- **New screen?** Give its root the page-container treatment (centered column,
  `--page-max`, `--page-pad`) and lead with a 22px `h1`. Group content with tiny
  uppercase `h2` labels + hairlines.
- **New action?** Primary = sage fill; secondary/destructive-adjacent = outline.
  Keep one primary per view where possible.
- **New status?** Reuse the danger/success soft-pill pattern; don't add new hues.
- **A nav bar, if ever added** — it isn't in the current components. Keep it
  quiet: paper or surface background, sage active state, no heavy chrome.
