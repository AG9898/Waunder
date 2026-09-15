# TESTING.md — Test Suite Reference

> Canonical source for how to run tests, what is covered, and how to write new tests.
> Read before adding any new test file or modifying an existing one.
> Code conventions that affect test structure live in [`CONVENTIONS.md`](CONVENTIONS.md).

Waunder has three deployed stacks, each with its own test runner: `api/` (Rails / RSpec),
`web/` (Vite + React, Vitest + Testing Library + MSW), and `workers/` (Node built-in test runner).
The `web/` Vitest suite was built as a parity port of the retired Go/go-app suite, so entries below
cite the Go tests they transcribed ([`GO_MIGRATION.md`](GO_MIGRATION.md)).

---

## Quick Start

```bash
# --- api/ (Rails, RSpec) ---
cd api && bundle exec rspec                              # all specs
cd api && bundle exec rspec spec/requests/api/health_spec.rb   # single file
cd api && bin/ci                                         # full CI gate (style + security + tests)

# --- workers/ (Node + TypeScript) ---
cd workers && npm test                                   # all tests
cd workers && node --import tsx --test src/safety.test.ts  # single file
cd workers && npm run typecheck                          # tsc --noEmit

# --- web/ (Vite + React + TypeScript) ---
cd client && npm test                                    # all tests (vitest run)
cd client && npx vitest run src/toolchain.test.tsx       # single file
cd client && npm run typecheck                           # tsc --noEmit
cd client && npm run lint                                # eslint .
cd client && npm run build                               # vite build
bash web/scripts/container-smoke.sh                   # build/run Caddy image smoke test
```

---

## Test Stacks

| Stack | Tool | Version | Location | Run Command |
|---|---|---|---|---|
| api (Rails) | RSpec (`rspec-rails ~> 8.0`) | Ruby 3.2.3 / Rails 8.1.3 | `api/spec/` | `cd api && bundle exec rspec` |
| workers | Node built-in test runner (`node --test`) + tsx | Node 22 / TS 5.7 | `workers/src/*.test.ts`, `workers/src/**/*.test.ts` | `cd workers && npm test` |
| web | Vitest 5 + jsdom + Testing Library + `@testing-library/jest-dom` + MSW 2 | Node 22 / TS 5.9 / React 19 | `web/src/**/*.{test,spec}.{ts,tsx}` | `cd client && npm test` |

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
  `PATCH /api/applications/:id/status`, covering tracker list/update behavior, Rails-owned
  `applied_at` serialization and stamping, client-field rejection, and automation-vs-pipeline
  status separation.
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
  updates, including the Rails-owned `applied_at` field and client-field rejection.
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
  payload shape, one-time `applied_at` stamping, audit payload shape, and associations.
