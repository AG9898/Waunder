# PRD — Waunder

> **Status** (2026-06-09)
>
> | Track | State |
> |---|---|
> | Shipped | Nothing shipped yet. All three services are skeletons: `api/` exposes only `GET /api/health` and the Rails `/up` healthcheck; `web/` renders a placeholder Home component; `workers/` has types, safety guards, and a handler registry but an empty ATS handler registry and no poll loop. `docs/workboard.json` is empty. |
> | In Progress | See `docs/workboard.json`. |
> | Planned | Phase 1 (MVP) — end-to-end flow from forwarded job-alert email to trusted submit. The Phase 1 task graph is seeded in `docs/workboard.json`. Direction-setting decisions are resolved: auth is a shared-secret session cookie + worker bearer token (RESOLVED-14); inbound email is Resend, not Mailgun (RESOLVED-13); LinkedIn Easy Apply ships behind a default-off flag (RESOLVED-15); lightweight manual job entry is in scope (RESOLVED-16); a single free OpenRouter model is used (RESOLVED-17). |

---

## Objective

Waunder is a mobile-first, single-user personal job application assistant for its one owner — not a SaaS. It finds and scores relevant job openings from forwarded job-alert emails, notifies the owner with a daily digest, drafts tailored application materials, tracks contacts and outreach, and supports trusted application submission to supported ATS platforms only after explicit per-application approval. The frontend is a Go + go-app WebAssembly Progressive Web App installed to the iPhone home screen — no native build, no App Store, no TestFlight — and stays responsive so it also works in desktop browsers. The goal is to compress the repetitive work of triaging, tailoring, and submitting job applications while keeping the owner in control of every submit.

---

## Users

- **The owner (single user)** — the only user of the app. Reviews the daily digest, inspects scored jobs, requests and reviews tailored application drafts and outreach messages, and explicitly approves any application before it is submitted. There is no multi-tenant model, no roles, and no public signup. The single user authenticates with a shared-secret passphrase exchanged for a signed session cookie (RESOLVED-14 in `docs/DECISIONS.md`).

---

## Scope

### Phase 1 — MVP (end-to-end pipeline)

Phase 1 delivers the full plan scenario: forward a job-alert email → Resend inbound webhook → Rails ingests, normalizes, pre-triages, and resolves the application route → eligible jobs are LLM-scored within the daily budget → a daily web-push digest is delivered → the owner reviews in the PWA → Waunder generates a tailored application draft / autofill payload → the owner approves → the Playwright worker fills/submits on a supported ATS → Rails reports final status.

- **Job discovery** via forwarded job-alert emails through Resend inbound webhooks (RESOLVED-13); inbound alerts parsed into normalized job records. An authenticated manual job/link entry endpoint is also available as a fallback, accepting a URL and/or pasted posting text and sending the resulting job through route resolution and scoring (RESOLVED-16).
- **Application route resolution** separating where a job was discovered from where it should be submitted. Stores source URL, canonical posting URL, application URL, route type, recommended route, and route confidence. Route types: `company_careers`, `greenhouse`, `lever`, `ashby`, `workday`, `linkedin_easy_apply`, `indeed_apply`, `glassdoor_apply`, `unknown`. Preference order: Direct ATS/company application URL > company careers page > job-board external apply URL > LinkedIn Easy Apply / Indeed Apply / Glassdoor Apply > manual apply only.
- **Deterministic inbound triage before LLM scoring**: bulk email-ingested jobs are title/location gated before OpenRouter. Target roles include developer, software engineer, AI/ML engineer, platform/infrastructure/devops, and adjacent data roles; Vancouver is highest location priority, then Calgary, then remote. Unknown or broad Canada/BC/Alberta locations are allowed at lower priority because some alert templates omit city detail. Filtered/deferred jobs stay visible in the PWA and can be explicitly scored by the owner.
- **LLM scoring and summaries** via OpenRouter (structured JSON where supported): job summary, match score, relevant requirements, missing/weak requirements, resume alignment notes, suggested application strategy, and red flags. Automatic inbound scoring is capped by `JOB_TRIAGE_AUTO_SCORE_DAILY_LIMIT`; manual job entries and explicit score requests bypass the cap.
- **Application assistance**: tailored resume emphasis notes, cover letter / message drafts where relevant, structured application answers, and reviewable/editable autofill payloads for known form systems.
- **Application tracking**: every job can be tracked through a user-facing pipeline status and
  optional stage independent of the worker automation status. The owner can mark jobs as
  interested, drafting, applied/waiting, interviewing, offer, rejected, withdrawn, archived, or
  needing review from the PWA. Successful trusted submit/report moves the tracker to
  applied/waiting; worker pauses/failures move it to needs review. The Applications screen has a
  view selector: the default pipeline (cards) view, and an all-jobs **table view** — an in-app
  spreadsheet-style tracker listing every job post with a link back to each posting. A stats
  cluster in the header shows totals (total count for now). *Planned (not yet implemented):
  filtering and sorting for the all-jobs table, and the same filtering for the main Jobs feed.*
