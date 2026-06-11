# TESTING.md — Test Suite Reference

> Canonical source for how to run tests, what is covered, and how to write new tests.
> Read before adding any new test file or modifying an existing one.
> Code conventions that affect test structure live in [`CONVENTIONS.md`](CONVENTIONS.md).

Waunder has three stacks, each with its own test runner: `api/` (Rails / RSpec),
`web/` (Go / `go test`), and `workers/` (Node built-in test runner).

---

## Quick Start

```bash
# --- api/ (Rails, RSpec) ---
cd api && bundle exec rspec                              # all specs
cd api && bundle exec rspec spec/requests/api/health_spec.rb   # single file
cd api && bin/ci                                         # full CI gate (style + security + tests)

# --- web/ (Go + go-app) ---
cd web && go test ./...                                  # all Go tests

# --- workers/ (Node + TypeScript) ---
cd workers && npm test                                   # all tests
cd workers && node --import tsx --test src/safety.test.ts  # single file
cd workers && npm run typecheck                          # tsc --noEmit
```

---

## Test Stacks

| Stack | Tool | Version | Location | Run Command |
|---|---|---|---|---|
| api (Rails) | RSpec (`rspec-rails ~> 8.0`) | Ruby 3.2.3 / Rails 8.1.3 | `api/spec/` | `cd api && bundle exec rspec` |
| web (go-app) | Go testing (`go test`) | Go 1.26 | `web/**/*_test.go` | `cd web && go test ./...` |
| workers | Node built-in test runner (`node --test`) + tsx | Node 22 / TS 5.7 | `workers/src/**/*.test.ts` | `cd workers && npm test` |

---

## What Is Covered

Be honest about the current state — most of the suite is still to be written.

### Today (actually present)

