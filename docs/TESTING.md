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
| workers | Node built-in test runner (`node --test`) + tsx | Node 22 / TS 5.7 | `workers/src/*.test.ts`, `workers/src/**/*.test.ts` | `cd workers && npm test` |

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
  auth gating with no enqueue on refused paths; plus `GET /api/applications/:id` and `PATCH
  /api/applications/:id/draft`, covering draft + job context, editable worker-shaped autofill
  preview, safety warnings, read-only GET behavior (no audit/enqueue), unknown-id not-found JSON
  shape, malformed edit rejection, and auth gating; plus `GET /api/applications` and
  `PATCH /api/applications/:id/status`, covering tracker list/update behavior and
  automation-vs-pipeline status separation.
- **api/** — `spec/requests/api/job_posts_spec.rb`: request specs for authenticated manual
  `POST /api/job_posts`, covering deterministic JobPost creation, route resolution, scoring-job
  enqueueing, unauthenticated refusal, and invalid-input JSON errors; plus the read endpoints
  `GET /api/job_posts` (scored feed ranked by match score, auth gating),
  `GET /api/job_posts?status=unscored` (filtered/deferred feed with triage metadata), and
  `GET /api/job_posts/:id` (scored detail, resolved route, current tracker state, auth gating),
  plus `POST /api/job_posts/:id/score` for explicit score requests and
  `PATCH /api/job_posts/:id/application_status` for tracker application create/reuse and status
  updates.
- **api/** — `spec/requests/api/digest_spec.rb`: request specs for `GET /api/digest`, covering the
  latest digest of recently scored JobPosts (no scoring/LLM on read), the empty-jobs case, and 401
  auth gating.
- **api/** — `spec/requests/api/ingestion_batches_spec.rb` + `spec/services/ingestion_batch_builder_spec.rb`:
  request + service specs for `GET /api/ingestion_batches` / `IngestionBatchBuilder`, covering
  source+arrival-time clustering (within-gap grouping, gap-break, cross-source separation, window
  cutoff), newest-first ordering, no scoring/LLM on read, and 401 auth gating.
- **api/** — `spec/requests/api/push_subscriptions_spec.rb`: request specs for public
  `GET /api/push/vapid_public_key`, authenticated `POST`/`DELETE /api/push_subscription`,
  idempotent endpoint updates, and auth gating.
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
- **api/** — `spec/models/contact_candidate_spec.rb` and `spec/models/outreach_draft_spec.rb`:
  model specs for contact-candidate job linkage, relevance-reason validation, outreach-draft
  association, and manual-send message validation.
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
- **api/** — `spec/jobs/daily_digest_job_spec.rb`: DailyDigestBuilder + WebPushDispatcher +
  DailyDigestJob specs covering recently-scored JobPost selection and notification-payload
  shaping, no-op guards (no VAPID key, no subscriptions, no digest content), expired-subscription
  pruning, and end-to-end dispatch — using a fake push transport injected via the dispatcher's
  `transport:` seam so no real Web Push is ever sent.
- **workers/** — `src/safety.test.ts`: unit tests for sensitive-field detection
  (`isSensitiveField`) and answer partitioning (`partitionBySensitivity`).
- **workers/** — `src/worker.test.ts`: unit tests for worker config loading, bearer-auth task
  fetch/report calls, clean idle when `API_INTERNAL_URL` is unset, one-cycle poll orchestration,
  unsupported-ATS safe failure, browser-launch failure reporting, and cleanup-failure reporting.
- **workers/** — `src/ats/handlers.test.ts`: Playwright fixture tests for Greenhouse, Lever, and
  Ashby handler registration, approved-answer fill/submit behavior, and required unknown /
  sensitive-field pause behavior.
- **web/** — `components/pwa_test.go`: table-driven `go test` coverage of the PWA install/push
  gating helpers — iOS/iPadOS detection and version parsing (`DetectIOS`), the iOS 16.4+ Web Push
  threshold (`SupportsIOSWebPush`), and the install/permission gate decision (`EvaluatePushGate`).
- **web/** — `components/jobs_test.go`, `components/applications_test.go`,
  `components/login_test.go`, `components/client_test.go`: render tests for the job list, job
  detail, applications tracker, and ingestion-history (batches) screens (scored fields, tracker state, empty,
  error, and 401 states) plus the login form, driven by a mocked `RailsClient`. Render tests use
  the go-app `NewTestEngine` (which fires `OnPreRender`, so data screens load in both `OnMount`
  and `OnPreRender`). The `httpRailsClient` is exercised against an `httptest` server to assert
  the `/api`-namespaced paths, JSON decode of scored fields/route/tracker state, session-cookie carry between
  requests, and 401 → `APIError`/`IsUnauthorized` mapping. Pure helpers (`MatchScoreLabel`,
  `RouteLabel`, `jobIDFromPath`, `loginErrorStatus`) are table-tested.
- **web/** — `components/profile_test.go`, `components/push_test.go`: render and unit tests for the
  profile/resume screen and the embedded push toggle (WEB-04). Profile tests assert the editable
  fields render, contact details show only as presence flags (never leaking PII), the resume
  metadata/empty state, and the save path (`doSave`) writes via the mocked `RailsClient` with
  reseed/error/401 handling. Push tests use a `mockPusher` standing in for the browser Push API
  (`PushSubscriber`): they verify `doSubscribe` reads the public VAPID key, subscribes, and only
  then persists to Rails; `doUnsubscribe` cancels the browser subscription before calling Rails;
  the `applySubscribe`/`applyUnsubscribe`/`initialPushState`/`pushErrorMessage` state mappings; and
  that rendering/mount never auto-subscribes (unsupported build renders guidance, supported build
  renders the enable control without any VAPID fetch or persist).
- **web/** — `components/contacts_test.go`: render and unit tests for the contacts/outreach screen
  (WEB-05). They assert the saved candidates render (name, role line, relevance reason, LinkedIn
  link), the empty/error/401 load states, and the explicit per-candidate `doGenerate` path (drafts
  via the mocked `RailsClient` with the typed loose template, recording the message for manual
  copy). Two safety tests lock in the product constraint: a full render lifecycle makes **zero**
  `GenerateOutreach` calls (no auto-generate/send on mount), and the rendered screen exposes no
  send affordance — only copy/manual-send guidance. Error-mapping (`applyGenerateResult`:
  503 → not-configured, 401 → session-expired, generic) and the `contactRole`/`generateButtonLabel`/
  `contactsJobIDFromPath` helpers are table-tested.
- **web/** — `components/manual_entry_test.go`: render and unit tests for the manual job entry
  screen (WEB-06). They assert the form renders (URL/text/title/company inputs, submit, back link),
  the explicit `doSubmit` path posts the **trimmed** input via the mocked `RailsClient` and then
  surfaces the created `JobPost` with a `/jobs/:id` link, that an empty form (no URL or text) never
  reaches the API (`inputPresent` gate), and the `applyCreateResult` error mapping (401 →
  session-expired, 422 → invalid-input, generic → transient). The `createdMessage` (title/company
  vs id fallback, pending/empty status → "being scored") and `entryButtonLabel` helpers are
  table-tested.

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

- `web/` component render tests and an API-client/push-subscription abstraction (only the pure
  install/push gating helpers are covered so far).
- Rails webhook/job/dispatch specs.
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
| `api/spec/models/contact_candidate_spec.rb` | API (Rails) | contact candidate job-post association, relevance reason validation, and owned outreach drafts |
| `api/spec/models/job_post_spec.rb` | API (Rails) | job post company/title validations, application-route association, match-score bounds |
| `api/spec/models/outreach_draft_spec.rb` | API (Rails) | outreach draft contact-candidate association and manual-send message validation |
| `api/spec/models/profile_spec.rb` | API (Rails) | profile name/JSON-shape validation, encrypted-at-rest ciphertext check for email/phone/address, deterministic-email queryability |
| `api/spec/models/resume_document_spec.rb` | API (Rails) | resume document profile/title validation, parsed_structure default, encrypted-at-rest ciphertext check for raw_text/parsed_structure |
| `api/spec/requests/api/auth_spec.rb` | API (Rails) | shared-secret session success/failure, protected endpoint gating, health bypass, worker bearer guard |
| `api/spec/requests/api/applications_spec.rb` | API (Rails) | `POST /api/applications/:id/submit` approved clean-payload dispatch, audit event recording, approval-required/unsupported/unsafe refusal paths, and 401 auth gating with no enqueue on refusal; `GET /api/applications/:id` draft + job context + worker-shaped autofill preview, read-only (no audit/enqueue), not-found JSON shape, and auth gating; `PATCH /api/applications/:id/draft` reviewed autofill-answer persistence, safety warnings, malformed edit rejection, draft-required rejection, and auth |
| `api/spec/requests/api/job_posts_spec.rb` | API (Rails) | `POST /api/job_posts` authenticated manual URL/text ingestion, route resolution, scoring enqueue, 401 auth gating, and invalid-input JSON error shape; `GET /api/job_posts` scored feed ranking + auth; `GET /api/job_posts?status=unscored` filtered/deferred feed with triage metadata; `POST /api/job_posts/:id/score` explicit scoring enqueue/manual override; `GET /api/job_posts/:id` scored detail with resolved route, not-found JSON shape, and auth |
| `api/spec/services/job_post_triage_spec.rb` | API (Rails) | deterministic inbound title/location triage for developer/software/AI-adjacent roles, Vancouver/Calgary/remote prioritization, rejection reasons, remote-status inference, and env-driven daily budget parsing |
| `api/spec/requests/api/digest_spec.rb` | API (Rails) | `GET /api/digest` latest digest of recently scored JobPosts (no scoring/LLM on read), empty-jobs case, and 401 auth gating |
| `api/spec/requests/api/ingestion_batches_spec.rb` | API (Rails) | `GET /api/ingestion_batches` ingestion history grouped into source+arrival-time batches newest-first (no scoring/LLM on read), empty case, and 401 auth gating |
| `api/spec/services/ingestion_batch_builder_spec.rb` | API (Rails) | `IngestionBatchBuilder` clustering: same-source within-gap grouping, gap-break into new batches, cross-source separation, window cutoff, empty case, and synthetic batch id |
| `api/spec/requests/api/push_subscriptions_spec.rb` | API (Rails) | `GET /api/push/vapid_public_key` public VAPID key read; `POST`/`DELETE /api/push_subscription` authenticated subscribe/unsubscribe, idempotent endpoint update, and 401 auth gating |
| `api/spec/requests/api/worker_tasks_spec.rb` | API (Rails) | `GET /api/worker_tasks` worker-shaped task pull with bearer-only auth; `POST /api/worker_tasks/:id/report` status updates, audit screenshots/log refs, and human-session rejection |
| `api/spec/requests/api/profile_spec.rb` | API (Rails) | `POST /api/profile/resume` JSON Resume → Profile + primary ResumeDocument mapping, PDF Active Storage attachment, encrypted-at-rest contact/raw_text check, idempotent re-sync, 401 unauth, 422 invalid/malformed; `GET`/`PATCH /api/profile` structured read/update with PII presence-flags only |
| `api/spec/requests/api/health_spec.rb` | API (Rails) | `GET /api/health` — 200 status, JSON shape, database connectivity |
| `api/spec/requests/webhooks/resend_spec.rb` | API (Rails) | Resend inbound webhook Svix verification, raw inbound-email persistence, parse-job enqueueing, provider-only auth, and PII-safe logging |
| `api/spec/services/inbound_email_parser_spec.rb` | API (Rails) | Deterministic known-sender (LinkedIn/Indeed/Glassdoor) parsing into normalized JobPosts, company reuse, and LLM-fallback flagging |
| `api/spec/jobs/parse_inbound_email_job_spec.rb` | API (Rails) | ParseInboundEmailJob wiring to the parser service for known-sender and fallback paths, including deterministic triage filtering and daily scoring-budget deferral |
| `api/spec/services/application_route_resolver_spec.rb` | API (Rails) | Deterministic ATS route-type detection from URL fixtures, recommended-route preference ranking, confidence, unknown→manual LLM fallback, and ApplicationRoute persistence/idempotency |
| `api/spec/services/openrouter_client_spec.rb` | API (Rails) | OpenRouter client: missing-key typed error, env model default/override, structured-JSON parse, prose/code-fence parse fallback, retry/exhaustion, and PII-safe logging via injected fake transport (no live calls) |
| `api/spec/jobs/score_job_post_job_spec.rb` | API (Rails) | JobScorer/ScoreJobPostJob: scoring-field population from mocked LLM JSON, match_score clamping, string-list coercion, fallback-posting scoring, graceful skip with no API key, failed-on-error, PII-safe logging (mocked client) |
| `api/spec/jobs/generate_application_draft_job_spec.rb` | API (Rails) | ApplicationDraftGenerator/GenerateApplicationDraftJob: draft generation from mocked LLM JSON, ATS-shaped autofill payload keyed to the resolved route (manual fallback for unknown), Profile data merged into autofill answers, malformed-answer dropping, graceful skip with no API key, failed-on-error, PII-safe logging (mocked client) |
| `workers/src/safety.test.ts` | Worker safety | `isSensitiveField` detection + `partitionBySensitivity` splitting of answers |
| `workers/src/worker.test.ts` | Worker orchestration | config loading, bearer-auth task fetch/report calls, clean idle without `API_INTERNAL_URL`, one-cycle poll orchestration, and unsupported-ATS safe failure |
| `workers/src/ats/handlers.test.ts` | Worker ATS handlers | Playwright fixture coverage for Greenhouse/Lever/Ashby registration, approved field fill/submit, unknown required field pauses, and sensitive-field pauses |
| `web/components/pwa_test.go` | Web (go-app PWA) | iOS/iPadOS detection + version parsing, iOS 16.4+ Web Push threshold, and the install/notification-permission gate decision |
| `web/components/jobs_test.go` | Web (go-app PWA) | Job list / job detail / ingestion-batch render tests (scored/unscored tabs, explicit score request button, scored fields, batch grouping + collapsible postings, tracker status controls, empty/error/401 states) via a mocked `RailsClient` and `NewTestEngine`; explicit no-score/no-apply/no-status-update-on-render assertions; `MatchScoreLabel`/`RouteLabel`/`jobIDFromPath` helpers |
| `web/components/applications_test.go` | Web (go-app PWA) | Applications tracker render tests, empty/error/401 states, explicit no-status-update-on-render assertion, and direct status-update state tests |
| `web/components/login_test.go` | Web (go-app PWA) | Login form render and `loginErrorStatus`/`loginButtonText` status mapping (401 → "Incorrect passphrase") |
| `web/components/client_test.go` | Web (go-app PWA) | `httpRailsClient` against `httptest`: `/api`-namespaced paths, scored/unscored job query decode, explicit score request path, scored-field/route/tracker JSON decode, application/job tracker PATCH payloads, draft PATCH payload shape, Rails error-code parsing, session-cookie carry, 401 → `APIError` |
| `web/components/profile_test.go` | Web (go-app PWA) | Profile/resume render (editable fields, contact presence flags with no PII leak, resume metadata/empty) and `doSave` write path (reseed/error/401) via a mocked `RailsClient` |
| `web/components/push_test.go` | Web (go-app PWA) | Push toggle subscribe/unsubscribe flow via a mocked `PushSubscriber` (public VAPID key fetched then persisted; browser cancel before Rails), state-mapping helpers, and no-auto-subscribe-on-render |
| `web/components/contacts_test.go` | Web (go-app PWA) | Contacts/outreach render (candidate fields, empty/error/401), explicit `doGenerate` draft path, no-auto-generate-on-mount and no-send-affordance safety tests, and `applyGenerateResult`/`contactRole`/`generateButtonLabel`/`contactsJobIDFromPath` helpers, via a mocked `RailsClient` |
| `web/components/manual_entry_test.go` | Web (go-app PWA) | Manual job entry render (URL/text/title/company form), explicit `doSubmit` posting trimmed input via the mocked `RailsClient` and surfacing the created `/jobs/:id` link, empty-form no-API-call gate, `applyCreateResult` error mapping (401/422/transient), and `createdMessage`/`entryButtonLabel` helpers |

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
