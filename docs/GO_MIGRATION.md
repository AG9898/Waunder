# GO_MIGRATION.md — Frontend Migration from Go/go-app to TypeScript

> Canonical record for the `web/` frontend migration: why it is happening, what was decided,
> what must be preserved byte-exactly, and how it is verified.
> Other docs link here rather than restating the migration. Architecture, conventions, testing,
> env vars, and style rules are rewritten in their own docs at cutover (see
> [Cutover doc checklist](#cutover-doc-checklist)).

**Status:** in progress — decided 2026-09-10, chain started 2026-09-10 with `FE-01` (the
`client/` toolchain). Production still runs the Go/go-app PWA and keeps running it until the
final cutover task (`FE-30`).

**Decision record:** [`DECISIONS.md`](DECISIONS.md) RESOLVED-24.
**Task chain:** `FE-01` … `FE-30` in [`workboard.json`](workboard.json), then `UI-01` … `UI-05`.

---

## Scope

Replace the `web/` service's frontend implementation. Nothing else changes:

- **`api/` is untouched.** No routes, controllers, serializers, models, migrations, or jobs change.
  The full API surface is already a JSON-only contract under `/api`, and auth is an httponly signed
  cookie set by Rails. A `fetch()` from a TypeScript SPA behaves identically to the Go client.
- **`workers/` is untouched.**
- **The `web` Railway service is reused.** Same service, same `RAILWAY_DOCKERFILE_PATH`
  (`deploy/railway-web.Dockerfile`), same private-network proxy to Rails, same public domain, same
  Resend webhook URL.

The one caveat to "no Rails changes": the new service worker must honor Rails' existing Web Push
payload shape rather than the framework's. See [Web Push payload](#web-push-payload-fix-a-real-bug).

---

## Why

Four measured reasons, not a preference.

### 1. The app ships a 16 MB uncompressed WebAssembly binary

`web/web/app.wasm` is 16,047,853 bytes. go-app serves static assets through plain
`http.FileServer` (`pkg/app/resource.go:21`) with **no gzip and no brotli**, so that is the
over-the-wire size on every cold cache. Compressed it would still be 3.9 MB. An equivalent
Vite + React build of these nine screens lands around 150–250 KB gzipped.

This is the dominant cost for a mobile-first PWA that the OS evicts from memory.

### 2. The service-worker update path is a framework limitation

go-app's generated `app-worker.js` is cache-first with no revalidation (`fetchWithCache` returns
any cache hit and never refetches), and `/web/app.wasm` is a constant, non-hashed URL. Shipped
changes stayed invisible to an already-loaded page, which required hand-rolling `OnAppUpdate`, a
reload banner, and a `goappTryUpdate()` JS poke as a workaround. `vite-plugin-pwa` (Workbox)
provides content-hashed precache manifests and a proper `needRefresh` signal as table stakes.

### 3. A large share of the frontend's complexity is test-harness workaround

Documented in `CLAUDE.md` Discoveries: `OnClick` handlers cannot be invoked from a test because
there is no way to obtain an `app.Context`; `app.PrintHTML` spins up its own engine and re-runs
`OnPreRender`, resetting post-action state; `OnMount` never fires under `app.NewTestEngine()`, so
data screens must implement both `OnMount` and `OnPreRender`; rendered attribute order is
nondeterministic because go-app builds attributes from a Go map (one assertion was ~30% flaky);
render assertions must match HTML-escaped text; `app.HTMLTextarea` has no `.Value()`;
`app.Option().Value("")` reports the option's **text** as its value, which shipped a real
user-facing bug in the jobs-feed Source filter.

The `do*`/`apply*` split that appears in every interactive component
(`doSubmit`/`applySubmitResult`, `doGenerate`/`applyGenerateResult`, `doShowTable`/
`applyJobsResult`) exists **only** because go-app click handlers are not directly testable. That
is application architecture bent around a framework limitation.

### 4. Library ecosystem — the original motivation

The screens that remain unsatisfying are exactly the ones that want mature components: the tracker
and all-jobs tables (sorting, column visibility, virtualization), the filter panel (currently a
native `<details>`), and interaction feedback (currently inline error paragraphs).

---

## Decisions

### Stack: Vite + React + TypeScript

Chosen over Svelte for reasons specific to this repository:

- **shadcn/ui is a copy-source-into-the-repo model, not an npm dependency.** That matches the
  vendoring policy this project already follows — Hanken Grotesk is a self-hosted WOFF2 rather than
  a Google Fonts `@import`, and the LinkedIn/Glassdoor/Indeed logos are Simple Icons SVGs baked
  into the repo rather than a live CDN. `shadcn-svelte` is a community port that trails upstream.
- The specific libraries these screens want are React-first: TanStack Table (tracker), `vaul`
  (filter drawer), `cmdk` (command palette), Recharts (score distribution). Svelte gets adapters
  or ports that lag.
- This repository is built through agents against a workboard. React/TSX has substantially denser
  representation than Svelte 5 runes, which are recent enough that generated Svelte frequently
  comes out in Svelte 4 idiom.

Bundle size did not decide this. Leaving WASM already satisfies that constraint roughly 60×; the
React-vs-Svelte delta (~200 KB vs ~120 KB gzipped) is noise at that point.

**Supporting libraries:** TanStack Query for server state (this app is entirely server state —
fetch, cache, invalidate, refetch-after-mutation), React Router for routing, `vite-plugin-pwa`
for the manifest and service worker, Vitest + Testing Library + MSW for tests, zod for
runtime validation at the API boundary.

#### Toolchain as scaffolded (`FE-01`)

`client/` is a plain npm project — no monorepo workspace, no shared root `package.json`, matching
how `workers/` already stands alone. Node `>=22`, ESM (`"type": "module"`).

| Concern | Choice |
|---|---|
| Build / dev server | Vite 8 + `@vitejs/plugin-react` 6 |
| UI | React 19 |
| Types | TypeScript 5.9, single `tsconfig.json`, `noEmit` |
| Tests | Vitest 5 + jsdom + Testing Library + `@testing-library/jest-dom` |
| Lint | ESLint 10 flat config + `typescript-eslint` + react-hooks / react-refresh plugins |
| Format | Prettier 3, with `eslint-config-prettier` last so the two never disagree |

Five scripts, and they are the per-task verification gate: `dev`, `build`, `typecheck`, `test`,
`lint` (plus `preview`, `test:watch`, `format`, `format:check`).

TypeScript is strict **plus** `noUncheckedIndexedAccess`, `noImplicitOverride`,
`noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`, and
`verbatimModuleSyntax`. Indexing an array or record yields `T | undefined`, so ported code has to
handle the empty case explicitly rather than inheriting the Go zero-value habit.

ESLint runs **syntactically** (`tseslint.configs.recommended`, not the type-checked variant):
`npm run typecheck` already owns type errors, so lint stays fast and needs no second tsconfig
project for `vite.config.ts` / `eslint.config.js`.

**Dev proxy.** `vite.config.ts` proxies `/api` and `/webhooks/resend/inbound` to
`API_INTERNAL_URL`, defaulting to `http://localhost:3000` — the same variable name the deployed
service uses, read Node-side only and never inlined into the bundle, so no `VITE_*` value is
introduced. `changeOrigin` is explicitly `false`: Rails must receive the browser's original
`Host` header in dev exactly as it will behind Caddy, whose `reverse_proxy` preserves `Host` by
default (unlike the Go server's `httputil` rewrite). The dev server listens on 8000, matching the
Go server's default.

#### API boundary schemas (`FE-03`)

`client/src/api/schemas.ts` holds a zod schema and an inferred type for every payload in
`web/components/client.go`, plus the anonymous envelope structs its methods declare inline
(`{job_post: …}`, `{application: …}`, `{lookup: …}`, …). It is the only new runtime dependency so
far: `zod` 4.

Runtime validation at the boundary is a deliberate upgrade, not a port. `json.Unmarshal`
zero-values a shape mismatch in silence, so a renamed or retyped field arrives at a screen as
`""`/`0`/`nil` and every symptom shows up somewhere else — that is the failure mode behind the
empty Applications table. These schemas reproduce Go's decode semantics for *absence* while
rejecting a wrong *type*:

| Wire value | Go | Schema |
|---|---|---|
| Key missing, or explicit `null`, on a value field | zero value | same — `""`, `0`, `false`, `[]` |
| Key missing, or `null`, on a pointer field (`*int`, `*ApplicationTracker`) | `nil` | `null`, never the zero value |
| Wrong type (`match_score: "82"`, `job_posts: {}`, `triage_reasons: [1]`) | zero-valued or a decode error, depending on the field | **always** a parse failure |
| Unknown key | ignored | stripped, not rejected |

The absence tolerance is load-bearing, not defensive padding: Rails' serializers genuinely differ
per endpoint. `Api::DigestController` emits 6 of `JobSummary`'s 13 keys; the job-feed's
`serialize_application` omits five keys the applications controller sends; an `unavailable`
posting lookup splats an empty field hash and carries only `status` and `error`. Unknown keys must
be stripped for the same reason — `profile` already ships `work_history`/`education`/`skills`,
which the Go struct never declared.

Keeping `match_score: null` distinct from `0` is the one that matters visually: `MatchScoreLabel`
renders the first as "Scoring…" and the second as "0%", so collapsing them tells the owner a
posting scored zero when it was never scored. A `expectTypeOf` block in `schemas.test.ts` pins
that at the type level too, so a later edit cannot quietly widen it.

Request-side schemas mirror the Go struct's own optionality instead: `ApplicationStatusUpdate`'s
`,omitempty` note and follow-up date stay `.optional()` because sending `""` would *erase* values
Rails is holding. `JobFeedParams` goes further and types its filters as literal unions — an unset
filter must be omitted, and `""` or an `"All"` sentinel is now a type error rather than the
silently empty feed the go-app `<select>` produced.

#### Transport and typed errors (`FE-04`)

`client/src/api/http.ts` is the whole request layer, ported from `httpRailsClient`'s
`get`/`sendJSON`/`do`: `apiGet(path, schema)` and `apiSend(method, path, schema | null, options)`,
where a `null` schema means "Rails answers with no payload" and the body is never read — the same
distinction Go drew by passing a `nil` destination. `client/src/api/errors.ts` holds the two error
kinds. Nothing above this layer touches `fetch`.

Four properties are enforced here rather than left to convention:

- **The session cookie is httponly and is never read.** Auth is entirely the browser attaching a
  signed cookie Rails set on `POST /api/session`. `credentials` is pinned to `"same-origin"`,
  explicitly and never `"include"` — `include` would carry the owner's cookie to another origin.
  `http.test.ts` scans every non-test file under `client/src/` and fails on a `document.cookie`
  reference, so the rule survives a later screen author who does not know it.
- **Paths cannot leave the origin.** `assertApiPath` rejects an absolute URL, a protocol-relative
  `//host` URL, and a bare relative segment. The transport is the one place the cookie is attached,
  so the destination must not be caller-controllable.
- **Every response is validated through its FE-03 schema before it reaches a caller.** This is
  where the schemas stop being decoration: a 2xx body that is not JSON, or that a schema rejects,
  raises `ResponseFormatError` instead of handing a screen a zero-value.
- **`APIError` carries the Rails envelope, not just a status.** `code` is the machine-readable
  `error.code` the screens branch on (`draft.go` maps `unsafe_payload`/`unsupported_ats`/
  `draft_required` to owner copy), and `message` is Rails' own text when it sent any, falling back
  to the exact `api request failed: status N[: body]` string Go produced. `isUnauthorized(err)`
  matches **401 only** — a 403 is an authorization decision about an authenticated owner and must
  not sign them out — and walks the `cause` chain, replacing Go's `errors.As` unwrap loop.

`ResponseFormatError` has no Go counterpart on purpose. Go had no way to say "the server answered,
but with something I cannot use", so it did not distinguish that from success. Separating it from
`APIError` keeps a contract break out of the retry/sign-out paths that `APIError` drives.

Transport failures are deliberately *not* wrapped: `fetch` rejects with the platform's own
`TypeError` (offline, DNS) or abort error, matching Go returning the transport error unwrapped.

**Test harness.** `client/src/test/msw.ts` sets up MSW (`msw` 2, the first devDependency added
since the scaffold) and is the shared harness for the rest of the chain. `installMockApi()`
installs the lifecycle for a test file — it is deliberately *not* named `use*`, because the
`react-hooks` lint rule reads that prefix as a hook and rejects a top-level call. Requests are
intercepted at the network layer, so the code under test runs the real `fetch` path; a
hand-stubbed `fetch` would let a transport bug through untested. `onUnhandledRequest: "error"`
means an unmocked request fails the test rather than quietly reaching a live Rails.

#### Endpoints, query keys, and the QueryClient (`FE-05`)

`client/src/api/endpoints.ts` is one exported function per method on the Go `RailsClient`
interface — 25 of them, same HTTP method, same path, same request body — plus the two
query-string helpers below. It owns call *shape* only: transport stays in `http.ts`, payload
validation in `schemas.ts`, cache identity in `keys.ts`. Reads resolve the response envelope key
(`{intake: …}`, `{job_post: …}`) so callers get the payload, not the wrapper; the four top-level
responses (`JobPage`, `IngestionBatchPage`, `SubmitResult`, `ManualJobResult`) are returned whole.

Naming: reads are `fetch*`, writes keep the Go verb (`setIntake`, `scoreJobPost`,
`submitApplication`), and the push pair becomes `subscribePush` / `unsubscribePush`. The mapping is
written out in `endpoints.test.ts`, which asserts the exported set still matches the interface
method for method — so a dropped endpoint fails a test rather than resurfacing as a missing screen
feature.

Three call shapes are preserved deliberately, because each encodes a rule that lives in Rails:

- **`updateApplicationDraft` sends only `answers`.** The ATS kind, apply URL, and resume
  reference on the preview are Rails-owned parts of the trusted-submit contract. The parameter is
  therefore `Pick<AutofillPreview, "answers">` rather than the whole preview the Go signature took.
- **`scoreJobPost` and `submitApplication` send no body at all** — not `{}` — matching Go's
  bodyless `POST`. `generateCoverLetter` does send `{}`, also matching Go. The test asserts the
  absent `Content-Type` for the first two.
- **`setJobLifecycle` still splits on id count**: one id uses the member endpoint, several use the
  bulk collection endpoint so Rails keeps it in one transaction.

`jobFeedQuery(params)` reproduces `JobFeedParams.query().Encode()` exactly, and this is the part
worth being precise about, because the go-app `<select>` bug (AGENTS.md 2026-06-24) was a filter
reaching Rails as the literal string `All`:

| Rule | Reason |
|---|---|
| A filter that is empty *after trimming* is omitted entirely | Rails applies its own defaults; `source=` or `source=All` matches nothing |
| The value sent is the **untrimmed** original | Go's `set` closure tested `TrimSpace(val)` but stored `val` |
| `page` is sent only above 1 | page 1 is Rails' default; sending it forks the cache key for nothing |
| Keys are sorted byte-wise, space is `+`, and `!*'()` are percent-encoded | `url.Values.Encode` sorts, and `encodeURIComponent` alone leaves those five literal |

The expectations in `endpoints.test.ts` were produced by **running** the Go method over the same
inputs and pasting the output, so that block is a parity fixture rather than a restatement of the
TypeScript.

`client/src/api/keys.ts` is the query key factory: `["waunder", …]` at the root, with the ten read
endpoints nested so a mutation invalidates by prefix — `queryKeys.jobs.detail(id)` also covers that
job's cover letter and contacts, `queryKeys.jobs.root()` covers every feed page and detail without
touching the profile. A feed page is keyed on its exact query string, so `{}` and `{page: 1}` share
one cache entry. The module header carries the mutation → invalidation table the screen tasks wire
up. Keys must always come from here: one spelled out inline is how a mutation silently stops
refreshing a screen.

`client/src/api/query-client.ts` adds `@tanstack/react-query` 5 and configures three things
against its defaults:

- **Retries are error-aware.** The default retries any failure three times, which would retry a
  401 before sending the owner to login and would retry a `ResponseFormatError` that is
  deterministic by construction. `shouldRetryQuery` retries only transport failures and Rails
  5xx — every 4xx and every format error fails immediately — for at most three attempts.
- **Mutations never retry, at all.** `submitApplication` dispatches a trusted submit to the
  Playwright worker; a replay of a request that reached Rails but whose response was lost would
  re-dispatch it, which no amount of owner approval covers. It is off for every mutation rather
  than an allowlist, so whoever adds the next write inherits the safe default.
- **Refetch on focus and reconnect stay on**, with a 30-second `staleTime`. This is an installed
  mobile PWA usually resumed from memory rather than reloaded (AGENTS.md 2026-09-08).

`client/src/test/handlers.ts` is the fake Rails the rest of the chain builds screens against:
`apiHandlers()` returns one MSW handler per endpoint and `fixtures` exports the canned payloads.
Every fixture is typed as its schema's *output* type, so a schema change breaks `npm run typecheck`
there instead of surfacing as a confusing `ResponseFormatError` inside an unrelated screen test.
The handlers answer the request rather than just the path — the feed echoes the requested page, the
detail handlers use the id from the URL, the intake toggle reflects the posted value — so
pagination and navigation are testable without a per-test handler.

#### Display helpers (`FE-06`)

`client/src/lib/labels.ts` ports the seven pure display helpers out of `client.go` and
`applications.go`: `matchScoreLabel`, `matchScoreBand`, `sourceLabel`, `sourceIconPath`,
`sourceEmoji`, `lifecycleLabel`, and `trackerGroup` (camelCase, otherwise unchanged). No
dependencies beyond two schema types, so it unblocks every screen task and lands before the
router.

The return values are a contract with `public/app.css` and with the `FE-28` screenshot gate, not
prose: bands feed `.job-score--high|mid|low|pending`, lifecycle states feed
`.job-status--active|backlog|removed`, groups feed `.tracker-row--<group>`, and every threshold
(high ≥ 75, mid 50–74, low < 50, `null` ⇒ pending) is transcribed rather than re-derived. The
band and the feed filter are separate vocabularies and the module says so: an unscored pill is
`pending`, while the equivalent filter value is `score_band=unscored`.

Three details are worth knowing before the screens consume it:

- **`sourceIconPath` is where the `/web/` prefix drop becomes code** —
  `/web/icons/linkedin.svg` → `/icons/linkedin.svg`. A stale prefix 404s silently and costs only
  the logo inside an origin pill, so `labels.test.ts` resolves each returned path against
  `client/public/` on disk rather than only comparing strings.
- **`matchScoreBand` drops Go's second parameter.** `MatchScoreBand(score, scoringStatus)` never
  read the status — `score == nil` already covers every unscored status — and
  `noUnusedParameters` rejects carrying a dead parameter across. The Go case table is still run
  with its status column to show the result never depended on it.
- **`trackerGroup` is checked against the Rails constant, not a second copy of it.** The test
  parses `Api::JobPostsController::APPLICATION_GROUPS` out of the controller source and asserts
  every status maps to its group, because Rails owns membership: `application=` filtering and the
  `application_counts` tally are computed server-side over the whole result set. The TypeScript
  copy exists only to tint a row, and a screen that recomputes a tab total from the rows it holds
  would silently be counting one page.

#### Router and the nine routes (`FE-07`)

`client/src/routes.tsx` is the route table and `client/src/main.tsx` is the app root:
`StrictMode` → `QueryClientProvider` → `RouterProvider` over `createBrowserRouter(routes)`.
React Router 7 is added here; the route array is exported rather than declared inline as JSX so
`routes.test.tsx` drives the *same* array through `createMemoryRouter` that the browser drives
through `createBrowserRouter` — the test cannot pass against a route table the app does not use.
The nine paths are unchanged, because they are a contract with the manifest `start_url`, the push
notification's `data.url`, the owner's existing history, and the `FE-28` parity gate.

Three things this pass settled:

- **Route order is no longer load-bearing, and the test says so instead of the order.** go-app
  matched its exact routes before its regexps, so `main.go` had to register `/jobs/new` above
  `^/jobs/\d+$`. React Router ranks matches by specificity and a static segment always outranks a
  dynamic one — verified by reversing the array and re-asserting, not assumed. The declaration
  order still mirrors `main.go`, but `/jobs/new` resolving to manual entry is an assertion, not a
  consequence of line numbers.
- **`\d+` → `:id` widens what matches, deliberately.** `/jobs/abc` was unrouted under go-app and
  now reaches the job detail screen, which asks Rails for the posting and renders its own
  not-found state from the 404. Rails was already the authority on whether an id exists (nothing
  stopped `/jobs/999999`), so this trades a client-side regexp for the answer that is actually
  correct.
- **Placeholders carry the real root class.** Each of the nine screens renders one page-container
  class that `public/app.css` styles — `.digest`, `.login-screen`, `.job-list`, `.manual-entry`,
  `.job-detail`, `.contacts-view`, `.applications`, `.draft-review`, `.profile` — so the
  placeholder elements carry them too and the route test asserts on them. That assertion is
  identical before and after each screen port: `FE-08` … `FE-26` swap one line in `routes.tsx` and
  change nothing in `routes.test.tsx`, and a ported screen that quietly drops its root class fails
  the route test rather than surfacing at the screenshot gate. The not-found screen uses
  `.app-shell`, the generic screen-shell class already in that selector group.

A not-found screen is new: go-app's handler 404'd an unrouted path server-side and an in-app
navigation to one rendered nothing. Caddy will answer every path with the app shell (`FE-27`), so
without a catch-all route a typo or a stale bookmark would render a blank page.

#### App chrome and the layout preference (`FE-08`)

`client/src/components/app-chrome.tsx` is the toolbar, the navigation, and the layout selector;
`client/src/lib/layout.ts` is the preference itself (read, write, normalize, apply). The markup and
every class are unchanged from `chrome.go`, and the selector still does exactly one thing: write
`data-layout` on the document root.

Four things this port settles:

- **The stored value is JSON-quoted, and that is the contract.** go-app's `BrowserStorage`
  JSON-encodes everything it writes (`storage.go`: `jsStorage.Set` → `json.Marshal`), so a Go
  `string` lands in `localStorage` **with quotes** — the owner's devices hold `"desktop"`, not
  `desktop`. `writeLayout` therefore writes `JSON.stringify` and produces byte-identical values,
  and `readLayout` accepts the quoted form as well as a bare one. This matters in both directions
  while the chain is in flight: the Go build is still production and reads the same key on the same
  devices until `FE-30`, so an unquoted write would reset the preference on the next Go load, and a
  read that did not unquote would reset it on the first React load. `waunder.jobFilters` (`FE-16`)
  is unaffected — it stored a struct, and `json.Marshal` of a struct already matches
  `JSON.stringify` of an object.
- **The chrome renders inside each screen's page container, not above the routes.** `renderAppTabs()`
  emitted it as the first child of `.digest` / `.job-list` / …, and that nesting is load-bearing:
  the screen roots carry `container-type: inline-size`, which makes them the containing block for
  the `position: fixed` bottom bar, and they own the `padding-bottom: var(--screen-bottom)` that
  reserves room for the bar plus the iPhone safe area. Hoisting `AppChrome` into a route layout
  element would position the bar against the viewport and leave the last row of every feed
  underneath it. `FE-15` … `FE-26` each render `<AppChrome />` as the first child of their screen
  root; the login and not-found screens render none, as today.
- **The active tab is derived from the route instead of passed in.** `chrome.go` took an `Active`
  field and eight call sites passed a literal — `"jobs"` from four different screens. The port maps
  the first path segment to the section, which is exactly what those literals encoded, so a ported
  screen cannot light up the wrong tab.
- **Auto stays a CSS breakpoint with no JavaScript.** `app.css` declares the desktop overrides
  twice, for `:root[data-layout="desktop"]` and for `:root:not([data-layout="mobile"])` inside
  `@media (min-width: 960px)`, and the two blocks must stay identical or Auto and Desktop drift
  apart on a resize. `app-chrome.test.tsx` parses both out of the stylesheet and compares them, and
  asserts the component queries no `matchMedia` and registers no resize listener.

Storage failure is a first-class case, not a guard: `localStorage` can be absent, can throw on
*access* in a browser configured to block site data, and can throw on write in private mode.
Reads degrade to Auto and the chrome still renders; a failed write is returned to the caller, which
applies the choice for the session anyway and surfaces `chrome.go`'s exact `.layout-error` copy so
the owner knows it will not survive a reload.

`chrome.go`'s `OnAppUpdate` / `goappTryUpdate` update banner is **not** ported here — `FE-10`
replaces it with Workbox's `needRefresh` signal in `update-banner.tsx`. The `.app-update` CSS is
already in place.

#### PWA manifest, precache, and update prompt (`FE-10`)

`vite-plugin-pwa` owns the shadow client's `/manifest.webmanifest`, generated service worker, and
the content-hashed precache manifest. `client/vite.config.ts` pins the manifest identity to the
current go-app output: name/short name `Waunder`, start URL and scope `/`, standalone display,
both colors `#2d2c2c`, and the four default/large/SVG/maskable records all pointing to `/icon.svg`.
It deliberately supplies **no `id`**, so platforms continue to derive identity from the unchanged
start URL and preserve the owner's installed icon.

The plugin uses `registerType: "prompt"`; `UpdateBanner` calls Workbox's `useRegisterSW()` and
renders the existing `.app-update` banner only when its `needRefresh` signal says a new worker is
waiting. Reload remains an explicit owner action, so an in-progress edit is never discarded. Vite
hashes module assets by content; stable public URLs (`/app.css`, fonts, and SVGs) are instead
included in Workbox's precache with revision hashes, preventing go-app's constant-URL cache trap
without changing the public asset contract.

#### Login and the 401 auth boundary (`FE-09`)

`client/src/components/login.tsx` is the passphrase screen — markup, classes, copy, and all three
status strings unchanged from `login.go` — and `client/src/lib/auth.ts` is the boundary that
decides when the owner is sent to it.

**Signed-in state is not something this client can read.** The session is a signed, httponly
cookie, so it can only be *derived from responses*: a 401 from any request means the session is
gone. The Go build spread that check across twenty-odd call sites — every `IsUnauthorized(err)`
branch set `sessionExpiredMessage` and `renderLoadError` drew a panel with a `/login` link — which
means a screen could simply forget it, and the panel left the owner to notice and click.
`installUnauthorizedRedirect(queryClient, router)` replaces all of it with one subscription over
the query cache and the mutation cache: any read or write whose terminal `error` action carries a
401 navigates to `/login` with `replace: true`, since the screen behind it cannot be rendered
without a session. `main.tsx` installs it once, for the life of the app.

It hangs off the **router object** rather than a layout component on purpose. A layout route
rendering `<Outlet />` would need the route tree restructured and would re-render every screen on
each navigation, while driving the same two subscriptions; navigating through the router object is
the framework's own escape hatch for code outside the tree, and it lets `auth.test.tsx` drive a
`createMemoryRouter` over the app's own `routes` array through the *same* function `main.tsx`
calls. Only the terminal `error` action is read: a retried read also dispatches `failed` per
attempt, but the `FE-05` retry policy refuses to retry any 4xx, so a 401 arrives at `error`
immediately. A 403 deliberately does not redirect — `isUnauthorized` is 401-only, because that is
an authorization decision about an *authenticated* owner and hiding it behind a login screen would
be a lie.

**The passphrase is never held anywhere this app owns.** `login.go` kept it in a controlled field
and cleared it after each attempt; the port never puts it in React state at all. The input is
uncontrolled, so the value lives only in the DOM node the browser already owns, is read once into
a local on submit, and the form is reset on both outcomes. This is also why login does **not** go
through `useMutation`: TanStack keeps a mutation's last `variables` in its cache (and hands them
to devtools), which would park the owner's passphrase there for the life of the tab. Login has no
cached read to invalidate either, so the local `submitting` / `status` pair is the whole state —
the same two fields the Go component had. A 401 from `POST /api/session` is *not* the session
boundary: it means the passphrase was wrong, so it stays on the screen as `Incorrect passphrase.`
rather than reaching the redirect above (which only ever sees TanStack-managed traffic).

**Sign-out is new.** `DELETE /api/session` has always existed in Rails
(`resource :session, only: %i[create destroy]`), but no Go screen ever called it, so the only way
out of a session was to wait out the 90-day cookie. `logout()` joins `endpoints.ts` as the one
function with no `RailsClient` counterpart, and `useSignOut()` wraps it: on success it returns to
`/login` and *then* clears the query cache — clearing first would notify the observers still
mounted on the screen being left and fire a round of refetches against a session that no longer
exists. A 401 from the sign-out itself counts as success, because `destroy` is session-guarded and
an already-expired cookie answers 401 while leaving the owner just as signed out.

Two consequences for later tasks:

- **`FE-25` renders the control.** `useSignOut()` ships here with no UI, because the profile screen
  is where it belongs and `app.css` has no rule for it yet — the same way `FE-06`'s helpers landed
  before the screens that call them. The new button is therefore a **deliberate** difference from
  the Go build at `/profile` for the `FE-28` parity gate, not a defect.
- **`auth.ts` is a `.ts`, and the boundary is not a component.** The task sketched
  `src/lib/auth.tsx`; there is no JSX in it, since the boundary is a subscription and sign-out is a
  hook.

### Server: Caddy, and Go is removed entirely

The Go server does four things: serve static files, SPA fallback, proxy `/api/*` to Rails, proxy
`/webhooks/resend/inbound` to Rails. A Caddyfile does all four in roughly fifteen lines and adds
`encode zstd gzip`, which the Go `http.FileServer` never had.

Three configuration facts that must be got right:

- Railway terminates TLS. The site address must be `:{$PORT}` with `auto_https off`, or Caddy
  attempts certificate provisioning and fails to bind.
- Caddy's `reverse_proxy` **preserves the original `Host` header** by default, whereas Go's
  `httputil.NewSingleHostReverseProxy` **rewrites it to the target host**. This is a real
  behavioral difference in front of Rails and must be verified, not assumed.
- `main_test.go`'s proxy unit test is replaced by a container smoke test (run the built image,
  curl both proxy paths and an SPA deep link). For a reverse-proxy configuration this tests the
  actual thing rather than testing `httputil`.

