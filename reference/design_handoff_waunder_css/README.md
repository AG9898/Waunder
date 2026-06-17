# Handoff: Waunder — UI theme & stylesheet

## Overview
Waunder is a single-user, mobile-first PWA job-application assistant. Its
frontend is **Go + go-app compiled to WebAssembly** — UI is built from Go
components that emit plain HTML elements with CSS classes (`.Class("…")`). There
is **no React/Vue/Tailwind layer**.

This handoff delivers a complete visual direction and a production-ready
stylesheet that styles the existing component classes. The look is **quiet,
warm, and utilitarian**: warm paper, a sage-green accent, charcoal ink, soft
rounded corners, and a humanist sans. It is built for repeated daily use, not
marketing.

## About the design files
The files in `screens/` and `Waunder UI.dc.html` are **design references** —
HTML that frames the real component markup so you can see the intended look.
**They are not the thing you ship.** The thing you ship is **`app.css`**.

The production task is simply:

1. Place `app.css` at `web/web/app.css` in the Waunder repo.
2. Confirm it is loaded by go-app:
   ```go
   mux.Handle("/", &app.Handler{
       // …
       Styles: []string{"/web/app.css"},
   })
   ```
3. That's it — the Go components already emit the class names `app.css` targets.
   No markup changes are required for any screen in this bundle.

You should **not** rebuild these screens in React or any other framework. The
existing go-app components are the source of truth for markup; `app.css` is the
source of truth for style.

## Fidelity
**High-fidelity.** Final colors, typography, spacing, radii, shadows, and
interaction states. The screenshots in `screenshots/` are the intended result of
applying `app.css` to the current components, captured at a 390px mobile width.

## How the app is structured (context)
go-app routes each path to one component that renders a single top-level `<div>`
(`.digest`, `.job-list`, `.job-detail`, …) straight into the page. **There is no
persistent nav bar or tab bar** — navigation is via in-page links (back links,
"View contacts and outreach", etc.). `app.css` therefore treats each screen root
as the page container (centered column, max-width, padding). If you later add a
nav chrome component, it will need its own classes/styles.

Routes (from `web/main.go`):

| Path | Component | Screen file |
|---|---|---|
| `/` | `DigestView` | `screens/digest.html` |
| `/login` | `Login` | `screens/login.html` |
| `/jobs` | `JobList` | `screens/jobs.html` |
| `/jobs/:id` | `JobDetailView` | `screens/job-detail.html` |
| `/jobs/:id/contacts` | `ContactsView` | `screens/contacts.html` |
| `/jobs/new` | `ManualEntry` | `screens/manual-entry.html` |
| `/applications/:id` | `DraftReview` | `screens/draft-review.html` |
| `/profile` | `ProfileView` | `screens/profile.html` |

---

## Screens / Views

> Measurements below reference the design tokens in `app.css` (see **Design
> tokens**). Where a literal is given, it is the resolved value of that token.

### 1. Daily digest — `DigestView` (`/`)
- **Purpose:** Landing screen; the day's surfaced jobs.
- **Layout:** Screen root `.digest` — centered column, `max-width 720px`, padding
  `24px 20px 40px`. Title `h1` "Daily digest" (22px/700). `.digest-body` is a
  flex column, `gap 16px`. `.digest-date` is a 13px faint meta line.
- **Components:**
  - `.digest-items` → `<ul>`, list-reset, flex column, `gap 12px`.
  - `.digest-link` (the `<a>` inside each `.digest-item`) → a soft card:
    `background #fbf8f3`, `border 1px #e4dccd`, `radius 16px`, `padding 16px 20px`,
    `box-shadow` soft (`--shadow-sm`). CSS grid: `1fr auto`. Hover lifts
    `translateY(-1px)` + `--shadow-md` + border darkens to `#d4c9b6`.
  - `.job-title` (span): 17px/600. `.job-company` (span): 13px, `#5d584f`.
  - `.job-score` (span): pill, `radius 999px`, `background #e7ede7`,
    `color #3a5446`, 12px/600, tabular-nums, right-aligned & vertically centered.
    Also renders status text ("Scoring…", "Not scored") in the same pill.

### 2. Jobs feed — `JobList` (`/jobs`)
- **Purpose:** Full scored feed.
- **Layout / components:** Same row treatment as the digest — `.job-list-items`,
  `.job-list-item`, `.job-list-link` mirror the digest classes exactly.

