# Waunder — Agent Working Guide

This file is a LIVING DOCUMENT — not a static README. Agents update it after every task
cycle with new discoveries and constraints; engineers seed it at project setup with known
pitfalls and architecture.

---

## Overview

Waunder is a mobile-first, single-user personal job-application assistant: it finds and
scores relevant job openings, notifies the user, drafts tailored application materials,
tracks contacts, and performs trusted application submission only after explicit per-application
approval. It is a monorepo of three services deployed on Railway — `api/` (Rails 8.1 API,
the single source of truth for all data, LLM orchestration, jobs, and worker dispatch),
`web/` (a Go + go-app WebAssembly PWA shell plus a small server that reverse-proxies `/api/*`
to Rails — no business logic), and `workers/` (a Node + Playwright worker that executes only
pre-approved structured submit tasks). Agents implement workboard tasks: features, fixes,
schema migrations, and infra changes. The canonical task queue is `docs/workboard.json`, and
skills are available at `.claude/skills/` (synced from ag.dev).

---

## Quick Start

Prerequisites: Ruby 3.2.3, Go 1.26, Node 22, PostgreSQL.

```bash
# --- api/ (Rails 8.1 API) ---
cd api && bin/setup          # install gems, prepare the database
bin/rails s                  # start the API server
bundle exec rspec            # run the test suite

# --- web/ (Go + go-app PWA) ---
cd web && make run           # build app.wasm + server, serve on :8000

# --- workers/ (Node + Playwright) ---
cd workers && npm install    # install dependencies
npm run dev                  # run the worker (tsx watch)
npm test                     # run worker tests

# --- Lint / typecheck ---
cd api && bin/rubocop        # Ruby lint (rubocop-rails-omakase)
cd web && go vet ./...       # Go static checks
cd workers && npm run typecheck  # TypeScript type check
```

---

## Build & Verification Commands

Run the fast checks for whichever service you touched before marking a task done. Never skip
a fast check. Skip slow checks only when the task says so.

| Command | What it checks | Speed |
|---------|---------------|-------|
| `cd api && bundle exec rspec` | Rails request / model / job specs | fast |
| `cd api && bin/rubocop` | Ruby lint (rubocop-rails-omakase) | fast |
| `cd workers && npm test` | Worker safety / unit tests | fast |
| `cd workers && npm run typecheck` | TypeScript types (`tsc --noEmit`) | fast |
| `cd web && go test ./...` | Go tests | fast |
| `cd web && go vet ./...` | Go static checks | fast |
| `cd api && bin/ci` | Full CI incl. brakeman + bundler-audit | slow |
| `cd web && make wasm` | WASM frontend build (`GOOS=js GOARCH=wasm`) | slow |

---

## Repository Structure

```
web/           Go + go-app WebAssembly PWA (frontend) + small Go server
  main.go         App routing + HTTP server that reverse-proxies /api/* to Rails
  components/     go-app UI components (compiled to WASM)
  Makefile        wasm / server / run build targets
  Dockerfile      Two-target (WASM + native server) build for Railway
api/           Rails 8.1 API-only app (single source of truth)
  app/controllers/api/  Client-facing JSON endpoints (under /api)
  app/jobs/             solid_queue background jobs
  config/routes.rb      Route definitions
  spec/                 RSpec test suite
workers/       Node + TypeScript + Playwright automation worker
  src/index.ts    Worker entrypoint
  src/worker.ts   Task execution loop
  src/safety.ts   Unknown/sensitive-field gating
  src/types.ts    Shared task/payload types
  src/config.ts   Worker configuration
  src/ats/        Per-ATS form-fill logic
docs/          Project docs and task queue
  INDEX.md        Documentation navigation map
  PRD.md          Product requirements and scope
  ARCHITECTURE.md System topology and boundaries
  CONVENTIONS.md  Coding standards and patterns
  DECISIONS.md    Architectural decision log
  ENV_VARS.md     Environment variable matrix
  TESTING.md      Test strategy and inventory
  workboard.json  Canonical task queue
  workboard.schema.json JSON Schema for task queue
  workboard.md    Workboard field definitions and usage rules
initial_plan.md  Authoritative original build plan
README.md      Repository overview
.claude/       Claude harness config
  skills/      Synced skills (do not edit here — edit source in ag.dev)
```

