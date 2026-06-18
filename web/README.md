# Waunder web (PWA)

Go + [go-app](https://go-app.dev) WebAssembly PWA, plus a small Go server that
serves the app shell and proxies `/api` to the Rails backend.

## Layout

```
web/
  main.go            # routing + server (app.Handler) + /api reverse proxy
  components/        # go-app UI components
  web/               # static resources, served under /web/ (app.wasm, app.css, fonts/ live here)
  Dockerfile         # two-target build: WASM frontend + native server
  Makefile           # wasm / server / run helpers
```

The same `main` package is compiled twice: once to WebAssembly
(`GOOS=js GOARCH=wasm`) for the browser, and once to a native binary for the
server. `app.RunWhenOnBrowser()` makes the client path take over in the browser.

## Local development

Requires the Go toolchain (`go` on PATH).

```bash
make run        # builds static/app.wasm + server, runs on :8000
```

Then open http://localhost:8000.

go-app's `Handler` auto-serves the generated `wasm_exec.js`, `app.js`, service
worker, and web manifest — only `app.wasm` is a build artifact.

Visual styling is plain CSS loaded by `app.Handler.Styles` from `/web/app.css`.
The canonical frontend style rules live in `../docs/STYLE_GUIDE.md`; the design
handoff under `../reference/design_handoff_waunder_css/` is reference material,
not app markup.

Hanken Grotesk is self-hosted as a single variable-font WOFF2 asset at
`web/fonts/hanken-grotesk.woff2` (latin subset, weights 400-700), referenced
from `app.css` via `@font-face` and served by go-app's default `/web/` static
file convention — no live Google Fonts dependency, so the offline-tolerant
PWA shell does not depend on a third-party font CDN at runtime.

## Environment

- `PORT` — server listen port (default `8000`; Railway sets this).
- `API_INTERNAL_URL` — base URL of the Rails API. When set, `/api/*` is
  reverse-proxied there (same-origin, no CORS). When unset, the proxy is
  disabled and the PWA serves standalone.

## Deployment

Built from `Dockerfile` as a Railway service. See `../initial_plan.md`
(Deployment section) for the full topology.