- **api/** — `spec/models/profile_spec.rb` and `spec/models/resume_document_spec.rb`: model specs
  for the encrypted-at-rest profile/resume fields. They assert the underlying column holds
  ciphertext (raw SQL select) while the accessor returns plaintext, and that deterministic email
  encryption stays queryable.
- **api/** — `spec/models/contact_candidate_spec.rb` and `spec/models/outreach_draft_spec.rb`:
  model specs for contact-candidate job linkage, relevance-reason validation, outreach-draft
  association, and manual-send message validation.
- **api/** — `spec/services/job_post_title_screen_spec.rb` and
  `spec/services/inbound_posting_title_filter_spec.rb`: table-driven accepted/rejected title-family
  boundaries plus aggregate pre-materialization screening counts and reasons.
- **api/** — `spec/services/inbound_email_parser_spec.rb`: service specs for the deterministic
  known-sender (LinkedIn/Indeed/Glassdoor) email parser, pre-materialization title screening,
  normalized JobPost and URL-alias persistence, company reuse, and LLM-fallback flagging for
  unknown senders and empty parses.
- **api/** — `spec/services/job_post_materializer_spec.rb`: inbound materialization coverage for
  stable source/posting/application URL-alias registration and retry-safe identity reuse without
  LLM calls.
- **api/** — `spec/services/inbound_email_llm_extractor_spec.rb`: mocked LLM-fallback extraction,
  no-posting/skip/retry states, screened-only completion without materialization, and shared
  URL-alias persistence without live network calls.
- **api/** — `spec/services/off_scope_job_post_cleanup_spec.rb`: dry-run reporting, audited
  soft-removal, manual-import exclusion, and application-history preservation for historical
  title-policy cleanup.
- **api/** — `spec/bin/cleanup_off_scope_job_posts_spec.rb`: subprocess smoke coverage proving the
  cleanup executable boots through Bundler and emits a parseable, non-writing dry-run report. It
  runs the executable outside the parent's Bundler environment with gems visible only through
  `BUNDLE_PATH`, as in the Docker image, so requiring a pinned default gem such as `json` before
  `config/environment` fails the spec.
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


- **web/** — `src/toolchain.test.tsx`: the `FE-01` scaffold smoke test. Renders a React element
  through Testing Library into jsdom and asserts it with a jest-dom matcher, so a green run proves
  Vite + React + TypeScript, the jsdom environment, `vitest.setup.ts`, and the matcher type
  augmentation are all wired. Screen tests arrive with the ported components (`FE-08` onward).
- **web/** — `src/components/tailwind-probe.test.tsx` (`UI-01`): asserts `tailwind.css` imports only
  the theme and utilities layers (no Preflight), that every `@theme` token equals its `app.css`
  `:root` value, that `app.css` is still linked, and renders the unrouted Tailwind probe.
- **web/** — `src/components/ui/toast.test.tsx` (`UI-05`): the toast viewport announces through a polite live region, dismisses on click and after its duration, and does not stack duplicates; screen tests read transient write feedback from `.toast`, and `vitest.setup.ts` clears the toast store after each case.
- **web/** — `src/components/ui/ui.test.tsx` (`UI-02`): renders the vendored Button, Input, Select,
  Dialog, and Sheet primitives, asserts their token utilities, prop-driven open/close and
  Escape-to-`onClose`, the `@source` opt-in, and that `package.json` gained no runtime UI dependency.
- **web/** — `src/components/ui/ui.test.tsx` (`UI-07`): smoke-tests the generated Popover,
  Command, and DropdownMenu primitives. Each open/close path is driven through its public trigger;
  the menu and command cases assert ArrowDown selection, Escape dismissal, and focus returning to
  the trigger, while the source/dependency checks pin the Radix/cmdk versions and reject generated
  default-color or arbitrary-value utilities.

- **web/** — `src/api/schemas.test.ts` (`FE-03`): the API boundary contract. Fixtures are copied
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

- **web/** — `src/api/http.test.ts` (`FE-04`): the transport contract, run against MSW rather
  than a stubbed `fetch`, so headers, credentials, status handling, and body parsing all execute
  for real. The status matrix is the spine of the file: a 200 (schema-validated, and still
  absence-tolerant for a partial serializer payload), a 4xx carrying Rails'
  `{error: {code, message}}` envelope, a 401 (and a 403 asserted *not* to sign the owner out, plus
  a 401 found through a wrapping error's `cause`), a 500 with no envelope (falling back to Go's
  `api request failed: status N[: body]` text, and truncating at 2048 bytes), and a 2xx whose body
  is unusable — non-JSON, wrong-typed, or the wrong shape entirely — raising `ResponseFormatError`.
  Two safety properties are pinned as tests, not comments: the transport refuses an off-origin
  path, and no non-test file under `web/src/` may mention `document.cookie`, because the session
  cookie is httponly.

- **web/** — `src/test/msw.ts` (`FE-04`): not a test, the shared harness the rest of the chain
  builds on. `installMockApi()` installs the MSW lifecycle for a file (`listen` /
  `resetHandlers` / `close`) with `onUnhandledRequest: "error"`, and `jsonResponse` /
  `errorResponse` / `textResponse` / `captureRequest` cover the four shapes a Rails endpoint test
  needs. It is named `installMockApi`, not `useMockApi`, because the `react-hooks` lint rule reads
  a `use*` prefix as a hook and rejects the top-level call.

- **web/** — `src/api/endpoints.test.ts` (`FE-05`): the endpoint, query-key, and QueryClient
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

- **web/** — `src/test/handlers.ts` (`FE-05`): not a test, the fake Rails the screen tasks build
  against. `apiHandlers()` returns one handler per endpoint and `fixtures` the canned payloads.
  Every fixture is typed as its schema's *output* type, so a schema change fails
  `npm run typecheck` here rather than surfacing as a puzzling `ResponseFormatError` in an
  unrelated screen test. The handlers answer the request, not just the path — the feed echoes the
  requested page, detail handlers use the id from the URL, the intake toggle reflects the posted
  value — so pagination and navigation need no per-test handler.

- **web/** — `src/components/ui/status-chip.test.tsx` (`UI-11`): renders all nine pipeline statuses
  plus the tracker's "Not applied" placeholder, checks the documented fill/ink/dot/border values
  and desktop/touch heights from `app.css`, and verifies unknown statuses use the Interested tone.

- **web/** — `src/lib/labels.test.ts` (`FE-06`/`UI-11`): the display helpers, tested as *transcriptions*
  of the Go case tables (`TestMatchScoreLabel`, `TestMatchScoreBand`, `TestSourceLabel`,
  `TestSourceIconPath`, `TestSourceEmoji`, `TestTrackerGroupMapsPipelineStatus`) rather than as
  freshly reasoned expectations, because every returned string is consumed by `app.css` and by the
  `FE-28` screenshot gate — the test's job is to reject a rewording. `lifecycleLabel` had no Go
  test, so its table is derived from `client.go` and the pill states `app.css` styles. `statusTone`
  is checked against Rails' `APPLICATION_GROUPS` in the same source-parsing test as `trackerGroup`.

  Two assertions go past what a transcribed table can see. The brand-logo paths are resolved
  against `web/public/icons/` **on disk**, because the migration-wide `/web/` prefix drop 404s
  silently and costs only the logo inside an origin pill. And `trackerGroup` is checked against
  the Rails source: the test parses `Api::JobPostsController::APPLICATION_GROUPS` out of the
  controller (resolving `UNTRACKED_GROUP` from its own assignment) and asserts every status maps
  to its group, with a key-set guard so a moved or renamed constant fails loudly instead of
  asserting nothing. Reading a repo file from a Vitest test is fine — the jsdom environment still
  runs in Node, and `src/api/http.test.ts` already scans the source tree.

- **web/** — `src/routes.test.tsx` (`FE-07`): the route table, driven through
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

- **web/** — `src/components/app-chrome.test.tsx` (`FE-08`): the shared chrome, in three layers.
  Markup and navigation are transcribed from `TestChromeNavigationAndLayout` and
  `TestNormalizeLayout` in `web/components/chrome_test.go`, with the active-tab table covering all
  nine paths plus an unknown one — the mapping the Go build spread across eight literal
  `renderAppTabs("…")` call sites, so `/jobs/new`, `/jobs/:id`, and `/jobs/:id/contacts` are each
  asserted to light up Jobs.

  `UI-12` also pins the desktop Surface v2 shell in CSS: explicit Desktop and Auto at the 960px
  breakpoint must expose identical 56px top-bar rules, compact control heights, and the Lucide
  plus marker, while the mobile fixed-nav and safe-area declarations remain the existing ones.

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

- **web/** — `src/components/update-banner.test.tsx` (`FE-10`): the PWA manifest and update
  prompt. It pins the current Go PWA identity fields and all four same-source icon records (with no
  manifest `id`), then mocks Workbox's `needRefresh` hook to prove the banner stays hidden until an
  update is waiting and its explicit Reload action activates the new worker.

- **web/** — `src/test/app-worker.test.ts` (`FE-12`): executes the permanent legacy-worker
  retirement script against fake service-worker globals. It asserts install waits for
  `skipWaiting`, activation deletes every named cache, unregisters and claims clients, best-effort
  reloads each window, and registers no fetch handler.

- **web/** — `scripts/container-smoke.sh` (`FE-27`): builds the root-context Node-to-Caddy
  image and exercises it against an isolated Node stub backend. It verifies both proxy paths retain
  methods, bodies, content type, custom headers, and the browser `Host`; an SPA deep link, legacy
  worker delivery, and `zstd`/`gzip` static compression are also asserted.

- **web/** — `src/components/login.test.tsx` (`FE-09`): the login screen, transcribed from
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

- **web/** — `src/lib/auth.test.tsx` (`FE-09`): the 401 boundary and sign-out. There is no Go
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

- **web/** — `src/lib/push.test.ts` and `src/components/push-toggle.test.tsx` (`FE-13`): the
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

- **web/** — `src/lib/platform.test.ts` and `src/components/install-guide.test.tsx` (`FE-14`):
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

- **web/** — `src/components/jobs/job-list.test.tsx` (`FE-15`): the jobs feed's list half,
  transcribed from the render and pagination cases in `web/components/jobs_test.go`. Two things
  differ deliberately. The Go build could not invoke an `OnClick` from a test, so paging was only
  ever exercised through `applyPrevPage`/`applyNextPage`; here the buttons are actually pressed,
  which is what makes the `number <= 1` / `has_next` disabled states load-bearing rather than
  cosmetic. And because Rails is MSW, half the assertions are on **the query string the feed
  sent** — a client-side sort or filter would satisfy any assertion about rendered rows, so
  "the server owns the feed" is pinned by the request (`sort=oldest&state=active&status=scored`,
  and no `page` on page 1) together with the rows rendering in exactly the order Rails returned
  them, scores out of order included. The pill classes are asserted as whole `className` strings
  (`job-score job-score--high`, `job-status job-status--backlog`) because they are a contract with
  `public/app.css`: a renamed band is an unstyled pill, not a failing render. Also covered: an
  unscored row taking `--pending` and never `--low`, an absent `lifecycle_state` still painting
  `--active`, the origin pill leading with the unprefixed `/icons/linkedin.svg` or the lucide
  `Pencil`/`Mail` marker and disappearing entirely for a sourceless posting, **no location element**
  (the feed payload carries none — see [`GO_MIGRATION.md`](GO_MIGRATION.md)), the loading/error/empty
  states including the 401 sign-in link, and stepping back a page costing no refetch because
  `page` is part of the query key. The error case uses a 422 rather than a 500 so it fails at
  once; the retry policy itself is covered in `endpoints.test.ts`.

- **web/** — `src/lib/job-filters.test.ts` and `src/components/jobs/job-filters.test.tsx`
  (`FE-16`): the feed's filter selection and its panel. The load-bearing assertions are the ones
  about **stored JSON**, not behaviour: `waunder.jobFilters` is written by the Go build on the
  owner's real devices and read by this one, in both directions until the `FE-30` cutover, so the
  expectations are transcribed from `jobFilterState`'s json tags in `web/components/jobs.go`
  rather than from the code under test — including a hand-written string of exactly what
  `persistFilters` emits, which is what makes the round trip evidence instead of a mirror. The
  panel cases mostly render the real `JobList` rather than the panel alone, because the criterion
  that matters (restore happens *before* the first fetch) is only observable as "one request, and
  it already carries the selection"; a panel test in isolation would pass on a screen that never
  wired the selection into `useQuery`. Two cases pin the corrections this port makes: the
  no-filter `<option>` is asserted to carry a real empty `value` attribute, which rules out the
  go-app bug that sent `source=All` to Rails (AGENTS.md 2026-06-24) rather than routing around it
  with a sentinel, and a `localStorage` getter that throws is asserted to still render the feed,
  mutation-checked by removing the guard.

- **web/** — `src/components/jobs/job-actions.test.tsx` (`FE-17`): the feed's write half. Every
  case drives the real `JobList` over MSW, because the properties that matter are only visible in
  the **request**. The Go test could assert that `SetJobLifecycle` had been called but not whether
  it sent one bulk `PATCH /api/job_posts/lifecycle` or N member `PATCH /api/job_posts/:id/lifecycle`
  — and the collection endpoint is what keeps a bulk transition in one Rails transaction — so the
  split is asserted on method, path, and body. The same reasoning covers "the mutation invalidates
  the feed rather than patching rows": a local splice and a refetch look identical in component
  state, and only "the feed was read again, and both rows are still on screen because the fake
  Rails still answers with both" distinguishes them. **Zero lifecycle transitions and zero scoring
  requests after a full render** is the safety case, mirroring the push-toggle and install-guide
  files — Remove is a soft delete and Score spends OpenRouter budget, so neither may fire because a
  row scrolled into view. Also covered: the bin tabs going through the `state` parameter (never a
  client-side split of the loaded rows) and restoring the saved bin into the *first* request; the
  checkbox living inside `.job-list-actions` with the lifecycle buttons and named after its row;
  the bin-dependent button set; a single in-flight write disabling every lifecycle control on the
  screen; a failure reported once and **never retried**, with 401 and 500 copy; and score-on-demand
  staying per row — in-flight on one row leaves the others clickable, Rails' own `pending` status
  refuses a second request, and one error renders beside the posting it belongs to. A deliberately
  hanging write is held open by a promise the handler awaits and `afterEach` releases, so the
  in-flight assertions are deterministic rather than timing-dependent.

- **web/** — `src/components/tracker/tracker.test.tsx` (`FE-22`/`UI-04`/`UI-14`/`UI-17`): the
  tracker request, sorting, visibility, virtualization, status-cell popover, and status-write
  contract. In addition to Rails' query and refetch assertions, it pins the Surface v2 grid markup
  (row numbers, Lucide header icons, sorted direction, pinned Job cell, mobile company subline),
  grouped status options, click/Enter opening, current-status and dismissal no-ops, and parses
  `app.css` for the horizontal scroll panel, sticky columns, gridlines, mobile fade, responsive
  row/header heights, editing tint, and table spacer display. The old `data-label` responsive-card
  assertions are intentionally absent: UI-14 uses one table grid at every width. Failed writes are
  asserted as one toast with no retry, and status writes are asserted to avoid draft and submit
  endpoints.

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

**Web (`web/`, Vitest):**

- Vitest + jsdom + Testing Library; tests are colocated as `*.test.ts(x)` under `src/`.
- Fake Rails with MSW (`src/test/msw.ts`, shared `src/test/handlers.ts`); never mock `fetch` directly.
- Browser APIs (Push, service worker, platform detection) sit behind injectable seams, so no
  permission prompt or real push is ever possible in a test.
- Safety rules (no submit/generate/subscribe on mount, no outreach send affordance) are asserted
  from MSW's request log.

**Workers (`workers/`):**

- Use the Node built-in runner: `import { test } from "node:test"` and
  `import assert from "node:assert/strict"`. Local imports use `.js` specifiers.
- Pure functions (safety helpers) are tested directly with plain input/output.
- ATS Playwright handlers are tested against local fixture HTML pages, not live ATS sites.

### Adding a New Test File

1. Name the file per the stack convention:
   - Rails: `spec/<type>/<area>/<name>_spec.rb` (e.g. `spec/requests/api/jobs_spec.rb`).
   - Workers: `src/<name>.test.ts`, colocated with the module under test.
   - Web: `src/<name>.test.ts` / `.test.tsx`, colocated with the module or component under test.
2. Place it in the correct directory for its stack.
3. Add a row to the Test File Inventory table above.
4. Run that stack's suite before committing to confirm no regressions.