Docs navigation: [`docs/INDEX.md`](docs/INDEX.md)

---

## Architecture

- Rails (`api/`) is the single source of truth: it owns all data, LLM orchestration (OpenRouter), background jobs, Mailgun inbound webhooks, web-push dispatch, and worker dispatch.
- The Go web server (`web/`) is app-shell + `/api` reverse proxy only. It holds no business logic and no database access.
- The browser only ever talks to the `web` origin. `/api/*` is proxied server-side to Rails over Railway's private network — no CORS, and Rails has no public domain.
- Database schema changes happen exclusively through Rails migrations. Never alter tables directly.
- Sensitive resume/profile fields are encrypted at rest with Active Record Encryption.
- Configuration is read from environment variables only. No hardcoded URLs, keys, or model names.
- The worker (`workers/`) executes only pre-approved structured submit tasks and pauses/fails safely on unknown or sensitive fields.

Full topology, component responsibilities, data flow, and deployment targets: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

---

## Code Style & Constraints

### Never

- Never commit secrets or credentials.
- Never bulk-rewrite `docs/workboard.json`; use targeted edits only.
- Never put business logic in the Go web server or the worker — all logic and data live in Rails.
- Never auto-submit an application without explicit per-application user approval.
- Never auto-answer unknown or sensitive fields (legal, demographic, salary, disability, sponsorship, identity) unless the user explicitly provided and approved those answers.
- Never store sensitive resume/profile fields unencrypted.
- Never auto-send LinkedIn messages; outreach is prefilled for manual sending only.

### Always

- Always run the fast verification suite before marking a task done.
- Always update relevant `docs/` files when behavior changes.
- Always prefer deterministic scripts over LLM calls where input formats are predictable (ATS detection, known-sender email parsing, route ranking, supported-ATS form fill).
- Always return an auditable worker status (screenshots and logs) for every submit attempt.
- Always keep the frontend same-origin by routing through the `/api` proxy.
- Always update the relevant `docs/` file in the same commit as a behavior change.

### Patterns

- API endpoints live under the `/api` namespace in `api/config/routes.rb` and controllers in `app/controllers/api/`.
- Background work goes through solid_queue jobs in `app/jobs/`, not inline in controllers.
- Worker tasks flow through `src/safety.ts` gating before any form interaction; per-ATS logic lives in `src/ats/`.

Full convention guide: [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md)

---

## Maintaining Docs

Docs must stay current with the code. Update the relevant doc in the **same commit** as
the code change — never defer a doc update to a follow-up task.

| What changed | Doc to update |
|---|---|
| System topology, services, auth, data flow, deployment | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| Coding pattern, naming rule, or never/always constraint | [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) |
| Env var added, removed, renamed, or changed | [`docs/ENV_VARS.md`](docs/ENV_VARS.md) |
| New architectural question raised | [`docs/DECISIONS.md`](docs/DECISIONS.md) — add OPEN-XX |
| Architectural decision resolved | [`docs/DECISIONS.md`](docs/DECISIONS.md) — move to Resolved |
| Test file added, removed, or pattern changed | [`docs/TESTING.md`](docs/TESTING.md) |
| Product scope, users, or success criteria changed | [`docs/PRD.md`](docs/PRD.md) |
| Any doc added, removed, renamed, or moved | [`docs/INDEX.md`](docs/INDEX.md) — always |
| Constraint or gotcha discovered during a task | This file (`AGENTS.md`) — append to Discoveries |

**Rule:** If a section in `AGENTS.md` summarizes something, and the full doc changes, update
both the summary here and the full doc in the same commit.

---

## Workboard

The canonical task queue is `docs/workboard.json`.
Schema and usage contract: [`docs/workboard.md`](docs/workboard.md).
Machine validation schema: [`docs/workboard.schema.json`](docs/workboard.schema.json).

Use the `/query-workboard` skill to inspect it. Use the `/start-task` skill to execute
a task end-to-end. Never dump the full board into context — use targeted `jq` queries.

