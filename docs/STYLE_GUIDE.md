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
> **UI-08** adds the owned Vaul Drawer as another foundational primitive. Its bottom surface uses the
> warm `bg-surface`/`border-border`/`shadow-md` treatment, an 18px top radius, a 36x4
> `bg-border-strong` handle, a warm `bg-ink` scrim, and bottom padding for
> `env(safe-area-inset-bottom)`; `DrawerTitle` remains visible for assistive technology. `UI-21`
> adopts it for the tracker's mobile status editor.
> **UI-09** adds the owned Calendar primitive on pinned `react-day-picker` `10.0.1`. Selected days
> use sage, today uses sage-soft, outside days use faint ink, and day/navigation controls are at
> least 44px for touch layouts. Its public boundary is a Rails-compatible `YYYY-MM-DD` string;
> parsing and formatting use local calendar components rather than UTC conversion. It is not
> adopted by a shipped screen yet.
>
> The class *suffixes* this file specifies — `.job-score--high|mid|low|pending`,
> `.job-status--active|backlog|removed`, `.tracker-row--<group>` — plus the brand-logo paths
> are produced by `web/src/lib/labels.ts`. Renaming a band or a state there
> silently unstyles a pill, so treat those return values as part of this style contract.
>
> The tracker's grid carries its markup contract into `web/src/components/tracker/`: one
> `<table class="tracker-table">` inside `.tracker-grid-scroll`, a row-number rail, and
> `.tracker-cell-job` as the TanStack-pinned leading data cell on desktop. `tracker-row
> tracker-row--<group>` from `trackerRowClass` remains the group-tint hook; the company is also
> rendered as a quiet second line inside the Job cell on mobile. The full structural slice contains Job, Company, Score,
> Status, Stage, Applied, Intaked, Updated, Follow-up, and Note; Status is an editable `StatusChip`
> command popover on desktop and a bottom drawer on mobile, Stage is an editable pipeline-stage
> popover, and Follow-up is an editable
> Calendar popover; Applied remains read-only, while Note is an editable popover textarea with
> explicit Save and Cancel.
> `tracker.test.tsx` parses `app.css` to pin the grid dimensions, gridlines, sticky columns, mobile
> scroll fade, desktop/mobile row heights, and explicit virtualization spacer display, so
> restyling the tracker means updating that test deliberately. A pipeline stage with no label renders
> no `.tracker-stage` pill rather than an empty one.
>
> **RESOLVED-26 replaces the former card/table contract.** The tracker is a horizontally scrolling
> Surface v2 grid at every width, with its status, stage, follow-up, and note editors built on this
> structural grid foundation.

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
- Jobs feed rows remain soft list cards with the color-coded score pill and a lifecycle status pill
  (Active / Backlog / Removed — `.job-status--active|backlog|removed`, tinted success-soft /
  warning-soft / danger-soft) stacked top-right of the card in a `.job-pills` column, and an
  origin pill under the company line. Feed cards use `--radius-panel` and a quiet row hover; the
  status pill makes a card's intake bin visible at a glance. On the ingestion landing, posting rows
  live inside their batch panel instead of being nested cards; they use the same score/status pills
  and the batch summary supplies the origin.
- The ingestion landing groups its rows under a 12px/600 uppercase date header (`.digest-date`) and
  one collapsible `--radius-panel` `.digest-batch` per alert email. Its `.digest-batch-summary`
  uses the grid-header strip and control height, carrying the origin pill, posting count, and
  arrival time; its posting rows are one `--color-grid-line`-separated list surface rather than
  cards inside the batch. The disclosure is a native `<details>`/`<summary>` with a CSS-only
  chevron (`.digest-batch-summary::after`, rotated by `.digest-batch[open]`), so every posting
  stays in the DOM while collapsed and the control needs no JavaScript. Dates and times render
  exactly as Rails sent them — never converted to the viewing device's timezone — so a header
  cannot disagree with the day the batch was grouped on.
