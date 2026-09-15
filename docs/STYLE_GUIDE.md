# STYLE_GUIDE.md — Waunder Frontend Style System

> Canonical source for Waunder's PWA visual direction.
> Component behavior and data ownership still live in Rails and `web/src/` docs; this file governs
> visual treatment, CSS integration, and design constraints.

Waunder's frontend should feel like a quiet personal operations tool: warm, utilitarian,
mobile-first, and comfortable for daily repeated use. It is not a marketing site and should
not use hero sections, decorative gradients, or card-heavy layouts.

The current design handoff lives at
[`reference/design_handoff_waunder_css/`](../reference/design_handoff_waunder_css/).
Its static HTML files and screenshots are reference material only. Do not copy the wrapper
HTML into the app. The React components in `web/src/components/` are the markup and behavior
source of truth; the stylesheet is `web/public/app.css`, linked from `web/index.html`.

> `app.css` and every class name were carried over **verbatim** from the retired Go/go-app build
> ([`GO_MIGRATION.md`](GO_MIGRATION.md)); styling upgrades (Tailwind, component libraries) are the
> separate `UI-*` phase. The stylesheet, the Hanken Grotesk WOFF2, the app icon, and the brand logos
> live under `web/public/`, which Vite serves at the site root: `/app.css`, `/fonts/…`, `/icons/…`,
> `/icon.svg`.
>
> **Tailwind v4 (`UI-01`).** `web/src/styles/tailwind.css` imports only `tailwindcss/theme` and
> `tailwindcss/utilities` — never the full entry, whose Preflight fights `app.css`'s resets. Both
> sit in cascade layers, so the unlayered `app.css` stays authoritative. `@theme` restates the
> `:root` tokens value for value (Tailwind's default colors, radii, type scale, shadows, and fonts
> are cleared; `--spacing` is 4px to match `--space-*`), so `bg-accent-soft`, `rounded-pill`, and
> `text-xs` mean exactly the `app.css` tokens. Change a token in both files at once;
> `tailwind-probe.test.tsx` fails on drift. Automatic source detection is off: opt a file in with an
> `@source` line when it adopts utilities, because scanning all of `src/` emits utilities such as
> `.table` and `.hidden` from ordinary words.
>
> **Vendored primitives (`UI-02`).** `web/src/components/ui/` holds shadcn/ui-style `Button`
> (`primary|secondary|ghost|danger`), `Input`, `Select`, `Dialog`, and `Sheet` (`bottom|right`),
> copied into the repo with no Radix, `cva`, `clsx`, or `tailwind-merge` runtime dependency — the same
> self-hosting policy as the font and brand logos. They use only token utilities, so they inherit the
> paper/sage palette above. `Select` is a native `<select>` (OS picker on phones) and `Dialog`/`Sheet`
> wrap the native `<dialog>`. The jobs feed's filter drawer (`UI-03`) is the first screen using `Dialog`: a trigger with the
> active-filter count opens a native modal `.job-filters-drawer`, bottom-anchored on narrow layouts and
> right-anchored inside the 800px container query; `ui.test.tsx` pins the dependency list.
> **RESOLVED-25 (2026-09-15) retires the "no runtime dependency" clause:** new primitives are generated
> with the shadcn CLI over Radix / `cmdk` / `vaul` / `react-day-picker`, icons come from `lucide-react`,
> and the native `Dialog`/`Sheet` above stay in place. Brand logos and the font stay self-hosted.
> **UI-07** adds Popover, Command, and DropdownMenu as owned primitives. Their generated surfaces use
> only Waunder token utilities (`rounded-panel`, `bg-surface`, `border-border`, `shadow-md`, and the
> sage focus-ring utilities); they are foundational only until a later UI task adopts one in a screen.
>
> The class *suffixes* this file specifies — `.job-score--high|mid|low|pending`,
> `.job-status--active|backlog|removed`, `.tracker-row--<group>` — plus the brand-logo paths
> are produced by `web/src/lib/labels.ts`. Renaming a band or a state there
> silently unstyles a pill, so treat those return values as part of this style contract.
>
> The tracker's responsive table carries its markup contract into
> `web/src/components/tracker/` unchanged: one `<table class="tracker-table">`, a `data-label` on
> every `.tracker-cell` that matches its column header (the only label a phone shows),
> `.tracker-cell-job` as every row's leading cell (it paints the group tint in table mode), and
> `tracker-row tracker-row--<group>` from `trackerRowClass`. `tracker.test.tsx` parses `app.css` to
> pin the rules that markup depends on — the `attr(data-label)` card labels, the explicit table
> display values inside the 800px container query, and the inset box-shadow tint — so restyling the
> tracker means updating that test deliberately. A pipeline stage with no label renders no
> `.tracker-stage` pill rather than an empty one.
>
> **RESOLVED-26 retires this card-layout contract.** It describes the shipped tracker until `UI-14`
> lands the Surface v2 grid (see "Surface v2" below), which replaces the `data-label` cards with a
> horizontally scrolling grid at every width and rewrites `tracker.test.tsx`'s CSS assertions.

