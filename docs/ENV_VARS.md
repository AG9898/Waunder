# ENV_VARS.md — Environment Variable Reference

This is the single source of truth for all environment variable and secret configuration.
If any other doc mentions a variable, it should link here rather than restate it.

> **Security rules:**
> - Never commit secret values to source control.
> - `.env` files containing secrets must be in `.gitignore`.
> - There is **no** `NEXT_PUBLIC_*`/`VITE_*` convention here. The go-app frontend is served
>   same-origin behind the Go proxy and reads no browser-exposed backend secrets. The only
>   client-exposed value is `VAPID_PUBLIC_KEY`, which is **public by design** (it is handed to
>   the browser for the web-push subscription). Every other secret stays server-side in Rails.
> - Rotate any secret that may have been committed; update all affected environments immediately.
> - Production secrets are set in the Railway service dashboard only — never in committed files.

---

## Variable Matrix

| Variable | Required | Default | Description | Where set |
|---|---|---|---|---|
| `API_INTERNAL_URL` | Conditional (Required in prod) | none | Base URL of the Rails `api` service. The `web` server proxies `/api/*` here and the `worker` polls it. When unset, `web` disables the `/api` proxy and serves standalone, and the worker idles/exits. | `web` + `worker` runtime env (Railway private-network URL) |
| `PORT` | No | `8000` | Port the Go `web` server listens on. | `web` runtime (Railway sets this automatically) |
| `DATABASE_URL` | Yes | none | PostgreSQL connection string. | `api` runtime (`api/.env`, Railway) |
| `RAILS_MASTER_KEY` | Yes (prod) | none | Decrypts Rails encrypted credentials. | `api` runtime (Railway secret; locally `api/config/master.key`) |
| `RAILS_ENV` | No | `development` | Rails environment (`production` on Railway). | `api` runtime |
| `ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY` | Yes | none | Active Record Encryption primary key for sensitive resume/profile fields. | `api` runtime (secret) |
| `ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY` | Yes | none | Active Record Encryption deterministic key (for queryable encrypted fields). | `api` runtime (secret) |
| `ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT` | Yes | none | Active Record Encryption key-derivation salt. | `api` runtime (secret) |
| `OPENROUTER_API_KEY` | Conditional | none | OpenRouter LLM gateway API key; required for scoring, summaries, and drafts. | `api` runtime (secret) |
| `OPENROUTER_MODEL` | No | `openai/gpt-4o-mini` (configurable) | Model id used for LLM calls. Kept configurable by env per the plan; choose any OpenRouter model id. | `api` runtime |
| `MAILGUN_WEBHOOK_SIGNING_KEY` | Conditional | none | Validates Mailgun inbound webhook signatures; required for email ingestion. | `api` runtime (secret) |
| `VAPID_PUBLIC_KEY` | Conditional | none | Web Push VAPID public key. **Public by design** — sent to the browser for push subscription. | `api` runtime + exposed to the web client |
| `VAPID_PRIVATE_KEY` | Conditional | none | Web Push VAPID private key; signs push messages. | `api` runtime (secret) |
| `VAPID_SUBJECT` | Conditional | none | VAPID contact (`mailto:` address or URL). | `api` runtime |
| `WORKER_POLL_INTERVAL_MS` | No | `15000` | Worker poll interval (ms) for fetching approved tasks. | `worker` runtime |
| `WORKER_HEADLESS` | No | `true` | Run Playwright headless. Set `false` to show the browser locally. | `worker` runtime |
| `LINKEDIN_EASY_APPLY_ENABLED` | No | `false` | Feature flag gating the higher-risk LinkedIn Easy Apply trusted-submit flow. | `api` + `worker` runtime |
| `REDIS_URL` | No (Conditional) | none | Redis connection string. Used only if Sidekiq is introduced later; unused while solid_queue is the job backend. | `api` + `worker` runtime |

---

## Local Development Setup

Recommend committing a `.env.example` with placeholder values for each service so the
variable surface is documented without exposing secrets. Never commit a real `.env`.

**api (Rails):**
1. Run `bin/setup` to install gems and prepare the database.
2. Create `api/.env` (copy from `api/.env.example`) with `DATABASE_URL` and any feature keys
   you need locally (`OPENROUTER_API_KEY`, Mailgun and VAPID keys for those flows).
3. Provide the Active Record Encryption keys. `bin/rails db:encryption:init` generates a set
   of `ACTIVE_RECORD_ENCRYPTION_*` values you can copy into `api/.env` (or Rails credentials).
4. Keep the local `RAILS_MASTER_KEY` in `api/config/master.key` (already gitignored).
5. Never commit `api/.env`.

**web (Go + go-app):**
1. Build and run with `make run` (defaults to `localhost:8000`).
2. Set `API_INTERNAL_URL` to your local Rails URL (e.g. `http://localhost:3000`) so the
   `/api` proxy is active. If unset, the proxy is disabled and the PWA serves standalone.

**worker (Node + Playwright):**
1. Set `API_INTERNAL_URL` to your local Rails URL so the worker can poll and report.
2. Optionally set `WORKER_HEADLESS=false` to watch the browser, and adjust
   `WORKER_POLL_INTERVAL_MS` for faster local iteration.

---

## Per-Environment Summary

There is no staging environment — only Local dev and Production (Railway).

| Variable | Local dev | Production |
|---|---|---|
| `API_INTERNAL_URL` | Conditional (proxy disabled if unset) | Required |
| `PORT` | Optional (defaults `8000`) | Optional (Railway sets it) |
| `DATABASE_URL` | Required | Required |
| `RAILS_MASTER_KEY` | Conditional (file-based locally) | Required |
| `RAILS_ENV` | Optional (defaults `development`) | Required (`production`) |
| `ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY` | Required | Required |
| `ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY` | Required | Required |
| `ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT` | Required | Required |
| `OPENROUTER_API_KEY` | Conditional | Conditional |
| `OPENROUTER_MODEL` | Optional | Optional |
| `MAILGUN_WEBHOOK_SIGNING_KEY` | Conditional | Conditional |
| `VAPID_PUBLIC_KEY` | Conditional | Conditional |
| `VAPID_PRIVATE_KEY` | Conditional | Conditional |
| `VAPID_SUBJECT` | Conditional | Conditional |
| `WORKER_POLL_INTERVAL_MS` | Optional | Optional |
| `WORKER_HEADLESS` | Optional | Optional |
| `LINKEDIN_EASY_APPLY_ENABLED` | Optional | Optional |
| `REDIS_URL` | Optional | Optional |
