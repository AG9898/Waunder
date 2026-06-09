# Waunder Initial Build Plan

## Summary

Waunder is a mobile-first personal job application assistant. It should find and score relevant job openings, notify the user, draft tailored application materials, track contacts, generate outreach messages, and support trusted application submission only after explicit user approval.

Initial direction:

- Frontend: **Go + go-app**, a WebAssembly PWA (Progressive Web App), installable to the iPhone home screen. No native build, no App Store / TestFlight.
- Backend: Ruby on Rails API in the same monorepo.
- Hosting: Railway.
- Database and jobs: PostgreSQL plus Rails background jobs, with Redis/Sidekiq if needed.
- Notifications: **Web Push API** via the service worker that go-app generates (VAPID keys). Replaces the earlier FCM/APNs plan.
- Email ingestion: Mailgun inbound routes for forwarded job-alert emails.
- LLM provider: OpenRouter, using structured JSON responses where supported.
- Privacy: single-user app with encrypted backend storage for resume/profile data.
- Automation boundary: LLM drafts, scores, tailors, prepares autofill data, and can perform trusted submit only after explicit user approval.

Why PWA instead of native iOS: this is a solo, single-user app, so the cost of the Apple native pipeline (Apple Developer account, macOS/Xcode signing, TestFlight distribution) buys nothing. A PWA installs to the iPhone home screen with its own icon, runs full-screen, and supports web push — without any of that overhead.

Current environment note: `/home/ag9898/projects` exists. This file lives in `/home/ag9898/projects/Waunder`. At planning time, local `go`, `ruby`, and `rails` commands should be verified; environment setup (Go toolchain for WASM builds, Ruby/Rails, PostgreSQL) should be part of the first implementation pass.

## Repository Shape

Create Waunder as a monorepo:

```txt
Waunder/
  web/         # Go + go-app PWA (WebAssembly frontend + small Go server)
  api/         # Rails API-only app
  workers/     # Playwright automation worker, likely Node-based
  docs/        # Architecture notes, setup guide, service decisions
  initial_plan.md
  README.md
```

The `web/` service is a small Go HTTP server using go-app's `app.Handler` to serve the compiled WASM bundle, the auto-generated PWA manifest, and the service worker. The PWA's Go components talk to the Rails API over HTTP/JSON; Rails remains the single source of truth and owns all data, LLM, and worker orchestration. The Go server holds no business logic beyond serving the app shell and proxying API calls (see Deployment).

## Deployment (Railway)

Everything on Railway runs as a container. Each service becomes its own OCI image with its own environment variables, and services in the same project communicate over Railway's **private network** without traversing the public internet.

Service topology — three Railway services in one project:

- `web` — Go + go-app PWA server.
- `api` — Rails API.
- `worker` — Playwright automation worker.

Plus managed PostgreSQL (and Redis if Sidekiq is introduced).

Build model:

- `web` uses an explicit **Dockerfile**, because go-app is a two-target build that Railway's auto-builder (Nixpacks/Railpack) does not handle on its own:
  1. Compile the frontend to WebAssembly: `GOOS=js GOARCH=wasm go build -o app.wasm ./cmd/app`.
  2. Build the server binary that serves `app.wasm`, go-app's `wasm_exec.js`, the manifest, and the service worker.
- `api` and `worker` can use Railway auto-build or their own Dockerfiles.

**Routing decision — the `web` Go server proxies `/api` to Rails over the private network.** The browser only ever talks to the `web` origin; requests under `/api/*` are forwarded server-side to the `api` service. This keeps the frontend same-origin (no CORS), keeps the service worker scope and push registration clean, and means the Rails API does not need a public domain. The Rails API base URL is supplied to the Go server via an environment variable (e.g. `API_INTERNAL_URL`).

## Product Scope

### Job Discovery

- Start with forwarded job-alert emails through Mailgun inbound webhooks.
- Parse inbound alerts into normalized job records.
- Support manual job/link entry later as a fallback.
- Avoid broad scraping as the first ingestion path.