A task is startable when:
- `status == "todo"`
- `blocked_by` is empty or missing
- all `depends_on` tasks have `status == "done"`

Targeted edit rules:
- Never rewrite the full `workboard.json`.
- Only update the status fields of the task currently being worked.
- Roll back `in_progress → todo` if blocked mid-task and unresolved.

---

## Agent Workflow

Standard task cycle for this project:

1. Read this file (`AGENTS.md` / `CLAUDE.md`) at the start of every session.
2. Run `/query-workboard` to find the next startable task.
3. Run `/start-task` to execute it (reads docs, implements, verifies, updates board).
4. Update this file if you discovered a constraint, pattern, or pitfall worth encoding.
5. Commit changes. Summarize: what was done, what was skipped, what is next.

For multi-task runs: `/ralphloop start-task iterations:N`.

Skills are sourced from ag.dev and synced into `.claude/skills/`.

### Stopping Conditions

Stop and report (do not continue) when:
- No startable task exists (all are blocked or done).
- A verification command fails and the fix is not obvious.
- An irreversible action (migration, destructive write, external publish) is required
  and the task does not explicitly authorize it.
- Before any real trusted-submit run that lacks explicit per-application user approval.
- When a worker task encounters unknown or sensitive fields (legal, demographic, salary, disability, sponsorship, identity).
- Before introducing Redis/Sidekiq (OPEN-01) or settling the single-user auth/session model (OPEN-02) without explicit owner instruction.
- Before sending a real web-push notification, real outbound email, or incurring real LLM spend in a test context.

---

## Debugging & Gotchas

- The `web/` service is one Go package compiled twice: to WebAssembly (`GOOS=js GOARCH=wasm`) for the frontend, and to a native binary for the server. On the client `app.RunWhenOnBrowser()` takes over and the server code never runs; on the server it is a no-op and HTTP starts.
- The Go server reads `API_INTERNAL_URL` to proxy `/api/*`. When unset, the proxy is disabled and the PWA still serves standalone in local dev — so a missing API_INTERNAL_URL is not a crash, just no backend.
- The Go server listens on `$PORT` (default 8000).
- There is no staging environment: only Production (Railway) and local dev.

---

## Environment Variables

Names agents commonly need (no values here): `API_INTERNAL_URL` (Rails base URL for the web
proxy), `PORT` (web server port, default 8000), `OPENROUTER_*` (LLM gateway + `OPENROUTER_MODEL`),
VAPID keys (web push), Active Record Encryption keys, Mailgun credentials, `DATABASE_URL`, and a
conditional `REDIS_URL` (only if Redis/Sidekiq is ever introduced — see OPEN-01).

See [`docs/ENV_VARS.md`](docs/ENV_VARS.md) for the canonical variable and secret matrix.

---

## Testing

Before marking any task done, run the fast checks for the service you changed: `cd api &&
bundle exec rspec` and `cd api && bin/rubocop` for Rails; `cd workers && npm test` and `npm run
typecheck` for the worker; `cd web && go test ./...` and `go vet ./...` for the web service.

Full test strategy, file inventory, and patterns for writing new tests: [`docs/TESTING.md`](docs/TESTING.md)

---

## Deployment

Deployment target is Railway: three services (`web`, `api`, `worker`) in one project plus
managed PostgreSQL, communicating over Railway's private network. There is no staging — only
Production and local dev. Agents must not deploy or perform irreversible production actions
(migrations against production, destructive writes, external publishes) unless a task explicitly
authorizes it.

---

## Living Document

This file is a running notebook of agent discoveries. After each task cycle, update
this file if you found:

- A constraint that would have saved time if it were written here.
- A debugging tip that resolves a non-obvious failure.
- A pattern that should be followed for consistency.
- A "never do X" rule that emerged from a near-miss.

Append under `## Discoveries` below. Keep each entry to 2–3 sentences with a date.
Do not reorganize or rewrite existing entries — append only.

```
### YYYY-MM-DD — <short title>
<What you found and why future agents working here should know it.>
```

---

## Discoveries

Agents: append new discoveries here after each task cycle, one entry each, using the
`### YYYY-MM-DD — <short title>` format described above. Append only; do not rewrite existing
entries.
