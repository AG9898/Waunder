/**
 * The request plumbing for the Rails API.
 *
 * Ported from `httpRailsClient`'s `get` / `sendJSON` / `do` in `web/components/client.go`
 * (see docs/GO_MIGRATION.md). This module owns transport only — URL assembly, headers,
 * status handling, and schema validation. Endpoint functions live in `endpoints.ts` (FE-05)
 * and no business logic lives on this side of the wire at all.
 *
 * Auth is a signed, **httponly** session cookie Rails sets on `POST /api/session`. The browser
 * attaches it automatically to same-origin requests; nothing here reads or writes it, and
 * nothing in the client may reach for the browser's cookie jar at all — httponly means the value
 * is not visible to JavaScript by design, and any code that tries is either broken or
 * exfiltrating. `http.test.ts` scans `src/` and fails on the attempt.
 *
 * Every path is same-origin and relative by construction: the PWA is served by the `web`
 * service, which proxies `/api/*` to Rails over Railway's private network. `assertApiPath`
 * enforces that, so the transport can never be pointed at another origin and carry the session
 * cookie there.
 */
import type { z } from "zod";

import { APIError, ResponseFormatError } from "./errors";

/** HTTP methods that carry a request body. Read requests go through `apiGet`. */
export type WriteMethod = "POST" | "PATCH" | "PUT" | "DELETE";

/** Anything a schema module exports that can validate an unknown payload into `T`. */
export type ResponseSchema<T> = z.ZodType<T>;

export interface ApiRequestOptions {
  /** Aborts the in-flight request (component unmount, superseded query). */
  signal?: AbortSignal;
}

export interface ApiSendOptions extends ApiRequestOptions {
  /** JSON request body. Omit for endpoints Rails expects with no body, e.g. `.../score`. */
  json?: unknown;
  /** Form-encoded body (`application/x-www-form-urlencoded`), as `POST /api/session` wants. */
  form?: Record<string, string>;
}

/**
 * `credentials: "same-origin"` is the current fetch default, set explicitly because it is the
 * whole auth mechanism. Never `"include"`: that would attach the owner's session cookie to a
 * cross-origin request, and every path here is same-origin by construction anyway.
 */
const CREDENTIALS = "same-origin" satisfies RequestCredentials;

const JSON_MEDIA_TYPE = "application/json";
const FORM_MEDIA_TYPE = "application/x-www-form-urlencoded";

/** GET a JSON endpoint and validate the response through its FE-03 schema. */
export function apiGet<T>(
  path: string,
  schema: ResponseSchema<T>,
  options: ApiRequestOptions = {},
): Promise<T> {
  return request(
    "GET",
    path,
    { headers: { Accept: JSON_MEDIA_TYPE }, signal: options.signal },
    schema,
  );
}

/**
 * Send a write request. With a `schema` the validated response is returned; without one the
 * response body is not read at all, matching Go's `do(req, nil)` for endpoints that answer
 * with no payload (`POST /api/session`, the push subscribe/unsubscribe pair).
 */
export function apiSend<T>(
  method: WriteMethod,
  path: string,
  schema: ResponseSchema<T>,
  options?: ApiSendOptions,
): Promise<T>;
export function apiSend(
  method: WriteMethod,
  path: string,
  schema: null,
  options?: ApiSendOptions,
): Promise<void>;
export function apiSend<T>(
  method: WriteMethod,
  path: string,
  schema: ResponseSchema<T> | null,
  options: ApiSendOptions = {},
): Promise<T | void> {
  const headers: Record<string, string> = { Accept: JSON_MEDIA_TYPE };
  let body: BodyInit | undefined;

  if (options.form !== undefined) {
    headers["Content-Type"] = FORM_MEDIA_TYPE;
    body = new URLSearchParams(options.form).toString();
  } else if (options.json !== undefined) {
    headers["Content-Type"] = JSON_MEDIA_TYPE;
    body = JSON.stringify(options.json);
  }

  const init: TransportInit = { headers, body, signal: options.signal };
  return schema === null ? request(method, path, init, null) : request(method, path, init, schema);
}

interface TransportInit {
  headers: Record<string, string>;
  body?: BodyInit;
  signal?: AbortSignal;
}

async function request<T>(
  method: string,
  path: string,
  init: TransportInit,
  schema: ResponseSchema<T>,
): Promise<T>;
async function request(
  method: string,
  path: string,
  init: TransportInit,
  schema: null,
): Promise<void>;
async function request<T>(
  method: string,
  path: string,
  init: TransportInit,
  schema: ResponseSchema<T> | null,
): Promise<T | void> {
  assertApiPath(path);

  const response = await fetch(path, {
    method,
    credentials: CREDENTIALS,
    headers: init.headers,
    ...(init.body === undefined ? {} : { body: init.body }),
    ...(init.signal === undefined ? {} : { signal: init.signal }),
  });

  if (!response.ok) {
    throw new APIError(response.status, await readText(response));
  }
  if (schema === null) return;

  const text = await readText(response);
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch (cause) {
    throw new ResponseFormatError(path, text, "body is not JSON", { cause });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ResponseFormatError(path, text, describeIssues(parsed.error), {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

/** A body that cannot be read (a torn connection mid-response) is not itself the failure. */
async function readText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

/**
 * Rejects anything that is not a relative, same-origin `/api/...` path — an absolute URL, a
 * protocol-relative `//host` URL, or a bare relative segment. The session cookie rides on every
 * request, so the destination must not be caller-controllable.
 */
function assertApiPath(path: string): void {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new TypeError(
      `api path must be a same-origin absolute path, got ${JSON.stringify(path)}`,
    );
  }
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}