### 3. Job detail — `JobDetailView` (`/jobs/:id`)
- **Purpose:** Full scored view of one job + how to apply.
- **Layout:** `.job-detail` page container. `.job-detail-back` ("← Jobs") is a
  13px/600 soft-ink back link, `margin-bottom 20px`, hovers to sage.
  `.job-detail-body` is a flex column.
- **Components:**
  - `h1.job-title` 22px/700; `p.job-company` 15px `#5d584f`.
  - `p.job-score` ("Match: 88%") → sage pill, `align-self flex-start`,
    `white-space nowrap`, `margin-bottom 20px`.
  - `p.job-summary` 15px `#5d584f`.
  - `.job-relevant` / `.job-missing` / `.job-red-flags` → sections separated by a
    `1px #e4dccd` top hairline, `padding 20px 0`. Each `h2` is a tiny uppercase
    label (12px/600, `#8c8579`, letter-spacing .07em). `<ul>` items are
    list-reset with a 6px dot bullet: sage for relevant, faint for missing,
    danger (`#a8533f`) for red flags.
  - `p.job-alignment`, `p.job-strategy` → hairline-topped paragraphs, `#5d584f`.
  - `.job-route` section: `h2` "How to apply"; `p.job-route-type` 17px capitalized;
    `a.job-route-link` → **outline button** (1px sage border, transparent fill,
    sage text, `radius 12px`; hover fills `#e7ede7`).
  - `a.job-contacts-link` → outline button, `margin-top 24px`, no top border.

### 4. Draft review — `DraftReview` (`/applications/:id`)
- **Purpose:** Review generated application materials, then explicitly approve+submit.
- **Layout:** `.draft-review` container; `.draft-back` back link; `.draft-body`
  flex column.
- **Components:**
  - `h1.draft-title` ("Senior Product Designer — Maple & Co") 22px/700.
  - `p.draft-status` 13px/600 faint, capitalized.
  - `.draft-resume-emphasis`, `.draft-cover-letter`, `.draft-answers`,
    `.draft-autofill` → hairline-topped sections (`padding 20px 0`), each led by a
    tiny uppercase `h2`. Body `<p>` uses `white-space: pre-line` for resume/cover.
  - `.draft-answer` (in `.draft-answers` and `.draft-autofill-answers`) → small
    surface card: `radius 12px`, `border 1px #e4dccd`, `padding 12px 16px`,
    flex column. `.draft-answer-field` is a tiny uppercase label;
    `.draft-answer-value` is 15px ink.
  - `.draft-autofill-ats` 13px `#5d584f`; `.draft-autofill-url` 13px sage link,
    `word-break: break-all`.
  - `.draft-submit` → a single sunken panel (`background #ece5da`, `radius 16px`,
    `padding 20px`) — **not** a nested card stack. `.draft-submit-note` 13px soft.
    `.draft-submit-button` → primary button. Disabled state holds steady
    (`cursor:default`) for the "Submitting…" / "Submitted" labels.
  - Result/error: `.draft-submit-error` (danger pill), `.draft-submit-result`
    (success pill).

### 5. Profile — `ProfileView` (`/profile`)
- **Purpose:** Edit non-sensitive profile fields; view contact presence flags,
  resume status, and the push toggle.
- **Layout:** `.profile` container; `.profile-body` flex column `gap 32px`.
- **Components:**
  - `.profile-form` flex column `gap 16px`. Each `.profile-field` is a `<label>`,
    flex column `gap 6px`. `.profile-field-label` 13px/600 `#5d584f`.
  - Inputs (`.profile-full-name`, `.profile-headline`, `.profile-summary`,
    `.profile-location`, `.profile-linkedin`, `.profile-github`,
    `.profile-portfolio`, plus generic `.profile-input`) → `background #fbf8f3`,
    `border 1px #d4c9b6`, `radius 12px`, `padding 11px 14px`, 15px.
    **Focus:** sage border + 3px sage focus ring (`--focus-ring`).
  - `.profile-save` → primary button (full-width on mobile, auto on desktop).
  - `.profile-save-ok` success pill / `.profile-save-error` danger pill.
  - `.profile-contact`, `.profile-resume`, `.push-toggle` → hairline-topped
    sections (`padding-top 24px`). Presence rows (`.profile-contact-row`) and
    resume meta (`.profile-resume-meta li`) are 15px `#5d584f`.
  - `.push-toggle-enable` → primary button; `.push-toggle-disable` /
    `.push-toggle-busy` → secondary/outline button; `.push-toggle-unsupported`
    faint note; `.push-toggle-error` danger pill.

