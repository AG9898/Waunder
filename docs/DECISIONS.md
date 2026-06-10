# DECISIONS.md — Architectural Decision Log

> **Open decisions:** Do not resolve without explicit instruction from the project owner.
>
> **To resolve an open decision:**
> 1. Move the block to the Resolved section.
> 2. Fill in the `Resolved` date and `Decision` / `Why` fields.
> 3. Update any docs affected ([ARCHITECTURE.md](ARCHITECTURE.md), [CONVENTIONS.md](CONVENTIONS.md), etc.).
> 4. Update this file in the same commit.
>
> **To add a new open decision:** copy the template below and assign the next OPEN-XX number.
> To add a resolved decision: copy the resolved template and assign the next RESOLVED-XX number.

---

## Open Decision Template

```
### OPEN-XX — <Short Decision Title>

**Question:** <What needs to be decided? State it as a precise question.>

**Context:** <Why does this matter? What are the constraints or tradeoffs involved?
What existing code or docs does this affect?>

**Options under consideration:**
1. **Option A** — description. Tradeoff: ...
2. **Option B** — description. Tradeoff: ...

**Blocking:** <What tasks or features are blocked until this is resolved? Or "Nothing currently blocked.">

**See also:** <links to related docs or tasks>
```

---

## Resolved Decision Template

```
### RESOLVED-XX — <Short Decision Title>

**Resolved:** YYYY-MM-DD

**Decision:** <The choice that was made. State it precisely.>

**Why:** <The rationale. What constraints, data, or priorities drove this choice?>

**Alternatives rejected:** <What was considered and why it was ruled out.>

**Affects:** <Which parts of the system or which docs are impacted. Link them.>
```

---

## Open Decisions

### OPEN-01 — Background job backend: solid_queue vs. Redis + Sidekiq

**Question:** When, if ever, should Waunder introduce Redis + Sidekiq in place of (or alongside) the database-backed solid_queue?

**Context:** solid_queue is database-backed (Postgres) and is sufficient for the current workload — a once-daily push digest plus low-volume, user-approved submit dispatches. Adding Redis means another Railway service and ongoing infra cost. This is the inverse of the decision locked in RESOLVED-10: it only reopens if job volume or latency needs grow beyond what database-backed queuing handles.

**Options under consideration:**
1. **Stay on solid_queue** — no Redis. Tradeoff: zero added infra; may hit throughput/latency limits if scheduled job volume grows.
2. **Add Redis + Sidekiq** — when volume or latency demands it. Tradeoff: faster/higher-throughput queuing at the cost of an extra Railway service, a `REDIS_URL`, and operational surface.

**Blocking:** Nothing currently blocked.

**See also:** RESOLVED-10, [`ARCHITECTURE.md`](ARCHITECTURE.md), [`ENV_VARS.md`](ENV_VARS.md)

---

## Resolved Decisions

### RESOLVED-01 — Frontend is a go-app WebAssembly PWA, not a native iOS app

**Resolved:** 2026-06-09

**Decision:** Build the frontend as a Go + go-app WebAssembly Progressive Web App, installable to the iPhone home screen. No native iOS build.

**Why:** Waunder is a solo, single-user app. The Apple native pipeline (Apple Developer account, macOS/Xcode signing, TestFlight distribution) buys nothing here. A PWA installs to the home screen with its own icon, runs full-screen standalone, and supports web push — without that overhead.

**Alternatives rejected:** Native iOS app distributed via the App Store / TestFlight — rejected for the toolchain and distribution cost with no single-user benefit.

**Affects:** [`ARCHITECTURE.md`](ARCHITECTURE.md), the `web/` service.

---

### RESOLVED-02 — Hosting on Railway: three services plus managed PostgreSQL

**Resolved:** 2026-06-09

**Decision:** Host on Railway as three services in one project — `web` (Go + go-app PWA server), `api` (Rails API), and `worker` (Playwright automation) — plus managed PostgreSQL, communicating over Railway's private network.

**Why:** A single Railway project keeps the three services co-located and able to talk over the private network without traversing the public internet, with managed Postgres avoiding self-hosted database operations.