Caddy appears only in `FE-27`. Local development uses Vite's own `server.proxy` to a local Rails,
so if Caddy proves wrong it is one task to swap for a small static server without touching any
screen work.

**`FE-27` implementation and verification.** `client/Caddyfile` disables automatic HTTPS, binds
`:{$PORT}`, enables `zstd` and `gzip`, serves `/srv` with an SPA fallback, and sends only
`/api/*` plus `/webhooks/resend/inbound` to `API_INTERNAL_URL`. The root-context
`deploy/railway-web.Dockerfile` builds `client/` with Node and runs the result in Caddy; it is a
shadow deployment definition only until `FE-30`, not a Railway service reconfiguration.
`bash client/scripts/container-smoke.sh` builds that image and verifies the two proxy paths,
request methods/bodies/content type/custom headers, the SPA fallback, the legacy worker, and both
compression encodings. Its stub backend receives each caller-supplied `Host` unchanged, confirming
that Caddy preserves the browser's original host in front of Rails rather than applying Go's
upstream-host rewrite.

### Cutover: shadow directory, atomic final commit

Work happens directly on `main` and Railway auto-deploys on push to `main`. An in-place
replacement of `web/` would leave production a dead PWA for the entire task chain.

Instead:

1. The new app is built in **`client/`**. `web/` keeps serving production, untouched, throughout.
2. Every task from `FE-01` to `FE-29` is independently verifiable via `npm test`, `npm run build`,
   and the Vite dev server against a local Rails. None of them change what production serves.