- The intake panel (`.intake-control`) sits above the batches as a `--radius-panel` surface with a
  status pill (`.intake-status--on|paused`), a held-alert count when any are waiting, and a single
  `--radius-control` pause/resume button at the touch or desktop control height that shows
  `Updating…` disabled while in flight. It never changes intake on render; the outcome is reported
  in a quiet `.intake-message` pill, failures in `.intake-error`.
- The job detail header carries the title, company, origin sentence, compensation, and banded score
  pill above a `.job-workspace`. Its assessment and cover-letter sections use 1px
  `--color-grid-line` hairlines and spacing rather than nested cards, and scorer blocks are omitted
  when empty; only the summary falls back to a sentence because an unscored posting is common.
  Below 800px `.job-workspace-actions` is `display: contents`, so its panels interleave with the
  assessment by CSS `order` — route out (0), assessment (1), pipeline status (2), drafts & outreach
  (3), intake (4). Above it becomes the single sticky `--radius-panel` sidebar surface, with its
  inner action sections separated by hairlines. The current pipeline status is a `StatusChip`
  beside the existing status and stage controls.
- On the Jobs feed each row card is followed by a `.job-list-actions` manage bar: the selection
  checkbox (`.job-select-label`, "Select") is grouped on the left with the lifecycle
  backlog/remove/restore buttons on the right, rather than floating the bare checkbox above the
  card. The bar is separated by a grid hairline, and the bulk bar uses the same grid-header panel;
  all of their controls use the touch height on mobile and compact desktop height on wide layouts.
  This keeps the per-row controls together and reads cleanly when the card stacks on mobile.
- The origin pill leads with the source's official brand logo (LinkedIn/Glassdoor/Indeed),
  self-hosted as SVGs under `web/public/icons/` (vendored from Simple Icons with the brand color
  baked into the fill — no live CDN dependency, matching the self-hosted-font policy). Sources
  without a brand logo (manual entry, generic email alert) use a lucide marker in `currentColor`
  instead. The logo/icon sits inline before the source label via `flex` + `gap` on the pill.
- The Applications screen is one unified tracker (TRACK-01), not a two-view toggle: every
  intaked job post gets a row, and its application status is set inline on that row. Its toolbar
  (`.tracker-toolbar`) pairs the title with one Rails-owned stats sentence (`.applications-summary`:
  `N applied to · N jobs tracked`). Below it, group tabs (`.tracker-tabs` / `.tracker-tab`, sharing
  the segmented `.view-selector-option-active` idiom with the Jobs bin tabs) select All / Not
  applied / Applied / In progress / Closed, each with a Rails count; the strip scrolls horizontally
  so five tabs stay reachable on a phone. Lifecycle bin and sort remain server-driven native
  selects under `.tracker-toolbar-controls`, next to the compact `.tracker-columns` dropdown.
- The tracker grid runs on TanStack Table (UI-04/UI-14/UI-16): a header click sorts only the loaded page
  (direction in `aria-sort` and the `.tracker-sort[data-sort]` arrow), while the sunken header uses
  Lucide column icons and a sorted-column state. The row-number rail is always pinned; the Job
  column is pinned only at the 800px desktop-container breakpoint so mobile retains a usable
  horizontal viewport. Column widths come from TanStack sizing, and the remaining columns scroll
  inside the panel. A
  `.tracker-columns` dropdown hides every non-Job column (never Job), pages over 60 rows are
  window-virtualized with measured rows, and `.tracker-spacer` rows stay explicit table rows.
  `.tracker-footer` remains inside the grid panel and carries the inclusive row range plus
  Previous / Page X of Y / Next controls.
  The server Sort select still orders the feed.
- The tracker uses one real table at every width, with gridlines, a 34px mobile / 36px desktop
  header strip, 56px mobile / 40px desktop rows, and a 28px mobile right-edge scroll fade. The
  Job cell ellipsizes its title and places Company beneath it on mobile; the Status cell
  uses a grouped `StatusChip` popover and the Stage cell uses the pipeline-stage popover, both
  keeping the group tint. Empty states name the active tab ("No applications submitted yet.") rather
  than a generic "no rows".