**Alternatives rejected:** Multi-provider or self-managed hosting — unnecessary operational overhead for a single-user app.

**Affects:** [`ARCHITECTURE.md`](ARCHITECTURE.md) (deployment), [`ENV_VARS.md`](ENV_VARS.md).

---

### RESOLVED-03 — The web Go server reverse-proxies `/api/*` to Rails over the private network

**Resolved:** 2026-06-09

**Decision:** The `web` Go server reverse-proxies all `/api/*` requests server-side to the `api` service over Railway's private network. The browser only ever talks to the `web` origin.

**Why:** Keeps the frontend same-origin (no CORS), keeps service-worker scope and web-push registration clean, and means the Rails API needs no public domain. The Rails base URL is supplied via the `API_INTERNAL_URL` environment variable.

**Alternatives rejected:** Exposing Rails on its own public domain and having the browser call it cross-origin — would require CORS handling and complicate service-worker/push scope.

**Affects:** [`web/main.go`](../web/main.go), [`ARCHITECTURE.md`](ARCHITECTURE.md), `API_INTERNAL_URL` in [`ENV_VARS.md`](ENV_VARS.md).

---

### RESOLVED-04 — Notifications via the Web Push API (VAPID), not FCM/APNs

**Resolved:** 2026-06-09

**Decision:** Deliver notifications through the Web Push API using VAPID keys, dispatched to the service worker that go-app generates. This replaces the earlier FCM/APNs plan.

**Why:** Web Push is PWA-native and requires no native push infrastructure. A once-daily digest fits its delivery characteristics.

**Alternatives rejected:** FCM / APNs — require native push infra and tie back to the native pipeline rejected in RESOLVED-01.

**Constraint:** iOS web push requires iOS 16.4+ and the PWA to be installed to the home screen; the notification flow must detect and guide the user through install when push is requested.

**Affects:** `web/` (push subscription flow, service worker), `api/` (push dispatch), VAPID keys in [`ENV_VARS.md`](ENV_VARS.md).

---

### RESOLVED-05 — First job-discovery path is forwarded job-alert emails via Mailgun

**Resolved:** 2026-06-09

**Decision:** The first ingestion path is forwarded job-alert emails received through Mailgun inbound routes, parsed into normalized job records. Broad scraping is out of scope as the first path.

**Why:** Forwarded alerts from known senders (LinkedIn, Indeed, Glassdoor) have stable formats that can be parsed deterministically, and avoid the fragility and policy risk of broad scraping.

**Alternatives rejected:** Broad web scraping as the first ingestion path — higher fragility, maintenance, and policy risk.

**Affects:** `api/` (Mailgun inbound webhook handling, `POST /webhooks/mailgun/inbound`), [`PRD.md`](PRD.md) scope.

**Superseded by:** RESOLVED-13 (2026-06-09) — the inbound email *provider* changed from Mailgun to Resend (`POST /webhooks/resend/inbound`, Svix-signed). The email-first, deterministic-parse ingestion principle from this decision still holds; only the vendor and webhook/signature mechanics changed.

---

### RESOLVED-06 — LLM provider is OpenRouter, model configurable by env var

**Resolved:** 2026-06-09

**Decision:** Use OpenRouter as the LLM gateway, requesting structured JSON responses where supported. The model is configurable per environment via `OPENROUTER_MODEL`.

**Why:** OpenRouter provides a single gateway across models, and keeping the model env-configurable allows cost/quality tuning without code changes.

**Alternatives rejected:** Hardcoding a single provider/model — would couple the app to one vendor and require code changes to tune.

**Affects:** `api/` (LLM orchestration), `OPENROUTER_*` in [`ENV_VARS.md`](ENV_VARS.md).

---

### RESOLVED-07 — Sensitive resume/profile fields encrypted at rest

**Resolved:** 2026-06-09

**Decision:** Encrypt sensitive resume/profile fields at rest using Active Record Encryption.

**Why:** This is a single-user private app holding personal resume/profile data; encrypting sensitive fields at rest limits exposure if the database is compromised.

**Alternatives rejected:** Storing sensitive fields in plaintext — unacceptable for personal data.