---

## Visual Principles

1. **Quiet over loud.** Structure comes from spacing, hairlines, and clear hierarchy, not
   saturated colors or decorative effects.
2. **Warm and personal.** Use warm paper surfaces, charcoal ink, and a calm sage accent.
3. **Dense but breathable.** Feed rows and detail sections should scan quickly without
   feeling cramped.
4. **One elevation level.** Cards are reserved for list rows and discrete repeated items
   such as contacts or structured answers. Detail screens use hairlines and spacing, not
   nested cards.
5. **Behavior stays unchanged.** Styling work must not add business logic, skip auth, trigger
   writes on mount/render, auto-submit applications, or auto-send outreach.

---

## Palette

The reference palette is warm paper plus sage, anchored by the existing PWA ink color
`#2d2c2c`.

| Role | Hex | Usage |
|---|---|---|
| Paper | `#f4efe8` | Page background |
| Surface | `#fbf8f3` | Cards and inputs |
| Sunken | `#ece5da` | Read-only wells and approve panels |
| Ink | `#2d2c2c` | Primary text and PWA theme color |
| Ink soft | `#5d584f` | Secondary copy |
| Ink faint | `#8c8579` | Labels, metadata, placeholders |
| Hairline | `#e4dccd` | Section dividers and card borders |
| Hairline strong | `#d4c9b6` | Input borders |
| Sage | `#5e7d6a` | Primary actions and links |
| Sage strong | `#4c6a58` | Hover/active actions |
| Sage soft | `#e7ede7` | Score pills and subtle washes |
| Danger | `#a8533f` / `#f4e3dc` / `#843d2c` | Error states, red-flag bullets, low match band |
| Warning | `#b07d35` / `#f5ecd9` / `#8a601f` | Mid match band |
| Success | `#4c6a58` / `#e3ece4` / `#36513f` | Success states, high match band |

Do not introduce blue/purple accent systems. The one exception is the Surface v2 status-chip
tones for Drafting (plum) and Interviewing (slate), which are chip fills only, never accents,
links, or buttons. Match-score pills are color-coded by band so the
score reads at a glance: high (≥75) success-soft/green, mid (50–74) warning-soft/amber, low
(<50) danger-soft/red, and pending (not yet scored) a neutral sunken pill. The band class
(`.job-score--high|mid|low|pending`) carries the color in both the feed/digest rows and the job
detail; the base `.job-score` pill defines only shape and layout.

---

## Typography

The target typeface is Hanken Grotesk with system sans fallbacks. Because Waunder is an
installable PWA with an offline-tolerant app shell, prefer self-hosted WOFF2 assets under
`web/public/` or a documented system-font fallback over a live Google Fonts dependency.

Use the reference scale:

