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
and the Resend inbound webhook path to Rails — no business logic), and `workers/` (a Node +
Playwright worker that executes only pre-approved structured submit tasks). Agents implement
workboard tasks: features, fixes, schema migrations, and infra changes. The canonical task queue
is `docs/workboard.json`, and skills are available at `.claude/skills/` (synced from ag.dev).

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
  main.go         App routing + HTTP server that reverse-proxies /api/* + Resend webhook to Rails
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
  PRODUCTION_SETUP.md Production setup runbook and non-secret live integration facts
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

- Rails (`api/`) is the single source of truth: it owns all data, LLM orchestration (OpenRouter), background jobs, Resend inbound webhooks, web-push dispatch, and worker dispatch.
- The Go web server (`web/`) is app-shell + `/api` and Resend webhook reverse proxy only. It holds no business logic and no database access.
- The browser only ever talks to the `web` origin. `/api/*` and the Resend inbound webhook path are proxied server-side to Rails over Railway's private network — no CORS, and Rails has no public domain.
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
- Before introducing Redis/Sidekiq (OPEN-01) without explicit owner instruction. (The auth/session model is resolved — RESOLVED-14: shared-secret session cookie + worker bearer token.)
- Before sending a real web-push notification or incurring real LLM spend in a test context. (Waunder sends no outbound email — Resend is inbound-only.)

---

## Debugging & Gotchas

- The `web/` service is one Go package compiled twice: to WebAssembly (`GOOS=js GOARCH=wasm`) for the frontend, and to a native binary for the server. On the client `app.RunWhenOnBrowser()` takes over and the server code never runs; on the server it is a no-op and HTTP starts.
- The Go server reads `API_INTERNAL_URL` to proxy `/api/*` and `/webhooks/resend/inbound`. When unset, the proxy is disabled and the PWA still serves standalone in local dev — so a missing API_INTERNAL_URL is not a crash, just no backend.
- The Go server listens on `$PORT` (default 8000).
- There is no staging environment: only Production (Railway) and local dev.

---

## Environment Variables

Names agents commonly need (no values here): `API_INTERNAL_URL` (Rails base URL for the web
proxy), `PORT` (web server port, default 8000), `OPENROUTER_*` (LLM gateway + `OPENROUTER_MODEL`),
VAPID keys (web push), Active Record Encryption keys, auth secrets (`APP_SHARED_SECRET`,
`SESSION_SECRET`, `WORKER_SERVICE_TOKEN`), `RESEND_WEBHOOK_SECRET` (inbound email), `DATABASE_URL`,
and a conditional `REDIS_URL` (only if Redis/Sidekiq is ever introduced — see OPEN-01).

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

### 2026-06-09 — Rails encryption init output
`bin/rails db:encryption:init` emits nested `active_record_encryption` YAML keys (`primary_key`,
`deterministic_key`, and `key_derivation_salt`), not the uppercase env var names. Redirect the
command to a private temp file and map those keys into `ACTIVE_RECORD_ENCRYPTION_*` values without
printing the generated secrets.

### 2026-06-09 — Railway blank variable writes
`railway variable set KEY --stdin --skip-deploys` fails when stdin is empty. During provisioning,
set only populated values and explicit Railway references; leave blank optional `.env` keys unset
until real integration secrets exist.

### 2026-06-09 — Rails JSON default validations
Rails `presence` validation treats empty JSON arrays and objects (`[]`/`{}`) as blank. For JSONB
columns that default to empty payloads, validate the Ruby shape (`Array`/`Hash`) instead of
requiring presence.

### 2026-06-09 — Svix Ruby verified payload keys
The `svix` Ruby gem verifies Resend webhook signatures against the raw request body, but the
verified JSON payload may come back with symbol keys. Normalize the verified event with
`deep_stringify_keys` before checking Resend fields like `type`, `id`, and `data`.

### 2026-06-10 — Inbound parse fallback flag without a migration
Inbound email parsing flags LLM fallback by writing a `parse_result` object into the existing
`inbound_emails.raw_payload` jsonb (no schema change), keeping the raw content persisted. Service
objects under `app/services/inbound_email_parsers/` autoload via Zeitwerk — do NOT add
`require_relative` between them or you get "already loaded" / redefinition errors; rely on the
namespace-matching path (`linked_in.rb` → `InboundEmailParsers::LinkedIn`).

### 2026-06-10 — ApplicationRoute schema already complete; no migration for ROUTE-01
The `application_routes` table already ships every column route resolution needs (`route_type`
default `unknown` + check constraint, `route_confidence` decimal(4,3) range constraint,
`recommended_route`, `application_url`, `canonical_posting_url`, `source_url`), so deterministic
resolution (`ApplicationRouteResolver`) needs no migration. Note `route_type` uses the
`*_easy_apply`/`*_apply` enum values (`linkedin_easy_apply`, `indeed_apply`, `glassdoor_apply`),
while `recommended_route` is a separate free string capturing *how* to apply (`direct_ats`,
`job_board_apply`, `manual`). Resolution is hooked into `InboundEmailParser#persist` right after
JobPost creation.

### 2026-06-10 — JobPost scoring fields already exist; no migration for LLM-02
The `job_posts` table already has every scoring column (`summary`, `match_score` with a 0–100
check constraint, `relevant_requirements`/`missing_requirements`/`red_flags` jsonb arrays,
`resume_alignment_notes`, `application_strategy`, `scoring_status` default `pending`, `scored_at`),
so `JobScorer`/`ScoreJobPostJob` needed no migration. `scoring_status` is a free string column —
the values in use are `pending` (set at ingest), `scored`, `skipped` (no API key), and `failed`
(client error). The repo has no FactoryBot; job/service specs build records with plain
`Model.create!` and inject a mocked client via the `client:` keyword (mirroring the
OpenrouterClient fake-transport seam).

### 2026-06-10 — Resume ingested from the portfolio's JSON Resume, not parsed from PDF
The resume's source of truth is the external `My_Portfolio` repo, which maintains a JSON Resume
(`src/data/resume.json`) and pushes it + the exported `cv.pdf`/`CV_AG.md` to `POST /api/profile/resume`
on every export (`scripts/sync-resume.js` → `npm run sync:resume`). `ResumeJsonImporter` maps it
deterministically (no LLM/OCR) into the singleton `Profile` + a primary `ResumeDocument`; the JSON is
`parsed_structure`, markdown is `raw_text`, PDF is an Active Storage attachment (`has_one_attached
:file`). Active Storage was NOT installed before this — run `bin/rails active_storage:install` + migrate
(done). The ingest reuses the shared-secret session (the portfolio logs in via `POST /api/session`),
so no new auth surface. Profile reads expose encrypted PII as presence flags only, never the raw value.
Cross-repo: changes to `My_Portfolio` are documented in ITS docs (ENV_VARS/ARCHITECTURE/Discoveries) too.

### 2026-06-10 — OpenrouterClient uses stdlib net/http (no Faraday/HTTParty in bundle)
The api/ Gemfile has no HTTP client gem, so `OpenrouterClient` uses stdlib `Net::HTTP`. Tests must
not hit the network: the client exposes an `http:` transport seam so specs inject a fake transport
returning canned responses — there is no WebMock/VCR in this repo. Class name is `OpenrouterClient`
(Zeitwerk-cased from `openrouter_client.rb`). The route-resolver determinism spec was updated to
assert `OpenrouterClient` is never `.new`'d rather than asserting the constant is undefined.

### 2026-06-10 — Active Record Encryption was unwired until DATA-03
The `ACTIVE_RECORD_ENCRYPTION_*` env vars existed in `.env` but Rails read none of them (no dotenv
gem, `.env` not auto-loaded, keys not in credentials). `config/initializers/active_record_encryption.rb`
now maps those env vars into `config.active_record.encryption` and provides fixed non-secret
fallback keys in the test env so the suite is hermetic. To encrypt a JSON field, store it in a
`text` column with `serialize :col, coder: JSON` declared *before* `encrypts :col` — encrypting a
`jsonb` column fails because ciphertext is not valid JSON. Verify encryption-at-rest in specs by
selecting the column via raw SQL and asserting the plaintext is absent.

### 2026-06-10 — ApplicationDraft autofill payload mirrors the worker, not the ATS form
The `application_drafts.autofill_payload` jsonb is worker-shaped (`application_id`, `ats`,
`apply_url`, `answers: [{field, value}]`, optional `resume_ref`), matching `workers/src/types.ts`
`ApplicationTask`. `ats` is the worker `AtsKind` (`greenhouse`/`lever`/`ashby`/`linkedin_easy_apply`),
NOT every `ApplicationRoute#route_type` — `ApplicationDraftGenerator::ATS_BY_ROUTE_TYPE` maps only
those four and falls back to `"manual"` for everything else (workday, unknown, job boards). Profile
contact/URL fields are merged into `answers` deterministically (never via the LLM), and the system
prompt instructs the model to OMIT sensitive questions so they never reach the payload. The generator
creates no draft and never raises when no API key is configured (returns a `skipped` Result).

### 2026-06-11 — Use ::Application in API controllers
The Rails domain model is named `Application`, which can be ambiguous from controller/request
contexts because Rails also has application-level helpers. In API controllers that load job
applications, reference the model as `::Application` to avoid accidentally resolving through the
Rails app object.

### 2026-06-11 — Worker report API metadata follows Rails params coercion
`Api::WorkerTasksController#report` stores worker screenshots/logs directly as audit arrays, but
JSON-ish metadata submitted as normal Rails request params may have scalar values coerced to
strings in request specs. Assert metadata keys/values the way Rails receives them unless the
endpoint is explicitly changed to parse a raw JSON body.

### 2026-06-11 — ATS handler registration avoids top-level await cycles
Worker ATS handlers import the registry from `workers/src/ats/registry.ts`; `workers/src/ats/index.ts`
then imports handler modules for side-effect registration and re-exports registry helpers. Do not
register handlers by dynamically importing from `index.ts` with top-level await, because Node's test
runner can exit with an unsettled top-level await cycle.

### 2026-06-12 — Web Push uses the `web-push` gem behind a transport seam
PUSH-02 added the `web-push` gem (3.1.0; pulls in `jwt`/`openssl`) — the first real push dependency.
`WebPushDispatcher` wraps `WebPush.payload_send` in a `WebPushTransport` and exposes a `transport:`
seam (same pattern as `OpenrouterClient`'s `http:`) so specs inject a fake transport and never send a
real push. Live sends are guarded behind `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` presence (no key or
no subscriptions ⇒ `skipped` Result, no raise). Dead endpoints raise `WebPush::ExpiredSubscription`/
`InvalidSubscription` and are pruned; that error's `.new(response, host)` reads `response.body`, so a
test double must stub `code`/`message`/`body`. `DailyDigestBuilder` reads only already-scored JobPosts
(never calls the LLM); the recurring schedule lives under the `production:` key in
`config/recurring.yml` (`DailyDigestJob`, `every day at 8am`).

### 2026-06-12 — Outreach generation is synchronous (controller), unlike scoring/drafts
CONTACT-01's `OutreachDraftGenerator` runs inline in `Api::OutreachDraftsController#create` (no
ActiveJob), because the client wants the draft back in the response. It mirrors
`ApplicationDraftGenerator`'s OpenRouter seam (`client:` kwarg, `OpenrouterClient::MissingApiKeyError`
⇒ skip), but the controller maps `skipped`⇒`503 llm_unavailable` and `failed`⇒`502 generation_failed`
so the caller learns the LLM is unavailable rather than getting a silent no-op. Specs stub
`OpenrouterClient.new` (not a `client:` injection, since the controller builds it) to a fake
responding to `complete_json` — never hits the network and never sends the message anywhere. Routes
are nested: `contact_candidates` under `job_posts`, `outreach_drafts` under `contact_candidates`.

### 2026-06-12 — go-app render tests fire OnPreRender, not OnMount; load data in both
The go-app `app.NewTestEngine()` harness runs in server mode (`app.IsServer == true`), so it invokes
`OnPreRender` — NOT `OnMount`. Data screens that fetch on entry must implement BOTH `OnMount` (live
client/WASM) and `OnPreRender` (SSR + tests) calling the same `load`. `engine.ConsumeAll()` drains the
`ctx.Async` goroutine and its `ctx.Dispatch`, so async fetches settle before `app.PrintHTML(&sb, c)`
(`PrintHTML` takes `(w, ui)` and returns nothing; there is no `NewClientTester`). `app.Context` embeds
`context.Context`, so pass `ctx` itself where a `context.Context` is needed (capture
`reqCtx := ctx.Context` before `ctx.Async`) — there is no `ctx.Context()` method. Component re-renders
use `ctx.Update()`, not a `compo.Update()`. WEB-02's screens fetch through a `components.RailsClient`
interface (mock in tests; `httpRailsClient` over stdlib net/http maps to browser fetch in WASM) and
target `GET /api/job_posts`, `GET /api/job_posts/:id`, `GET /api/digest` — read endpoints Rails does
NOT yet expose (only the write/auth surface exists), so those are a pending API-side contract.

### 2026-06-13 — go-app OnClick handlers aren't directly testable; split the body out
The public `app.TestEngine` (from `app.NewTestEngine()`) exposes only `Load`/`ConsumeNext`/
`ConsumeAll` — there is NO way to obtain an `app.Context` to invoke an `OnClick(handler)` from a
test, and `app.PrintHTML` spins up its own engine that re-runs `OnPreRender` (resetting any
post-action state, e.g. it flips a data screen back to `loadLoading` and hides content gated on
`loadDone`). To test an explicit user action (WEB-03's approve+submit), extract the action body
into a plain method that takes a `context.Context` (`doSubmit(ctx)`) plus a pure state-applier
(`applySubmitResult(res, err)`); the `OnClick` handler stays a thin `ctx.Async`/`ctx.Dispatch`
wrapper around them. Tests then call the plain method directly and assert on component state and
the label helpers, and render submit-state chrome via `PrintHTML(r.renderSubmit())` (a sub-UI,
not the whole component, to dodge the OnPreRender reset). The "never submit on mount" safety rule
is covered by asserting the mock's submit-call count is 0 after a full `renderHTML` lifecycle.

### 2026-06-13 — go-app render assertions must match HTML-escaped text; share Push mock
WEB-04's `PushToggle` reuses the WEB-03 pattern (`OnClick` → thin `ctx.Async`/`ctx.Dispatch` over a
plain `doSubscribe(ctx)`/`doUnsubscribe(ctx)` + pure `applySubscribe`/`applyUnsubscribe` appliers),
so the subscribe/unsubscribe flows are unit-tested with no engine and the "never auto-subscribe on
render" rule is asserted by a 0 subscribe/persist count after a full `renderHTML` lifecycle. Two
gotchas: (1) `app.PrintHTML` HTML-escapes apostrophes (`aren't` → `aren&#39;t`), so render-substring
assertions must avoid raw apostrophes or match an escape-free fragment. (2) The browser Push API
mock (`mockPusher`, implementing `PushSubscriber`) lives in `push_test.go` but is also used by
`profile_test.go` (ProfileView embeds a PushToggle) — keep one shared mock in the package, not one
per file, to avoid duplicate-type redefinition.

### 2026-06-13 — go-app Textarea has no Value(); clipboard via app.Window() JS shim
WEB-05's `ContactsView` reuses the action-handler split (`OnClick` → thin `ctx.Async`/`ctx.Dispatch`
over a plain `doGenerate(ctx, idStr, tmpl)` + pure `applyGenerateResult`), and asserts the
manual-send-only rule with a 0 `GenerateOutreach` count after a full `renderHTML` lifecycle plus a
"no send affordance in the rendered HTML" test. Two go-app gotchas: (1) `app.HTMLTextarea` has NO
`.Value()` method (unlike `app.HTMLInput`) — set its content with `.Text(...)` or the build fails.
(2) For browser clipboard copy use `app.Window().Get("navigator").Get("clipboard")` guarded by
`.Truthy()` then `.Call("writeText", text)`; on the server/SSR + test build go-app's JS shim makes
this inert (no real DOM), so render tests exercise the copy handler safely and the WASM build still
compiles. Per-candidate generate state is held in a `map[int]*outreachGen` keyed by candidate id,
lazily created via a `genFor(id)` helper so `renderContact` and the handlers share one instance.

### 2026-06-13 — Manual entry form mirrors the existing do*/apply* + trim-only client pattern
WEB-06's `components.ManualEntry` posts to the existing MANUAL-01 `POST /api/job_posts` via a new
`RailsClient.CreateJobPost(ctx, ManualJobInput)` (request wrapped as `{job_post: {...}}`, response
read from `{job_post: {...}}`). The web layer does ONLY a "URL or text present" client hint and
trims fields before sending — all real validation (HTTP(S)-URL check), normalization, route
resolution, and scoring stay in Rails. The new `CreateJobPost` mock method goes on the shared
`mockClient` in `jobs_test.go` (one mock for the whole package), and the click handler body is
extracted into a context-only `doSubmit` + pure `applyCreateResult` so it is unit-testable without
the go-app engine. Route `/jobs/new` is added before the `^/jobs/\d+$` regexp route — exact routes
win over regexps and "new" is not `\d+`, so no collision.

