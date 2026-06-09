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
  orchestration via OpenRouter, notification dispatch, Mailgun inbound webhook handling,
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
- Handles the Mailgun inbound webhook (signature-validated), notification dispatch (web push),
  background jobs (`solid_queue`), and worker dispatch.
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
1. A forwarded job-alert email hits a Mailgun inbound route.
2. Mailgun POSTs to `/webhooks/mailgun/inbound` on Rails; the signature is validated.
3. Rails enqueues background jobs: parse alert → normalize job → resolve application route →
   LLM score via OpenRouter → generate draft.
4. A daily web-push digest is eventually sent to subscribed PWA installs.

**Trusted submit**:
1. User reviews and approves a prepared application in the PWA.
2. Browser POSTs `POST /api/applications/:id/submit` (through the proxy) to Rails.
3. Rails enqueues a worker dispatch job with a structured autofill payload.
4. The `worker` polls/receives the approved task and uses Playwright to fill the supported
   ATS form.
5. The worker reports status, logs, and screenshots back to Rails.
6. Rails records an `AuditEvent` and the final application status.

---

## Auth

Waunder is a single-user private app. The browser **only ever talks to the `web` origin**;
all `/api/*` traffic is forwarded server-side by the Go proxy to the `api` service. Because
the frontend is same-origin, there is **no CORS** to configure, the service-worker scope and
web-push registration stay clean, and Rails needs no public domain.

A session mechanism (`POST /api/session`) is planned, but the **exact mechanism is an open
decision** — it has not been chosen and must not be invented ad hoc. See
[`DECISIONS.md`](DECISIONS.md) for the open question and its eventual resolution.

---

## External Dependencies

| Service | Purpose | Required / Optional |
|---|---|---|
| Railway managed PostgreSQL | Primary datastore; also backs solid_queue/solid_cache/solid_cable | Required |
| Mailgun | Inbound email routes for forwarded job alerts (`POST /webhooks/mailgun/inbound`, signature-validated) — the first ingestion path | Required for email ingestion |
| OpenRouter | LLM gateway for scoring, summaries, and drafts (structured JSON); model configurable by env | Required for scoring/drafting features |
| Web Push (VAPID) | Push notifications via the go-app service worker (iOS 16.4+, PWA installed to home screen) | Required for the push digest |
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