**Affects:** `api/` models, Active Record Encryption keys in [`ENV_VARS.md`](ENV_VARS.md), [`CONVENTIONS.md`](CONVENTIONS.md).

---

### RESOLVED-08 — Prefer deterministic scripts over LLM where formats are predictable

**Resolved:** 2026-06-09

**Decision:** Where input formats are predictable, use deterministic scripts rather than LLM calls — ATS route detection from URL patterns, ATS detection from careers-page content, known-sender email parsing, application route-preference ranking, and form fill for supported ATS platforms. Fall back to the LLM only when no pattern matches or the input is novel/unstructured.

**Why:** Deterministic logic is cheaper and more reliable than LLM calls for structured, recognizable input.

**Alternatives rejected:** Routing all parsing/detection through the LLM — higher cost and lower reliability for structured input.

**Affects:** `workers/` (form fill, ATS detection), `api/` (parsing, route ranking).

---

### RESOLVED-09 — Prefer canonical employer/ATS application routes over job-board automation

**Resolved:** 2026-06-09

**Decision:** Separate where a job was discovered from where it should be submitted, and prefer canonical employer/ATS routes when they can be found. Preference order: Direct ATS / company application URL > company careers page > job-board external apply URL > LinkedIn Easy Apply / Indeed Apply / Glassdoor Apply > manual apply only.

**Why:** Canonical ATS routes are more stable and lower-risk to automate than job-board account automation. Example: a Glassdoor posting that links to Greenhouse is a Glassdoor discovery source with Greenhouse as the preferred application route.

**Alternatives rejected:** Always applying through the discovery source / job-board account — more fragile and higher-risk than the underlying ATS.

**Affects:** `ApplicationRoute` resolution in `api/`, [`PRD.md`](PRD.md), [`ARCHITECTURE.md`](ARCHITECTURE.md).

---

### RESOLVED-10 — Database-backed background jobs (solid_queue) initially

**Resolved:** 2026-06-09

**Decision:** Use database-backed background jobs via solid_queue (with solid_cache and solid_cable) initially, with no Redis. Introduce Redis/Sidekiq only if job needs outgrow database-backed queuing.

**Why:** Postgres-backed queuing is sufficient for a once-daily digest and low submit volume, and avoids the cost and operational surface of an additional Redis service.

**Alternatives rejected:** Standing up Redis + Sidekiq from day one — premature infra for the current workload.

**Affects:** `api/` (jobs, cache, cable), conditional `REDIS_URL` in [`ENV_VARS.md`](ENV_VARS.md). See also OPEN-01.

---

### RESOLVED-11 — Repository is a monorepo

**Resolved:** 2026-06-09

**Decision:** Waunder is a single monorepo containing `web/`, `api/`, `workers/`, and `docs/`.

**Why:** A single repo keeps the three tightly-coupled services and shared docs versioned together for a solo project, simplifying coordination of cross-service changes.

**Alternatives rejected:** Separate repositories per service — more coordination overhead for no single-developer benefit.

**Affects:** Repository structure (see [`AGENTS.md`](../AGENTS.md)), [`ARCHITECTURE.md`](ARCHITECTURE.md).

---

### RESOLVED-12 — Trusted automated submit only after explicit per-application approval

**Resolved:** 2026-06-09

**Decision:** Automated trusted submit is allowed only when all hold: the user explicitly approves the prepared application (per application), the target platform is supported, the form contains no unknown or sensitive fields requiring manual review, and the worker can produce an auditable status result. Initial targets: Greenhouse, Lever, Ashby, and LinkedIn Easy Apply.

**Why:** Submitting an application is an irreversible, identity-bearing action; gating it on explicit per-application approval and auditable status prevents unintended or incorrect submissions. LinkedIn Easy Apply is higher-risk and sits behind an explicit feature flag (see RESOLVED-15).

**Alternatives rejected:** Fully autonomous submission without per-application approval — unacceptable risk of incorrect or unwanted applications.

**Affects:** `workers/` (safety gating), [`PRD.md`](PRD.md), [`CONVENTIONS.md`](CONVENTIONS.md). See also RESOLVED-15.

---

