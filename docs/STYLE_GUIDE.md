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
| Danger | `#a8533f` / `#f4e3dc` / `#843d2c` | Error states and red-flag bullets |
| Success | `#4c6a58` / `#e3ece4` / `#36513f` | Success states |

Do not introduce blue/purple accent systems or color-code match scores. Match scores stay
quiet in a single sage-soft pill regardless of value.

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
- There is no persistent nav or tab bar in the current design. Navigation remains in-flow
  through back links and screen-specific links.
- Feed and digest rows are soft list cards with a score/status pill aligned on the right.
- Job detail, draft review, profile, and route sections use top hairlines plus spacing.
- Primary actions use sage filled buttons; secondary actions use outline/surface buttons.
- Inputs and textareas use warm surface fill, strong hairline border, 12px radius, and a
  visible sage focus ring.
- Error and success messages use soft status pills. Loading uses a gentle opacity pulse.

If a new screen is added, extend the same system: one centered column, a compact title,
hairline sections, one primary action where possible, and no decorative background imagery.

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