### Application Route Resolution

Waunder should separate where a job was discovered from where the application should actually be submitted. Discovery may come from LinkedIn, Glassdoor, Indeed, email alerts, or manual saves, but application should prefer canonical employer or ATS routes when available.

For each job, Waunder should attempt to store:

- Source URL where the job was found.
- Canonical job posting URL.
- Application URL.
- Application route type.
- Recommended route.
- Route confidence.

Preferred application route order:

1. Direct ATS/company application URL.
2. Company careers page.
3. Job-board external apply URL.
4. LinkedIn Easy Apply, Indeed Apply, or Glassdoor Apply.
5. Manual apply only.

Initial route types:

- `company_careers`
- `greenhouse`
- `lever`
- `ashby`
- `workday`
- `linkedin_easy_apply`
- `indeed_apply`
- `glassdoor_apply`
- `unknown`

If a job is discovered on a job board but links to a real employer ATS, Waunder should recommend the ATS route. For example, a Glassdoor posting that ultimately links to Greenhouse should be treated as a Glassdoor discovery source with Greenhouse as the preferred application route.

### Scripted Automation

Where input formats are predictable, prefer deterministic scripts over LLM calls to reduce cost and improve reliability.

Obvious candidates:
- ATS route detection from URL patterns (Greenhouse, Lever, Ashby, Workday all have recognizable signatures).
- ATS detection from careers page content (known JS bundles, iframes, form attributes).
- Form fill logic for supported ATS platforms — scripts handle navigation, LLM generates the payload content.
- Job alert email parsing for known senders (LinkedIn, Indeed, Glassdoor have stable HTML formats).
- Application route preference ranking (pure logic from the priority list above).

Fall back to LLM when no pattern matches or the format is novel or unstructured.

### Job Scoring and Summaries

Use OpenRouter-backed LLM calls to generate:

- Job summary.
- Match score.
- Relevant requirements.
- Missing or weak requirements.
- Resume alignment notes.
- Suggested application strategy.
- Red flags.

### Application Assistance

The app should generate:

- Tailored resume emphasis notes.
- Cover letter or message drafts where relevant.
- Structured application answers.
- Autofill payloads for known form systems.

Trusted submit is allowed only when:

- The user explicitly approves the prepared application.
- The target platform is supported.
- The form contains no unknown or sensitive fields requiring manual review.
- The automation worker can produce an auditable status result.

Initial trusted-submit targets:

- Greenhouse.
- Lever.
- Ashby.
- LinkedIn Easy Apply.

LinkedIn Easy Apply should be treated as higher-risk and implemented behind an explicit feature flag.

### LinkedIn Contact and Outreach Flow

Waunder should:

- Save contact candidates related to job posts.
- Track why each contact may be relevant.
- Generate tailored outreach drafts from a loose template.
- Open or present prefilled message text for manual sending.

MVP should not send LinkedIn messages in the background.

## Core Backend Responsibilities

Rails API should own:

- User/session access for a single-user private app.
- Job records.
- Company records.
- Contact candidates.
- Application records.
- Application drafts.
- Outreach drafts.
- Resume/profile storage.
- Web push subscriptions (endpoint + keys per installed PWA).
- Audit events.
- Mailgun inbound webhook handling.
- LLM orchestration through OpenRouter.
- Notification dispatch.
- Automation worker dispatch.

Sensitive resume/profile fields should use Rails encryption.

## Core Web (PWA) Responsibilities

The go-app PWA should provide:

- Daily job digest view.
- Job feed and job detail screens.
- Application preparation/review screens.
- Approval flow before submit.
- Contact candidate review.
- Outreach draft review.
- Resume upload.
- Structured profile form.
- Web push subscription / notification permission flow.
- Application/contact status tracking.
- Installable PWA shell: manifest, app icon, full-screen standalone display, and offline-tolerant app shell (service worker generated by go-app).

