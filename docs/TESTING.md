# TESTING.md — Test Suite Reference

> Canonical source for how to run tests, what is covered, and how to write new tests.
> Read before adding any new test file or modifying an existing one.
> Code conventions that affect test structure live in [`CONVENTIONS.md`](CONVENTIONS.md).

Waunder has three deployed stacks, each with its own test runner: `api/` (Rails / RSpec),
`web/` (Go / `go test`), and `workers/` (Node built-in test runner). A fourth, `client/`, is the
in-progress replacement frontend and runs Vitest.

> **Migrating:** `web/` is being replaced by the Vite + React + TypeScript project in `client/`,
> whose test stack is Vitest + Testing Library + MSW. The `web/` sections below describe the
> current Go/go-app suite and stay accurate until the cutover task removes it. See
> [`GO_MIGRATION.md`](GO_MIGRATION.md).

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

# --- client/ (Vite + React + TypeScript, shadow frontend) ---
cd client && npm test                                    # all tests (vitest run)
cd client && npx vitest run src/toolchain.test.tsx       # single file
cd client && npm run typecheck                           # tsc --noEmit
cd client && npm run lint                                # eslint .
cd client && npm run build                               # vite build
bash client/scripts/container-smoke.sh                   # build/run Caddy image smoke test
```

---

## Test Stacks

| Stack | Tool | Version | Location | Run Command |
|---|---|---|---|---|
| api (Rails) | RSpec (`rspec-rails ~> 8.0`) | Ruby 3.2.3 / Rails 8.1.3 | `api/spec/` | `cd api && bundle exec rspec` |
| web (go-app) | Go testing (`go test`) | Go 1.26 | `web/**/*_test.go` | `cd web && go test ./...` |
| workers | Node built-in test runner (`node --test`) + tsx | Node 22 / TS 5.7 | `workers/src/*.test.ts`, `workers/src/**/*.test.ts` | `cd workers && npm test` |
| client (shadow frontend) | Vitest 5 + jsdom + Testing Library + `@testing-library/jest-dom` + MSW 2 | Node 22 / TS 5.9 / React 19 | `client/src/**/*.{test,spec}.{ts,tsx}` | `cd client && npm test` |

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
  API-key typed error, Nex default model and disabled high-reasoning payload, environment model/reasoning
  overrides, structured-JSON parsing, parse fallback for prose/code-fence-wrapped JSON, retry on 429/5xx
  then exhaustion, and PII-safe logging — all against an injected fake transport with no live network calls.
- **api/** — `spec/models/cover_letter_draft_spec.rb`,
  `spec/services/cover_letter_generator_spec.rb`, and
  `spec/requests/api/cover_letter_drafts_spec.rb`: encrypted-at-rest cover-letter storage,
  job/profile/primary-resume grounding through a mocked OpenRouter client, one-current-draft
  replacement, auth/read/generate/error responses, and the invariant that generation never
  creates an Application or worker task.
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

- **client/** — `src/toolchain.test.tsx`: the `FE-01` scaffold smoke test. Renders a React element
  through Testing Library into jsdom and asserts it with a jest-dom matcher, so a green run proves
  Vite + React + TypeScript, the jsdom environment, `vitest.setup.ts`, and the matcher type
  augmentation are all wired. Screen tests arrive with the ported components (`FE-08` onward).

- **client/** — `src/api/schemas.test.ts` (`FE-03`): the API boundary contract. Fixtures are copied
  from what the Rails serializers actually emit, **including the keys they leave out** — the
  digest's six-key row, the job feed's abbreviated tracker, an `unavailable` posting lookup that
  carries only `status` and `error`, an application whose draft has not generated yet. Three
  properties are pinned deliberately: a missing key and an explicit `null` resolve identically (Go
  decode parity); `match_score: null` stays `null` and never becomes `0`; and a wrong *type*
  (`match_score: "82"`, `job_posts: {}`, `triage_reasons: [1]`, a fractional id) fails parsing
  instead of silently defaulting. Unknown keys are asserted to be *stripped*, not rejected, because
  Rails already sends fields the client never declared. An `expectTypeOf` block pins the same
  nullability at the type level, so `npm run typecheck` catches a widened or collapsed field even
  when no runtime assertion covers it.

- **client/** — `src/api/http.test.ts` (`FE-04`): the transport contract, run against MSW rather
  than a stubbed `fetch`, so headers, credentials, status handling, and body parsing all execute
  for real. The status matrix is the spine of the file: a 200 (schema-validated, and still
  absence-tolerant for a partial serializer payload), a 4xx carrying Rails'
  `{error: {code, message}}` envelope, a 401 (and a 403 asserted *not* to sign the owner out, plus
  a 401 found through a wrapping error's `cause`), a 500 with no envelope (falling back to Go's
  `api request failed: status N[: body]` text, and truncating at 2048 bytes), and a 2xx whose body
  is unusable — non-JSON, wrong-typed, or the wrong shape entirely — raising `ResponseFormatError`.
  Two safety properties are pinned as tests, not comments: the transport refuses an off-origin
  path, and no non-test file under `client/src/` may mention `document.cookie`, because the session
  cookie is httponly.

- **client/** — `src/test/msw.ts` (`FE-04`): not a test, the shared harness the rest of the chain
  builds on. `installMockApi()` installs the MSW lifecycle for a file (`listen` /
  `resetHandlers` / `close`) with `onUnhandledRequest: "error"`, and `jsonResponse` /
  `errorResponse` / `textResponse` / `captureRequest` cover the four shapes a Rails endpoint test
  needs. It is named `installMockApi`, not `useMockApi`, because the `react-hooks` lint rule reads
  a `use*` prefix as a hook and rejects the top-level call.

- **client/** — `src/api/endpoints.test.ts` (`FE-05`): the endpoint, query-key, and QueryClient
  contract. Each of the 25 ported `RailsClient` endpoints gets a table case registering an MSW
  handler at the *literal* path it expects, so a wrong path fails as an unhandled request before
  any assertion runs, and the captured `Request` pins the method, path, `Content-Type`, and body —
  including the shapes that carry a rule: `scoreJobPost`/`submitApplication` send no body at all,
  `generateCoverLetter` sends `{}`, `login` is form-encoded, `updateApplicationDraft` sends only
  `answers`, and `setJobLifecycle` splits between the member and bulk endpoints on id count. A
  coverage test asserts the exported set still matches the Go interface method for method, so a
  dropped endpoint fails here rather than resurfacing as a missing screen feature.

  The `jobFeedQuery` block is a **parity fixture**: every expected string was produced by running
  Go's `JobFeedParams.query().Encode()` over the same input, not written by hand, which is what
  makes it evidence rather than a mirror of the implementation. It covers the rules that produced
  real bugs — an unset filter omitted entirely (never `""` or `"All"`), a padded value sent
  untrimmed, space as `+`, `!*'()` percent-encoded, `~` left literal, byte-wise key sort, and
  `page` sent only above 1.

  Two policies are pinned as tests rather than comments: query keys nest so
  `queryKeys.jobs.detail(id)` also invalidates that job's cover letter and contacts while leaving
  another job and the profile alone, and the QueryClient retries only transport failures and Rails
  5xx (a 401, 403, 422, or `ResponseFormatError` fails immediately) with **mutations never
  retried**, because replaying `POST /api/applications/:id/submit` would re-dispatch a trusted
  submit.

