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
- **workers/** — `src/safety.test.ts`: unit tests for sensitive-field detection
  (`isSensitiveField`) and answer partitioning (`partitionBySensitivity`).
- **web/** — **no tests yet.**

### Planned (from the plan's Testing Plan)

**Rails (`api/`):**

- Request specs for all JSON endpoints.
- Model specs verifying encrypted profile/resume storage (fields encrypted at rest).
- Webhook specs covering Mailgun signature validation and inbound email parsing.
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
- Rails model/webhook/job/dispatch specs (only the health request spec exists).
- Playwright ATS handler and pause/fail tests (only pure safety-helper unit tests exist).
- The full end-to-end MVP integration scenario (see below).

---

## Test File Inventory

Keep this table up to date — add a row when adding a new test file.

| File | Domain | What It Covers |
|---|---|---|
| `api/spec/requests/api/auth_spec.rb` | API (Rails) | shared-secret session success/failure, protected endpoint gating, health bypass, worker bearer guard |
| `api/spec/requests/api/health_spec.rb` | API (Rails) | `GET /api/health` — 200 status, JSON shape, database connectivity |
| `workers/src/safety.test.ts` | Worker safety | `isSensitiveField` detection + `partitionBySensitivity` splitting of answers |

---

## Writing New Tests

### Rules

- Unit tests must not hit live external services — mock OpenRouter, Mailgun, web push, and the
  Playwright browser wherever possible.
- Rails request specs assert both auth and the JSON response shape.
- Encrypted-storage model specs verify that sensitive profile/resume fields are encrypted at
  rest (not stored in plaintext).
- Webhook specs must cover Mailgun signature validation, not just the happy-path body parse.
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
- Mock external clients (OpenRouter, Mailgun, web push) — never call the live services.
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