3. `FE-30` is one atomic commit: repoint `deploy/railway-web.Dockerfile`, `git rm -r web/`,
   `git mv client web`.

Production is green at every commit, the chain can be abandoned at any point, and the end state is
the current layout — `api/`, `web/`, `workers/` — with zero Go.

### Tailwind and component libraries are deferred, deliberately

`FE-01` … `FE-30` port to **`app.css` verbatim**, keeping the same class names. That makes the port
provable: identical markup classes and stylesheet mean a screenshot diff is a real regression
signal rather than a design change indistinguishable from a bug.

`UI-01` … `UI-05` then do the styling upgrade. Two constraints for that phase:

- Tailwind v4's default `@import "tailwindcss"` includes Preflight, which fights `app.css`'s own
  resets and base element styles. Import **only** `theme` and `utilities` so the two coexist.
- The existing `:root` token block (`--color-bg`, `--radius-pill`, `--text-xs`, …) is already in
  Tailwind v4's `@theme` naming shape, so the design system transfers rather than being
  re-derived. Convert component by component, deleting `app.css` sections as they empty.

---

## End state

```
api/           Rails 8.1 API — unchanged
web/           Vite + React + TypeScript PWA (was Go + go-app)
  index.html
  package.json
  vite.config.ts
  Caddyfile         static + SPA fallback + /api and Resend webhook proxy
  public/           app.css, fonts/, icons/, icon.svg, app-worker.js (kill switch)
  src/
    api/            zod schemas, transport, endpoint functions, query keys, query client
    components/     screens and shared UI
    lib/            label/format helpers, platform detection
    sw.ts           custom service worker (precache + push)
workers/       Node + Playwright worker — unchanged
deploy/
  railway-web.Dockerfile   node build stage -> caddy runtime
```