- The Jobs feed's scored/unscored view and Active / Backlog / Removed bins use segmented controls
  with `--radius-panel` tracks and `--radius-control` tabs. Its filter + sort trigger is a compact
  `.job-filters-summary` control with a small active-filter count; it opens the native modal
  `.job-filters-drawer`, bottom-anchored on narrow layouts and right-anchored inside the 800px
  container query. The drawer's inputs use touch height on mobile, desktop control height in the
  sidebar, and a 2-up mobile / single-column desktop layout. The Applications tracker has its own
  leaner controls (group tabs + bin + sort) and does not reuse this panel.
- Jobs feed pagination keeps the existing Previous / Page X of Y / Next copy, with a grid-line
  divider and lucide direction icons; its buttons use `--radius-control` and touch or desktop
  control height without changing the server-owned page behavior.
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
  Draft review keeps generated materials as hairline-separated sections with discrete answer rows
  and copy controls that retain their success/blocked feedback. The automation section remains a
  collapsed `<details>` initially; when opened, it presents one sunken autofill panel with a grid
  header and hairline-separated editable answers, inline warning panels, the worker report, and a
  distinct approve panel. Its pipeline status uses the shared `StatusChip`, and the approve control
  stays disabled until Rails says the draft is ready, every answer is complete, and warnings are
  clear. The autofill preview's apply URL is rendered as its own link text, so
  `.draft-autofill-url` carries `word-break: break-all` to wrap at phone width; a URL that is not
  `http(s)` renders as plain text in the same class rather than as a link.
  Existing notes/follow-up dates survive status-only edits; clearing a stage uses a real select
  sentinel mapped back to an empty API value (Rails still defaults Applied to Waiting).
- Primary actions use sage filled buttons; secondary actions use outline/surface buttons.
- The Jobs-screen import action is a compact sage-soft outline control; empty-feed import is a
  text action inside the quiet empty-state well. Manual entry keeps one explicit, `noValidate`
  form: its inputs and Import/lookup controls use `--radius-control`, touch height on mobile, and
  `--control-h-desktop` in a wide container. Lookup notes are compact sage-soft or danger-soft
  feedback pills. Import results are `--radius-panel` surfaces whose modifier class distinguishes
  new/already-submitted (success), already-tracked (sage), and possible-match (warning), while
  preserving Rails' outcome copy and the link to the returned record.
- Inputs and textareas use warm surface fill, strong hairline border, 12px radius, and a
  visible sage focus ring.
  Every sage-filled button (and the vendored `Button`) uses `--focus-ring-strong` — a surface gap
  inside a strong sage outer ring — because the soft sage `--focus-ring` disappears against a sage
  fill (`UI-03`, replacing the Go build's `.login-submit`-only override). Verify with a keyboard Tab
  walk and computed `box-shadow`.
  The `FE-28` parity gate checked primary-button rings with a keyboard Tab walk and computed
  `box-shadow`, not with a screenshot taken right after `focus()`.
- Error and success messages use soft status pills. Loading uses a gentle opacity pulse.
- The login screen keeps its centered 28px wordmark and behavior-only form. Its passphrase field
  and sage submit action use `--radius-control`, touch height on mobile, and
  `--control-h-desktop` in Desktop or wide Auto layouts; the danger-soft error state uses the same
  control radius. The sage action retains `--focus-ring-strong`, and the passphrase remains an
  uncontrolled input that is never stored in React or TanStack state.
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
- The job-detail `.job-cover-letter` section follows the assessment-section hairline rhythm rather
  than adding a nested card. Its empty state explains that generation uses the synced resume and
  never submits; the generated body preserves paragraph breaks, with Copy and explicit
  Generate/Regenerate controls plus a compact recoverable error state.
- The profile screen keeps its editable form and read-only contact, resume, push, and session
  sections in one quiet column: section boundaries and repeated metadata rows use
  `--color-grid-line` hairlines rather than nested cards. Profile inputs and explicit actions use
  `--radius-control` with touch-sized controls, tightening to `--control-h-desktop` in a wide
  profile container. The resume parse status (`.profile-resume-status`) and subscribed indicator
  (`.push-toggle-status-on`) remain quiet success/sunken fact pills, while the conditional install
  guide is one sunken `--radius-panel` with an explicit enable action. Contact values remain
  presence-only and no profile, push, or sign-out write runs on render.
- The contacts screen keeps each person as one discrete `--radius-panel` card. Outreach is separated
  by a grid-line hairline; its template, Generate/Regenerate, and Copy controls use
  `--radius-control`, touch height on mobile, and `--control-h-desktop` in a wide container. A
  generated message is one sunken `--radius-panel` well whose copy row is separated by a grid
  hairline, not another card stack. The add-contact disclosure uses the grid-header strip over one
  surface panel. Generation, saving, and copying remain explicit, and no send affordance exists.

If a new screen is added, extend the same system: a readable mobile column, purposeful desktop
columns, a compact title, hairline sections, and one primary action where possible.

---

## Surface v2 (RESOLVED-26, complete)

The approved design is the canvas at https://claude.ai/artifact/EejxLR8rLjxT3UzbnPbvVa (artboards:
desktop tracker grid, mobile tracker grid, mobile edit-status sheet, chips and cell states). It is a
reference for values and anatomy only; React components stay the markup source of truth. Tasks
UI-06…UI-30 and TRACK-02 implemented it. The sections above describe the shipped system; the
details below retain the completed design contract for future maintenance.

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