### RESOLVED-13 — Inbound email provider is Resend (inbound-only), replacing Mailgun

**Resolved:** 2026-06-09

**Decision:** Use Resend for inbound job-alert email ingestion. Forwarded alerts hit a Resend-verified receiving domain; Resend parses them and POSTs an `email.received` event to Rails at `POST /webhooks/resend/inbound`, verified via the Svix signature headers (`svix-id`, `svix-timestamp`, `svix-signature`). This supersedes the Mailgun choice in RESOLVED-05. Outbound email is **out of scope** for the MVP — the app sends no email (owner notifications are Web Push per RESOLVED-04, LinkedIn outreach is manual-send per RESOLVED-12), so no Resend sending domain or `RESEND_API_KEY` is configured.

**Why:** Resend supports inbound parsing with Svix-signed webhooks and durable storage if the webhook is down, with simpler DX than Mailgun for this single-user app. Since Waunder never sends email, only the inbound surface is wired.

**Alternatives rejected:** Mailgun inbound (RESOLVED-05) — superseded for DX. Adding Resend outbound — unused surface for the MVP; revisit only if an email digest fallback to Web Push is ever wanted (Phase 2).

**Affects:** `api/` (`POST /webhooks/resend/inbound`, Svix signature validation), `RESEND_WEBHOOK_SECRET` / `RESEND_INBOUND_DOMAIN` in [`ENV_VARS.md`](ENV_VARS.md), [`ARCHITECTURE.md`](ARCHITECTURE.md), [`PRD.md`](PRD.md).

---

### RESOLVED-14 — Single-user auth: shared-secret session cookie + worker bearer token

**Resolved:** 2026-06-09

**Decision:** Authenticate the single owner via a shared passphrase exchanged at `POST /api/session` for a signed, HTTP-only session cookie; `Api::BaseController` enforces the session on all `/api` endpoints except health. The worker authenticates service-to-service with a static `WORKER_SERVICE_TOKEN` bearer on its task-pull/report endpoints. This resolves the former OPEN-02 to its Option 1.

**Why:** Simplest model that fits a single-user, same-origin app behind the Go proxy. The shared secret (`APP_SHARED_SECRET`) plus a cookie-signing secret (`SESSION_SECRET`) cover the browser; a separate worker token cleanly scopes machine-to-machine access without entangling it with the human session.

**Alternatives rejected:** Single bearer token for both browser and worker (Option 2) — conflates human and machine sessions. Device-bound PWA session (Option 3) — more complex on iOS PWA for no single-user benefit.

**Affects:** `api/` (`Api::BaseController`, `POST /api/session`, worker auth guard), `APP_SHARED_SECRET` / `SESSION_SECRET` / `WORKER_SERVICE_TOKEN` in [`ENV_VARS.md`](ENV_VARS.md), [`ARCHITECTURE.md`](ARCHITECTURE.md) (Auth), [`CONVENTIONS.md`](CONVENTIONS.md).

---

### RESOLVED-15 — Ship LinkedIn Easy Apply trusted-submit behind a flag (default off) in the MVP

**Resolved:** 2026-06-09

**Decision:** Include the LinkedIn Easy Apply worker handler in the MVP codebase, gated behind `LINKEDIN_EASY_APPLY_ENABLED` (default `false`). The Greenhouse/Lever/Ashby handlers ship enabled. This resolves the former OPEN-03 to its Option 1.

**Why:** Keeps the higher-risk path present and ready to enable without exposing it by default, while the lower-risk ATS targets carry the MVP.

**Alternatives rejected:** Deferring LinkedIn Easy Apply entirely — would require a later re-integration pass; the flag default-off already neutralizes the risk.

**Affects:** `workers/` (`src/ats/`), `LINKEDIN_EASY_APPLY_ENABLED` in [`ENV_VARS.md`](ENV_VARS.md), [`PRD.md`](PRD.md). See also RESOLVED-12.

---

### RESOLVED-16 — Include lightweight manual job/link entry in Phase 1

**Resolved:** 2026-06-09