- **Trusted submit** to Greenhouse, Lever, and Ashby. LinkedIn Easy Apply is treated as higher-risk and gated behind an explicit feature flag. Submit only proceeds with explicit owner approval, a supported target, no unknown/sensitive fields, and an auditable status result.
- **LinkedIn contact and outreach**: save contact candidates linked to jobs, track why each is relevant, and generate tailored outreach drafts from a loose template. Drafts are presented prefilled for manual sending — never auto-sent.
- **Web push digest** via the VAPID-keyed Web Push API delivered to the installed PWA's service worker (the daily digest).
- **Resume upload and structured profile** capture, with sensitive fields stored encrypted.
- **Installable PWA shell**: manifest, app icon, full-screen standalone display, and an offline-tolerant app shell (service worker generated by go-app), plus the notification permission / install-guide flow.

### Phase 2 — Later

- Richer manual-entry and job-management UX beyond the lightweight Phase 1 fallback.
- Broader ATS platform support beyond Greenhouse/Lever/Ashby.
- Redis/Sidekiq for background jobs if needs outgrow Rails' built-in `solid_queue`.

### Out of Scope

- No native iOS app — PWA only (no App Store, no TestFlight, no Xcode signing pipeline).
- No broad web scraping as the first ingestion path.
- No automatic background sending of LinkedIn messages — outreach drafts are presented for manual send.
- No multi-user / public SaaS — single owner only.
- Trusted submit never proceeds without explicit per-application approval, never on unsupported platforms, and never when a form contains unknown or sensitive fields.

---

## Success Criteria

- A forwarded job-alert email reliably becomes a normalized job record; eligible postings are scored automatically within the daily triage budget, and filtered/deferred postings remain available for manual score requests.
- The daily push digest is delivered to the installed PWA via Web Push (VAPID).
- The owner can review a scored job and a generated application draft, and must approve before any submit occurs.
- The owner can see tracked applications in the PWA, manually change pipeline status/stage, and
  treat submitted applications as applied/waiting while later interview stages remain trackable.
- The worker fills supported ATS forms (Greenhouse, Lever, Ashby) and pauses or fails safely on unknown or sensitive fields, reporting an auditable status with logs/screenshots back to Rails.
- Sensitive resume/profile fields are encrypted at rest (Rails encryption).
- Trusted submit never fires without explicit per-application approval and the Rails submit gate
  rejects unsupported ATS targets or payloads with unresolved/sensitive fields before any worker
  dispatch job is enqueued.

---

## Constraints

- **Single-user privacy**: sensitive resume/profile fields are encrypted at rest using Rails encryption; no PII appears in logs.
- **iOS web push**: requires iOS 16.4+ and the PWA added to the home screen; the notification flow must detect this and guide the owner through install before requesting push permission.
- **Worker safety**: the automation worker must never auto-submit legal, demographic, salary, disability, sponsorship, or identity-sensitive answers unless the owner explicitly provided and approved those answers.
- **Cost and reliability**: deterministic scripts are preferred over LLM calls wherever input formats are predictable (ATS route detection, known-sender email parsing, title/location triage, route ranking, supported-form fill logic); LLM is the fallback for novel or unstructured input and is budgeted for bulk inbound scoring.
- **Routing**: employer / ATS application routes are preferred over job-board account automation whenever they can be found.

---

## Non-Goals

- Not a general-purpose, multi-tenant job-search SaaS — it is purpose-built for a single owner.
- Not a native mobile application — it is an installable PWA.
- Not an autonomous applicant — every submit and every LinkedIn outreach message requires explicit human action.
- Not a web scraper — discovery starts from forwarded email alerts, not crawling job boards.