The Job column's right edge uses `--color-border-strong`; other column edges use
`--color-grid-line`.

### Status chips

One `StatusChip` renders any `pipeline_status`: a 22px (24px on touch) pill, 12px/600 label, a 6px
dot, fill and ink from this table. Its pure tone/group metadata lives in `web/src/lib/labels.ts`;
unknown values use the Interested tone and label, while the "Not applied" tracker placeholder uses
that tone with its own label. The Applications tracker uses the chip as its editable status-cell
trigger, and job detail and draft review reuse the same primitive.

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
- **UI-14/UI-16/UI-18/UI-19/UI-20/UI-21 structural slice:** the shipped grid contains row number, Job, Company, Score,
  Status, Stage, Applied, Intaked, Updated, Follow-up, and Note. Job keeps its existing link and
  source logo; Score keeps the match-score band pill; Status is an editable grouped `StatusChip`
  popover on desktop and a bottom drawer on mobile, Stage is an editable pipeline-stage popover, and
  Follow-up is an editable calendar
  popover with Clear; Applied remains read-only and Note is an editable popover textarea with
  explicit Save and Cancel.
- Column order: row number (48px desktop / 34px mobile, centered, faint tabular digits), Job
  (pinned on desktop;
  source logo 14px + title 600, ellipsis; on mobile the company sits under the title as a 12px faint
  second line), Company, Score (match-score band pill), Status (`StatusChip`), Stage (pipeline stage
  popover, faint `—` when empty), Applied, Updated, Follow-up, Note (ink-soft, single-line ellipsis). Dates
  are tabular; an empty date is a faint `—`.
- Follow-up tone: a past date is danger ink 600 with a 6px danger dot; today reads "Today" in sage
  strong 600; future dates are ink-soft. Applied and follow-up dates use the literal Rails calendar
  values without browser timezone conversion.
- Header cells are 12px/600 uppercase faint text with a 13px lucide icon; the sorted column uses
  `--color-header-sorted`, sage-strong text, and an arrow icon for direction.
- The grid scrolls horizontally inside its panel with the Job column pinned at desktop container
  widths only; on mobile Job scrolls with the other data columns and a 28px fade on the panel's right
  edge signals more columns.
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

### Re-skin constraints (screens without their own artboard)

These constraints governed the completed re-skin and remain the maintenance contract for screens
without their own artboard.

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
- Markup changes follow an approved design (Surface v2 is complete under RESOLVED-26) or its re-skin
  constraints; anything beyond that needs a new mock and plan.
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
