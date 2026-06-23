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
| `API_INTERNAL_URL` | Conditional (Required in prod) | none | Base URL of the Rails `api` service. The `web` server proxies `/api/*` and `/webhooks/resend/inbound` here, and the `worker` polls it. When unset, `web` disables the Rails proxy and serves standalone, and the worker idles/exits. | `web` + `worker` runtime env (Railway private-network URL) |
| `PORT` | No | `8000` | Port the Go `web` server listens on. | `web` runtime (Railway sets this automatically) |
| `DATABASE_URL` | Yes | none | PostgreSQL connection string. | `api` runtime (`api/.env`, Railway) |
| `RAILS_MASTER_KEY` | Yes (prod) | none | Decrypts Rails encrypted credentials. | `api` runtime (Railway secret; locally `api/config/master.key`) |
| `RAILS_ENV` | No | `development` | Rails environment (`production` on Railway). | `api` runtime |
| `ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY` | Yes | none | Active Record Encryption primary key for sensitive resume/profile fields. | `api` runtime (secret) |
| `ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY` | Yes | none | Active Record Encryption deterministic key (for queryable encrypted fields). | `api` runtime (secret) |
| `ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT` | Yes | none | Active Record Encryption key-derivation salt. | `api` runtime (secret) |
| `APP_SHARED_SECRET` | Yes | none | The single owner's login passphrase, exchanged at `POST /api/session` for a signed session cookie (RESOLVED-14). | `api` runtime (secret) |
| `SESSION_SECRET` | Yes | none | Server-side key used to sign/verify the session cookie issued by `POST /api/session`. | `api` runtime (secret) |
| `WORKER_SERVICE_TOKEN` | Yes | none | Static bearer token the `worker` presents to authenticate its task-pull/report calls to Rails (RESOLVED-14). Set identically on `api` and `worker`. | `api` + `worker` runtime (secret) |
| `OPENROUTER_API_KEY` | Conditional | none | OpenRouter LLM gateway API key; required for scoring, summaries, and drafts. | `api` runtime (secret) |
| `OPENROUTER_MODEL` | No | `openai/gpt-oss-120b:free` | Model id used for **all** LLM calls (scoring, summaries, drafts) — single model, no per-task tiers (RESOLVED-17). Free-tier default (replaces `google/gemma-4-31b-it:free`, which became persistently 429 rate-limited); configurable to any OpenRouter model id. | `api` runtime |
| `JOB_TRIAGE_AUTO_SCORE_DAILY_LIMIT` | No | `20` | Maximum number of inbound, triage-eligible JobPosts Rails automatically sends to OpenRouter scoring per day. Manual entries and explicit score requests bypass this budget; set `0` to keep all inbound jobs unscored until manually requested. | `api` runtime |
| `JOBS_PAGE_SIZE` | No | `30` | Server-side page size (rows/page) for paginated list reads (`GET /api/job_posts`, `GET /api/ingestion_batches`). See RESOLVED-20. | `api` runtime |
| `JOB_INTAKE_DAILY_ACTIVE_LIMIT` | No | `30` | Maximum number of inbound, triage-eligible JobPosts that stay `lifecycle_state: active` per day (top-ranked by triage); the rest auto-park in `backlog` so the working feed stays drainable (RESOLVED-20). | `api` runtime |
| `JOB_INTAKE_STALE_AFTER_DAYS` | No | `120` | Age (days) after which `ExpireStaleJobPostsJob` auto-backlogs an `active`, owner-unactioned JobPost (RESOLVED-20). | `api` runtime |
| `REMOVED_JOB_RETENTION_DAYS` | No | unset | (Deferred — OPEN-06) If a hard-purge of soft-`removed` JobPosts is ever added, the retention window before purge. Unused while remove stays a permanent soft-delete. | `api` runtime |
| `RESEND_WEBHOOK_SECRET` | Conditional | none | Svix signing secret that validates Resend inbound (`email.received`) webhook signatures at `POST /webhooks/resend/inbound`; required for email ingestion (RESOLVED-13). | `api` runtime (secret) |
| `RESEND_API_KEY` | Conditional | none | Resend account API key used by `ResendInboundClient` to fetch the **body** of a received email (`GET /emails/receiving/{email_id}`). The `email.received` webhook delivers only metadata — no text/html — so without this key `ParseInboundEmailJob` has no body to parse and every alert dead-ends. | `api` runtime (secret) |
| `RESEND_INBOUND_DOMAIN` | Conditional | none | The Resend-verified receiving domain that forwarded job alerts are sent to (reference/config; e.g. `adenguo.com`). | `api` runtime |
| `VAPID_PUBLIC_KEY` | Conditional | none | Web Push VAPID public key. **Public by design** — exposed to the browser at `GET /api/push/vapid_public_key`, and also read by the `web` server (when set) to forward into the PWA env so the go-app client can subscribe. | `api` runtime + `web` runtime (forwarded to PWA env) |
| `VAPID_PRIVATE_KEY` | Conditional | none | Web Push VAPID private key; signs push messages. | `api` runtime (secret) |
| `VAPID_SUBJECT` | Conditional | none | VAPID contact (`mailto:` address or URL). | `api` runtime |
| `WORKER_POLL_INTERVAL_MS` | No | `15000` | Worker poll interval (ms) for fetching approved tasks. | `worker` runtime |
| `WORKER_HEADLESS` | No | `true` | Run Playwright headless. Set `false` to show the browser locally. | `worker` runtime |
| `LINKEDIN_EASY_APPLY_ENABLED` | No | `false` | Feature flag gating the higher-risk LinkedIn Easy Apply trusted-submit flow. Set `true` in local `.env` (RESOLVED-19); **production must also set this on the `api` and `worker` services** for LinkedIn auto-submit, otherwise LinkedIn jobs fall back to the manual "Open application" link. | `api` + `worker` runtime |
| `REDIS_URL` | No (Conditional) | none | Redis connection string. Used only if Sidekiq is introduced later; unused while solid_queue is the job backend. | `api` + `worker` runtime |
| `SOLID_QUEUE_IN_PUMA` | Conditional (Required in prod) | unset | When set, Puma runs the Solid Queue supervisor in-process (`config/puma.rb`), so the `api` service also processes background jobs (e.g. `ParseInboundEmailJob`). The Railway `worker` service is the Node/Playwright submit worker, **not** a Rails job runner, so without this no process drains the queue. | `api` runtime |