No Go toolchain, no `go.mod`, no `Makefile`, no `app.wasm`.

---

## Port map

| Go source | LOC | Becomes |
|---|---|---|
| `web/main.go` (routes) | 121 | `src/main.tsx` (app root) + `src/routes.tsx` (React Router route table) |
| `web/main.go` (proxy, PWA handler) | — | `Caddyfile` + `vite-plugin-pwa` config |
| `web/components/client.go` | 1,115 | `src/api/{schemas,errors,http,endpoints,keys,query-client}.ts` + `src/lib/labels.ts` |
| `web/components/jobs.go` — `JobList` | ~920 | `src/components/jobs/` (list, filters, lifecycle) |
| `web/components/jobs.go` — `JobDetailView` | ~570 | `src/components/job-detail/` |
| `web/components/jobs.go` — `DigestView` | ~450 | `src/components/ingestion-batches/` |
| `web/components/applications.go` | 653 | `src/components/tracker/` |
| `web/components/draft.go` | 576 | `src/components/draft-review/` |
| `web/components/manual_entry.go` | 477 | `src/components/manual-entry/` |
| `web/components/contacts.go` | 325 | `src/components/contacts/` |
| `web/components/push.go` + `push_browser.go` | 427 | `src/components/push-toggle.tsx` + `src/lib/push.ts` (~30 lines; the `FuncOf`/`Release`/promise-to-channel `await` adapter disappears) |
| `web/components/profile.go` | 266 | `src/components/profile/` |
| `web/components/install_guide.go` + `pwa.go` | 281 | `src/components/install-guide.tsx` + `src/lib/platform.ts` |
| `web/components/chrome.go` | 134 | `src/components/app-chrome.tsx` |
| `web/components/login.go` | 113 | `src/components/login.tsx` + `src/lib/auth.ts` (the 401 boundary the Go screens each checked by hand, plus the sign-out Go never had) |
| `web/components/copy_button.go` | 50 | `src/components/copy-button.tsx` |
| `web/web/app.css` | 64 KB | `web/public/app.css` — **copied verbatim** |
| `web/web/fonts/`, `web/web/icons/`, `web/web/icon.svg` | — | `web/public/` — copied verbatim |
| `web/components/*_test.go` | 3,866 | Vitest + Testing Library + MSW; expect fewer lines |
| `web/scripts/layout-smoke.cjs` | — | extended into the parity gate (`FE-28`) |

