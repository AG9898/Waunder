# Production Setup

Operational reference for the live Railway/Resend setup. Keep this file limited to
non-secret values and setup facts that agents need to orient quickly; secrets stay in
Railway variables and local ignored `.env` files.

---

## Live URLs

| Purpose | Value |
|---|---|
| PWA / owner app | `https://web-production-9b240.up.railway.app` |
| Resend webhook endpoint | `https://web-production-9b240.up.railway.app/webhooks/resend/inbound` |
| Job-alert ingestion address | `job-alerts@adenguo.com` |

Rails (`api`) has no public domain. The public `web` service proxies `/api/*` and
`/webhooks/resend/inbound` to Rails over Railway private networking via `API_INTERNAL_URL`.

---

## Railway Services

Production runs in one Railway project with these services:

| Service | Role |
|---|---|
| `web` | Public Go/go-app PWA server and proxy |
| `api` | Private Rails API, jobs, LLM orchestration, webhook handling |
| `worker` | Private Playwright worker for approved submit tasks |
| `Postgres` | Managed PostgreSQL backing Rails data, jobs, cache, and cable |

App services (`api`, `web`, and `worker`) are connected to GitHub source
`AG9898/Waunder`, branch `main`, with auto-deploy enabled on push. Railway's
GitHub builder uses the repository root as Docker context for this project, so
each app service points `RAILWAY_DOCKERFILE_PATH` at a root-context Dockerfile:

| Service | Railway Dockerfile path |
|---|---|
| `api` | `deploy/railway-api.Dockerfile` |
| `web` | `deploy/railway-web.Dockerfile` |
| `worker` | `deploy/railway-worker.Dockerfile` |

Required production env is documented in [`ENV_VARS.md`](ENV_VARS.md). Key placement:

| Variable | Railway service |
|---|---|
| `DATABASE_URL` | `api` |
| `OPENROUTER_API_KEY` | `api` |
| `RESEND_WEBHOOK_SECRET` | `api` |
| `RESEND_API_KEY` | `api` |
| `RESEND_INBOUND_DOMAIN` | `api` |
| `VAPID_PUBLIC_KEY` | `api` and `web` |
| `VAPID_PRIVATE_KEY` | `api` |
| `APP_SHARED_SECRET`, `SESSION_SECRET` | `api` |
| `WORKER_SERVICE_TOKEN` | `api` and `worker` |
| `API_INTERNAL_URL` | `web` and `worker` |

Do not print Railway variable values into logs or chat. Use `railway variable list --kv`
only when output is redirected to a temp file, and delete that file immediately after use.

---

## Resend Inbound Mail

Resend is configured with one enabled webhook for `email.received`:

`https://web-production-9b240.up.railway.app/webhooks/resend/inbound`

The receiving domain is `adenguo.com` (verified, receiving enabled in Resend; `RESEND_INBOUND_DOMAIN=adenguo.com`).
Resend routes any local-part at the verified domain to the webhook, so job alerts should arrive at:

`job-alerts@adenguo.com`

The owner's readable mailbox can remain `aden.guowe@gmail.com`. Configure job boards one of two
ways:

1. Send job alerts directly to `job-alerts@adenguo.com`.
2. Keep job alerts arriving at `aden.guowe@gmail.com` and add Gmail forwarding/filter rules that
   forward matching job-alert messages to `job-alerts@adenguo.com`.

Do not forward all personal mail. Use filters scoped to job-alert senders or labels.

**Body retrieval:** Resend's `email.received` webhook payload contains only metadata (from/to/
subject/`email_id`/attachments) — **not** the message body. `ParseInboundEmailJob` fetches the
text/html separately via `ResendInboundClient` (`GET /emails/receiving/{email_id}`) using
`RESEND_API_KEY`, then parses it. Without `RESEND_API_KEY`, parsing has no content and no JobPost
is ever created. Forwarded alerts (manual or Gmail-filter) are matched by the original sender found
in the forwarded `From:` line; anything the deterministic parsers can't handle falls back to LLM
extraction (`InboundEmailLlmExtractor`), and every resulting JobPost is enqueued for scoring.

---

## PWA First Use

Open the public web URL in Safari on iPhone:

`https://web-production-9b240.up.railway.app`

If unauthenticated, use the `/login` screen and enter the value of `APP_SHARED_SECRET`. Locally,
that passphrase is in ignored `api/.env`; in production it is the Railway `api` variable of the
same name.

For iOS Web Push, install the site first: Safari share button -> Add to Home Screen. Open the app
from the home-screen icon, then enable notifications from the profile/push area. Normal Safari tabs
cannot receive iOS PWA push notifications.

---

## Smoke Checks

Expected successful checks:

```bash
curl -I https://web-production-9b240.up.railway.app/
```

Should return `200`.

```bash
curl -sS -o /tmp/waunder-webhook-smoke.txt -w '%{http_code}\n' \
  -X POST https://web-production-9b240.up.railway.app/webhooks/resend/inbound \
  -H 'content-type: application/json' \
  --data '{}'
rm -f /tmp/waunder-webhook-smoke.txt
```

Should return `401`: that means the public web route reached Rails and Rails rejected the unsigned
payload. Real Resend deliveries carry Svix signatures and are validated with `RESEND_WEBHOOK_SECRET`.

Check latest production deployments:

```bash
railway deployment list --service web --environment production --json
railway deployment list --service api --environment production --json
```

The latest deployments should be `SUCCESS`.