### 6. Add a job (manual entry) — `ManualEntry` (`/jobs/new`)
- **Purpose:** Submit a job URL and/or pasted posting text.
- **Layout:** `.manual-entry` container; `.manual-entry-back` back link;
  `h1` "Add a job"; `.manual-entry-note` 13px soft.
- **Components:**
  - `.manual-entry-form` flex column `gap 16px`. Each `.manual-entry-label` is a
    `<label>` (flex column, its `<span>` is the field label). `.manual-entry-url`,
    `.manual-entry-title`, `.manual-entry-company` are text/url inputs;
    `.manual-entry-text` is a `min-height 104px` resizable textarea — all share
    the input styling above.
  - `.manual-entry-submit` → primary button.
  - `.manual-entry-error` danger pill.
  - `.manual-entry-result` → success panel (`background #e3ece4`, `border 1px
    #cfe0d3`, `radius 12px`). `.manual-entry-result-msg` `#36513f`;
    `.manual-entry-result-link` underlined success-ink link.

### 7. Contacts & outreach — `ContactsView` (`/jobs/:id/contacts`)
- **Purpose:** See contact candidates; generate an outreach draft per contact for
  **manual** sending (the app never sends).
- **Layout:** `.contacts-view` container; `.contacts-back` back link;
  `h1.contacts-title`; `.contacts-note` 13px soft.
- **Components:**
  - `.contacts-list` flex column `gap 16px`. Each `.contact` → soft surface card
    (`radius 16px`, `border 1px #e4dccd`, `padding 20px`, flex column `gap 8px`).
  - `.contact-name` 17px/600; `.contact-role` 13px soft; `.contact-relevance`
    13px soft; `.contact-linkedin` 13px/600 sage link.
  - `.contact-outreach` → top-hairline sub-block, flex column `gap 12px`.
    `.contact-outreach-template` textarea (shared input style, `min-height 104px`).
    `.contact-outreach-generate` → primary button.
  - `.contact-outreach-draft` → flex column. `.contact-outreach-manual` 12px faint
    caption. `.contact-outreach-message` read-only textarea on the sunken surface
    (`#ece5da`). `.contact-outreach-copy` → secondary/outline button.
  - `.contact-outreach-error` danger pill.

### 8. Login — `Login` (`/login`)
- **Purpose:** Single passphrase entry.
- **Layout:** `.login-screen` → full-height (`100dvh`) centered column,
  `max-width 380px`, `gap 20px`. `h1` "Waunder" 28px/700 centered.
- **Components:**
  - `.login-form` flex column `gap 12px`. `.login-passphrase` → centered-text
    password input (`padding 13px 16px`, 17px). `.login-submit` → full-width
    primary button. `.login-status` → centered danger pill.

---

## Interactions & behavior
All async/state behavior already lives in the Go components — `app.css` only
provides the **visual** state styling the components toggle into via class
labels and `disabled`:

- **Hover** — list cards lift + deepen shadow; outline buttons fill with sage
  wash; primary buttons darken to `#4c6a58`. All transitions `~140ms ease`.
- **Active** — primary/secondary buttons nudge `translateY(1px)`; cards return to
  flat.
- **Focus** — all inputs and focusable elements show `box-shadow: 0 0 0 3px
  rgba(94,125,106,.30)` (sage focus ring) + sage border on inputs. Uses
  `:focus-visible` globally.
- **Loading** — `.loading` ("Loading…") centered, faint, gentle opacity pulse
  (`@keyframes waunder-pulse`, 1.3s). Buttons mid-action are `disabled` →
  `opacity .55`, `cursor: progress` (e.g. "Saving…", "Submitting…", "Adding…",
  "Working…").
- **Error** — `.load-error` panel and the inline `*-error` / `.login-status`
  messages → danger soft background (`#f4e3dc`), danger ink (`#843d2c`),
  `radius 12px`. `.sign-in-link` is an underlined danger-ink link.
- **Success** — `.profile-save-ok`, `.draft-submit-result`,
  `.manual-entry-result` → success soft background (`#e3ece4`), success ink
  (`#36513f`).
- **Disabled** — inputs `opacity .6`, `cursor: not-allowed`.
- **Responsive** — mobile-first base. At `≥768px`: page padding grows to 32px,
  titles to 26px, form buttons stop spanning full width, list rows get roomier
  padding. At `≥1024px`: column max-width 760px.

