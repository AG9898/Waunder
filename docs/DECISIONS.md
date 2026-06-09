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

### OPEN-02 — Single-user auth / session model for `POST /api/session`

**Question:** What credential issuance and verification mechanism should back the single-user session at `POST /api/session`?

**Context:** Waunder is single-user and same-origin behind the Go web proxy (browser only ever talks to the web origin; `/api/*` is proxied to Rails, which has no public domain). That removes CORS concerns but does not specify how the user authenticates or how the session is represented. The worker also needs an authenticated channel to pull approved tasks from Rails, so whatever is chosen must cover service-to-service auth too.

**Options under consideration:**
1. **Shared-secret session cookie** — single passphrase exchanged for a signed cookie. Tradeoff: simplest; secret management and cookie scoping must be correct.
2. **Token-based** — issue a signed token (e.g. JWT/opaque) used as a bearer for both browser and worker. Tradeoff: uniform for service-to-service auth; token lifecycle/rotation to manage.
3. **OS-level / device-bound** — bind the session to the installed PWA / device. Tradeoff: strongest device binding; more complex on iOS PWA.

**Blocking:** All protected API endpoints (everything under `/api` except health) and the worker's authenticated task pull.

**See also:** [`ARCHITECTURE.md`](ARCHITECTURE.md), Initial API Surface in [`PRD.md`](PRD.md)

---

### OPEN-03 — Ship LinkedIn Easy Apply trusted-submit in the MVP?

**Question:** Should LinkedIn Easy Apply trusted-submit be included in the MVP, or deferred to a later phase?

**Context:** The plan flags LinkedIn Easy Apply as higher-risk than the ATS targets (Greenhouse, Lever, Ashby) and requires it to sit behind an explicit feature flag (`LINKEDIN_EASY_APPLY_ENABLED`). The other trusted-submit targets are lower-risk and are in scope per RESOLVED-12.

**Options under consideration:**
1. **Ship behind a flag (default off) in MVP** — code present but disabled until manually enabled. Tradeoff: ready to enable; carries the higher-risk surface in the MVP codebase.
2. **Defer to a later phase** — exclude entirely from MVP. Tradeoff: smaller, lower-risk MVP; LinkedIn submit comes later.

**Blocking:** Nothing currently blocked; affects worker scope for the MVP.

**See also:** RESOLVED-12, [`PRD.md`](PRD.md), [`ENV_VARS.md`](ENV_VARS.md)

---

### OPEN-04 — Timing of manual job/link entry fallback

**Question:** Should lightweight manual job/link entry land in Phase 1, or be deferred to Phase 2?

**Context:** Email ingestion via Mailgun is the first discovery path (RESOLVED-05), but it will miss postings the user finds directly. The plan defers manual entry to "later." Manual entry is the fallback for those misses.

**Options under consideration:**
1. **Include lightweight manual entry in Phase 1** — small form to add a job by URL/paste. Tradeoff: covers ingestion gaps immediately; small added scope up front.
2. **Defer to Phase 2** — rely solely on email ingestion for the MVP. Tradeoff: leaner MVP; user cannot capture self-found jobs until later.

**Blocking:** Nothing currently blocked.

**See also:** RESOLVED-05, [`PRD.md`](PRD.md)

---

### OPEN-05 — Default OpenRouter model and per-task tiering

**Question:** What should the default OpenRouter model be, and should scoring and drafting use the same model or separate cost/quality tiers?

**Context:** The model is environment-configurable via `OPENROUTER_MODEL` (RESOLVED-06), but a sensible default is undecided, as is whether cheaper scoring/summarization and higher-quality drafting should run on different models.

**Options under consideration:**
1. **Single default model** — one `OPENROUTER_MODEL` for all LLM tasks. Tradeoff: simplest config; either over-pays on cheap tasks or under-serves quality on hard ones.
2. **Per-task model tiers** — separate models for scoring/summarization vs. cover-letter/draft generation. Tradeoff: better cost/quality balance; more configuration and routing logic.

**Blocking:** Nothing currently blocked.

**See also:** RESOLVED-06, [`ENV_VARS.md`](ENV_VARS.md)

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

**Why:** Submitting an application is an irreversible, identity-bearing action; gating it on explicit per-application approval and auditable status prevents unintended or incorrect submissions. LinkedIn Easy Apply is higher-risk and sits behind an explicit feature flag (see OPEN-03).

**Alternatives rejected:** Fully autonomous submission without per-application approval — unacceptable risk of incorrect or unwanted applications.

**Affects:** `workers/` (safety gating), [`PRD.md`](PRD.md), [`CONVENTIONS.md`](CONVENTIONS.md). See also OPEN-03.