Nine routes carry over unchanged: `/`, `/login`, `/jobs`, `/jobs/new`, `/jobs/:id`,
`/jobs/:id/contacts`, `/applications`, `/applications/:id`, `/profile`, plus a catch-all
not-found screen that go-app had no equivalent for. The three go-app `RouteWithRegexp` patterns
become ordinary React Router params — see [Router and the nine routes](#router-and-the-nine-routes-fe-07).

---

## Preserved contracts

These are cheap to preserve and fail silently if missed. Every one is an acceptance criterion on
the task that owns it.

| Contract | Exact value | Symptom if changed |
|---|---|---|
| Layout preference storage | key `waunder.layout`; same values (Auto/Desktop/Mobile), stored **JSON-quoted** (`"desktop"`) because go-app's storage `json.Marshal`s what it writes | Owner's layout choice silently resets |
| Jobs feed filter storage | key `waunder.jobFilters`; same JSON shape | Owner's saved filters silently reset |
| Session cookie | `waunder_session`, httponly ⇒ unreadable from JS. Auth state derives from a 401 on any request, exactly as `IsUnauthorized` does today; `FE-09` centralizes that into one subscription (`src/lib/auth.ts`) | Login loop, or a UI that thinks it is signed in |
| Manifest identity | `name`/`short_name` `Waunder`, `start_url` `/`, `scope` `/`, `display` `standalone`, `theme_color` and `background_color` `#2d2c2c`, same icon, served at `/manifest.webmanifest`, and **no `id`** (go-app emits none, so identity falls back to `start_url`) | iOS 16.4+ keys a home-screen web app on name + manifest `id`, so the owner's existing icon stops matching and a re-add creates a duplicate |
| Web Push payload | `{title, body, data: {url, count}}` — see below | Notification click goes nowhere |
| Asset paths | 5 references: `app.css:26` `@font-face`, `main.go:96-101` styles/icon, `client.go:635-639` source logos — all re-pointed from `/web/<path>` to `/<path>`, see below | Missing font, missing brand logos |
| Proxy paths | `/api/*` and `/webhooks/resend/inbound` → `API_INTERNAL_URL` | Inbound email ingestion stops |

### Static asset paths: `/web/<path>` becomes `/<path>`

go-app's `app.Handler` serves the whole `web/web/` directory tree under a `/web/` URL prefix, so
every static asset reference in the Go app is prefixed. Vite serves `public/` at the **site root**
instead, so `FE-02` drops the prefix and nothing else: the files themselves are byte-identical
copies.

| Asset | go-app URL | New URL | File | Referenced from |
|---|---|---|---|---|
| Stylesheet | `/web/app.css` | `/app.css` | `client/public/app.css` | `client/index.html` `<link rel="stylesheet">` (was `main.go` `Styles`) |
| Font | `/web/fonts/hanken-grotesk.woff2` | `/fonts/hanken-grotesk.woff2` | `client/public/fonts/` | `app.css` `@font-face` `src`, plus an `index.html` preload |
| App icon | `/web/icon.svg` | `/icon.svg` | `client/public/icon.svg` | `index.html` favicon + apple-touch-icon, and the manifest (`FE-26`) |
| Source logos | `/web/icons/{linkedin,glassdoor,indeed}.svg` | `/icons/{linkedin,glassdoor,indeed}.svg` | `client/public/icons/` | `SourceIconPath` (`client.go:635-639`) → `src/lib/labels.ts` |

Two consequences for later tasks:

- The component that ports `SourceIconPath` must return the **unprefixed** `/icons/<name>.svg`.
  A stale `/web/` prefix 404s silently and the origin pill simply loses its logo — the label still
  renders, so it is easy to miss.
- `app.css` is linked from `index.html` rather than imported from `src/`, so it stays out of Vite's
  asset hashing and keeps the same always-`/app.css` URL go-app served. `FE-26`'s precache list must
  therefore include it explicitly; it is not in the JS module graph.

The permitted `app.css` edits are exactly this path change plus the header comments that described
go-app wiring — four lines, verifiable with
`diff -u web/web/app.css client/public/app.css`. `client/.prettierignore` excludes
`public/app.css` so `npm run format` cannot reformat the verbatim copy out from under the parity
gate.

### A free simplification

`VAPID_PUBLIC_KEY` is currently injected into the WASM bundle through go-app's `Env` map
(`main.go:104-106`) and read with `goappGetenv`. But `GET /api/push/vapid_public_key` already
exists and `client.go:930` already calls it. Fetch it from the API and drop the environment
variable from the `web` service entirely.

---

## Service worker handoff

**This is the highest-risk item in the migration.** Without explicit handling, the installed PWA
can be permanently stuck on the old build.

go-app registers its worker at `/app-worker.js` with cache name `app-<version>`, and its fetch
handler is `fetchWithCache` — pure cache-first, no revalidation — with `/` in the precache set.
After cutover the sequence is:

1. The installed PWA asks its old service worker for `/`.
2. The old worker returns the **cached old HTML** (cache-first, never revalidates).
3. That HTML loads the old `/app.js` bootstrap, which registers `/app-worker.js`.
4. The new deployment no longer serves `/app-worker.js` → 404 → the update fails.
5. The old worker survives. The new app is never reached.

**Mitigation (`FE-12`):** the new deployment serves a deliberate kill switch at
`/app-worker.js` — a small worker that on `install` calls `skipWaiting()`, and on `activate`
deletes every cache key, calls `self.registration.unregister()`, claims clients, and reloads them.
Service worker script fetches bypass the service worker's own fetch handler per spec, so the
browser does retrieve the fresh file from the network; `AppChrome` additionally calls
`goappTryUpdate()` on mount today, which forces the check.

The permanent source file is `client/public/app-worker.js`, so Vite serves it at the exact legacy
path in development and copies it to the production build root. It deliberately registers no fetch
handler. `client/src/test/app-worker.test.ts` executes that shipped file against fake cache,
registration, and client objects to pin the full retirement sequence without relying on a browser.

Keep `/app-worker.js` deployed indefinitely — it is a few lines, and removing it re-arms the trap
for any device that has not opened the app since cutover.

### The owner's actual client is an iOS home-screen web app

The owner runs Waunder as a web app added to the iOS home screen from Chrome. This makes the
handoff **harder**, not easier, and the automated check cannot fully cover it.

- **Storage on iOS is fragmented and version-dependent.** Cookies, Web Storage, and IndexedDB are
  isolated per home-screen icon, while service worker registration and CacheStorage have been
  reported as shared with the browser since iOS 14. A Chrome-added web app on iOS 16.4+ runs in its
  own WKWebView instance with its own storage. Do not build a recovery procedure on any assumption
  about which container is which — it is not reliably knowable across versions.
- **Therefore the kill switch is the primary recovery, not a convenience.** It is the only path that
  works without knowing the storage topology, and the device has no DevTools.
- **The only manual fallback that can be stated with confidence is deleting the home-screen icon and
  re-adding it.** Clearing site data inside Chrome may or may not reach the web app's container.
- **That fallback is not free.** Because cookies and Web Storage are isolated per icon, deleting it
  loses the session cookie (re-enter the passphrase), the push subscription (Rails prunes the dead
  endpoint on the next send; re-enable it from Profile), and the `waunder.layout` and
  `waunder.jobFilters` values. Recoverable in under a minute, but not invisible.
- **Manifest identity is load-bearing on iOS.** iOS 16.4+ identifies a home-screen web app by its
  name combined with the manifest `id`. go-app emits **no `id`** today, so identity falls back to
  `start_url`. If the new manifest introduces an `id` that does not resolve to the same identity,
  iOS can treat it as a different web app — the existing icon stops matching and a re-add creates a
  duplicate. Keep `id` absent, or set it to a value that resolves identically.
- **Forcing a reload is best-effort.** The kill switch's contract is to unregister and clear caches;
  `WindowClient.navigate()` behavior on WebKit is not something to depend on, and the already-loaded
  page is the old go-app page with no listener of ours. Once the worker is gone and the caches are
  cleared, the next app launch fetches from the network anyway — worst case the owner opens the app
  twice.
- **Automation cannot verify this.** `FE-29`'s handoff check runs desktop Chromium through
  Playwright, which proves the logic but not iOS WebKit. Run it against Playwright's `webkit` build
  as a closer proxy, and treat a manual check on the actual phone after cutover as the real gate.

`FE-29` records both the fallback and the post-cutover on-device check in
[`PRODUCTION_SETUP.md`](PRODUCTION_SETUP.md); `FE-30` confirms the owner's icon actually picks up
the new build after the push.

**Verification trap:** Playwright's `serviceWorkers: 'block'` (used today by
`web/scripts/layout-smoke.cjs`) bypasses this entire path, so a screenshot can look perfect while
every real returning browser shows the old build. The handoff must be verified with
`launchPersistentContext` and no such option.