- **client/** — `src/test/handlers.ts` (`FE-05`): not a test, the fake Rails the screen tasks build
  against. `apiHandlers()` returns one handler per endpoint and `fixtures` the canned payloads.
  Every fixture is typed as its schema's *output* type, so a schema change fails
  `npm run typecheck` here rather than surfacing as a puzzling `ResponseFormatError` in an
  unrelated screen test. The handlers answer the request, not just the path — the feed echoes the
  requested page, detail handlers use the id from the URL, the intake toggle reflects the posted
  value — so pagination and navigation need no per-test handler.

- **client/** — `src/lib/labels.test.ts` (`FE-06`): the display helpers, tested as *transcriptions*
  of the Go case tables (`TestMatchScoreLabel`, `TestMatchScoreBand`, `TestSourceLabel`,
  `TestSourceIconPath`, `TestSourceEmoji`, `TestTrackerGroupMapsPipelineStatus`) rather than as
  freshly reasoned expectations, because every returned string is consumed by `app.css` and by the
  `FE-28` screenshot gate — the test's job is to reject a rewording. `lifecycleLabel` had no Go
  test, so its table is derived from `client.go` and the pill states `app.css` styles.

  Two assertions go past what a transcribed table can see. The brand-logo paths are resolved
  against `client/public/icons/` **on disk**, because the migration-wide `/web/` prefix drop 404s
  silently and costs only the logo inside an origin pill. And `trackerGroup` is checked against
  the Rails source: the test parses `Api::JobPostsController::APPLICATION_GROUPS` out of the
  controller (resolving `UNTRACKED_GROUP` from its own assignment) and asserts every status maps
  to its group, with a key-set guard so a moved or renamed constant fails loudly instead of
  asserting nothing. Reading a repo file from a Vitest test is fine — the jsdom environment still
  runs in Node, and `src/api/http.test.ts` already scans the source tree.

- **client/** — `src/routes.test.tsx` (`FE-07`): the route table, driven through
  `createMemoryRouter` over the **same exported `routes` array** the app hands
  `createBrowserRouter`, so the test cannot pass against a table the app does not use. It asserts
  the exact ten paths (nine plus the catch-all), that each path renders its screen, that
  `/jobs/new` resolves to manual entry and not to `/jobs/:id`, that the ids go-app matched with
  `\d+` regexps arrive as route params, and that an unknown path renders the not-found screen with
  a working link home rather than a blank page.

  The per-path assertion is on the **page-container class** each screen root carries (`.digest`,
  `.login-screen`, `.job-list`, `.manual-entry`, `.job-detail`, `.contacts-view`, `.applications`,
  `.draft-review`, `.profile`), transcribed from `web/components/*.go` rather than read off
  `routes.tsx`. That makes it a parity fixture that survives the screen ports: `FE-08` … `FE-26`
  replace a placeholder with the real screen and change nothing here, and a ported screen that
  drops its root class fails this test instead of surfacing at the `FE-28` screenshot gate.
  Route *order* is deliberately not asserted — React Router ranks a static segment above a dynamic
  one, verified by reversing the array, so the outcome is asserted instead of the mechanism.

- **client/** — `src/components/app-chrome.test.tsx` (`FE-08`): the shared chrome, in three layers.
  Markup and navigation are transcribed from `TestChromeNavigationAndLayout` and
  `TestNormalizeLayout` in `web/components/chrome_test.go`, with the active-tab table covering all
  nine paths plus an unknown one — the mapping the Go build spread across eight literal
  `renderAppTabs("…")` call sites, so `/jobs/new`, `/jobs/:id`, and `/jobs/:id/contacts` are each
  asserted to light up Jobs.

  The layout preference is pinned to the **exact stored bytes**: a seeded `"desktop"` (JSON-quoted,
  as go-app's `json.Marshal` left it) loads and selects Desktop, and choosing Mobile writes
  `"mobile"` back. Unavailable storage is covered from both ends — `readLayout`/`writeLayout`
  against `null` and against stubs that throw, plus a render with `Storage.prototype` throwing on
  both `getItem` and `setItem`, which must still render the chrome, still apply the choice, and
  surface the `.layout-error` copy.

  Two assertions cover what the DOM cannot show. `public/app.css` is parsed to prove Auto's
  `@media (min-width: 960px)` block declares *identical* variables to explicit
  `:root[data-layout="desktop"]` and that the bar and screen containers reserve
  `env(safe-area-inset-bottom)` — both drift invisibly in jsdom. And a stubbed `matchMedia` plus an
  `addEventListener` spy prove Auto is resolved by CSS with no viewport listener; jsdom implements
  no `matchMedia` at all, so the stub is what makes that an observation rather than a crash.

- **client/** — `src/components/update-banner.test.tsx` (`FE-10`): the PWA manifest and update
  prompt. It pins the current Go PWA identity fields and all four same-source icon records (with no
  manifest `id`), then mocks Workbox's `needRefresh` hook to prove the banner stays hidden until an
  update is waiting and its explicit Reload action activates the new worker.

- **client/** — `src/test/app-worker.test.ts` (`FE-12`): executes the permanent legacy-worker
  retirement script against fake service-worker globals. It asserts install waits for
  `skipWaiting`, activation deletes every named cache, unregisters and claims clients, best-effort
  reloads each window, and registers no fetch handler.

- **client/** — `scripts/container-smoke.sh` (`FE-27`): builds the root-context Node-to-Caddy
  image and exercises it against an isolated Node stub backend. It verifies both proxy paths retain
  methods, bodies, content type, custom headers, and the browser `Host`; an SPA deep link, legacy
  worker delivery, and `zstd`/`gzip` static compression are also asserted.

- **client/** — `src/components/login.test.tsx` (`FE-09`): the login screen, transcribed from
  `TestLoginRendersForm`, `TestLoginErrorStatus`, and `TestLoginButtonText` in
  `web/components/login_test.go` — the form's classes and attributes, all three status strings
  (`Enter your passphrase.`, `Incorrect passphrase.` on a 401, `Could not sign in. Please try
  again.` on anything else), and both button labels. It renders the app's own `routes` array at
  `/login` through a memory router, so the route wiring is under test too, and asserts the request
  body is the exact `passphrase=correct+horse+battery+staple` form encoding Go's `url.Values`
  produced, that success lands on `/` with `REPLACE`, and that an empty submit sends no request at
  all.

  One test covers the rule that would be an incident rather than a bug: after a failed attempt the
  passphrase is not in the field, not anywhere in the rendered markup, not in either web storage,
  and has reached no `console` method (all five are spied). The screen keeps the secret out of
  React state entirely — the input is uncontrolled and login is deliberately not a `useMutation`,
  since TanStack retains a mutation's `variables` in its cache.

- **client/** — `src/lib/auth.test.tsx` (`FE-09`): the 401 boundary and sign-out. There is no Go
  test to transcribe — the Go build checked `IsUnauthorized` per call site and had no sign-out — so
  this pins the replacement contract, driven through the *same* `installUnauthorizedRedirect` call
  `main.tsx` makes over a `createMemoryRouter` built from the app's own route table. A 401 from a
  read (through `fetchQuery`) and from a write (through a `useMutation` in the route tree) each land
  on `/login` with the real login screen rendered and `REPLACE` as the history action; a **403 does
  not**; the 401 is not retried first (one request); no navigation happens when `/login` is already
  showing; and unsubscribing stops it.

  Sign-out asserts the method and empty body of `DELETE /api/session`, that the query cache is
  emptied, that a 401 (an already-expired cookie) still signs the owner out with no error shown,
  and that any other failure reports `Could not sign out. Please try again.` and stays put. The
  control is mounted by swapping one element into the app's route table, because `useSignOut` uses
  router hooks and belongs where `FE-25` will render it.

- **client/** — `src/lib/push.test.ts` and `src/components/push-toggle.test.tsx` (`FE-13`): the
  push flow, in two layers. **Nothing in either file can send a push or show a permission prompt.**
  `push.test.ts` drives the real subscriber against a fake `PushEnvironment` — a plain object
  standing in for service-worker readiness, the permission prompt, and a `PushManager` — which is
  what makes the two orderings assertable: permission is requested *before* `pushManager.subscribe`
  (a denied or dismissed prompt subscribes nothing), and the browser `unsubscribe` runs *before*
  Rails is told, so a browser that refuses to cancel never leaves Rails believing the subscription
  is gone. The Go `browserPusher` had no test at all, being pure go-app JS interop; this is new
  coverage rather than a transcription. `push-toggle.test.tsx` mocks one layer higher — a
  `PushSubscriber` with call counters — and lets MSW answer Rails, so the toggle's own rule is a
  counter assertion: **zero subscribe calls, zero `POST /api/push_subscription` calls, and zero
  VAPID fetches after a plain render**, in both a supported and an unsupported browser. Asking for
  notification permission without a user gesture is how an origin gets permanently blocked, so that
  is the property worth a test rather than a comment. The four owner-visible states (unsupported,
  off, on, denied) are asserted as distinct renderings, and the VAPID key is asserted to come from
  `GET /api/push/vapid_public_key` — never a build-time value.

- **client/** — `src/lib/platform.test.ts` and `src/components/install-guide.test.tsx` (`FE-14`):
  platform detection and the guidance it drives. `platform.test.ts` is a straight transcription of
  `web/components/pwa_test.go`'s three case tables, and it is the one Go test file worth
  transcribing rather than rewriting, because its rows encode facts that cannot be re-derived: an
  iPad has reported the **desktop Safari user agent** since iPadOS 13, so `maxTouchPoints > 1` is
  the only thing separating it from a Mac (a single touch point is asserted to stay a Mac — a
  touch-capable peripheral reports one); `Mac OS X 10_15_7` must not be read as version 10.15; and
  Apple shipped Web Push at **16.4**, not 16.0. One case is new and guards an ordering the Go code
  had right without saying why: an uninstalled iOS 17 device reports *no Push API at all*, because
  Safari hides it until the app is on the home screen, so the gate must check version and install
  state before capability or the owner is told their browser cannot do something that one "Add to
  Home Screen" fixes. The browser readers are covered too — jsdom has no `matchMedia`,
  `PushManager`, or `navigator.standalone`, which is the same answer a prerender gives, and a
  `navigator` whose getters throw (a fingerprint-blocking browser) must not take the guide down.
  `install-guide.test.tsx` injects those signals as a plain record, which is what turns each of the
  four gates into an ordinary render assertion — the Go component read the browser inside `OnMount`
  and had no test at all. It carries the same counter rule as the push toggle (**zero VAPID
  fetches, zero subscribes, zero persists after a plain render of every gate**) and asserts the
  correction this port makes: `install_guide.go` subscribed the browser and then discarded the
  subscription, so the test pins `POST /api/push_subscription` actually receiving it.

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
| `api/spec/models/cover_letter_draft_spec.rb` | API (Rails) | one-per-job association and encrypted-at-rest cover-letter body |
| `api/spec/models/contact_candidate_spec.rb` | API (Rails) | contact candidate job-post association, relevance reason validation, and owned outreach drafts |
| `api/spec/models/job_post_spec.rb` | API (Rails) | job post company/title validations, application-route and URL-identity associations, match-score bounds |
| `api/spec/models/job_post_url_identity_spec.rb` | API (Rails) | URL-identity role allowlist, raw URL preservation, per-job alias uniqueness, same-owner shared identities, and cross-job database ownership enforcement |
| `api/spec/models/outreach_draft_spec.rb` | API (Rails) | outreach draft contact-candidate association and manual-send message validation |
| `api/spec/models/profile_spec.rb` | API (Rails) | profile name/JSON-shape validation, encrypted-at-rest ciphertext check for email/phone/address, deterministic-email queryability |
| `api/spec/models/resume_document_spec.rb` | API (Rails) | resume document profile/title validation, parsed_structure default, encrypted-at-rest ciphertext check for raw_text/parsed_structure |
| `api/spec/requests/api/auth_spec.rb` | API (Rails) | shared-secret session success/failure, protected endpoint gating, health bypass, worker bearer guard |
| `api/spec/requests/api/cover_letter_drafts_spec.rb` | API (Rails) | authenticated current-letter read/generate, unavailable/upstream failure responses, and no Application side effect |
| `api/spec/requests/api/intake_spec.rb` | API (Rails) | authenticated intake status, pause/resume, held-reference requeue, once-daily maintenance scheduling, and invalid-state rejection |
| `api/spec/requests/api/applications_spec.rb` | API (Rails) | `POST /api/applications/:id/submit` approved clean-payload dispatch, audit event recording, approval-required/unsupported/unsafe refusal paths, and 401 auth gating with no enqueue on refusal; `GET /api/applications/:id` draft + job context + worker-shaped autofill preview, read-only (no audit/enqueue), not-found JSON shape, and auth gating; `PATCH /api/applications/:id/draft` reviewed autofill-answer persistence, safety warnings, malformed edit rejection, draft-required rejection, and auth |
| `api/spec/requests/api/job_posts_spec.rb` | API (Rails) | `POST /api/job_posts` manual URL/text import with optional external application URL, typed new/tracked/submitted response, exact-identity alias/audit reuse without duplicate scoring, auth, and invalid-input errors; `GET /api/job_posts` scored+active oldest-first default feed with the `{number,size,total,has_next}` page envelope + auth; `GET /api/job_posts` `sort=score` ranking, `state=backlog`/active-default exclusion of backlog+removed, AND-combined `score_band`/`source`/`location`/`date_from`/`date_to` filters, and `JOBS_PAGE_SIZE`-driven pagination; `GET /api/job_posts?status=unscored` filtered/deferred feed with triage metadata; the TRACK-01 tracker surface (`status=all` unscored inclusion, `state=open` spanning active+backlog while excluding removed, embedded latest-`application` + `created_at` serialization, newest-application-wins when a job has several, `application` group filtering with untracked posts counted as not-applied, `application_counts` taken over the other filters only, and `sort=newest`/`sort=activity` ordering); `POST /api/job_posts/lookup` prefill read (fields returned, nothing persisted, unreadable postings answered 200 as `unavailable`, auth) and enrichment-before-scoring for a URL-only import; `POST /api/job_posts/:id/score` explicit scoring enqueue/manual override; `GET /api/job_posts/:id` scored detail with resolved route, not-found JSON shape, and auth |
| `api/spec/services/job_post_triage_spec.rb` | API (Rails) | deterministic inbound title/location triage for developer/software/AI-adjacent roles, Vancouver/Calgary/remote prioritization, rejection reasons, remote-status inference, and env-driven daily budget parsing |
| `api/spec/requests/api/digest_spec.rb` | API (Rails) | `GET /api/digest` latest digest of recently scored JobPosts (no scoring/LLM on read), empty-jobs case, and 401 auth gating |
| `api/spec/requests/api/ingestion_batches_spec.rb` | API (Rails) | `GET /api/ingestion_batches` ingestion history grouped into source+arrival-time batches newest-first (no scoring/LLM on read), empty case, and 401 auth gating |
| `api/spec/services/ingestion_batch_builder_spec.rb` | API (Rails) | `IngestionBatchBuilder` clustering: same-source within-gap grouping, gap-break into new batches, cross-source separation, window cutoff, empty case, and synthetic batch id |
| `client/src/toolchain.test.tsx` | client (Vitest) | scaffold smoke test: React render into jsdom via Testing Library with a jest-dom matcher, proving the Vite/TS/Vitest/setup wiring |
| `client/src/api/schemas.test.ts` | client (Vitest) | zod API boundary schemas: Go decode parity (missing key == `null` == zero value, unknown keys stripped), `match_score: null` kept distinct from `0`, partial serializer payloads (digest six-key row, feed's abbreviated tracker, undrafted application, `unavailable`/`unsupported` lookup), wrong-type rejection, `,omitempty` request fields staying absent, `JobFeedParams` rejecting an empty/`"All"` sentinel, and `expectTypeOf` type-level nullability parity |
| `client/src/api/http.test.ts` | client (Vitest) | API transport over MSW: schema-validated 200, Rails `{error:{code,message}}` 4xx, 401 vs 403 and 401 through a wrapped `cause`, envelope-less 500 with Go's fallback message and 2048-byte truncation, non-JSON/wrong-typed/wrong-shape 2xx raising `ResponseFormatError`, JSON vs form vs bodyless writes, no-schema writes leaving the body unread, off-origin path refusal, and a scan proving no source file reads `document.cookie` |
| `client/src/api/endpoints.test.ts` | client (Vitest) | endpoint/query-key/QueryClient contract over MSW: method, path, and request body of all 25 ported `RailsClient` endpoints (bodyless `POST` for score/submit, `{}` for cover-letter generate, form-encoded login, answers-only draft update, member-vs-bulk lifecycle split), an exported-set coverage check against the Go interface (plus `logout`, the one endpoint with no Go counterpart, whose own assertions live in `auth.test.tsx`), non-integer id refusal, `jobFeedQuery` parity fixtures produced by running Go's `Encode()` (omitted unset filters, untrimmed values, `+`/`!*'()` escaping, sorted keys, `page` only above 1), query-key prefix hierarchy and feed-page key identity, the retry matrix (transport/5xx retried; 401/403/422 and `ResponseFormatError` not) with mutations never retried, and a round trip of every endpoint through the shared handlers |
| `client/src/lib/labels.test.ts` | client (Vitest) | display-helper parity: the Go case tables for `matchScoreLabel` (unscored statuses vs a real `0%`), `matchScoreBand` (75/50 thresholds, `null` ⇒ pending, exhaustive 0–100 sweep), `sourceLabel`, `sourceIconPath`, and `sourceEmoji` (logo-or-emoji, never both), a derived `lifecycleLabel` table, brand-logo paths resolved against `client/public/icons/` on disk to catch the `/web/` prefix drop, and `trackerGroup` checked against `APPLICATION_GROUPS` parsed out of the Rails controller source |
| `client/src/routes.test.tsx` | client (Vitest) | route table over `createMemoryRouter` driving the app's own exported `routes`: the exact ten paths, each path rendering its screen asserted on the `app.css` page-container class transcribed from the Go screens, `/jobs/new` winning over `/jobs/:id`, the former `\d+` regexp ids arriving as route params, and an unknown path rendering the not-found screen with a link home |
| `client/src/components/app-chrome.test.tsx` | client (Vitest) | shared chrome parity: the Go navigation/`normalizeLayout` tables, the active tab derived from all nine paths (plus `/login` and an unknown path marking none), `waunder.layout` read and written as go-app's JSON-quoted value, unquoted/garbage/non-string stored values degrading to Auto, absent and throwing storage on both read and write (chrome still renders, choice still applied, `.layout-error` shown), `data-layout` on the document root, `public/app.css` parsed to prove Auto's 960px block matches explicit Desktop exactly and that the bottom bar and screen containers reserve the iPhone safe area, and no `matchMedia`/resize listener |
| `client/src/components/update-banner.test.tsx` | client (Vitest) | PWA manifest identity (including four `/icon.svg` records and absent `id`) plus the Workbox `needRefresh` update banner and explicit reload action |
| `client/src/sw.test.ts` | client (Vitest) | push and notification-click handlers driven with fake push/notificationclick events and a fake worker scope: Rails' `{title, body, data:{url, count}}` shown with the app icon and badge, an unparseable or absent body still notifying, `data.url` resolved against the app origin and clamped to it (cross-origin, `javascript:`, protocol-relative all falling back to `/`, including a target stored by an older worker), a click focusing an open window and posting the navigate message instead of `client.navigate` (no full reload), preferring a window already on the target, `openWindow` when none is open / focus is refused / only foreign-origin windows exist, the page-side `installSwNavigation` routing on that message alone, and `src/sw.ts` wiring both events plus the precache, `index.html` fallback, and `SKIP_WAITING` defaults it took over from the generated worker |
| `client/src/test/app-worker.test.ts` | client (Vitest) | permanent `/app-worker.js` retirement worker through fake service-worker globals: install skip-waiting, all-cache deletion, self-unregister/client claim, best-effort window reload, and no fetch handler |
| `client/scripts/container-smoke.sh` | client (container smoke) | root-context Node-to-Caddy image: API + Resend proxy request preservation, original `Host` behavior, SPA fallback, legacy worker, and zstd/gzip static compression |
| `client/scripts/handoff-check.cjs` | client (local integration) | signed Resend replay through the Caddy image into Rails, raw body and `svix-*` header preservation, `InboundEmail` persistence, and Go-worker retirement/cache clearing in persistent Chromium and Playwright WebKit contexts; the required iOS home-screen check remains manual |
| `client/src/components/login.test.tsx` | client (Vitest) | login screen parity: the Go form markup/classes/attributes and all three status strings, the exact form-encoded `POST /api/session` body, success navigating to `/` with `REPLACE`, an empty submit sending no request, the in-flight disabled `Signing in…` button, and the passphrase appearing in no markup, no web storage, and no `console` call after a failed attempt |
| `client/src/lib/auth.test.tsx` | client (Vitest) | the 401 auth boundary and sign-out, driven through the app's own `installUnauthorizedRedirect` over a memory router built from the real route table: a 401 from a read and from a write each redirect to a rendered `/login` with `REPLACE`, a 403 does not, the 401 is not retried first, no navigation when already on `/login`, unsubscribing stops it, and `DELETE /api/session` clears the query cache and returns to login — including a 401 counting as already signed out, and a 500 reporting a failure in place |
| `client/src/lib/push.test.ts` | client (Vitest) | browser push flow against a **mocked PushManager** (no permission prompt, no real push): the Go `initialPushState` table, unsupported/denied/failed staying distinct states, the three `pushErrorMessage` strings, `readSubscription` reading both encryption keys off `toJSON()` and rejecting a subscription Rails could never encrypt to, permission requested before `pushManager.subscribe` (and a denied or dismissed prompt subscribing nothing), an unsupported browser neither prompting nor failing a read, unsubscribe cancelling the active subscription and propagating a browser failure, and the production environment reporting unsupported wherever there is no Push API |
| `client/src/components/push-toggle.test.tsx` | client (Vitest) | push toggle parity over MSW plus a mocked `PushSubscriber`: **zero subscribe, zero persist, and zero VAPID fetches after a plain render** in both supported and unsupported browsers, the unsupported/off/on/denied states rendering distinctly, the VAPID key read from `GET /api/push/vapid_public_key` and passed to the browser, `POST /api/push_subscription` carrying the browser subscription, the in-flight disabled `Working…` control, an empty server key and an unsupported browser both landing on unsupported without touching the other side, no persist when the browser subscribe fails, 401 and 500 messages, and unsubscribe cancelling in the browser before `DELETE /api/push_subscription` (and leaving Rails alone when it cannot) |
| `client/src/lib/platform.test.ts` | client (Vitest) | platform detection with no browser at all: the `pwa_test.go` user-agent case table (iPhone/iPad, an underscore patch version, **iPadOS masquerading as desktop Safari** via `maxTouchPoints > 1`, and `Mac OS X 10_15_7` never read as a version), the iOS 16.4 Web Push boundary, the push-gate table with the ordering case that offers an uninstalled iOS 17 device the install step rather than "unsupported", `navigator.standalone` and the `display-mode` media query each sufficing alone, and the browser readers degrading to every signal off when `matchMedia`/`PushManager`/`Notification` are missing or throw |
| `client/src/components/install-guide.test.tsx` | client (Vitest) | install guide parity over MSW plus a mocked `PushSubscriber` and injected platform signals (no permission prompt, no real push): the four gates rendering their own copy and `.install-guide`/`.enable-notifications`/`.install-status` markup, the granted state winning over platform guidance, **zero VAPID fetches, zero subscribes, and zero persists after a plain render of every gate**, and the enable flow fetching the key, subscribing, and actually storing the subscription with `POST /api/push_subscription` — plus the declined/no-server-key/failed-store messages and the in-flight disabled button that stops a double post |
| `client/src/test/handlers.ts` | client (Vitest, harness) | shared fake Rails: `apiHandlers()` covers every endpoint (echoing the requested page, the URL id, and the posted intake value) and `fixtures` exports schema-typed canned payloads, including an unscored row whose `match_score` stays `null` |
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
| `api/spec/services/openrouter_client_spec.rb` | API (Rails) | OpenRouter client: missing-key typed error, Nex default plus reasoning-none payload, env model/reasoning override, structured-JSON parse, prose/code-fence parse fallback, retry/exhaustion, and PII-safe logging via injected fake transport (no live calls) |
| `api/spec/services/cover_letter_generator_spec.rb` | API (Rails) | mocked job/profile/primary-resume grounding, one-current-letter replacement, malformed/missing-key handling, no Application side effect, and PII-safe logging |
| `api/spec/jobs/score_job_post_job_spec.rb` | API (Rails) | JobScorer/ScoreJobPostJob: scoring-field population from mocked LLM JSON, match_score clamping, string-list coercion, fallback-posting scoring, graceful skip with no API key, failed-on-error, PII-safe logging (mocked client) |
| `api/spec/jobs/generate_application_draft_job_spec.rb` | API (Rails) | ApplicationDraftGenerator/GenerateApplicationDraftJob: draft generation from mocked LLM JSON, ATS-shaped autofill payload keyed to the resolved route (manual fallback for unknown), Profile data merged into autofill answers, malformed-answer dropping, graceful skip with no API key, failed-on-error, PII-safe logging (mocked client) |
| `api/spec/jobs/expire_stale_job_posts_job_spec.rb` | API (Rails) | stale active auto-backlog plus 30-day removed-row retention scheduling/purge, with Application-protected and backlog exclusions |
| `workers/src/safety.test.ts` | Worker safety | `isSensitiveField` detection + `partitionBySensitivity` splitting of answers |
| `workers/src/worker.test.ts` | Worker orchestration | config loading, bearer-auth task fetch/report calls, clean idle without `API_INTERNAL_URL`, one-cycle poll orchestration, and unsupported-ATS safe failure |
| `workers/src/ats/handlers.test.ts` | Worker ATS handlers | Playwright fixture coverage for Greenhouse/Lever/Ashby registration, approved field fill/submit, unknown required field pauses, and sensitive-field pauses |
| `web/components/pwa_test.go` | Web (go-app PWA) | iOS/iPadOS detection + version parsing, iOS 16.4+ Web Push threshold, and the install/notification-permission gate decision |
| `web/components/chrome_test.go` | Web (go-app PWA) | Shared navigation accessibility, persistent Import job entry, layout choices, invalid-preference fallback, copy-control initial state, empty-stage handling, and the pending-app-update banner (hidden with no update, shown after `applyAppUpdate(true)`, and latching so a later false reading cannot hide it) |
| `web/scripts/layout-smoke.cjs` | Web (Playwright Chromium) | Eight screens at 320/390/768/960/1440px, layout persistence/resize, overflow, explicit manual tracking success/failure, stage clearing, copy success/blocked feedback, and no application writes on navigation; all API calls use local fixtures |
| `web/components/jobs_test.go` | Web (go-app PWA) | Job list / detail / ingestion batches, visible Import job actions (including empty feed), lifecycle/filter/pagination behavior, manual application link fallback and safe URL handling, no regression of later tracking statuses, explicit cover-letter generate/regenerate/error behavior with no generation, application creation, or submit on render, explicit intake pause/resume state and error paths, held count, and no intake mutation on render via a mocked `RailsClient` |
| `web/components/applications_test.go` | Web (go-app PWA) | Application tracker (TRACK-01) render tests: one row per intaked job with its inline status control and the "Not applied" placeholder, group tabs with server counts, the applied-to/tracked header split, bin + sort controls, Prev/Next pagination, per-tab empty states, and 401 handling. Query assertions pin `status=all` / `state=open` / `sort=newest`. Write-path tests cover the row status write going through the job-post endpoint plus a refetch, the inert placeholder, and error recovery; render tests assert 0 status writes, 0 draft creations, and 0 submits after a full lifecycle |
| `web/components/login_test.go` | Web (go-app PWA) | Login form render and `loginErrorStatus`/`loginButtonText` status mapping (401 → "Incorrect passphrase") |
| `web/components/client_test.go` | Web (go-app PWA) | `httpRailsClient` against `httptest`: `/api` paths, explicit focused cover-letter read/generate, intake GET/PATCH, Jobs filters/page decode, manual import application URL + typed result decode, scoring/job-post tracker/draft payloads, session-cookie carry, and API errors. The application-scoped `Applications`/`UpdateApplicationStatus` client tests were removed with those methods in TRACK-01; the Rails endpoints remain covered by `spec/requests/api/applications_spec.rb` |
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
   - Client: `src/<name>.test.ts` / `.test.tsx`, colocated with the module or component under test.
2. Place it in the correct directory for its stack.
3. Add a row to the Test File Inventory table above.
4. Run that stack's suite before committing to confirm no regressions.
