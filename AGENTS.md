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
- Before introducing Redis/Sidekiq (OPEN-01) without explicit owner instruction. (The auth/session model is resolved — RESOLVED-14: shared-secret session cookie + worker bearer token.)
- Before sending a real web-push notification or incurring real LLM spend in a test context. (Waunder sends no outbound email — Resend is inbound-only.)

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