- **api/** — `spec/requests/api/health_spec.rb`: a request spec for `GET /api/health` asserting
  HTTP 200, the JSON shape (`status: "ok"`, `service: "waunder-api"`), and database connectivity
  (`database: "connected"`).
- **api/** — `spec/requests/api/auth_spec.rb`: request specs for `POST /api/session`,
  protected endpoint gating, health bypass, and the worker bearer guard.
- **api/** — `spec/requests/api/applications_spec.rb`: request specs for `POST
  /api/applications/:id/submit`, covering the approved clean-payload dispatch path, audit-event
  recording, approval-required refusal, unsupported ATS refusal, unsafe-payload refusal, and 401
  auth gating with no enqueue on refused paths.
- **api/** — `spec/requests/api/worker_tasks_spec.rb`: request specs for worker bearer-only
  task pull/report endpoints, covering task payload shape, missing/invalid bearer rejection,
  human-session rejection, application status updates, and audit artifact persistence.
- **api/** — `spec/requests/webhooks/resend_spec.rb`: request specs for the Resend inbound
  webhook, covering Svix signature verification, raw inbound-email persistence, parse-job
  enqueueing, unauthenticated provider auth, missing-secret handling, and PII-safe logging.
- **api/** — `spec/models/company_spec.rb`, `spec/models/job_post_spec.rb`, and
  `spec/models/application_route_spec.rb`: model specs for the core job-posting associations,
  validations, route-type allowlist, and score/confidence bounds.
- **api/** — `spec/models/application_spec.rb`, `spec/models/application_draft_spec.rb`, and
  `spec/models/audit_event_spec.rb`: model specs for the application lifecycle, draft JSON
  payload shape, audit payload shape, and associations.
- **api/** — `spec/models/profile_spec.rb` and `spec/models/resume_document_spec.rb`: model specs
  for the encrypted-at-rest profile/resume fields. They assert the underlying column holds
  ciphertext (raw SQL select) while the accessor returns plaintext, and that deterministic email
  encryption stays queryable.
- **api/** — `spec/services/inbound_email_parser_spec.rb`: service specs for the deterministic
  known-sender (LinkedIn/Indeed/Glassdoor) email parser, normalized JobPost persistence, company
  reuse, and LLM-fallback flagging for unknown senders and empty parses.
- **api/** — `spec/jobs/parse_inbound_email_job_spec.rb`: job spec wiring the inbound parse job
  to the parser service for both the known-sender and LLM-fallback paths.
- **api/** — `spec/services/application_route_resolver_spec.rb`: deterministic route-type
  detection from URL fixtures, recommended-route preference ordering, posting/source URL tie-breaks,
  unknown→manual LLM-fallback flagging, determinism, and ApplicationRoute persistence/idempotency.
- **api/** — `spec/services/openrouter_client_spec.rb`: OpenRouter client specs covering missing/blank
  API-key typed error, env model default/override, structured-JSON parsing, parse fallback for
  prose/code-fence-wrapped JSON, retry on 429/5xx then exhaustion, and PII-safe logging — all against
  an injected fake transport with no live network calls.
- **api/** — `spec/jobs/score_job_post_job_spec.rb`: JobScorer + ScoreJobPostJob specs covering
  population of the scoring/summary fields from mocked LLM JSON, match_score clamping and string-list
  coercion, parser-flagged fallback scoring, graceful skip (marked `skipped`, no raise) when no API
  key is configured, `failed` marking on client errors, and PII-safe logging — using a mocked
  OpenRouter client (no live calls).
- **api/** — `spec/jobs/generate_application_draft_job_spec.rb`: ApplicationDraftGenerator +
  GenerateApplicationDraftJob specs covering draft creation from mocked LLM JSON, ATS-shaped
  autofill payload keyed to the resolved route (greenhouse/lever, manual fallback for unknown
  routes), Profile data merged into autofill answers, malformed structured-answer dropping, graceful
  skip (no draft, no raise) when no API key is configured, `failed` result on client errors, and
  PII-safe logging — using a mocked OpenRouter client (no live calls).
- **workers/** — `src/safety.test.ts`: unit tests for sensitive-field detection
  (`isSensitiveField`) and answer partitioning (`partitionBySensitivity`).
- **workers/** — `src/worker.test.ts`: unit tests for worker config loading, bearer-auth task
  fetch/report calls, clean idle when `API_INTERNAL_URL` is unset, one-cycle poll orchestration, and
  unsupported-ATS safe failure.
- **web/** — **no tests yet.**

### Planned (from the plan's Testing Plan)

**Rails (`api/`):**

- Request specs for all JSON endpoints.
- Model specs verifying encrypted profile/resume storage (fields encrypted at rest).
- Job specs for downstream inbound email parsing and normalization.
- Job specs for LLM orchestration with mocked OpenRouter responses.
- Worker-dispatch specs for approved application submissions.

**Web (`web/`, go-app):**

- Component / render tests for the job feed, job detail, approval flow, profile form, and draft
  review screens.
- API client tests with mocked Rails responses.
- Push subscription flow tested behind an abstraction, with the browser Notification/Push APIs
  mocked.
- A PWA smoke check: manifest validity, service-worker registration, and installability.

**Automation (`workers/`):**

- Playwright tests against fixture pages for Greenhouse, Lever, Ashby, and a mocked Easy
  Apply-style flow.
- Required pause/fail tests for: unknown questions, sensitive fields, missing resume data,
  expired sessions, and unsupported form states.

### Not covered yet

- Any `web/` (Go) tests at all.
- Rails webhook/job/dispatch specs.
- Playwright ATS handler and pause/fail tests (only pure safety-helper unit tests exist).
- The full end-to-end MVP integration scenario (see below).

---

## Test File Inventory

Keep this table up to date — add a row when adding a new test file.

| File | Domain | What It Covers |
|---|---|---|
| `api/spec/models/application_draft_spec.rb` | API (Rails) | application draft association plus structured-answer and autofill JSON shapes |
| `api/spec/models/application_route_spec.rb` | API (Rails) | application route type allowlist and confidence validation |
| `api/spec/models/application_spec.rb` | API (Rails) | application status lifecycle validation and draft/audit associations |
| `api/spec/models/audit_event_spec.rb` | API (Rails) | audit event application/status validation plus screenshot/log/metadata JSON shapes |
| `api/spec/models/company_spec.rb` | API (Rails) | company name validation and job-post association |
| `api/spec/models/job_post_spec.rb` | API (Rails) | job post company/title validations, application-route association, match-score bounds |
| `api/spec/models/profile_spec.rb` | API (Rails) | profile name/JSON-shape validation, encrypted-at-rest ciphertext check for email/phone/address, deterministic-email queryability |
| `api/spec/models/resume_document_spec.rb` | API (Rails) | resume document profile/title validation, parsed_structure default, encrypted-at-rest ciphertext check for raw_text/parsed_structure |
| `api/spec/requests/api/auth_spec.rb` | API (Rails) | shared-secret session success/failure, protected endpoint gating, health bypass, worker bearer guard |
| `api/spec/requests/api/applications_spec.rb` | API (Rails) | `POST /api/applications/:id/submit` approved clean-payload dispatch, audit event recording, approval-required/unsupported/unsafe refusal paths, and 401 auth gating with no enqueue on refusal |
| `api/spec/requests/api/worker_tasks_spec.rb` | API (Rails) | `GET /api/worker_tasks` worker-shaped task pull with bearer-only auth; `POST /api/worker_tasks/:id/report` status updates, audit screenshots/log refs, and human-session rejection |
| `api/spec/requests/api/profile_spec.rb` | API (Rails) | `POST /api/profile/resume` JSON Resume → Profile + primary ResumeDocument mapping, PDF Active Storage attachment, encrypted-at-rest contact/raw_text check, idempotent re-sync, 401 unauth, 422 invalid/malformed; `GET`/`PATCH /api/profile` structured read/update with PII presence-flags only |
| `api/spec/requests/api/health_spec.rb` | API (Rails) | `GET /api/health` — 200 status, JSON shape, database connectivity |
| `api/spec/requests/webhooks/resend_spec.rb` | API (Rails) | Resend inbound webhook Svix verification, raw inbound-email persistence, parse-job enqueueing, provider-only auth, and PII-safe logging |
| `api/spec/services/inbound_email_parser_spec.rb` | API (Rails) | Deterministic known-sender (LinkedIn/Indeed/Glassdoor) parsing into normalized JobPosts, company reuse, and LLM-fallback flagging |
| `api/spec/jobs/parse_inbound_email_job_spec.rb` | API (Rails) | ParseInboundEmailJob wiring to the parser service for known-sender and fallback paths |
| `api/spec/services/application_route_resolver_spec.rb` | API (Rails) | Deterministic ATS route-type detection from URL fixtures, recommended-route preference ranking, confidence, unknown→manual LLM fallback, and ApplicationRoute persistence/idempotency |
| `api/spec/services/openrouter_client_spec.rb` | API (Rails) | OpenRouter client: missing-key typed error, env model default/override, structured-JSON parse, prose/code-fence parse fallback, retry/exhaustion, and PII-safe logging via injected fake transport (no live calls) |
| `api/spec/jobs/score_job_post_job_spec.rb` | API (Rails) | JobScorer/ScoreJobPostJob: scoring-field population from mocked LLM JSON, match_score clamping, string-list coercion, fallback-posting scoring, graceful skip with no API key, failed-on-error, PII-safe logging (mocked client) |
| `api/spec/jobs/generate_application_draft_job_spec.rb` | API (Rails) | ApplicationDraftGenerator/GenerateApplicationDraftJob: draft generation from mocked LLM JSON, ATS-shaped autofill payload keyed to the resolved route (manual fallback for unknown), Profile data merged into autofill answers, malformed-answer dropping, graceful skip with no API key, failed-on-error, PII-safe logging (mocked client) |
| `workers/src/safety.test.ts` | Worker safety | `isSensitiveField` detection + `partitionBySensitivity` splitting of answers |
| `workers/src/worker.test.ts` | Worker orchestration | config loading, bearer-auth task fetch/report calls, clean idle without `API_INTERNAL_URL`, one-cycle poll orchestration, and unsupported-ATS safe failure |

---

## Writing New Tests

### Rules

- Unit tests must not hit live external services — mock OpenRouter, Resend, web push, and the
  Playwright browser wherever possible.
- Rails request specs assert both auth and the JSON response shape.
- Encrypted-storage model specs verify that sensitive profile/resume fields are encrypted at
  rest (not stored in plaintext).
- Webhook specs must cover Resend inbound Svix signature validation, not just the happy-path body parse.
- Worker safety tests are pure input/output over `isSensitiveField` / `partitionBySensitivity` —
  no mocks.
- Every new public endpoint (Rails), service/client object, go-app screen component, or ATS
  handler needs at least one test before the task is marked done.
- The end-to-end MVP scenario is the integration north star: email → ingest/score → push →
  review → draft → approve → submit → status report.

### Patterns

**Rails (`api/`):**

- Request specs use RSpec with `type: :request` and `require "rails_helper"`; drive endpoints
  over HTTP and assert status + parsed JSON body.
- Mock external clients (OpenRouter, Resend, web push) — never call the live services.
- Model specs cover encrypted-field behavior directly on the model.

**Web (`web/`, go-app):**

- Use `go test` table-driven tests.
- Mock the Rails API client behind an interface so component/render tests run without a backend.
- Mock the browser Notification/Push APIs behind an abstraction for the push-subscription flow.

**Workers (`workers/`):**

- Use the Node built-in runner: `import { test } from "node:test"` and
  `import assert from "node:assert/strict"`. Local imports use `.js` specifiers.
- Pure functions (safety helpers) are tested directly with plain input/output.
- ATS Playwright handlers are tested against local fixture HTML pages, not live ATS sites.

### Adding a New Test File

1. Name the file per the stack convention:
   - Rails: `spec/<type>/<area>/<name>_spec.rb` (e.g. `spec/requests/api/jobs_spec.rb`).
   - Web: `<name>_test.go`, colocated with the package under test.
   - Workers: `src/<name>.test.ts`, colocated with the module under test.
2. Place it in the correct directory for its stack.
3. Add a row to the Test File Inventory table above.
4. Run that stack's suite before committing to confirm no regressions.
