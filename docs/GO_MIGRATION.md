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
    api/            zod schemas, transport, endpoint functions, query keys
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
| `web/main.go` (routes) | 121 | `src/main.tsx` + React Router route table |
| `web/main.go` (proxy, PWA handler) | — | `Caddyfile` + `vite-plugin-pwa` config |
| `web/components/client.go` | 1,115 | `src/api/{schemas,client,endpoints,keys}.ts` + `src/lib/labels.ts` |
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
| `web/components/login.go` | 113 | `src/components/login.tsx` |
| `web/components/copy_button.go` | 50 | `src/components/copy-button.tsx` |
| `web/web/app.css` | 64 KB | `web/public/app.css` — **copied verbatim** |
| `web/web/fonts/`, `web/web/icons/`, `web/web/icon.svg` | — | `web/public/` — copied verbatim |
| `web/components/*_test.go` | 3,866 | Vitest + Testing Library + MSW; expect fewer lines |
| `web/scripts/layout-smoke.cjs` | — | extended into the parity gate (`FE-28`) |

Nine routes carry over unchanged: `/`, `/login`, `/jobs`, `/jobs/new`, `/jobs/:id`,
`/jobs/:id/contacts`, `/applications`, `/applications/:id`, `/profile`. The two go-app
`RouteWithRegexp` patterns become ordinary React Router params.

---

## Preserved contracts

These are cheap to preserve and fail silently if missed. Every one is an acceptance criterion on
the task that owns it.

| Contract | Exact value | Symptom if changed |
|---|---|---|
| Layout preference storage | key `waunder.layout`; same values (Auto/Desktop/Mobile) | Owner's layout choice silently resets |
| Jobs feed filter storage | key `waunder.jobFilters`; same JSON shape | Owner's saved filters silently reset |
| Session cookie | `waunder_session`, httponly ⇒ unreadable from JS. Auth state derives from a 401 on any request, exactly as `IsUnauthorized` does today | Login loop, or a UI that thinks it is signed in |
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
- Rails is the source of truth for all validation, normalization, scoring, route resolution, and
  submit safety. The frontend does trim-only client hints, exactly as the Go client did. Porting is
  not an occasion to move logic forward.
- Never add an outbound send affordance to the outreach screen — outreach stays prefill-for-manual-
  sending, and the draft-review submit button stays gated on `draft_ready` with no warnings.
- Keep the API contract read-only in this chain. If a screen appears to need an endpoint change,
  stop and report rather than editing `api/`.
