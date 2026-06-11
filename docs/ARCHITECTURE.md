# Architecture

> Canonical source for system topology, runtime boundaries, and component responsibilities.
> Other docs should link here rather than restating architecture details.

---

## Overview

Waunder is a single-user, mobile-first personal job-application assistant deployed as a
three-service monorepo on Railway. A Go + go-app WebAssembly PWA (`web`) serves the
installable app shell and proxies `/api/*` to a Ruby on Rails API (`api`), which is the
single source of truth for all data, LLM orchestration, notification dispatch, and
worker dispatch. A Node + Playwright automation worker (`worker`) executes only
pre-approved, structured submit tasks against supported ATS forms. Managed PostgreSQL
backs the Rails app, including its database-backed jobs, cache, and cable.

---

## System Topology

Three Railway services in one project, plus Railway managed PostgreSQL. Services
communicate over Railway's private network (no public internet hop). Redis is introduced
only if Sidekiq later replaces solid_queue.

- **web** (Railway — Go 1.26 + go-app v10 WebAssembly PWA + small native Go HTTP server;
  Go module `github.com/ag9898/waunder/web`): serves the compiled `app.wasm`, go-app's
  generated `wasm_exec.js`, the auto-generated PWA manifest and service worker, and the
  app shell. Reverse-proxies `/api/*` to the Rails `api` service over the private network.
  Built from an explicit two-target Dockerfile (`GOOS=js GOARCH=wasm go build -o web/app.wasm .`
  for the frontend, then a native server binary). Listens on `$PORT` (default `8000`).
- **api** (Railway — Rails 8.1.3 API-only, Ruby 3.2.3, Puma): owns all data, LLM
  orchestration via OpenRouter, notification dispatch, Resend inbound webhook handling,
  background jobs, and worker dispatch. Jobs run on `solid_queue`, cache on `solid_cache`,
  cable on `solid_cable` — all database-backed, so no Redis is required initially.
  Currently exposes only `/api/health` (custom JSON: `status`/`service`/`database`/`time`)
  and the Rails `/up` boot check. Has **no public domain** — reachable only through `web`'s
  proxy on the private network.
- **worker** (Railway — Node 22 + TypeScript ESM + Playwright): polls Rails for approved
  application tasks, fills supported ATS forms (`greenhouse`, `lever`, `ashby`,
  `linkedin_easy_apply`), captures screenshots and logs, and reports status back to Rails.
  Pauses or fails safely on unknown or sensitive fields. Configured entirely from env
  (`API_INTERNAL_URL`, `WORKER_POLL_INTERVAL_MS`, `WORKER_HEADLESS`).
- **PostgreSQL** (Railway managed): single source of truth. Sensitive resume/profile fields
  are encrypted at rest via Active Record Encryption.

The full topology and the rationale for the `/api` proxy routing decision live in
[`../initial_plan.md`](../initial_plan.md).

---

## Component Responsibilities

### web (Go + go-app PWA server)
- Serves the installable PWA: app shell, `app.wasm`, generated `wasm_exec.js`, web manifest,
  and service worker.
- Reverse-proxies `/api/*` to the Rails `api` service via `API_INTERNAL_URL`. When that var
  is unset, the proxy is disabled and the PWA serves standalone (local dev convenience).
- Holds **no business logic** — it never reads the database, never calls the LLM, and stores
  no secrets beyond the proxy target.

### api (Rails API)
- Owns **all** business logic: job/company/contact/application records, application and
  outreach drafts, resume/profile storage, push subscriptions, and audit events.
- Orchestrates LLM calls through OpenRouter (structured JSON for scoring, summaries, drafts).
- Handles the Resend inbound webhook (`/webhooks/resend/inbound`, Svix-signature-validated),
  notification dispatch (web push), background jobs (`solid_queue`), and worker dispatch.
- Encrypts sensitive resume/profile fields with Active Record Encryption — never plaintext.
- Owns the database schema; all changes go through Rails migrations.

### worker (Node + Playwright)
- Executes **only** approved, structured submit tasks handed off by Rails.
- Fills supported ATS forms using backend-generated autofill payloads.
- Never guesses on unknown or sensitive (legal/demographic/salary/disability/sponsorship/
  identity) fields; pauses or fails safely instead.
- Produces auditable results — status, logs, and screenshots reported back to Rails.

### database (Railway managed PostgreSQL)
- Single source of truth for all application state.
- Schema is managed exclusively through Rails migrations — never `ALTER TABLE` directly.
- Also backs `solid_queue` (jobs), `solid_cache` (cache), and `solid_cable` (cable).

---

## Data Flow

**Read request** (e.g. `GET /api/jobs`):
1. Browser issues the request to the `web` origin.
2. The Go server matches the `/api/` prefix and reverse-proxies to the `api` service over
   Railway's private network (`API_INTERNAL_URL`).
3. A Rails controller (an `Api::BaseController` subclass) handles the request.
4. Rails queries PostgreSQL and builds the JSON response.
5. The response flows back through the proxy to the browser.

**Inbound email ingestion**:
1. A forwarded job-alert email hits the Resend-verified receiving domain (`RESEND_INBOUND_DOMAIN`).
2. Resend parses it and POSTs an `email.received` event to `/webhooks/resend/inbound` on Rails;
   the Svix signature (`svix-id`/`svix-timestamp`/`svix-signature`) is validated against
   `RESEND_WEBHOOK_SECRET`.
3. Rails enqueues background jobs: parse alert → normalize job → resolve application route →
   LLM score via OpenRouter → generate draft.
4. A daily web-push digest is eventually sent to subscribed PWA installs.

