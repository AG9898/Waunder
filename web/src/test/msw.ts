/**
 * MSW harness shared by every test that crosses the API boundary.
 *
 * Requests are intercepted at the network layer, so the code under test runs the real `fetch`
 * path — headers, credentials, status handling, and body parsing all execute exactly as they do
 * in the browser. That is the point: a hand-stubbed `fetch` would let a transport bug through.
 *
 * The paths are relative (`/api/...`), same as the app sends. Vitest's jsdom environment gives
 * them an origin to resolve against, so handlers match without hardcoding a host.
 *
 * Usage — call `installMockApi()` once at the top level of a test file, then add per-test handlers
 * with `server.use(...)`. They are reset after each test:
 *
 * ```ts
 * const server = installMockApi();
 * it("reads the feed", async () => {
 *   server.use(jsonResponse("get", "/api/job_posts", { job_posts: [] }));
 * });
 * ```
 */
import {
  HttpResponse,
  http,
  type HttpHandler,
  type HttpResponseResolver,
  type JsonBodyType,
} from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll } from "vitest";

export { HttpResponse, http };
export type { HttpHandler, JsonBodyType };

/**
 * The shared interceptor. Exported for `server.use(...)` inside a test; the lifecycle is owned
 * by `installMockApi()`.
 */
export const server = setupServer();

/** HTTP methods the harness can register a handler for. */
export type MockMethod = "get" | "post" | "patch" | "put" | "delete";

/**
 * Installs the MSW lifecycle for the calling test file and returns the server.
 *
 * `onUnhandledRequest: "error"` is deliberate: an unmocked request means the test is exercising
 * a path nobody described, and silently letting it hit the network is how a suite starts
 * depending on a live Rails.
 */
export function installMockApi(...handlers: HttpHandler[]): typeof server {
  beforeAll(() => {
    server.listen({ onUnhandledRequest: "error" });
  });
  afterEach(() => {
    server.resetHandlers(...handlers);
  });
  afterAll(() => {
    server.close();
  });
  server.use(...handlers);
  return server;
}

/** A handler answering `path` with `body` as JSON and `status` (default 200). */
export function jsonResponse(
  method: MockMethod,
  path: string,
  body: JsonBodyType,
  status = 200,
): HttpHandler {
  return handler(method, path, () => HttpResponse.json(body, { status }));
}

/**
 * A handler answering with Rails' `{error: {code, message}}` envelope at `status`. This is the
 * shape every Rails failure path uses, so error-branch tests should reach for it rather than
 * hand-rolling a body.
 */
export function errorResponse(
  method: MockMethod,
  path: string,
  status: number,
  code: string,
  message: string,
): HttpHandler {
  return handler(method, path, () => HttpResponse.json({ error: { code, message } }, { status }));
}

/** A handler answering with a raw, non-JSON body — a proxy error page, an HTML 502, and so on. */
export function textResponse(
  method: MockMethod,
  path: string,
  body: string,
  status = 200,
): HttpHandler {
  return handler(method, path, () =>
    HttpResponse.text(body, { status, headers: { "Content-Type": "text/html" } }),
  );
}

/** A handler that captures the intercepted `Request` so a test can assert on what was sent. */
export function captureRequest(
  method: MockMethod,
  path: string,
  received: { request?: Request },
  body: JsonBodyType = {},
): HttpHandler {
  return handler(method, path, ({ request }) => {
    received.request = request.clone();
    return HttpResponse.json(body);
  });
}

function handler(method: MockMethod, path: string, resolver: HttpResponseResolver): HttpHandler {
  return http[method](path, resolver);
}