The primary device target is the user's iPhone (installed to home screen), but the UI should stay responsive so it also works on desktop browsers. iOS web push requires iOS 16.4+ and that the PWA be added to the home screen; the notification flow should detect and guide the user through install when push is requested.

## Core Worker Responsibilities

The Playwright worker should:

- Receive approved application tasks from Rails.
- Use structured autofill payloads generated by the backend.
- Fill supported ATS forms.
- Pause or fail safely when it encounters unsupported fields.
- Avoid submitting legal, demographic, salary, disability, sponsorship, or identity-sensitive answers unless the user explicitly provided and approved those answers.
- Report status, logs, and screenshots back to Rails.

## Initial API Surface

Suggested starting endpoints:

- `POST /api/session`
- `GET /api/jobs`
- `GET /api/jobs/:id`
- `POST /api/jobs/:id/approve`
- `POST /api/jobs/:id/archive`
- `POST /api/jobs/:id/application_draft`
- `POST /api/applications/:id/submit`
- `GET /api/contacts`
- `POST /api/contacts/:id/outreach_draft`
- `POST /api/profile`
- `POST /api/resume_documents`
- `POST /api/push_subscriptions`
- `POST /webhooks/mailgun/inbound`

Suggested starting resources:

- `Profile`
- `ResumeDocument`
- `JobPost`
- `ApplicationRoute`
- `Company`
- `ContactCandidate`
- `Application`
- `ApplicationDraft`
- `OutreachDraft`
- `PushSubscription`
- `AuditEvent`

## Background Jobs

Initial background job types:

- Parse inbound job alert email.
- Normalize job data.
- Resolve canonical application route.
- Generate LLM summary and match score.
- Generate application draft/autofill payload.
- Generate outreach draft.
- Send daily push digest.
- Dispatch approved submit request to worker.

## Testing Plan

Rails:

- Request specs for JSON endpoints.
- Model specs for encrypted profile/resume storage.
- Webhook specs for Mailgun signature validation and inbound parsing.
- Job specs for mocked OpenRouter responses.
- Worker dispatch specs for approved application submissions.

Web (go-app):

- Go component/render tests for job feed, job detail, approval flow, profile form, and draft review.
- API client tests with mocked Rails responses.
- Push subscription flow tested behind an abstraction (browser Notification/Push APIs mocked).
- A PWA smoke check: manifest validity, service worker registration, and installability.

Automation:

- Playwright tests against fixture pages for Greenhouse, Lever, Ashby, and a mocked Easy Apply-style flow.
- Required pause/fail tests for unknown questions, sensitive fields, missing resume data, expired sessions, and unsupported form states.

End-to-end MVP scenario:

- Forward job alert email to Mailgun.
- Rails ingests and scores job.
- Push notification is sent.
- User reviews job in the PWA.
- Waunder generates tailored application draft.
- User approves submit.
- Worker attempts supported form fill/submit.
- Rails reports final application status back to the app.

## Assumptions

- Waunder is initially personal/single-user, not a public SaaS.
- The frontend is a go-app WebAssembly PWA, installed to the iPhone home screen — no native build, App Store, or TestFlight. The Linux environment can fully build, run, and deploy both the PWA and the backend.
- iOS web push requires iOS 16.4+ and the PWA to be installed (added to home screen). Push when the app is fully closed is supported but less aggressive than native; acceptable for a once-daily digest.
- The service worker and any browser push glue run in JavaScript (no WASM Web Push API); go-app generates the service worker, keeping this to a small contained surface.
- Railway is the default deployment target.
- Mailgun is the first inbound email provider.
- OpenRouter is the first LLM gateway; model choice should remain configurable by environment variable.
- Trusted submit is allowed only after explicit approval and only for supported flows.
- LinkedIn outreach is opened/presented for manual sending, not automatically sent.
- Broad scraping is out of scope for the first ingestion path.
- Employer/ATS application routes should be preferred over job-board account automation whenever they can be found.
