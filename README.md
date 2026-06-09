# Waunder

A mobile-first, single-user personal job application assistant — installable as a PWA on your iPhone home screen.

> **Status:** early skeleton. Nothing is shipped end-to-end yet — all three services are scaffolds. See [`docs/PRD.md`](docs/PRD.md) for scope and [`docs/workboard.json`](docs/workboard.json) for the task queue.

## What is Waunder?

Waunder finds and scores relevant job openings from forwarded job-alert emails, notifies you with a daily push digest, drafts tailored application materials, tracks contacts, generates outreach messages, and can submit applications to supported ATS platforms — but only after you explicitly approve each one. It is a personal tool for a single owner, not a SaaS.

**Why a PWA instead of a native iOS app?** This is a solo, single-user app, so the cost of the Apple native pipeline (Apple Developer account, macOS/Xcode signing, TestFlight distribution) buys nothing. A Go + go-app WebAssembly PWA installs to the iPhone home screen with its own icon, runs full-screen, and supports Web Push — without any of that overhead. The UI stays responsive so it also works in desktop browsers.

## Monorepo layout

```
Waunder/
  web/         Go + go-app PWA (WebAssembly frontend + small Go server)
  api/         Rails 8.1 API-only backend (source of truth: data, LLM, orchestration)
  workers/     Node + TypeScript + Playwright automation worker
  docs/        Architecture, PRD, conventions, decisions, and the task queue
  initial_plan.md   Authoritative build plan
```

## Tech stack

| Service | Stack |
|---------|-------|
| `web/`     | Go + go-app, compiled to WebAssembly; small Go HTTP server serves the WASM bundle, manifest, and service worker, and proxies `/api` to Rails |
| `api/`     | Rails 8.1 API-only, Ruby 3.2.3, PostgreSQL, RSpec; OpenRouter for LLM, Mailgun inbound for email, Web Push (VAPID) for notifications |
| `workers/` | Node 22 + TypeScript + Playwright; fills supported ATS forms from approved, structured payloads |

External services: Railway (hosting), managed PostgreSQL, Mailgun (inbound email), OpenRouter (LLM gateway).

## Quick start

Each service has its own README with full setup details. The commands below are the entry points that exist today.

**web/** — Go + go-app PWA (`web/Makefile`):

```bash
cd web
make wasm     # compile the frontend to WebAssembly (web/app.wasm)
make server   # build the native server binary
make run      # build wasm + server and run locally (defaults to :8000)
```

**api/** — Rails 8.1 API:

```bash
cd api
bin/setup     # install gems, prepare the database
bin/rails server
bundle exec rspec   # run the test suite
```

**workers/** — Node + TypeScript + Playwright (npm scripts in `workers/package.json`):

```bash
cd workers
npm install
npm run dev        # run with tsx watch
npm run build      # tsc compile
npm run typecheck  # tsc --noEmit
npm test           # node --test
```

## Deployment

Waunder deploys to **Railway** as three containerized services in one project — `web`, `api`, and `worker` — plus managed PostgreSQL. Services communicate over Railway's private network. The browser only ever talks to the `web` origin: the Go server proxies requests under `/api/*` server-side to the Rails `api` service (base URL supplied via an environment variable such as `API_INTERNAL_URL`). This keeps the frontend same-origin (no CORS), keeps the service worker scope and push registration clean, and means the Rails API needs no public domain.

The `web` service uses an explicit Dockerfile because go-app is a two-target build (WASM frontend + server binary). `api` and `worker` can use Railway auto-build or their own Dockerfiles.

## Documentation

- Docs navigation: [`docs/INDEX.md`](docs/INDEX.md)
- Product requirements: [`docs/PRD.md`](docs/PRD.md)
- Agent working guide: [`CLAUDE.md`](CLAUDE.md) / [`AGENTS.md`](AGENTS.md)