| Token | Size | Weight | Usage |
|---|---:|---:|---|
| `--text-xl` | 28px | 700 | Login wordmark |
| `--text-lg` | 22px | 700 | Screen titles |
| `--text-md` | 17px | 600 | Row titles, contact names, route labels |
| `--text-base` | 15px | 400 | Body text, inputs |
| `--text-sm` | 13px | 500-600 | Meta text, field labels, back links |
| `--text-xs` | 12px | 600 | Uppercase section labels and score pills |

Section labels use tiny uppercase text with moderate letter spacing. Numbers use tabular
figures where possible.

---

## Layout And Components

- Routed screen roots such as `.digest`, `.job-list`, `.job-detail`, `.draft-review`,
  `.profile`, `.manual-entry`, and `.contacts-view` act as centered page containers.
- Every signed-in screen shares navigation and an Auto / Desktop / Mobile layout selector.
  Auto uses a 960px viewport breakpoint; PWA installation and user-agent strings do not affect
  layout. The override is saved locally per browser under `waunder.layout` and survives navigation
   and reloads. Mobile uses a centered 560px maximum column and bottom navigation with iPhone safe
   area padding. Desktop uses up to 1280px with in-flow top navigation; narrow desktop windows still
   wrap safely. **Import job** is available from the shared header and the Jobs screen, including a
   clear empty-feed action. Intake is the ingestion-history tab.
- Feed and digest rows are soft list cards with the color-coded score pill and a lifecycle
  status pill (Active / Backlog / Removed — `.job-status--active|backlog|removed`, tinted
  success-soft / warning-soft / danger-soft) stacked top-right of the card in a `.job-pills`
  column, and an origin pill under the company line. The status pill makes a card's intake bin
  visible at a glance, which matters most on the mixed ingestion landing where rows aren't
  pre-filtered by bin.
- The ingestion landing groups its rows under a date header (`.digest-date`) and one collapsible
  `.digest-batch` block per alert email, whose `.digest-batch-summary` carries the origin pill, the
  posting count, and the arrival time. The disclosure is a native `<details>`/`<summary>` with a
  CSS-only chevron (`.digest-batch-summary::after`, rotated by `.digest-batch[open]`), so every
  posting stays in the DOM while collapsed and the control needs no JavaScript. Dates and times
  render exactly as Rails sent them — never converted to the viewing device's timezone — so a
  header cannot disagree with the day the batch was grouped on.
- The intake panel (`.intake-control`) sits above the batches with a status pill
  (`.intake-status--on|paused`), a held-alert count when any are waiting, and a single
  pause/resume button that shows `Updating…` disabled while in flight. It never changes intake on
  render; the outcome is reported in a quiet `.intake-message` pill, failures in `.intake-error`.
- The job detail is a header (title, company, origin sentence, compensation, score pill) above a
  `.job-workspace` that holds the assessment column and a `.job-workspace-actions` aside. Below
  800px the aside is `display: contents`, so its panels interleave with the assessment by CSS
  `order` — route out (0), assessment (1), pipeline status (2), drafts & outreach (3), intake (4);
  above it the aside becomes a sticky surface-coloured sidebar. The optional actions (prepare a
  draft, contacts and outreach) sit inside a collapsed `<details class="job-optional-actions">`
  so the primary path — open the posting on the employer's site, then record it — stays first.
  Assessment blocks are omitted entirely when the scorer had nothing for them; only the summary
  falls back to a sentence, because an unscored posting is the common case rather than an error.
- On the Jobs feed each row card is followed by a `.job-list-actions` manage bar: the selection
  checkbox (`.job-select-label`, "Select") is grouped on the left with the lifecycle
  backlog/remove/restore buttons on the right, rather than floating the bare checkbox above the
  card. This keeps the per-row controls together and reads cleanly when the card stacks on mobile.
