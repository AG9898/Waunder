# Waunder worker

Node + TypeScript + [Playwright](https://playwright.dev) automation worker. It
receives **approved** application tasks from the Rails API, fills supported ATS
forms from structured payloads, and reports status, logs, and screenshots back.

It never submits sensitive answers (salary, sponsorship, demographic, identity,
etc.) unless the user explicitly provided and approved them, and it pauses/fails
safely on unknown fields. See `../initial_plan.md` (Core Worker Responsibilities).

## Layout

```
workers/
  src/
    index.ts        # entry point (config + poll loop)
    config.ts       # env-sourced configuration
    worker.ts       # processTask(): dispatch a task to its ATS handler
    types.ts        # ApplicationTask / TaskResult shapes
    safety.ts       # sensitive-field detection + partitioning
    ats/
      index.ts      # AtsHandler interface + handler registry
    safety.test.ts  # unit tests for the safety guard
  Dockerfile        # Playwright base image, for Railway deployment
```

## Local development

```bash
npm install
npm run typecheck     # tsc --noEmit
npm test              # node test runner (via tsx)
npm run dev           # run the worker with reload (tsx watch)
```

To actually drive browsers locally, install them once:

```bash
npx playwright install --with-deps chromium
```

The Docker image already includes the browsers.

## Environment

- `API_INTERNAL_URL` — Rails API base URL (task source + status reporting).
  When unset, the worker logs readiness and exits (no task source).
- `WORKER_SERVICE_TOKEN` — bearer token shared with Rails. Required when
  `API_INTERNAL_URL` is set.
- `WORKER_POLL_INTERVAL_MS` — task poll interval (default `15000`).
- `WORKER_HEADLESS` — set to `false` to run headed locally (default headless).

## Status

The worker loads env config, polls Rails for approved tasks, dispatches each
task to the ATS handler registry, and reports terminal task results back to
Rails with bearer authentication. Per-ATS handlers (Greenhouse, Lever, Ashby,
and the feature-flagged LinkedIn Easy Apply) are still implemented separately.