---

## Local Development Setup

Each service has a committed `.env.example` with placeholder values for its local runtime
variables. Copy the relevant template to `.env` for local development; never commit a real
`.env`.

**api (Rails):**
1. Run `bin/setup` to install gems and prepare the database.
2. Create `api/.env` from `api/.env.example` with `DATABASE_URL`, the auth secrets
   (`APP_SHARED_SECRET`, `SESSION_SECRET`, `WORKER_SERVICE_TOKEN`), and any feature keys you need
   locally (`OPENROUTER_API_KEY`, `RESEND_WEBHOOK_SECRET`, and VAPID keys for those flows).
3. Provide the Active Record Encryption keys. `bin/rails db:encryption:init` generates nested
   `active_record_encryption` YAML values that map to the `ACTIVE_RECORD_ENCRYPTION_*`
   environment variables in the template. These env vars are read by
   `config/initializers/active_record_encryption.rb` into `config.active_record.encryption`;
   the test environment falls back to fixed non-secret keys so the suite needs no populated
   `.env`.
4. Keep the local `RAILS_MASTER_KEY` in `api/config/master.key` (already gitignored).
5. Never commit `api/.env`.

**web (Go + go-app):**
1. Create `web/.env` from `web/.env.example`.
2. Build and run with `make run` (defaults to `localhost:8000`).
3. Set `API_INTERNAL_URL` to your local Rails URL (e.g. `http://localhost:3000`) so the
   `/api` and Resend webhook proxy routes are active. If unset, the proxy is disabled and
   the PWA serves standalone.

**worker (Node + Playwright):**
1. Create `workers/.env` from `workers/.env.example`.
2. Set `API_INTERNAL_URL` to your local Rails URL so the worker can poll and report, and use the
   same `WORKER_SERVICE_TOKEN` value as `api/.env`. If `API_INTERNAL_URL` is set but
   `WORKER_SERVICE_TOKEN` is blank, the worker exits with a configuration error instead of polling
   unauthenticated.
3. Optionally set `WORKER_HEADLESS=false` to watch the browser, and adjust
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
| `APP_SHARED_SECRET` | Required | Required |
| `SESSION_SECRET` | Required | Required |
| `WORKER_SERVICE_TOKEN` | Required | Required |
| `OPENROUTER_API_KEY` | Conditional | Conditional |
| `OPENROUTER_MODEL` | Optional | Optional |
| `JOB_TRIAGE_AUTO_SCORE_DAILY_LIMIT` | Optional | Optional |
| `RESEND_WEBHOOK_SECRET` | Conditional | Conditional |
| `RESEND_API_KEY` | Conditional | Conditional |
| `RESEND_INBOUND_DOMAIN` | Conditional | Conditional |
| `VAPID_PUBLIC_KEY` | Conditional | Conditional |
| `VAPID_PRIVATE_KEY` | Conditional | Conditional |
| `VAPID_SUBJECT` | Conditional | Conditional |
| `WORKER_POLL_INTERVAL_MS` | Optional | Optional |
| `WORKER_HEADLESS` | Optional | Optional |
| `LINKEDIN_EASY_APPLY_ENABLED` | Optional | Optional |
| `REDIS_URL` | Optional | Optional |

## Test-only Variables

These are read only by the RSpec suite and never by the running app. They let the profile/resume
request spec exercise realistic personal data without committing any PII; all default to anonymous
placeholders so the suite runs with no setup. Leave them unset in normal runs.

| Variable | Default | Used by |
|---|---|---|
| `TEST_PROFILE_NAME` | `Test User` | `spec/requests/api/profile_spec.rb` |
| `TEST_PROFILE_EMAIL` | `test@example.com` | `spec/requests/api/profile_spec.rb` |
| `TEST_PROFILE_PHONE` | `555-010-0000` | `spec/requests/api/profile_spec.rb` |
| `TEST_PROFILE_LINKEDIN` | `https://linkedin.com/in/test-user` | `spec/requests/api/profile_spec.rb` |
| `TEST_PROFILE_PORTFOLIO` | `https://example.com` | `spec/requests/api/profile_spec.rb` |

---

## Railway Production Provisioning Notes

Production variables are set per Railway service with deploys skipped during provisioning. The
`api` service uses Railway managed Postgres for `DATABASE_URL`; do not copy a local development
database URL into production. The `web` and `worker` services use the Rails private-network URL for
`API_INTERNAL_URL` (`http://...` over Railway private networking, not HTTPS and not a public Rails
domain), and `WORKER_SERVICE_TOKEN` must match exactly on `api` and `worker`.

Blank optional values from local `.env` files are left unset because the Railway CLI refuses empty
stdin values. Add conditional secrets such as `OPENROUTER_API_KEY` or `RESEND_WEBHOOK_SECRET` only
when those integrations are being enabled.

See [`PRODUCTION_SETUP.md`](PRODUCTION_SETUP.md) for the non-secret live URL, Resend webhook,
job-alert ingestion address, and smoke-check runbook.