## State management
No new state. The Go components own all of it (load/submit/save/generate/push
lifecycles in `web/components/*.go`). The CSS reacts to:
- presence of status classes the components conditionally render
  (`*-error`, `*-ok`, `*-result`, `.loading`, `.load-error`), and
- the native `disabled` attribute on buttons/inputs.

## Design tokens
All defined as CSS custom properties in `:root` (see `app.css`).

**Colors**
| Token | Value | Use |
|---|---|---|
| `--color-bg` | `#f4efe8` | page — warm paper |
| `--color-surface` | `#fbf8f3` | cards, inputs |
| `--color-surface-sunken` | `#ece5da` | read-only wells |
| `--color-ink` | `#2d2c2c` | primary text (= PWA theme color) |
| `--color-ink-soft` | `#5d584f` | secondary text |
| `--color-ink-faint` | `#8c8579` | labels, meta, placeholders |
| `--color-border` | `#e4dccd` | hairlines |
| `--color-border-strong` | `#d4c9b6` | input borders, dividers |
| `--color-accent` | `#5e7d6a` | primary action, links — sage |
| `--color-accent-strong` | `#4c6a58` | hover/active |
| `--color-accent-soft` | `#e7ede7` | tinted fill (pills, link wash) |
| `--color-accent-ink` | `#3a5446` | text on tinted fill |
| `--color-danger` | `#a8533f` | error accent |
| `--color-danger-soft` | `#f4e3dc` | error background |
| `--color-danger-ink` | `#843d2c` | error text |
| `--color-success` | `#4c6a58` | success accent |
| `--color-success-soft` | `#e3ece4` | success background |
| `--color-success-ink` | `#36513f` | success text |

**Typography** — `--font-sans: "Hanken Grotesk", ui-sans-serif, system-ui, …`
Scale: `--text-xs 12 · --text-sm 13 · --text-base 15 · --text-md 17 ·
--text-lg 22 · --text-xl 28`. Base line-height `1.55`.

**Spacing** — `--space-1…8`: 4, 8, 12, 16, 20, 24, 32, 40 px.

**Radius** — `--radius-sm 8 · --radius-md 12 · --radius-lg 16 · --radius-xl 22 ·
--radius-pill 999` px.

**Shadows**
- `--shadow-sm: 0 1px 2px rgba(45,44,44,.04), 0 1px 3px rgba(45,44,44,.05)`
- `--shadow-md: 0 2px 6px rgba(45,44,44,.05), 0 10px 28px rgba(45,44,44,.06)`
- `--focus-ring: 0 0 0 3px rgba(94,125,106,.30)`

**Layout** — `--page-max 720px` (760 at ≥1024px), `--page-pad 20px` (32 at ≥768px).

## Assets / fonts
- **Font:** Hanken Grotesk. `app.css` `@import`s it from Google Fonts at the top
  so the file is self-contained for static loading. If you prefer to self-host
  (recommended for a PWA / offline shell), drop the WOFF2 files into `web/` and
  replace the `@import` with local `@font-face` rules — keep the family name
  `"Hanken Grotesk"` so nothing else changes.
- **Icons / images:** none introduced. Back links use a literal "←" character;
  list bullets are CSS dots. The existing app icon (`web/web/icon.svg`) is
  untouched. The PWA `ThemeColor`/`BackgroundColor` `#2d2c2c` already matches
  `--color-ink`.
- No gradients, no decorative imagery — per the design constraints.

## Files in this bundle
```
design_handoff_waunder_css/
├── README.md            ← this file
├── STYLEGUIDE.md        ← visual direction & theme rationale
├── app.css              ← THE DELIVERABLE — place at web/web/app.css
├── Waunder UI.dc.html   ← all 8 screens + the system panel, on one canvas
├── screens/             ← per-screen reference HTML (real markup + app.css)
│   ├── digest.html
│   ├── jobs.html
│   ├── job-detail.html
│   ├── draft-review.html
│   ├── profile.html
│   ├── manual-entry.html
│   ├── contacts.html
│   └── login.html
└── screenshots/         ← rendered PNG of each screen at 390px
    ├── digest.png  · jobs.png  · job-detail.png  · draft-review.png
    └── profile.png · manual-entry.png · contacts.png · login.png
```

To preview any screen locally, open the matching `screens/*.html` in a browser
(it links `../app.css`). These wrappers are for review only — never copy the
wrapper markup into the app; only `app.css` ships.