**Decision:** Add a lightweight manual job/link entry path (an authenticated endpoint plus a small PWA form) in Phase 1 as a fallback to email ingestion, so the owner can capture self-found postings. The submitted URL/paste flows into the same normalize → route-resolve → score pipeline. This resolves the former OPEN-04 to its Option 1.

**Why:** Email ingestion misses postings the owner finds directly; a small manual-entry surface closes that gap immediately for little added scope.

**Alternatives rejected:** Deferring to Phase 2 — leaves an ingestion gap through the entire MVP.

**Affects:** `api/` (manual-entry endpoint), `web/` (entry form), [`PRD.md`](PRD.md).

---

### RESOLVED-17 — Single OpenRouter model; default `google/gemma-4-31b-it:free`

**Resolved:** 2026-06-09

**Decision:** Use a single `OPENROUTER_MODEL` for all LLM calls (scoring, summaries, drafts) — no per-task model tiers. The default is `google/gemma-4-31b-it:free`, staying on OpenRouter's free tier. This resolves the former OPEN-05 to its Option 1. Because free-tier models impose rate limits and looser structured-output guarantees, the OpenRouter client requests structured JSON where supported and degrades gracefully (retry / parse-fallback) rather than assuming strict schema enforcement.

**Why:** Single-user, cost-sensitive app; a free model keeps spend at zero and one model keeps configuration and routing simple. Per-task tiering is premature.

**Alternatives rejected:** Per-task model tiers (Option 2) — extra config/routing for no current benefit. A paid default — unnecessary spend for the MVP.

**Affects:** `api/` (OpenRouter client, scoring/draft jobs), `OPENROUTER_MODEL` default in [`ENV_VARS.md`](ENV_VARS.md). See also RESOLVED-06.

### RESOLVED-18 — Resume comes from the portfolio's JSON Resume via push-on-export, not PDF parsing

**Resolved:** 2026-06-10

**Decision:** The owner's external portfolio project (`My_Portfolio`, a Next.js app) is the single source of truth for the resume. It maintains a canonical JSON Resume object (`src/data/resume.json`) and exports `cv.pdf` + `CV_AG.md`. A `sync:resume` step in its export pipeline pushes all three artifacts to Waunder at `POST /api/profile/resume` (authenticated by opening a shared-secret session). Rails maps them **deterministically** into the singleton `Profile` and a primary `ResumeDocument` via `ResumeJsonImporter` — **no LLM and no PDF/OCR parsing** — because the JSON is already clean structure. The JSON becomes `parsed_structure`, the markdown becomes `raw_text`, and the PDF is attached via Active Storage as the file a worker uploads to an ATS form. This reshapes PROFILE-01 from "upload a PDF and LLM-parse it" to "ingest a JSON Resume + PDF and map it." A manual upload UI (WEB-04) remains a fallback on the same endpoint.

**Why:** The portfolio already produces clean, canonical structured data; re-deriving it by OCR/LLM-parsing the exported PDF would be strictly lossy and add cost/failure surface for no benefit. Push-on-export triggers a sync exactly when the resume changes, needs no polling job, and never exposes the resume JSON (which carries email/phone PII) at a public URL.

**Alternatives rejected:** Upload-and-parse a PDF (original PROFILE-01 scope) — lossy and unnecessary given canonical JSON exists. Pull from a published portfolio URL — requires exposing PII-bearing JSON and a polling/refresh job. Local file import (`../My_Portfolio`) — works only in dev; the portfolio repo is absent in Railway production. Active Storage local disk is ephemeral on Railway, accepted because the portfolio re-pushes the PDF on every export (self-healing); object storage is the durable upgrade if needed later.

**Affects:** `api/` (`ResumeJsonImporter`, `Api::ProfileController`, `Api::ResumeDocumentsController`, Active Storage, routes), the external `My_Portfolio` repo (`scripts/sync-resume.js`, `sync:resume`/`publish:resume` npm scripts, its own `ENV_VARS.md`/`ARCHITECTURE.md`), [`ARCHITECTURE.md`](ARCHITECTURE.md), [`CONVENTIONS.md`](CONVENTIONS.md), PROFILE-01/WEB-04 on the workboard. See also RESOLVED-07, RESOLVED-08, RESOLVED-16.