- The origin pill leads with the source's official brand logo (LinkedIn/Glassdoor/Indeed),
  self-hosted as SVGs under `web/public/icons/` (vendored from Simple Icons with the brand color
  baked into the fill — no live CDN dependency, matching the self-hosted-font policy). Sources
  without a brand logo (manual entry, generic email alert) use a lucide marker in `currentColor`
  instead. The logo/icon sits inline before the source label via `flex` + `gap` on the pill.
- The Applications screen is one unified tracker (TRACK-01), not a two-view toggle: every
  intaked job post gets a row, and its application status is set inline on that row. Its title
  pairs with a stats cluster in the top-right (`.applications-header` / `.applications-stats` —
  a value + small uppercase caption per stat: applied-to and jobs-tracked). Below it, group tabs
  (`.tracker-tabs` / `.tracker-tab`, sharing the segmented `.view-selector-option-active` idiom
  with the Jobs bin tabs) select All / Not applied / Applied / In progress / Closed, each with a
  count badge; the strip scrolls horizontally so five tabs stay reachable on a phone. Lifecycle
  bin and sort sit under them as plain labelled selects (`.tracker-controls`).
- The tracker table runs on TanStack Table (UI-04): a header click sorts only the loaded page
  (direction in `aria-sort` and the `.tracker-sort[data-sort]` arrow, so header text still equals
  each cell's `data-label`); a collapsed `.tracker-columns` control hides Company/Status/dates
  (never Job, which leads the row and paints the tint) and drops header and cells together; pages
  over 60 rows are window-virtualized with measured rows and `.tracker-spacer` rows given explicit
  block/table display in both layouts. The server Sort select still orders the feed.
- The tracker rows (`.tracker-table`) are one responsive markup, not two: on mobile each row is a
  card whose cells label themselves via `data-label` + `::before`, and inside the 800px container
  query the same table reverts to real `table` display with a sunken header row, hairline
  dividers, and a hover tint. The tracker group is carried by a colored left edge (a border on the
  mobile card; an inset `box-shadow` on the leading cell in table mode, since a collapsed-border
  table row cannot paint one) — sage for applied, amber for in progress, faint for closed. Empty
  states name the active tab ("No applications submitted yet.") rather than a generic "no rows".
- The Jobs feed's filter + sort controls live in a collapsed-by-default `.job-filters-panel`
  (`<details>`/`<summary>` "Filters & sort") so they don't push the feed down on mobile; the
  summary carries a small count badge of how many filters are active, and the controls lay out
  in a 2-up grid (auto-fit on wide screens). The Applications tracker has its own leaner
  controls (group tabs + bin + sort) and does not reuse this panel.
- Job detail, draft review, profile, and route sections use top hairlines plus spacing.
- Desktop workspaces use the available width: Jobs has a filter sidebar and compact rows;
  job detail pairs the assessment with a sticky application panel; ingestion batches, contacts,
  profile fields, and draft materials use two columns where useful, and the Applications tracker
  becomes a real table.
  Container queries at 800px of content width keep these layouts tied to the selected layout,
  including forced Mobile on a wide monitor and narrow windows in Desktop mode.
- Manual application is the primary job-detail flow: open the resolved application link in a
  new tab (fall back to the original posting), then explicitly mark applied/waiting. On mobile,
  the primary actions precede the assessment and secondary tracking/organization follows it.
  Draft generation and outreach live in an expandable section; draft-review materials have
  copy controls with success/blocked feedback, and automation controls are collapsed initially.
  The autofill preview's apply URL is rendered as its own link text, so `.draft-autofill-url`
  carries `word-break: break-all` to wrap at phone width; a URL that is not `http(s)` renders as
  plain text in the same class rather than as a link.
  Existing notes/follow-up dates survive status-only edits; clearing a stage uses a real select
  sentinel mapped back to an empty API value (Rails still defaults Applied to Waiting).
- Primary actions use sage filled buttons; secondary actions use outline/surface buttons.
- The Jobs-screen import action is a compact sage-soft outline control; empty-feed import is a
  text action inside the quiet empty-state well. Manual import results name the outcome plainly
  (new, already tracked, already submitted, or possible match) and link to the returned record.
- Inputs and textareas use warm surface fill, strong hairline border, 12px radius, and a
  visible sage focus ring.
  Every sage-filled button (and the vendored `Button`) uses `--focus-ring-strong` — a surface gap
  inside a strong sage outer ring — because the soft sage `--focus-ring` disappears against a sage
  fill (`UI-03`, replacing the Go build's `.login-submit`-only override). Verify with a keyboard Tab
  walk and computed `box-shadow`.
  The `FE-28` parity gate checked primary-button rings with a keyboard Tab walk and computed
  `box-shadow`, not with a screenshot taken right after `focus()`.
- Error and success messages use soft status pills. Loading uses a gentle opacity pulse.
- Empty feed/list states (`.digest-empty`, `.job-list-empty`, `.tracker-empty`,
  `.contacts-empty`) render as a
  quiet sunken well with centered faint-ink text — visually distinct from the danger-toned
  `.load-error` so "nothing here yet" never reads as a failure.
- The `Home` root (`.app-shell`) is a thin skeleton wrapper, not a routed screen container; it
  renders `InstallGuide` directly. The install/notification guide (`.install-guide`) uses the
  same sunken-well treatment as empty states, with a sage filled `.enable-notifications` button
  matching the primary-button system and a faint `.install-status` line for the post-action
  result.
- LLM-generated free text (job summaries, alignment/strategy notes, cover letters, structured
  answer values) can contain long unbroken tokens (e.g. a pasted URL with no spaces) that would
  otherwise overflow a narrow card. The base reset applies `overflow-wrap: break-word` to
  `p`/`li`/`h1`/`h2`/`span` as a safe no-op default; raw-URL link text (`.draft-autofill-url`)
  additionally uses `word-break: break-all` since the text itself is the link. That base reset
  does not reach `<textarea>` elements, so the pasted-posting and outreach-draft fields
  (`.manual-entry-text`, `.contact-outreach-template`, `.contact-outreach-message`) set
  `overflow-wrap: break-word` directly to stay usable at mobile widths.
- The job-detail `.job-cover-letter` card follows the assessment-section hairline rhythm. Its
  empty state explains that generation uses the synced resume and never submits; the generated
  body preserves paragraph breaks, with Copy and explicit Generate/Regenerate controls plus a
  compact recoverable error state.
- The profile screen's resume parse status (`.profile-resume-status`) and the push toggle's
  subscribed indicator (`.push-toggle-status-on`) reuse the same quiet pill idiom as the
  match-score pill, but tinted success-soft/sunken rather than sage, so "resume parsed" and
  "notifications on" read as calm status facts rather than another action button.

If a new screen is added, extend the same system: a readable mobile column, purposeful desktop
columns, a compact title, hairline sections, and one primary action where possible.

---

## Surface v2 (RESOLVED-26, in progress)

The approved design is the canvas at https://claude.ai/artifact/EejxLR8rLjxT3UzbnPbvVa (artboards:
desktop tracker grid, mobile tracker grid, mobile edit-status sheet, chips and cell states). It is a
reference for values and anatomy only; React components stay the markup source of truth. Tasks
UI-06…UI-30 and TRACK-02 implement it. Until a task lands, the sections above describe what ships;
each task rewrites the bullet it replaces in the same commit.

### Tokens added

Add these alongside the existing `:root` tokens (and restate them in `tailwind.css` `@theme`):

| Token | Value | Usage |
|---|---|---|
| `--radius-control` | 8px | Buttons, selects, inputs, nav items in the re-skinned surface |
| `--radius-panel` | 10px | Grid containers, popovers, panels |
| `--color-grid-header` | `#f1ebe3` | Grid/table header strip |
| `--color-grid-line` | `#ebe4d8` | Cell and row hairlines inside a grid |
| `--color-row-hover` | `#f6f1e9` | Row hover |
| `--color-row-active` | `#eef2ec` | Row being edited / selected |
| `--color-header-sorted` | `#e9ece3` | Sorted column header cell |
| `--control-h-desktop` | 32px | Compact desktop controls |
| `--control-h-touch` | 44px | Minimum touch target on mobile layouts |

The pinned Job column's right edge uses `--color-border-strong`; other column edges use
`--color-grid-line`.

### Status chips

One `StatusChip` renders any `pipeline_status`: a 22px (24px on touch) pill, 12px/600 label, a 6px
dot, fill and ink from this table. Its pure tone/group metadata lives in `web/src/lib/labels.ts`;
unknown values use the Interested tone and label, while the "Not applied" tracker placeholder uses
that tone with its own label. This is a foundational primitive and is not adopted by shipped screens
until the later Surface v2 screen tasks.

| Group | Status | Fill | Ink | Dot | Border |
|---|---|---|---|---|---|
| Not applied | Interested | `#ece5da` | `#5d584f` | `#8c8579` | none |
| Not applied | Drafting | `#eee6ee` | `#6a4a6a` | `#8f6690` | none |
| Not applied | Needs review | `#f5ecd9` | `#8a601f` | `#b07d35` | none |
| Applied | Applied | `#e7ede7` | `#3a5446` | `#5e7d6a` | none |
| In progress | Interviewing | `#e5ebf1` | `#3f566f` | `#5b7896` | none |
| In progress | Offer | `#d7e5d9` | `#2f4a38` | `#4c6a58` | none |
| Closed | Rejected | `#f4e3dc` | `#843d2c` | `#a8533f` | none |
| Closed | Withdrawn | transparent | `#8c8579` | `#b3aa9c` | `#d4c9b6` |
| Closed | Archived | transparent | `#8c8579` | `#b3aa9c` | `#d4c9b6` |

Menus that list statuses group them under these four group labels, in this order, mirroring Rails'
`APPLICATION_GROUPS`.

### Tracker grid

- One grid at every width inside a surface panel (`--radius-panel`, hairline border, `--shadow-sm`).
  Header strip 36px (34px mobile), rows 40px desktop / 56px mobile, 13px body text.
- Column order: row number (48px desktop / 34px mobile, centered, faint tabular digits), Job (pinned;
  source logo 14px + title 600, ellipsis; on mobile the company sits under the title as a 12px faint
  second line), Company, Score (match-score band pill), Status (`StatusChip`), Stage (plain text,
  faint `—` when empty), Applied, Updated, Follow-up, Note (ink-soft, single-line ellipsis). Dates
  are tabular; an empty date is a faint `—`.
- Follow-up tone: a past date is danger ink 600 with a 6px danger dot; today reads "Today" in sage
  strong 600; future dates are ink-soft.
- Header cells are 12px/600 uppercase faint text with a 13px lucide icon; the sorted column uses
  `--color-header-sorted`, sage-strong text, and an arrow icon for direction.
- The grid scrolls horizontally inside its panel with the Job column pinned; on mobile a 28px fade on
  the panel's right edge signals more columns.
- Toolbar above the grid: title plus a one-line stats sentence ("N applied to · N jobs tracked");
  segmented group tabs with counts (active tab: surface fill, sage-strong text, sage-soft count pill);
  Show and Sort as compact labelled controls; Columns as a dropdown menu. Footer inside the panel:
  row range on the left, Previous / "Page X of Y" / Next on the right.
- Cell states: default; hover row `--color-row-hover`; focused cell inset 2px sage ring; editing row
  `--color-row-active` with sage-strong row number and the editor anchored to the cell; saving shows
  "Saving…" in faint text inside the cell and disables other cell editors, matching today's one-write
  -at-a-time rule.
- Editors: Status is a popover command list grouped by tracker group with a check on the current
  status; Stage is a popover list of stages including "No stage"; Follow-up is a calendar popover with
  a Clear action; Note is a popover textarea with explicit Save and Cancel. On a mobile layout, tapping
  a status opens a bottom drawer: job title and company, status tiles in a two-column grid under group
  labels (current tile sage border + check), and the stage select; a tile tap writes immediately.

### Shell

- Desktop: a 56px surface top bar with a bottom hairline. It holds an 18px/700 wordmark, text nav
  items (13px/600, `--radius-control`, active = sage-soft fill + sage-strong text), and, on the
  right, the compact layout select plus the sage-filled **Import job** action (the Surface v2 Add
  job control) with a 14px Lucide plus icon. This is the existing `/jobs/new` entry point.
- Mobile: a 60px header with the wordmark and a 44px sage add button; bottom nav of four items, each a
  20px lucide icon over an 11px label, active item sage-strong with a sage-soft pill behind the icon;
  the add control is the same accessible `/jobs/new` entry point with its label reduced to the icon;
  safe-area padding unchanged.

### Re-skin checklist (screens without their own artboard)

Apply exactly these and nothing else; a task that needs a layout, copy, or behaviour change stops and
asks.

1. Controls use `--radius-control` and `--control-h-desktop` on desktop layouts, never below
   `--control-h-touch` on mobile layouts; panels and cards use `--radius-panel`.
2. Replace card-inside-card stacks with one panel plus `--color-grid-line` hairlines where a screen
   nests surfaces.
3. Section labels stay 12px/600 uppercase faint; lists of repeated fields use the grid header strip
   treatment when they are tabular.
4. Any pipeline status renders as `StatusChip`; match scores keep the band pills.
5. Icons are lucide at 13–20px in `currentColor`; no emoji markers.
6. Keep every existing class, safety behaviour, and test; update `app.css` rules in place.

---

### Toasts And Motion (UI-05)

- Transient mutation feedback uses toasts (`web/src/lib/toast.ts` store, `web/src/components/ui/toast.tsx`
  viewport rendered by `AppChrome`): a failed lifecycle write (feed and job detail), a failed tracker
  status write, and "Profile saved.". Toasts sit in one `aria-live="polite"` region labelled
  Notifications, carry a dismiss button, auto-dismiss after 6s, and do not stack duplicates.
- Permanent states stay inline on the screen they describe: draft warnings and submit gating,
  scoring failures, validation and save errors (profile, contacts, manual import), and load errors.
- Motion is enter-only (`waunder-enter`, 140–160ms, opacity never below 0.6) on routed screen roots,
  feed rows, ingestion batches, and toasts, declared only inside
  `@media (prefers-reduced-motion: no-preference)` so reduced motion gets none. `.draft-review` is
  excluded so nothing delays or obscures its submit gating.

## Integration Rules

- Ship styling from `web/public/app.css`, linked from `web/index.html` (not imported from `src/`,
  so it keeps a constant URL). It is excluded from Prettier; do not reformat it.
- Keep React components as the source of truth for markup and state. Static files under
  `reference/` are review references only.
- Keep the PWA manifest in `web/vite.config.ts` (`vite-plugin-pwa`) and the service worker in
  `web/src/sw.ts`; `/app-worker.js` is the permanent legacy-worker kill switch.
- Markup changes follow an approved design (currently Surface v2, RESOLVED-26) or its re-skin
  checklist; anything beyond that needs a new mock and plan.
- Preserve existing safety tests and behavior: submits, profile saves, manual job creation,
  push subscribe/unsubscribe, and outreach generation must remain explicit user actions.

---

## Verification

Frontend styling tasks should run:

```bash
cd web && npm run typecheck
cd web && npm run lint
cd web && npm test
cd web && npm run build
```

When a task changes visible UI, also run the PWA locally and inspect representative mobile
and desktop states. At minimum, compare the routed screens against the reference screenshots
for digest, jobs, job detail, draft review, profile, manual entry, contacts, and login, and
check non-happy states such as empty lists, loading, errors, disabled buttons, and push
unsupported/busy/error states.
