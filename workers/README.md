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
    index.ts        # entry point (config + readiness; poll loop TODO)
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
- `WORKER_POLL_INTERVAL_MS` — task poll interval (default `15000`).
- `WORKER_HEADLESS` — set to `false` to run headed locally (default headless).

## Status

Skeleton: types, safety guard, ATS handler registry, and entry point are in
place. The poll loop and per-ATS handlers (Greenhouse, Lever, Ashby, and the
feature-flagged LinkedIn Easy Apply) come next, alongside the Rails task API.
