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
  `POST /api/job_posts`, covering deterministic JobPost creation, optional external-application
  route resolution, exact-match `new`/`already_tracked`/`already_submitted` response shapes,
  alias/audit persistence, no duplicate scoring, unauthenticated refusal, and invalid-input JSON
  errors; plus the read endpoints
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
  `spec/models/application_route_spec.rb`, and `spec/models/job_post_url_identity_spec.rb`: model
  specs for the core job-posting associations, validations, route-type and URL-role allowlists,
  URL-alias preservation, same-owner aliases, and cross-JobPost identity protection at both the
  model and database levels.
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
  known-sender (LinkedIn/Indeed/Glassdoor) email parser, normalized JobPost and URL-alias
  persistence, company reuse, and LLM-fallback flagging for unknown senders and empty parses.
- **api/** — `spec/services/job_post_materializer_spec.rb`: inbound materialization coverage for
  stable source/posting/application URL-alias registration and retry-safe identity reuse without
  LLM calls.
- **api/** — `spec/services/inbound_email_llm_extractor_spec.rb`: mocked LLM-fallback extraction,
  no-posting/skip/retry states, and shared URL-alias persistence without live network calls.
- **api/** — `spec/jobs/parse_inbound_email_job_spec.rb`: job spec wiring the inbound parse job
  to the parser service for both the known-sender and LLM-fallback paths.
- **api/** — `spec/services/application_route_resolver_spec.rb`: deterministic route-type
  detection from URL fixtures, recommended-route preference ordering, posting/source URL tie-breaks,
  unknown→manual LLM-fallback flagging, determinism, ApplicationRoute persistence/idempotency, and
  stable resolved-application URL alias registration.
- **api/** — `spec/services/job_url_identity_spec.rb`: pure stable URL identity generation for
  LinkedIn listing variants, known tracking-parameter removal, generic/ATS path/query retention,
  malformed/non-HTTP(S) refusal, and no HTTP/LLM construction.
- **api/** — `spec/services/job_post_url_identity_backfill_spec.rb`: historical URL-alias backfill
   coverage for source/posting/application URLs, blank-value skipping, rerun idempotency, and
   deterministic collision ownership with retained JobPost audit records.
- **api/** — `spec/services/manual_job_post_importer_spec.rb`: transactional manual import coverage
  for exact identity reuse, source/posting/application alias persistence, import audit events,
  submitted-vs-tracked result selection, and optional application-URL validation.
- **api/** — `spec/services/posting_metadata_fetcher_spec.rb`: deterministic posting-metadata
  extraction covering the LinkedIn guest top card (including forwarded `/comm/` URLs), the
  Greenhouse/Lever/Ashby public endpoints, JSON-LD `JobPosting`, OpenGraph/`<title>` fallbacks,
  bounded redirects, non-HTTP and private-address refusal, unavailable-not-raising failure paths,
  and an assertion that the LLM is never constructed — all against an injected fake transport with
  no live network calls or DNS lookups.
- **api/** — `spec/services/job_post_enricher_spec.rb`: placeholder title/company replacement,
  owner-supplied fields never being overwritten (via the `source_payload.manual_entry` flags),
  blank-only description/location/compensation fills, unavailable/skipped results leaving the
  record untouched, and no LLM use — with a stubbed fetcher.
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
- **api/** — `spec/jobs/expire_stale_job_posts_job_spec.rb`: ExpireStaleJobPostsJob stale-sweep
  specs covering auto-backlog of active unactioned posts past `JOB_INTAKE_STALE_AFTER_DAYS` with an
  audited transition, leaving recent/backlog/removed rows untouched, skipping owner-actioned posts
  (with an Application or a `lifecycle_changed` audit event), idempotency across repeated runs, and
  the env override.
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
  the `/api`-namespaced paths, the `Jobs(JobFeedParams)` filter/sort/state/page query building and
  `{job_posts, page}` envelope decode, JSON decode of scored fields/route/tracker state,
  session-cookie carry between requests, and 401 → `APIError`/`IsUnauthorized` mapping. Pure helpers (`MatchScoreLabel`,
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
- **web/** — `components/manual_entry_test.go`: render and unit tests for the manual job import
  screen (WEB-06/WEB-15). They assert the form renders (listing URL, optional external application
  URL, text/title/company inputs, submit, back link), the explicit `doSubmit` path posts the
  **trimmed** input via the mocked `RailsClient` and then surfaces the returned `/jobs/:id` link,
  that an empty form (no URL or text) never reaches the API (`inputPresent` gate), and that a full
  render lifecycle makes zero `CreateJobPost` calls. The new/tracked/submitted/possible-match
  result messages and links plus the `applyCreateResult` error mapping (401 → session-expired,
  422 → invalid-input, generic → transient) are table-tested. The posting-lookup prefill is
  covered by driving `doLookup` directly: the trimmed URL reaches the client, title/company/
  posting text are filled from the result, owner-typed fields are never overwritten, an
  unreadable posting leaves the form idle and submittable, an expired session is surfaced, and a
  full render lifecycle makes zero `LookupPosting` calls.
- **web/** — `components/jobs_test.go` (INTAKE-08 intake actions): render tests assert the Jobs
  feed exposes per-row select checkboxes, per-row Backlog/Remove (Active bin) and Restore
  (Backlog/Removed bins), and the multi-select bulk bar (Backlog/Remove selected, or Restore
  selected); the job detail exposes the matching intake block keyed off `lifecycle_state`. The
  explicit `doSetLifecycle` path (single, bulk via `selectedIDs`, and restore) calls the mocked
  `SetJobLifecycle` (single id → member route, multiple → bulk) and the transitioned rows leave the
  current bin view while selection clears; `applyToggleSelect` and the error mapping (401 →
  session-expired, generic) are unit-tested. Two safety tests lock the constraint: a full render
  lifecycle makes **zero** `SetJobLifecycle` calls on both `JobList` and `JobDetailView`.

- **web/** — `components/jobs_test.go` + `components/applications_test.go` (INTAKE-09 landing/table
  pagination): the ingestion-batches landing (`DigestView`) renders a Prev/Next pagination block
  reading the page envelope (page indicator "Page N of M", Prev disabled on page 1, Next gated on
  `has_next`); `applyNextPage`/`applyPrevPage` advance/stop and the advanced page is carried to the
  mocked `IngestionBatches(ctx, page)`. The tracker table (`ApplicationsView`) loads with
  `status=all` + `state=open` (TRACK-01 — the earlier all-jobs table left `status` unset and so
  silently got the scored-only default, which is why it rendered empty), switches lifecycle bin and
  sort via `applyBin`/`applySort` (each resetting to page 1),
  paginates with Prev/Next (`applyNextPage`/`applyPrevPage`), and its header stats and group-tab
  badges read the server's `application_counts` rather than counting the current page. The mocked
  `Jobs` returns those counts via `mockClient.jobsCounts`. The mocked `IngestionBatches`
  now returns an `IngestionBatchPage` and records the requested page (`gotBatchesPage`).

### Planned (from the plan's Testing Plan)

**Intake management (INTAKE / RESOLVED-20):**

- `api/` request specs for `GET /api/job_posts` filters (`score_band`, `source`, `location`,
  `date_from`/`date_to`, `state`), `sort` (`oldest` default vs `score`), and the 30-row/page
  pagination envelope (`page.number`/`size`/`total`/`has_next`); `state=active` default excludes
  backlog/removed.
- `api/` request specs for `PATCH /api/job_posts/:id/lifecycle` and bulk
  `PATCH /api/job_posts/lifecycle`: active↔backlog↔removed transitions, each writing a
  `JobPostAuditEvent` (no-op transitions write nothing); `removed` rows hidden from active feeds;
  removed state assigns a restore/purge deadline; bulk transactional update
  with `not_found` (no changes) on any unknown id; invalid-value and unknown-id error shapes; auth gating.
- `api/` specs for `JobPostTriage` auto-backlog of rejected posts and the
  `JOB_INTAKE_DAILY_ACTIVE_LIMIT` daily active cap, and a job spec for `ExpireStaleJobPostsJob`
  auto-backlogging stale active posts plus protected removed-row retention/purge.
- `api/` request spec for `GET /api/ingestion_batches` pagination at 30/page.
- `web/` render/handler tests for the Jobs filter controls, sort toggle, bin tabs
  (active/backlog/removed), per-row + bulk backlog/remove/restore actions (assert no lifecycle
  mutation on mount/render), and Prev/Next pagination, via the mocked `RailsClient`
  (`SetJobLifecycle` + filter params on `Jobs()`).

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
- Responsive/manual-workflow browser check: install the existing `workers/` Playwright
  dependencies and Chromium, then run `cd web && make wasm server`. Start the shell with
  `env -u API_INTERNAL_URL PORT=8094 ./bin/server`; in another terminal at the repository root,
  run `node web/scripts/layout-smoke.cjs`. If using a preinstalled Chromium, set
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its executable. The script mocks all API requests,
  blocks service workers for deterministic asset updates, and writes screenshots to a temporary
  directory printed on success. This verifies Chromium at phone/tablet/desktop widths; physical
  iPhone Safari/Home Screen behavior still benefits from an on-device check.

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
| `api/spec/models/job_post_spec.rb` | API (Rails) | job post company/title validations, application-route and URL-identity associations, match-score bounds |
| `api/spec/models/job_post_url_identity_spec.rb` | API (Rails) | URL-identity role allowlist, raw URL preservation, per-job alias uniqueness, same-owner shared identities, and cross-job database ownership enforcement |
| `api/spec/models/outreach_draft_spec.rb` | API (Rails) | outreach draft contact-candidate association and manual-send message validation |
| `api/spec/models/profile_spec.rb` | API (Rails) | profile name/JSON-shape validation, encrypted-at-rest ciphertext check for email/phone/address, deterministic-email queryability |
| `api/spec/models/resume_document_spec.rb` | API (Rails) | resume document profile/title validation, parsed_structure default, encrypted-at-rest ciphertext check for raw_text/parsed_structure |
| `api/spec/requests/api/auth_spec.rb` | API (Rails) | shared-secret session success/failure, protected endpoint gating, health bypass, worker bearer guard |
| `api/spec/requests/api/intake_spec.rb` | API (Rails) | authenticated intake status, pause/resume, held-reference requeue, once-daily maintenance scheduling, and invalid-state rejection |
| `api/spec/requests/api/applications_spec.rb` | API (Rails) | `POST /api/applications/:id/submit` approved clean-payload dispatch, audit event recording, approval-required/unsupported/unsafe refusal paths, and 401 auth gating with no enqueue on refusal; `GET /api/applications/:id` draft + job context + worker-shaped autofill preview, read-only (no audit/enqueue), not-found JSON shape, and auth gating; `PATCH /api/applications/:id/draft` reviewed autofill-answer persistence, safety warnings, malformed edit rejection, draft-required rejection, and auth |
| `api/spec/requests/api/job_posts_spec.rb` | API (Rails) | `POST /api/job_posts` manual URL/text import with optional external application URL, typed new/tracked/submitted response, exact-identity alias/audit reuse without duplicate scoring, auth, and invalid-input errors; `GET /api/job_posts` scored+active oldest-first default feed with the `{number,size,total,has_next}` page envelope + auth; `GET /api/job_posts` `sort=score` ranking, `state=backlog`/active-default exclusion of backlog+removed, AND-combined `score_band`/`source`/`location`/`date_from`/`date_to` filters, and `JOBS_PAGE_SIZE`-driven pagination; `GET /api/job_posts?status=unscored` filtered/deferred feed with triage metadata; the TRACK-01 tracker surface (`status=all` unscored inclusion, `state=open` spanning active+backlog while excluding removed, embedded latest-`application` + `created_at` serialization, newest-application-wins when a job has several, `application` group filtering with untracked posts counted as not-applied, `application_counts` taken over the other filters only, and `sort=newest`/`sort=activity` ordering); `POST /api/job_posts/lookup` prefill read (fields returned, nothing persisted, unreadable postings answered 200 as `unavailable`, auth) and enrichment-before-scoring for a URL-only import; `POST /api/job_posts/:id/score` explicit scoring enqueue/manual override; `GET /api/job_posts/:id` scored detail with resolved route, not-found JSON shape, and auth |
| `api/spec/services/job_post_triage_spec.rb` | API (Rails) | deterministic inbound title/location triage for developer/software/AI-adjacent roles, Vancouver/Calgary/remote prioritization, rejection reasons, remote-status inference, and env-driven daily budget parsing |
| `api/spec/requests/api/digest_spec.rb` | API (Rails) | `GET /api/digest` latest digest of recently scored JobPosts (no scoring/LLM on read), empty-jobs case, and 401 auth gating |
| `api/spec/requests/api/ingestion_batches_spec.rb` | API (Rails) | `GET /api/ingestion_batches` ingestion history grouped into source+arrival-time batches newest-first (no scoring/LLM on read), empty case, and 401 auth gating |
| `api/spec/services/ingestion_batch_builder_spec.rb` | API (Rails) | `IngestionBatchBuilder` clustering: same-source within-gap grouping, gap-break into new batches, cross-source separation, window cutoff, empty case, and synthetic batch id |
| `api/spec/requests/api/push_subscriptions_spec.rb` | API (Rails) | `GET /api/push/vapid_public_key` public VAPID key read; `POST`/`DELETE /api/push_subscription` authenticated subscribe/unsubscribe, idempotent endpoint update, and 401 auth gating |
| `api/spec/requests/api/worker_tasks_spec.rb` | API (Rails) | `GET /api/worker_tasks` worker-shaped task pull with bearer-only auth; `POST /api/worker_tasks/:id/report` status updates, audit screenshots/log refs, and human-session rejection |
| `api/spec/requests/api/profile_spec.rb` | API (Rails) | `POST /api/profile/resume` JSON Resume → Profile + primary ResumeDocument mapping, PDF Active Storage attachment, encrypted-at-rest contact/raw_text check, idempotent re-sync, 401 unauth, 422 invalid/malformed; `GET`/`PATCH /api/profile` structured read/update with PII presence-flags only |
| `api/spec/requests/api/health_spec.rb` | API (Rails) | `GET /api/health` — 200 status, JSON shape, database connectivity |
| `api/spec/requests/webhooks/resend_spec.rb` | API (Rails) | Resend inbound webhook Svix verification, raw inbound-email persistence, enabled parse-job enqueueing, paused reference holding with no job, provider-only auth, and PII-safe logging |
| `api/spec/services/inbound_email_parser_spec.rb` | API (Rails) | Deterministic known-sender (LinkedIn/Indeed/Glassdoor) parsing into normalized JobPosts and URL aliases, company reuse, and LLM-fallback flagging |
| `api/spec/services/job_post_materializer_spec.rb` | API (Rails) | Shared inbound materialization stable URL-alias registration and retry-safe identity reuse without LLM calls |
| `api/spec/services/inbound_email_llm_extractor_spec.rb` | API (Rails) | Mocked fallback extraction, URL-alias persistence, skip/empty/retry states, and no live network calls |
| `api/spec/jobs/parse_inbound_email_job_spec.rb` | API (Rails) | ParseInboundEmailJob wiring to the parser service for known-sender and fallback paths, including deterministic triage filtering and daily scoring-budget deferral |
| `api/spec/services/application_route_resolver_spec.rb` | API (Rails) | Deterministic ATS route-type detection from URL fixtures, recommended-route preference ranking, confidence, unknown→manual LLM fallback, ApplicationRoute persistence/idempotency, and resolved-application URL aliases |
| `api/spec/services/job_url_identity_spec.rb` | API (Rails) | Pure host-aware URL identity keys: LinkedIn job-id canonicalization, tracking-parameter removal, generic/ATS job-component retention, invalid-input safety, and no HTTP/LLM construction |
| `api/spec/services/job_post_url_identity_backfill_spec.rb` | API (Rails) | Historical URL alias backfill, blank URL skipping, rerun idempotency, deterministic collision ownership, and preserved duplicate audit records |
| `api/spec/services/manual_job_post_importer_spec.rb` | API (Rails) | Manual import exact-identity lookup, novel alias/audit persistence, new/tracked/submitted result typing, and application-URL validation |
| `api/spec/services/posting_metadata_fetcher_spec.rb` | API (Rails) | Deterministic posting metadata: LinkedIn guest top card (incl. `/comm/` URLs), Greenhouse/Lever/Ashby public endpoints, JSON-LD `JobPosting`, OpenGraph/`<title>` fallback, bounded redirects, non-HTTP + private-address refusal, unavailable-not-raising failures, and no LLM construction (injected fake transport, no live calls) |
| `api/spec/services/job_post_enricher_spec.rb` | API (Rails) | Placeholder title/company backfill, owner-supplied fields preserved, blank-only description/location/compensation fills, unavailable/skipped no-ops, and no LLM use (stubbed fetcher) |
| `api/spec/jobs/enrich_job_post_job_spec.rb` | API (Rails) | EnrichJobPostJob enqueues `ScoreJobPostJob` after enrichment, including when the posting could not be read |
| `api/spec/services/openrouter_client_spec.rb` | API (Rails) | OpenRouter client: missing-key typed error, env model default/override, structured-JSON parse, prose/code-fence parse fallback, retry/exhaustion, and PII-safe logging via injected fake transport (no live calls) |
| `api/spec/jobs/score_job_post_job_spec.rb` | API (Rails) | JobScorer/ScoreJobPostJob: scoring-field population from mocked LLM JSON, match_score clamping, string-list coercion, fallback-posting scoring, graceful skip with no API key, failed-on-error, PII-safe logging (mocked client) |
| `api/spec/jobs/generate_application_draft_job_spec.rb` | API (Rails) | ApplicationDraftGenerator/GenerateApplicationDraftJob: draft generation from mocked LLM JSON, ATS-shaped autofill payload keyed to the resolved route (manual fallback for unknown), Profile data merged into autofill answers, malformed-answer dropping, graceful skip with no API key, failed-on-error, PII-safe logging (mocked client) |
| `api/spec/jobs/expire_stale_job_posts_job_spec.rb` | API (Rails) | stale active auto-backlog plus 30-day removed-row retention scheduling/purge, with Application-protected and backlog exclusions |
| `workers/src/safety.test.ts` | Worker safety | `isSensitiveField` detection + `partitionBySensitivity` splitting of answers |
| `workers/src/worker.test.ts` | Worker orchestration | config loading, bearer-auth task fetch/report calls, clean idle without `API_INTERNAL_URL`, one-cycle poll orchestration, and unsupported-ATS safe failure |
| `workers/src/ats/handlers.test.ts` | Worker ATS handlers | Playwright fixture coverage for Greenhouse/Lever/Ashby registration, approved field fill/submit, unknown required field pauses, and sensitive-field pauses |
| `web/components/pwa_test.go` | Web (go-app PWA) | iOS/iPadOS detection + version parsing, iOS 16.4+ Web Push threshold, and the install/notification-permission gate decision |
| `web/components/chrome_test.go` | Web (go-app PWA) | Shared navigation accessibility, persistent Import job entry, layout choices, invalid-preference fallback, copy-control initial state, empty-stage handling, and the pending-app-update banner (hidden with no update, shown after `applyAppUpdate(true)`, and latching so a later false reading cannot hide it) |
| `web/scripts/layout-smoke.cjs` | Web (Playwright Chromium) | Eight screens at 320/390/768/960/1440px, layout persistence/resize, overflow, explicit manual tracking success/failure, stage clearing, copy success/blocked feedback, and no application writes on navigation; all API calls use local fixtures |
| `web/components/jobs_test.go` | Web (go-app PWA) | Job list / detail / ingestion batches, visible Import job actions (including empty feed), lifecycle/filter/pagination behavior, manual application link fallback and safe URL handling, no regression of later tracking statuses, explicit intake pause/resume state and error paths, held count, and no intake mutation on render via a mocked `RailsClient` |
| `web/components/applications_test.go` | Web (go-app PWA) | Application tracker (TRACK-01) render tests: one row per intaked job with its inline status control and the "Not applied" placeholder, group tabs with server counts, the applied-to/tracked header split, bin + sort controls, Prev/Next pagination, per-tab empty states, and 401 handling. Query assertions pin `status=all` / `state=open` / `sort=newest`. Write-path tests cover the row status write going through the job-post endpoint plus a refetch, the inert placeholder, and error recovery; render tests assert 0 status writes, 0 draft creations, and 0 submits after a full lifecycle |
| `web/components/login_test.go` | Web (go-app PWA) | Login form render and `loginErrorStatus`/`loginButtonText` status mapping (401 → "Incorrect passphrase") |
| `web/components/client_test.go` | Web (go-app PWA) | `httpRailsClient` against `httptest`: `/api` paths, intake GET/PATCH, Jobs filters/page decode, manual import application URL + typed result decode, scoring/job-post tracker/draft payloads, session-cookie carry, and API errors. The application-scoped `Applications`/`UpdateApplicationStatus` client tests were removed with those methods in TRACK-01; the Rails endpoints remain covered by `spec/requests/api/applications_spec.rb` |
| `web/components/profile_test.go` | Web (go-app PWA) | Profile/resume render (editable fields, contact presence flags with no PII leak, resume metadata/empty) and `doSave` write path (reseed/error/401) via a mocked `RailsClient` |
| `web/components/push_test.go` | Web (go-app PWA) | Push toggle subscribe/unsubscribe flow via a mocked `PushSubscriber` (public VAPID key fetched then persisted; browser cancel before Rails), state-mapping helpers, and no-auto-subscribe-on-render |
| `web/components/contacts_test.go` | Web (go-app PWA) | Contacts/outreach render (candidate fields, empty/error/401), explicit `doGenerate` draft path, no-auto-generate-on-mount and no-send-affordance safety tests, and `applyGenerateResult`/`contactRole`/`generateButtonLabel`/`contactsJobIDFromPath` helpers, via a mocked `RailsClient` |
| `web/components/manual_entry_test.go` | Web (go-app PWA) | Manual job import render (listing URL, optional external application URL, text/title/company form), explicit `doSubmit` posting trimmed input via the mocked `RailsClient` and surfacing the returned `/jobs/:id` link, new/tracked/submitted/possible-match messages, empty-form and render no-API-call gates, error mapping (401/422/transient), label helpers, and the `doLookup` prefill (fills only untouched fields, keeps owner input, stays usable on an unreadable posting, zero lookups on render) |

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