### 2026-06-17 — Resend webhook reaches Rails through the web proxy
Rails remains private in production, so the public Resend webhook URL must use the `web` service
domain at `/webhooks/resend/inbound`. `web/main.go` proxies that exact path to `API_INTERNAL_URL`
alongside `/api/*`; do not add a public Railway domain directly to `api` just for Resend.

### 2026-06-17 — Production multi-db config must explicitly use DATABASE_URL
The Rails production `database.yml` has primary/cache/queue/cable entries, so Railway's
`DATABASE_URL` was not being applied implicitly at boot and Rails tried a local Postgres socket
during `db:prepare`. Keep `url: <%= ENV["DATABASE_URL"] %>` on the shared production base config
unless the app is deliberately split across separate managed databases.

### 2026-06-17 — UI handoff is reference-only except CSS/assets
The frontend design handoff lives at `reference/design_handoff_waunder_css/` and targets the
existing go-app class names. Do not copy the static wrapper HTML into the app; ship styling through
`web/web/app.css` loaded by `app.Handler.Styles`, and self-host fonts or use system fallbacks for
the offline-tolerant PWA shell.

### 2026-06-18 — app.Handler.Styles wired; server tests of it need a registered route
WEB-07 copied `reference/design_handoff_waunder_css/app.css` to `web/web/app.css` and added
`Styles: []string{"/web/app.css"}` to the `app.Handler` built by a new `newAppHandler()` helper in
`web/main.go` (extracted from `main()` so it's directly testable). Dropped the reference file's
live `@import url("https://fonts.googleapis.com/...")` for Hanken Grotesk and its mention in
`--font-sans` — STYLE_GUIDE.md/CONVENTIONS.md call for a self-hosted WOFF2 or system fallback for
the offline-tolerant PWA shell, and no WOFF2 asset was added in this pass, so `--font-sans` now
lists only the system-font fallback stack. Gotcha: `app.Handler.ServeHTTP` 404s on any path unless
`routes.routed(path)` is true, i.e. an `app.Route(...)` was registered for it — this registration
normally happens in `main()` before `RunWhenOnBrowser()`, so a server test that builds the handler
directly (e.g. `httptest.NewServer(newAppHandler())`) must also call `app.Route("/", ...)` itself
(it's a process-global, idempotent for an already-registered path) before hitting `GET /`, or every
request 404s and the rendered `<link rel="stylesheet">` markup never appears in the body.

### 2026-06-18 — WEB-09 styling gap audit: diff emitted classes against app.css, don't eyeball screens
To find every go-app class lacking an intentional style for WEB-09, grep all `.Class("literal")`
call sites across `web/components/*.go` (covers `app.Foo().Class("x")` and chained
`.Class("x").` on the next line — both patterns appear) into a sorted unique list, then diff
against `web/web/app.css` selectors; `class` *variables* passed into shared helpers
(`requirementList(heading, class string, ...)`, `answerList`, `textField`) are call-site
literals already covered by the same grep, so no special-casing needed. The only real gaps were
the three empty-feed states (`.digest-empty`/`.job-list-empty`/`.contacts-empty` — JobList,
DigestView, ContactsView all render an empty-state `<p>` when their slice is length 0, but no
rule existed) and the still-reachable `InstallGuide` block (`Home` renders it directly off `/`;
`.install-guide`/`.enable-notifications`/`.install-status` had zero coverage). Resume-meta list
items (`.profile-resume-title/-status/-file`) and `.contact-outreach-error` looked "missing" by
exact-class grep but already inherit from a parent/group selector (`.profile-resume-meta li`,
the shared error-message selector list) — verify inheritance before adding a redundant rule.

### 2026-06-18 — Digest/jobs/login screens already matched the reference; one real focus-ring gap
WEB-10's comparison pass found the digest/jobs/login markup and CSS already byte-identical to the
reference handoff for row rhythm, score pills, mobile/desktop spacing, and the auth-error/empty
states (verified by proxying the live PWA through a throwaway local mock JSON server via
`API_INTERNAL_URL` and screenshotting with the `playwright` package already vendored in
`workers/node_modules`, since the MCP Playwright tool requires a browser extension not present in
this environment). The one real, reproducible gap: the global `:focus-visible { box-shadow:
var(--focus-ring); }` rule renders the sage-tinted ring almost invisible against the sage-filled
primary buttons (e.g. `.login-submit`) because ring and fill share the same hue/lightness family —
confirm with `getComputedStyle` + a `page.keyboard.press('Tab')` walk, not a same-frame screenshot
right after `.focus()`, since the box-shadow has a 140ms transition and an immediate screenshot
under-reports it. Fixed narrowly for `.login-submit:focus-visible` with a two-layer ring (light
inset + darker sage outer) rather than touching the shared button selector group, since the other
primary buttons it's grouped with (manual entry, draft submit, profile save, outreach generate,
push enable) belong to WEB-11/12/13's scope, not WEB-10's files list.

### 2026-06-18 — Hanken Grotesk self-hosted as one variable-font WOFF2
WEB-08 self-hosted Hanken Grotesk at `web/web/fonts/hanken-grotesk.woff2` (latin subset) and
added a single `@font-face { font-weight: 400 700; }` in `web/web/app.css`, because Google Fonts
serves Hanken Grotesk as a **variable font**: requesting the `css2` family endpoint for distinct
static weights (400/500/600/700) returns the *same* underlying woff2 URL for the latin subset
for every weight — the file itself encodes the full weight axis, so one file covers all four
tokens correctly (confirmed via `file` reporting a valid WOFF2/TrueType blob, not a per-weight
duplicate-name bug). No `Gemfile`/`go.mod`/`package.json` change was needed: go-app's `app.Handler`
already serves the whole `./web` directory tree under `/web/` by default (no embed directive, no
explicit static route registration needed for new files dropped under `web/web/`), so
`web/web/fonts/hanken-grotesk.woff2` is reachable at `/web/fonts/hanken-grotesk.woff2` with zero
`main.go` changes. `--font-sans` now lists `"Hanken Grotesk"` first with the system stack retained
as the fallback for the brief load window / asset-unavailable case, satisfying STYLE_GUIDE.md's
"self-hosted WOFF2 ... or documented system-font fallback" guidance with both layered together.

### 2026-06-18 — job-detail/draft-review markup already matched reference; CSS had one real gap
For WEB-11, rendering the reference `screens/job-detail.html`/`draft-review.html` fixtures
through the *production* `web/web/app.css` (via a local static server + a cached Playwright
Chromium binary, since the `mcp__playwright__browser_*` tools require a Chrome extension not
installed in this sandbox — point `chromium.launch({ executablePath, args: ['--no-sandbox'] })`
at `~/.cache/ms-playwright/chromium-<rev>/chrome-linux64/chrome` directly instead) showed pixel
parity with the reference screenshots already, since WEB-09/WEB-10 had carried this CSS over
essentially verbatim. The one real gap found by stress-testing long LLM-generated text (an
unbroken token with no spaces, e.g. a bare URL) was that `.job-summary`/`.job-alignment` etc. had
no wrap protection and overflowed the card horizontally at mobile width — fixed with a base-reset
`overflow-wrap: break-word` on `p,li,h1,h2,span` (see STYLE_GUIDE.md). Stress-testing the literal
*static* button/link text (`.job-route-link`, `.job-contacts-link`) with a fake long URL was a
red herring: those components render fixed labels ("Open application"), never the raw URL, so
only `.draft-autofill-url` (which renders the URL itself as link text) needed `word-break`.

### 2026-06-18 — PushToggle's OnMount/OnPreRender clobbers a hand-set test state via the mock pusher
For WEB-12, a render test that constructs `&PushToggle{state: pushOn, ...}` and calls the shared
`renderHTML` helper does NOT show the "on" markup: `start()` (wired to both `OnMount` and
`OnPreRender`) unconditionally calls `refresh()`, which re-derives state from
`t.Pusher.CurrentEndpoint()` — with a zero-value `mockPusher{}` that's `supported: false`, so it
overwrites the hand-set state to `pushUnsupported` before `Render()` ever runs. To unit-test a
specific render branch of a component whose `OnMount`/`OnPreRender` re-fetches state, call the
pure render helper (`renderPushControl(toggle)`) directly and pipe it through `app.PrintHTML`,
bypassing the engine/lifecycle entirely (mirrors the WEB-03/WEB-04 "render a sub-UI, not the
whole component" pattern for dodging the OnPreRender reset). Also added a shared quiet
status-pill idiom (success-soft tint, `--radius-pill`, `--text-xs`) for "fact" indicators next to
an action control — `.profile-resume-status-{parsed,pending}` and `.push-toggle-status-on` —
distinct from the existing score/route pill (sage-soft) and error/success message pills.

### 2026-06-18 — Manual entry/contacts CSS was already a pixel-exact reference copy; the real gap was textareas
WEB-13 found that `web/web/app.css`'s `.manual-entry-*`/`.contact-*`/`.contact-outreach-*` rules
(input sizing, focus rings, error/success panels, contact cards, outreach draft wells, copy
button) were already byte-for-byte identical to `reference/design_handoff_waunder_css/app.css`
for these selectors — WEB-07's wholesale stylesheet copy covered them completely, and the Go
markup classes in `manual_entry.go`/`contacts.go` already matched the reference HTML 1:1. The one
real gap: WEB-11's global `overflow-wrap: break-word` reset only targets `p`/`li`/`h1`/`h2`/`span`,
which never reaches `<textarea>` — so `.manual-entry-text` (pasted posting text) and
`.contact-outreach-template`/`.contact-outreach-message` (generated outreach drafts) needed the
same rule applied directly to stay wrap-safe on mobile for an unbroken long token (e.g. a pasted
URL). When a styling task's CSS/markup diff against the reference comes back empty, check
non-`p/li/h1/h2/span` text containers (textareas, inputs) before concluding there is nothing to do.

### 2026-06-18 — Railway GitHub auto-deploy needs root-context Dockerfiles
Connecting the monorepo services to GitHub via `railway service source connect --repo AG9898/Waunder
--branch main` enables push-triggered deployments, but Railway's GitHub builds used the repo root
as Docker context even after service `rootDirectory` was set. Do not point GitHub deploys at
`api/Dockerfile`, `web/Dockerfile`, or `workers/Dockerfile` directly because those Dockerfiles
assume their service directory is the build context; instead use the root-context files under
`deploy/` and set each service's `RAILWAY_DOCKERFILE_PATH` to the matching
`deploy/railway-*.Dockerfile`.

### 2026-06-18 — Rails passphrase logging needs an explicit filter
Rails' default-ish `:passw` parameter filter does not match `passphrase`, so `/api/session`
requests logged the owner passphrase in production until `:passphrase` was added explicitly to
`api/config/initializers/filter_parameter_logging.rb`. When adding auth-like form keys, verify the
exact parameter name is filtered before running live login smoke tests.

### 2026-06-19 — Resend email.received has no top-level "id"; use the svix-id header
A live inbound test (real Resend `email.received`) revealed `Webhooks::ResendController#inbound`
was rejecting valid payloads with `KeyError` → 400 because it read `event.fetch("id")`, but
Resend's `email.received` body only has `created_at`/`data`/`type` — there is NO top-level `id`.
The unique, retry-stable identifier is the **`svix-id` request header** (Svix message id), which
now feeds `inbound_emails.event_id` (and makes Svix redeliveries idempotent via the
`[provider, event_id]` unique index). The old request spec passed only because its fixture
injected a fake top-level `id: "evt_123"`; the spec now mirrors the real body (no top-level `id`)
and asserts `event_id == svix-id`. When testing a webhook controller against a provider, verify
the fixture matches the provider's *actual* payload shape — a green spec can still mask a field
the provider never sends. End-to-end the Resend switch to `adenguo.com` works: DNS/MX, Resend
inbound, the web proxy, and Svix signature verification all succeeded; only this body-shape bug
was dropping the email.

### 2026-06-19 — Solid Queue/Cache/Cable schemas weren't provisioned in prod; in-Puma not enabled
With the webhook fix in place, the first real inbound `email.received` then 500'd on
`PG::UndefinedTable: relation "solid_queue_jobs" does not exist`: the `InboundEmail` row saved
(primary DB) but `ParseInboundEmailJob.perform_later` couldn't enqueue. Root cause: production
runs four databases (primary/cache/queue/cable), and `db:prepare` only loads a database's schema
when it *creates* that database — the Solid DBs have empty/absent `migrations_paths`
(`db/queue_migrate` etc. don't exist), so once they exist-but-empty `db:migrate` is a no-op and
`db/queue_schema.rb`/`cache_schema.rb`/`cable_schema.rb` never load. Fix: `api/bin/docker-entrypoint`
now, after `db:prepare`, loads each Solid schema through the *same named connection the app uses*
(`establish_connection(:queue)` etc., matching `config.solid_queue.connects_to`), guarded on the
marker table (`solid_queue_jobs`/`solid_cache_entries`/`solid_cable_messages`) so it's idempotent
and never drops data — and is robust whether the Solid DBs are separate or collapse onto the same
physical DB. Second gap: jobs still wouldn't *run* because Solid Queue only executes inside Puma
when `SOLID_QUEUE_IN_PUMA` is set (`config/puma.rb`), and the Railway `worker` service is the
Node/Playwright submit worker, NOT a Rails job runner — so `SOLID_QUEUE_IN_PUMA=true` is now set on
the `api` service (in-Puma is the right call for this single-user, no-Redis app). The entrypoint
guard also broadened to fire when the final arg is `server` (covers the `./bin/thrust ./bin/rails
server` CMD).

### 2026-06-22 — Resend webhook delivers no body; fetch it via the receiving API
The Resend `email.received` webhook payload contains only metadata — `from`/`to`/`subject`/
`email_id`/`attachments`, NO `text`/`html`. The original code stored `raw_payload: event` and the
parsers read the body from `data["text"]`/`["html"]`, which are always nil, so EVERY inbound email
extracted zero postings → flagged `needs_llm_fallback` → and that flag had no consumer, so 0
JobPosts were ever created from real email. Fixes (INBOUND pipeline): (1) `ResendInboundClient`
fetches the body via `GET https://api.resend.com/emails/receiving/{email_id}` with `RESEND_API_KEY`
(stdlib Net::HTTP behind an `http:` seam, `MissingApiKeyError` guard — same shape as
`OpenrouterClient`); `ParseInboundEmailJob#hydrate_body!` merges it onto `raw_payload["data"]`
before parsing. (2) `InboundEmailParser#select_parser` is now forward-aware — it matches the
envelope From AND any `From: ... <addr@domain>` in the forwarded body, because a forwarded/auto-
forwarded LinkedIn alert arrives with the forwarder's address as the envelope From. (3)
`InboundEmailLlmExtractor` is the actual `needs_llm_fallback` consumer — it asks the LLM for a
`{postings:[...]}` JSON list and materializes each (skips gracefully with no `OPENROUTER_API_KEY`,
idempotent on `llm_parsed`). (4) Both paths persist through the shared `JobPostMaterializer`
(dedupes by `posting_url`, so job retries / repeat alerts don't duplicate) and `ParseInboundEmailJob`
now enqueues `ScoreJobPostJob` for every created JobPost — previously inbound-created posts were
never scored (scoring was only wired into the manual `Api::JobPostsController`). To retrieve any
inbound body by hand: `resend emails receiving get <email_id>` (CLI), or `... receiving list`.

### 2026-06-22 — Real LinkedIn job-alert digests need order-agnostic parsing
The original LinkedIn parser assumed clean `linkedin.com/jobs/view/<id>` URLs with the layout
`title / Company·Location / URL`. Real LinkedIn job-alert **digest** emails don't match: they use
tracked `/comm/jobs/view/<id>` links, wrap them in `<...>`, pad with the `͏` (U+034F) filler char
and `[image: X]` alt lines, and order each posting block as `title / URL / "Company · Location"`
(URL BEFORE the pair). The rewritten `InboundEmailParsers::LinkedIn` anchors on the `Company ·
Location` line (a spaced middle-dot pair), takes the title from the nearest preceding text line,
and attaches the job id from the nearest `/jobs/view/(\d+)` link searching outward (handles URL
before OR after the pair, so it still parses the old/simple format too). The 6 job ids in a digest
also appear in the `originToLandingJobPostings=<id,id,...>` query param of the alert's search link —
a useful cross-check. Verified deterministically against a live forwarded digest: 6/6 postings with
correct title/company/location/canonical URL, no LLM. Scoring (ScoreJobPostJob → OpenRouter) is
still a separate step and the free-tier model (`google/gemma-4-31b-it:free`) was 429-rate-limited
during testing — ingestion now creates the JobPosts regardless.

### 2026-06-22 — OpenRouter free tier collapsed; default model moved off Gemma
The `google/gemma-4-31b-it:free` default became persistently 429 rate-limited (not transient — it
failed across the client's full retry/backoff), so every real inbound JobPost scored `failed`. A
live probe of OpenRouter's `/models` filtered to free (prompt+completion price 0) found most free
slugs now 404 (moved to paid) or 429; only `openai/gpt-oss-120b:free` (and `gpt-oss-20b:free`) were
responding. Default is now `openai/gpt-oss-120b:free` (env `OPENROUTER_MODEL` + code `DEFAULT_MODEL`
+ RESOLVED-17). It does NOT honor strict `response_format` json_object (returns the JSON as prose),
but `OpenrouterClient`'s parse-fallback extracts the first balanced JSON object, so `complete_json`
still yields a full scoring object — verified end-to-end (match_score 10–85 across 12 real posts).
`google/gemini-2.5-flash-lite` is the documented cheap *paid* fallback (works cleanly, ~cents/digest)
if the free tier degrades again. OpenRouter's free tier is volatile — re-probe `/models` when the
configured free model starts 429-ing rather than assuming a specific slug stays free.

### 2026-06-22 — LinkedIn has a SECOND native digest layout; parser now anchors on the job id
A real direct (non-forwarded) LinkedIn alert from `jobalerts-noreply@linkedin.com` uses a different
plain-text template than the forwarded one above: the `email_job_alert_digest_01` layout puts
`title / company / location` on THREE separate lines (no `Company · Location` middle-dot pair) and
prefixes the link with `View job: https://…/comm/jobs/view/<id>` (URL not at line start). The
pair-anchored parser matched the sender but extracted 0 → fell back to the LLM (which got 6/6, so it
*looked* fine in the JobPost feed but silently burned an LLM call). `InboundEmailParsers::LinkedIn`
is now re-anchored on the **job-view id** (`/jobs/view/(\d+)`), the only element common to every
template, with two passes over one token stream: pass 1 = the existing pair-anchored layout
(unchanged), pass 2 = id-anchored native layout (reads up to 3 text lines preceding each link as
location/company/title, nearest-first, bounded by the previous block's link so blocks don't bleed).
The tokenizer now also detects mid-line `View job:` URLs, drops `---` divider rules, drops promo
lines (`PROMO` regex: "This company is actively hiring", "N school alumni", header lines, "See all
jobs"), and guards `Company · Location` pairs against `http` so the footer unsubscribe/help line (a
` · ` separated pair of URLs) isn't mistaken for a posting. Verified against the REAL production
inbound #6 body: 6/6 deterministic, identical to the LLM result, no LLM call. Lesson: a known-sender
parser that matches the sender but returns 0 postings routes silently to the LLM — when adding/
extending a parser, test it against a real captured body of EACH template, not one hand-written
fixture.

### 2026-06-22 — Apply flow front-door + single-click approve+submit were the missing wiring
The trusted-submit back half (draft generator, `ApplicationSubmitDispatcher`, worker, ATS handlers)
shipped complete, but NOTHING created an `Application`, enqueued `GenerateApplicationDraftJob`, or set
`approved`/`approved_at` — so `/applications/:id` was unreachable and the job-detail "Apply" only opened
the external LinkedIn URL (the `renderRoute` "Open application" link). Wired it end-to-end: `POST
/api/applications` (`Api::ApplicationsController#create`, `{application: {job_post_id}}`) creates/reuses a
draft-status Application (idempotent: reuses the latest `draft`/`approved` one, re-enqueues draft gen only
when `application_draft` is nil) and the new `JobDetailView` Apply button navigates to the review screen.
Per RESOLVED-19 the submit endpoint is now **single-click approve+submit**: `#submit` marks the app
`approved`/`approved_at` (unless already `submitted`) before calling the dispatcher — the dispatcher's
supported-ATS + clean-payload gates remain the real safety boundary, so the controller-side approve is
safe. This flipped the old "rejects submit without approval ⇒ approval_required" request spec, which now
asserts a draft submit auto-approves and dispatches. `LINKEDIN_EASY_APPLY_ENABLED` is now `true` in
`api/.env` to include LinkedIn Easy Apply in trusted submit; **production must set it on the api+worker
Railway services too** (the dispatcher's `supported_ats` reads it at runtime; specs leave it default-false
so the greenhouse-only expectations are unaffected). Go side: `RailsClient.CreateApplication` + the
`do*`/`apply*` handler split (test via `doApply` directly; assert `createAppCalls==0` after a full render to
prove "never apply on mount").

### 2026-06-22 — Draft preview is an editable Rails-owned submit contract
`GET /api/applications/:id` now returns `draft_ready`, `autofill_warnings`, `failure_reason`, and
latest worker report context along with the worker-shaped `autofill_payload`; `PATCH
/api/applications/:id/draft` updates only reviewed `answers` and preserves Rails-owned ATS/apply
URL/resume metadata. Keep the PWA submit button disabled until the draft is ready and warnings are
clear, and remember the Rails dispatcher is still the final safety gate. The submit dispatcher's
age-sensitive regex must use `\bage\b`; a plain `age` alternative false-positives on fields like
`programming languages`.

### 2026-06-22 — Playwright image must exactly match the worker package
Railway worker crashes can come from a Playwright package/image mismatch before the code reaches the
normal task-report path (`chromium.launch` throws if the browser executable baked into the image is
for an older package). Pin `workers/package.json` and both worker Dockerfiles to the same Playwright
version, and keep `processTask` catching page-factory/browser-launch errors so Rails still receives a
failed worker report instead of the process crash-looping. Do not let `browser.close()` errors escape
either; cleanup failures should be appended to result logs so the worker can still POST the terminal
status.

### 2026-06-22 — Application tracker status is separate from worker status
`applications.status` remains the trusted-submit/worker lifecycle (`draft`/`approved`/`submitted`/
`paused`/`failed`), while the user-facing tracker uses `pipeline_status` plus optional
`pipeline_stage` (`applied` + `waiting` means submitted but awaiting a response). Manual tracker
changes (`PATCH /api/applications/:id/status`, `PATCH /api/job_posts/:id/application_status`) must
never enqueue worker jobs; successful submit/report syncs the tracker to applied/waiting, and
paused/failed worker reports sync it to needs_review.

### 2026-06-22 — Glassdoor parser rewrite + provider attribution surfaced to UI
Real Glassdoor "Jobs for You" alerts (incl. manually forwarded ones) use a `Company <rating> ★` /
title / location / salary / `Easy Apply` / age block ending in a `partner/jobListing.htm?...&jobListingId=<id>`
link on the `.ca` (or any) Glassdoor TLD — NOT the `title / Company — Location / URL` shape the old
`InboundEmailParsers::Glassdoor` assumed, and NOT `.com` only. The old parser matched the sender but
extracted 0 → silent LLM fallback (same trap as the LinkedIn digest). Rewrote it to anchor on the
job link, walk back to the nearest `★` company line (bounded by the previous block's link), and read
title/location/salary; kept a `legacy_block` fallback for the rating-less `Company — Location` layout
so the old synthetic spec still passes. Verified 5/5 against the REAL production body (IE 7) — anchor
on `jobListingId=` excludes the header `/Job/jobs.htm` search link. Also: (1) `ApplicationRouteResolver`
glassdoor matcher now includes `glassdoor.ca` (was `.com` + `.co.<tld>` only, so every `.ca` posting
resolved to `unknown`/manual). (2) Added a `compensation:` field through the `Base#posting` helper →
`JobPostMaterializer` → `job_posts.compensation` (Glassdoor carries salary; LinkedIn usually doesn't).
(3) Provider attribution now survives the LLM fallback: `InboundEmailLlmExtractor` sets `source` from
`parse_result["parser"]` (linkedin/glassdoor) instead of always "inbound_llm" — only truly unknown
senders stay "inbound_llm". (4) `source` (+ detail `compensation`) is now in the `Api::JobPostsController`
read serializers and rendered as an origin tag in the PWA (`SourceLabel` in web/components/client.go,
`.job-source` styles). NOTE: nothing here changes the apply flow — the user applies LinkedIn/Glassdoor
manually for now. Pre-existing 6 JobPosts labeled "inbound_llm" (all really LinkedIn) are NOT backfilled.

### 2026-06-22 — Color-coded score pills + self-hosted source brand logos
Match-score pills are now color-coded by band (`MatchScoreBand` in web/components/client.go →
`.job-score--high|mid|low|pending` classes): high ≥75 (success-soft), mid 50–74 (new
`--color-warning*` amber token), low <50 (danger-soft), pending = neutral sunken. The band class
owns the pill color in BOTH list/digest rows AND the job detail — so the base `.job-list-link
.job-score`/`.job-detail .job-score` rules had their hardcoded `background`/`color` REMOVED (every
pill always carries a band class now); leaving them set would have beaten the 0,1,0 band selectors
via the 0,2,0 `.job-detail .job-score` context rule. In the list grid the score pill moved from
`grid-row: 1 / span 2` (vertically centered, looked "floating") to `grid-row: 1` so it sits inline
with the title. This deliberately overrides the old STYLE_GUIDE rule "do not color-code match
scores" (updated in the same change at the user's request). Source origin pills now lead with the
official brand logo for LinkedIn/Glassdoor/Indeed, self-hosted as SVGs under `web/web/icons/`
(vendored from Simple Icons, brand hex baked into the path `fill` — NOT a live CDN, matching the
self-hosted-WOFF2 font policy; go-app serves `web/web/` under `/web/` so `/web/icons/*.svg` needs
no main.go route). NOTE: Simple Icons REMOVED `linkedin.svg` from its current set over a trademark
request — pull it from a pinned older release (used `simple-icons@9.21.0` via jsdelivr); glassdoor/
indeed are still in `develop`. Non-branded sources (manual ✍️, inbound/email 📧) use an emoji
marker via `SourceEmoji`; `SourceIconPath` returns "" for them. The shared `sourceIcon(source)`
helper in jobs.go renders logo-or-emoji-or-nothing and the source pill is `display:flex; gap` so
the marker sits inline before the label.

### 2026-06-22 — Applications tab: view selector + all-jobs table + header stats
`ApplicationsView` (web/components/applications.go) now has a segmented view selector toggling
the pipeline cards (`viewApplications`, default) and an all-jobs `.jobs-table` (`viewTable`) — an
in-app spreadsheet tracker rendering every JobPost via the existing `Jobs()` endpoint, each row
linking back to `/jobs/:id` (title link + trailing "View" link). The header pairs the title with a
top-right stats cluster (`.applications-stats`) showing the total for the active view (tracked
apps vs jobs). Jobs are fetched LAZILY on first table open (`showTable`→`loadJobs`), so the default
view costs no extra request — `view`/`jobs`/`jobsState` are separate from the applications
`state`, and OnPreRender's `load` only touches the applications state, so a render test can pre-set
`view: viewTable, jobsState: loadDone, jobs: [...]` and render `c.renderTable()` directly (the
draft/push "render a sub-UI" pattern) without the lifecycle resetting it. Reused the `do*`/`apply*`
split for the lazy load (`doShowTable`/`applyJobsResult`) so the fetch+state transition is
unit-testable without the go-app engine; mockClient gained `jobsCalls` to assert "no jobs fetch on
mount". The table reuses the feed's `.job-score--<band>` and source-pill idioms but needs its own
`.jobs-table .job-score`/`.job-source` shape rules (the feed pill shape is scoped to
`.job-list-link`/`.digest-link`/`.job-detail`, not the table). NOTE: wrapping the `<h1>` in
`.applications-header` broke the `.applications > h1` title selector — retargeted it to
`.applications-header h1`. GOTCHA (pre-existing, surfaced here): go-app renders element attributes
from a Go MAP, so attribute ORDER is nondeterministic across process runs (you can see
`selected="false"` land before/after `value` in one render). Any test asserting a multi-attribute
substring like `class="..." href="..."` is therefore flaky (~30% here) — assert each attribute
substring separately. Filtering/sorting for the table AND the main Jobs feed is documented as
planned but NOT implemented (PRD.md, STYLE_GUIDE.md).