### Handoff integration result (`FE-29`, 2026-09-11)

`node client/scripts/handoff-check.cjs` passed locally against the built Caddy image, Rails in the
test environment, the legacy Go server, and both Playwright Chromium and WebKit. It performs two
isolated checks:

- It replays a freshly Svix-signed `email.received` body through Caddy twice: first into a capture
  server to compare the raw bytes and every `svix-*` header, then into Rails with the test webhook
  secret. Rails accepts the signature and persists an `InboundEmail`; the script asserts the stored
  raw payload is byte-for-byte the replayed JSON. It temporarily pauses test intake and deletes its
  fixture row afterward, so no parsing or scoring is triggered.
- It opens the Go app in a `launchPersistentContext`, waits for the legacy `/app-worker.js` and its
  cache, swaps the same origin to the Caddy image, then requests a worker update. Chromium and
  Playwright WebKit both observed the replacement worker unregistering and all legacy caches being
  removed before the Vite asset bundle loaded.

Playwright WebKit is a closer proxy to iOS than Chromium, but no desktop automation proves iOS
WebKit or the Chrome-added home-screen container. The manual on-device check in
[`PRODUCTION_SETUP.md`](PRODUCTION_SETUP.md#pwa-cutover-recovery) remains the production gate.

---

## Web Push payload — fix a real bug

Rails sends `{title, body, data: {url: "/", count: N}}` (`daily_digest_builder.rb:23-26`).

go-app's generated worker reads `notification.path` for the click target and **overwrites the
`data` key** with its own `{goapp: {path, actions}}`. Rails never sends a top-level `path`, so
`data.goapp.path` is `undefined` and `data.url` is discarded. `icon` and `badge` are undefined
too, so the notification renders with a browser default icon.

The live symptom degrades differently depending on whether a window is already open
(`clients.matchAll` → focus, versus `clients.openWindow(undefined)`), so this has probably looked
like it works. The shape mismatch is a static fact on both sides.

**The new service worker reads `data.url`, sets the app icon and badge, and Rails still does not
change.** Owned by `FE-11`.

---

## Verification

Per task: `npm run build`, `npm run typecheck`, `npm test` (Vitest), `npm run lint` in `client/`.
Rails is untouched, so `api/` suites are unaffected — but the API must be running locally for any
manual check, via Vite's dev proxy.

Three gates before the cutover commit, each its own task:

- **`FE-27` container smoke test** — build the image, run it, assert `/api/*` proxies, the Resend
  webhook path proxies, an SPA deep link (`/jobs/123`) returns the shell, static assets are served
  compressed, and the `Host` header behavior in front of Rails is correct.
- **`FE-28` visual parity gate** — Playwright screenshots of all nine routes at mobile and desktop
  widths, against the Go app and the new app side by side, with a diff report. `app.css` and the
  markup classes are unchanged, so any visual difference is a defect.
- **`FE-29` live integration** — a real (or replayed) Resend `email.received` survives Svix
  signature verification through Caddy, and the `/app-worker.js` kill switch retires the go-app
  worker in a persistent browser context.

---

## Cutover doc checklist

The docs below are **accurate today** and describe the Go frontend correctly. They must be
rewritten in the `FE-30` cutover commit, not before — documenting a React frontend while
production runs Go would be false. `FE-30` owns all of it:

| Doc | Change at cutover |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Rewrite `### web (Go + go-app PWA server)` and the Overview/Topology mentions |
| [`CONVENTIONS.md`](CONVENTIONS.md) | Replace `## Stack — web/ (Go + go-app, Go 1.26)` with the TypeScript stack rules |
| [`TESTING.md`](TESTING.md) | Replace the `web/` Go test stack, inventory, and go-app patterns with Vitest/Testing Library/MSW |
| [`ENV_VARS.md`](ENV_VARS.md) | Remove `VAPID_PUBLIC_KEY` from the `web` service; drop the "no `VITE_*` convention" note or restate it |
| [`STYLE_GUIDE.md`](STYLE_GUIDE.md) | Retarget "the go-app components in `web/components/`" to the React components; keep the visual system as-is |
| [`PRODUCTION_SETUP.md`](PRODUCTION_SETUP.md) | Build/runtime facts for the `web` service; PWA-stuck manual fallback |
| [`PRD.md`](PRD.md) | Two incidental go-app mentions |
| [`INDEX.md`](INDEX.md) | Confirm this file's row; no other change |
| `README.md` | Monorepo layout, tech stack, quick start, and the "Why a PWA" paragraph |
| `CLAUDE.md` / `AGENTS.md` | Quick Start, Build & Verification table, Repository Structure, Architecture summary, and the four obsolete go-app entries under Debugging & Gotchas. This file is loaded into every agent session, so a stale version is worse than a missing one |
| This file | Flip **Status** to done and record what actually differed |

---

## Notes for agents working the chain

- Until `FE-30`, `web/` is production. Do not edit it, and do not delete it.
- All new work goes in `client/`. It is not wired to Railway and cannot break production.
- `app.css` is copied **verbatim** in `FE-02`. Do not restyle, tidy, or reformat it, and do not
  change a class name in any component — the parity gate depends on both being unchanged. Styling
  changes belong to `UI-01` and later.
- Every ported screen renders `<AppChrome />` (`FE-08`) as the **first child of its own page
  container**, the way `renderAppTabs()` did — not in a route layout above the screens, or the fixed
  bottom bar loses its containing block and the reserved safe-area space. Login and not-found render
  no chrome.
- Rails is the source of truth for all validation, normalization, scoring, route resolution, and
  submit safety. The frontend does trim-only client hints, exactly as the Go client did. Porting is
  not an occasion to move logic forward.
- Never add an outbound send affordance to the outreach screen — outreach stays prefill-for-manual-
  sending, and the draft-review submit button stays gated on `draft_ready` with no warnings.
- Keep the API contract read-only in this chain. If a screen appears to need an endpoint change,
  stop and report rather than editing `api/`.