**Resume sync (from the portfolio project)**:
1. The external portfolio project (`My_Portfolio`, a Next.js app) maintains the resume as a
   canonical JSON Resume object (`src/data/resume.json`) and exports `cv.pdf` + `CV_AG.md`.
2. After an export, its `npm run sync:resume` step opens a Waunder session (shared secret →
   `POST /api/session`) and pushes the three artifacts to `POST /api/profile/resume`.
3. Rails maps the JSON Resume **deterministically** (no LLM, no PDF parsing) into the singleton
   `Profile` and a primary `ResumeDocument` via `ResumeJsonImporter`: structured fields +
   `parsed_structure` from the JSON, `raw_text` from the markdown, and the PDF attached via
   Active Storage (the file a worker later uploads to an ATS form). Sensitive fields stay
   encrypted at rest. Re-syncs upsert the same singleton rows. See RESOLVED-18 in
   [`DECISIONS.md`](DECISIONS.md).

**Trusted submit**:
1. User reviews and approves a prepared application in the PWA.
2. Browser POSTs `POST /api/applications/:id/submit` (through the proxy) to Rails.
3. Rails verifies the application has explicit approval (`status: approved` plus
   `approved_at`), the draft has a supported ATS payload, and the payload contains no blank,
   unresolved, or sensitive fields requiring manual review.
4. Rails records a `submit_dispatched` `AuditEvent` and enqueues `WorkerDispatchJob` with the
   structured autofill payload.
5. The `worker` polls `GET /api/worker_tasks` with its `WORKER_SERVICE_TOKEN` bearer. Rails
   returns approved, dispatched applications as worker-shaped tasks; the human session cookie is
   not accepted on this endpoint.
6. The worker uses Playwright to fill the supported ATS form, then posts its terminal result to
   `POST /api/worker_tasks/:id/report` with status, reason, screenshot references, and logs.
7. Rails updates the final application status and records a `worker_status_reported`
   `AuditEvent` containing the audit artifacts.

---

## Auth

Waunder is a single-user private app. The browser **only ever talks to the `web` origin**;
all `/api/*` traffic is forwarded server-side by the Go proxy to the `api` service. Because
the frontend is same-origin, there is **no CORS** to configure, the service-worker scope and
web-push registration stay clean, and Rails needs no public domain.

The owner authenticates with a single shared passphrase (`APP_SHARED_SECRET`) exchanged at
`POST /api/session` for a signed, HTTP-only session cookie (signed with `SESSION_SECRET`).
`Api::BaseController` enforces that session on every `/api` endpoint except health. The `worker`
authenticates service-to-service with a static `WORKER_SERVICE_TOKEN` bearer on its task-pull and
status-report endpoints — it does not use the human session. See RESOLVED-14 in
[`DECISIONS.md`](DECISIONS.md).

---

## External Dependencies

| Service | Purpose | Required / Optional |
|---|---|---|
| Railway managed PostgreSQL | Primary datastore; also backs solid_queue/solid_cache/solid_cable | Required |
| Resend | Inbound email for forwarded job alerts (`email.received` → `POST /webhooks/resend/inbound`, Svix-signature-validated) — the first ingestion path. Inbound-only; the app sends no email (RESOLVED-13). | Required for email ingestion |
| OpenRouter | LLM gateway for scoring, summaries, and drafts (structured JSON); model configurable by env | Required for scoring/drafting features |
| Web Push (VAPID) | Push notifications via the go-app service worker (iOS 16.4+, PWA installed to home screen) | Required for the push digest |
| Portfolio project (`My_Portfolio`) | External source of truth for the resume; pushes its JSON Resume + exported PDF/markdown to `POST /api/profile/resume` (push-on-export). Waunder never reaches back into it. | Optional — provides the resume; manual upload is the fallback |
| Active Storage (local disk service) | Stores the resume PDF blob attached to `ResumeDocument`. On Railway the local disk is ephemeral, but the portfolio re-pushes the PDF on every export, so it self-heals (RESOLVED-18). | Required to hold the worker-uploadable resume file |
| Redis / Sidekiq | Background-job backend only if needs outgrow solid_queue | Optional — not used initially; database-backed solid_queue is the default |

---

## Deployment Targets

There is **no staging environment** — only Production (Railway) and Local dev.

| Environment | web | api | worker | database |
|---|---|---|---|---|
| Production | Railway service `web` | Railway service `api` | Railway service `worker` | Railway managed Postgres |
| Staging | N/A (no staging) | N/A (no staging) | N/A (no staging) | N/A (no staging) |
| Local dev | `localhost:8000` (Go server, `make run`) | local Rails (`bin/rails s`, e.g. `:3000`) | local Node worker (`npm run dev`) | local/Docker Postgres |

See [`ENV_VARS.md`](ENV_VARS.md) for the canonical variable and secret matrix per environment.

---

## Constraints

- The browser only ever talks to the `web` origin — never directly to Rails.
- All `/api` traffic goes through the Go proxy; the Rails `api` service has no public domain.
- Rails is the single source of truth — **no business logic in the Go server or the worker**.
- Schema changes go through Rails migrations only — never `ALTER TABLE` or `DROP COLUMN` directly.
- Secrets are read from environment variables only — no hardcoded values anywhere.
- Sensitive resume/profile fields must be encrypted at rest (Active Record Encryption) — never plaintext.
- The worker never auto-submits and never answers unknown or sensitive fields (legal,
  demographic, salary, disability, sponsorship, identity) unless the user explicitly provided
  and approved those answers.
- Trusted submit is allowed only for supported ATS platforms and only after explicit
  per-application approval.
- Prefer deterministic scripts over LLM calls wherever input formats are predictable.
