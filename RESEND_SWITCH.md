# Potential Resend Domain Switch

Temporary handoff note for a possible future switch from the current Resend
receiving domain to a portfolio-connected domain. This file is intentionally not
added to `docs/INDEX.md`; it is a planning scratchpad for a later task.

Date noted: 2026-06-17

> **DONE (2026-06-19):** The switch was executed. The single verified Resend
> receiving domain is now `adenguo.com` (verified, receiving enabled), and the
> live ingestion address is `job-alerts@adenguo.com`. `ubcpsych.com` is no longer
> in the Resend account. References to `ubcpsych.com` below are retained only as
> the pre-switch state and as the rollback target.

## Current Production State

- Waunder uses Resend for inbound job-alert email only.
- The app sends no outbound email through Resend.
- Live receiving domain: `adenguo.com` (was `ubcpsych.com` before the switch).
- Live job-alert address: `job-alerts@adenguo.com` (was `job-alerts@ubcpsych.com`).
- Public Resend webhook endpoint:
  `https://web-production-9b240.up.railway.app/webhooks/resend/inbound`
- Rails remains private in production. The public `web` service proxies
  `/webhooks/resend/inbound` to Rails over Railway private networking through
  `API_INTERNAL_URL`.

Primary docs with current live details:

- `docs/PRODUCTION_SETUP.md`
- `docs/ENV_VARS.md`
- `docs/ARCHITECTURE.md`
- `docs/DECISIONS.md` (`RESOLVED-13`)
- `AGENTS.md` discovery: "Resend webhook reaches Rails through the web proxy"

## Why Switch

The current Resend receiving domain is tied to the UBC Psych project. A domain or
subdomain connected to the owner's portfolio may be a better fit for Waunder
because it is more closely associated with the job-search/application identity.

## Resend Free-Tier Constraint

As of the current Resend pricing/docs checked on 2026-06-17:

- Free plan allows 1 custom domain.
- Pro allows 10 custom domains.
- Scale allows 1,000 custom domains.

If the Waunder Resend team stays on the free tier, adding a portfolio domain
likely means replacing/removing the current `ubcpsych.com` domain rather than
keeping both.

Reference URLs:

- https://resend.com/pricing
- https://resend.com/docs/dashboard/receiving/custom-domains
- https://resend.com/docs/knowledge-base/how-do-i-avoid-conflicting-with-my-mx-records

## Recommended Target Shape

Prefer a receiving subdomain rather than the portfolio root domain, unless the
root domain has no existing mailbox/MX setup.

Examples:

- `job-alerts@jobs.example.com`
- `job-alerts@inbound.example.com`
- `job-alerts@waunder.example.com`

Reason: Resend receiving relies on MX records. If the root portfolio domain
already has Gmail/Google Workspace/another mailbox provider, putting Resend MX
records on the root domain can disrupt or compete with normal mail delivery.
Resend recommends using a subdomain to avoid MX conflicts.

## What Must Change

### Resend Dashboard

1. Remove or disable the current `ubcpsych.com` domain if the account must stay
   on the free tier.
2. Add the new portfolio domain or subdomain.
3. Complete Resend domain verification DNS records.
4. Enable Receiving for the new domain/subdomain.
5. Add the required Resend receiving MX record.
6. Confirm the receiving record reaches `verified` state.
7. Keep or recreate the webhook endpoint for `email.received`.

The webhook URL can stay the same:

`https://web-production-9b240.up.railway.app/webhooks/resend/inbound`

Only rotate/update `RESEND_WEBHOOK_SECRET` if the webhook is recreated or moved
to a different Resend team/webhook endpoint.

### DNS

Add the DNS records Resend provides for the new domain/subdomain.

For receiving, the important record is the MX record for the exact receiving
domain/subdomain. Do not add a receiving MX record to the portfolio root domain
unless intentionally routing root-domain mail to Resend.

If the target is `jobs.example.com`, the MX record should be scoped to `jobs`,
not `@`.

### Railway Variables

Update the `api` service:

- `RESEND_INBOUND_DOMAIN=<new receiving domain/subdomain>`

Usually unchanged:

- `RESEND_WEBHOOK_SECRET`

Change `RESEND_WEBHOOK_SECRET` only if Resend generates a new Svix signing
secret for a newly created webhook.

No expected change:

- `API_INTERNAL_URL`
- `APP_SHARED_SECRET`
- `SESSION_SECRET`
- `WORKER_SERVICE_TOKEN`
- `OPENROUTER_*`
- VAPID keys

### Job Alert Routing

Update whichever source currently feeds job alerts:

- LinkedIn job alerts
- Indeed job alerts
- Glassdoor job alerts
- Gmail filters/forwarding rules

The target should change from:

`job-alerts@ubcpsych.com`

to the chosen new address, for example:

`job-alerts@jobs.example.com`

Do not forward all personal mail. Keep forwarding scoped to job-alert senders,
labels, or filters.

### Repository Docs

If/when the switch becomes real, update at least:

- `docs/PRODUCTION_SETUP.md`
  - Live URLs table: job-alert ingestion address.
  - Resend Inbound Mail section: receiving domain and address.
- `docs/ENV_VARS.md`
  - Only if the description/example should mention the actual chosen domain.
- `AGENTS.md`
  - Append a discovery if the switch reveals a setup gotcha.

Do not update `docs/INDEX.md` for this temporary `RESEND_SWITCH.md` scratchpad.

## Expected Code Impact

Likely no code change is needed.

The webhook path is domain-agnostic:

- `web/main.go` proxies `/webhooks/resend/inbound`.
- `api/config/routes.rb` routes `POST /webhooks/resend/inbound`.
- `api/app/controllers/webhooks/resend_controller.rb` validates the Svix
  signature and ingests any `email.received` payload.

The Rails webhook controller does not currently enforce a specific recipient
domain. `RESEND_INBOUND_DOMAIN` is reference/config, not a runtime gate in the
current code.

## Validation Checklist

After switching:

1. Confirm DNS verification in Resend.
2. Confirm Receiving is enabled and verified for the new domain/subdomain.
3. Confirm the Resend webhook is enabled for `email.received`.
4. Smoke test the public proxy route:

   ```bash
   curl -sS -o /tmp/waunder-webhook-smoke.txt -w '%{http_code}\n' \
     -X POST https://web-production-9b240.up.railway.app/webhooks/resend/inbound \
     -H 'content-type: application/json' \
     --data '{}'
   rm -f /tmp/waunder-webhook-smoke.txt
   ```

   Expected result: `401`, because unsigned payloads should reach Rails and then
   be rejected.

5. Send a real test email to the new job-alert address.
6. Confirm Resend logs show the inbound email and webhook delivery.
7. Confirm Rails creates an `InboundEmail` and enqueues/parses it.
8. Confirm a known sender alert still becomes a normalized/scored `JobPost`.

## Rollback

If the new domain does not verify or inbound delivery fails:

1. Re-enable or re-add the old `ubcpsych.com` domain in Resend if still
   available under the plan.
2. Restore `RESEND_INBOUND_DOMAIN=ubcpsych.com` on the Railway `api` service.
3. Restore job-board/Gmail forwarding destinations to `job-alerts@ubcpsych.com`.
4. Keep the webhook URL unchanged unless the webhook itself was recreated.

## Open Decisions

- Exact portfolio domain or subdomain to use.
- Whether to stay on Resend free tier and replace the existing domain, or upgrade
  to keep both domains.
- Whether the new address should be generic (`job-alerts@...`) or branded
  (`waunder@...`, `alerts@...`, etc.).
