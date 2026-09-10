# STYLE_GUIDE.md — Waunder Frontend Style System

> Canonical source for Waunder's PWA visual direction.
> Component behavior and data ownership still live in Rails/go-app docs; this file governs
> visual treatment, CSS integration, and design constraints.

Waunder's frontend should feel like a quiet personal operations tool: warm, utilitarian,
mobile-first, and comfortable for daily repeated use. It is not a marketing site and should
not use hero sections, decorative gradients, or card-heavy layouts.

The current design handoff lives at
[`reference/design_handoff_waunder_css/`](../reference/design_handoff_waunder_css/).
Its static HTML files and screenshots are reference material only. Do not copy the wrapper
HTML into the app. The go-app components in `web/components/` remain the markup and behavior
source of truth; the stylesheet is integrated through go-app's `app.Handler`.

> **Migrating:** the frontend is moving to Vite + React + TypeScript. `app.css` and every
> class name in it are carried over **verbatim** by the port, so this visual system survives
> unchanged; only the component language changes. Styling upgrades (Tailwind, component
> libraries) are a separate later phase. See [`GO_MIGRATION.md`](GO_MIGRATION.md).

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

Do not introduce blue/purple accent systems. Match-score pills are color-coded by band so the
score reads at a glance: high (≥75) success-soft/green, mid (50–74) warning-soft/amber, low
(<50) danger-soft/red, and pending (not yet scored) a neutral sunken pill. The band class
(`.job-score--high|mid|low|pending`) carries the color in both the feed/digest rows and the job
detail; the base `.job-score` pill defines only shape and layout.

---

## Typography

The target typeface is Hanken Grotesk with system sans fallbacks. Because Waunder is an
installable PWA with an offline-tolerant app shell, prefer self-hosted WOFF2 assets under
`web/web/` or a documented system-font fallback over a live Google Fonts dependency.

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
- On the Jobs feed each row card is followed by a `.job-list-actions` manage bar: the selection
  checkbox (`.job-select-label`, "Select") is grouped on the left with the lifecycle
  backlog/remove/restore buttons on the right, rather than floating the bare checkbox above the
  card. This keeps the per-row controls together and reads cleanly when the card stacks on mobile.
- The origin pill leads with the source's official brand logo (LinkedIn/Glassdoor/Indeed),
  self-hosted as SVGs under `web/web/icons/` (vendored from Simple Icons with the brand color
  baked into the fill — no live CDN dependency, matching the self-hosted-font policy). Sources
  without a brand logo (manual entry, generic email alert) use an emoji marker instead. The
  logo/emoji sits inline before the source label via `flex` + `gap` on the pill.
- The Applications screen is one unified tracker (TRACK-01), not a two-view toggle: every
  intaked job post gets a row, and its application status is set inline on that row. Its title
  pairs with a stats cluster in the top-right (`.applications-header` / `.applications-stats` —
  a value + small uppercase caption per stat: applied-to and jobs-tracked). Below it, group tabs
  (`.tracker-tabs` / `.tracker-tab`, sharing the segmented `.view-selector-option-active` idiom
  with the Jobs bin tabs) select All / Not applied / Applied / In progress / Closed, each with a
  count badge; the strip scrolls horizontally so five tabs stay reachable on a phone. Lifecycle
  bin and sort sit under them as plain labelled selects (`.tracker-controls`).
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
  Existing notes/follow-up dates survive status-only edits; clearing a stage uses a real select
  sentinel mapped back to an empty API value (Rails still defaults Applied to Waiting).
- Primary actions use sage filled buttons; secondary actions use outline/surface buttons.
- The Jobs-screen import action is a compact sage-soft outline control; empty-feed import is a
  text action inside the quiet empty-state well. Manual import results name the outcome plainly
  (new, already tracked, already submitted, or possible match) and link to the returned record.
- Inputs and textareas use warm surface fill, strong hairline border, 12px radius, and a
  visible sage focus ring.
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

## Integration Rules

- Ship styling from `web/web/app.css` and load it through `app.Handler{Styles: []string{"/web/app.css"}}`.
- Keep go-app components as the source of truth for markup and state. Static files under
  `reference/` are review references only.
- Do not introduce React, Tailwind, MUI, hand-written manifests, or a hand-written service
  worker for this styling pass.
- Keep PWA manifest, icon, theme/background colors, and service worker generation in
  `web/main.go` through go-app.
- Any markup adjustments should be narrow compatibility fixes for existing states/classes,
  not product redesigns.
- Preserve existing safety tests and behavior: submits, profile saves, manual job creation,
  push subscribe/unsubscribe, and outreach generation must remain explicit user actions.

---

## Verification

Frontend styling tasks should run:

```bash
cd web && go test ./...
cd web && go vet ./...
```

When a task changes visible UI, also run the PWA locally and inspect representative mobile
and desktop states. At minimum, compare the routed screens against the reference screenshots
for digest, jobs, job detail, draft review, profile, manual entry, contacts, and login, and
check non-happy states such as empty lists, loading, errors, disabled buttons, and push
unsupported/busy/error states.
