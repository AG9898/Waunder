/**
 * Typed errors for the Rails API boundary.
 *
 * Ported from the `APIError` / `IsUnauthorized` / `APIErrorCode` / `APIErrorMessage` block in
 * `web/components/client.go` (see docs/GO_MIGRATION.md). Screens branch on the *code*, not on
 * the prose: `draft.go` maps `unsafe_payload` / `unsupported_ats` / `draft_required` to
 * owner-facing copy, and every screen routes back to the login flow on a 401.
 *
 * Two error kinds, deliberately distinct:
 *
 * - `APIError` — Rails answered, with a non-2xx status. Recoverable and meaningful: it carries
 *   the status plus the `{error: {code, message}}` envelope Rails sends.
 * - `ResponseFormatError` — Rails answered 2xx but the body was not the shape the caller asked
 *   for (not JSON at all, or a payload the FE-03 schema rejected). This is a contract break, not
 *   a user-recoverable condition, and it is a *new* signal: Go's `json.Unmarshal` zero-valued a
 *   mismatch in silence, which is how the empty Applications table shipped.
 *
 * Transport failures (offline, DNS, aborted request) are not wrapped — `fetch` rejects with the
 * platform's own `TypeError` / `AbortError`, matching Go returning the transport error unwrapped.
 */
import { ApiErrorPayloadSchema } from "./schemas";

/** Matches Go's `io.LimitReader(resp.Body, 2048)` on the error path. */
const MAX_ERROR_BODY = 2048;

/**
 * A non-2xx response from Rails.
 *
 * `message` is the human-facing string: Rails' own envelope message when it sent one, otherwise
 * the same `api request failed: status N[: body]` text Go's `APIError.Error()` produced. `code`
 * is the machine-readable envelope code (`""` when the body is not the Rails envelope), and
 * `body` keeps the raw text for logging.
 */
export class APIError extends Error {
  override readonly name = "APIError";

  /** HTTP status code Rails responded with. */
  readonly status: number;

  /** `error.code` from the Rails envelope; `""` when the body is not that shape. */
  readonly code: string;

  /** Raw response body, truncated to the same 2048 bytes Go read. */
  readonly body: string;

  constructor(status: number, body: string) {
    const truncated = body.slice(0, MAX_ERROR_BODY).trim();
    const envelope = parseErrorEnvelope(truncated);
    super(envelope.message || fallbackMessage(status, truncated));
    this.status = status;
    this.code = envelope.code;
    this.body = truncated;
  }
}

/** A 2xx response whose body was not JSON, or did not match the schema the caller asked for. */
export class ResponseFormatError extends Error {
  override readonly name = "ResponseFormatError";

  /** Request path that produced the unusable body. */
  readonly path: string;

  /** Raw response body, truncated for logging. */
  readonly body: string;

  constructor(path: string, body: string, detail: string, options?: { cause?: unknown }) {
    super(`unexpected response from ${path}: ${detail}`, options);
    this.path = path;
    this.body = body.slice(0, MAX_ERROR_BODY);
  }
}

/**
 * Reports whether `error` is an `APIError` carrying a 401, so screens can route the owner back
 * to the login flow when the session cookie is missing or expired. 401 specifically — a 403 is
 * an authorization decision Rails made about an authenticated owner and must not sign them out.
 */
export function isUnauthorized(error: unknown): boolean {
  return asAPIError(error)?.status === 401;
}

/**
 * Reports whether `error` is an `APIError` carrying a 503, ported from `isServiceUnavailable`
 * in `web/components/contacts.go`.
 *
 * 503 is not a generic server hiccup in this API: it is the status Rails answers when an LLM
 * generator ran but had nothing to run *with* — `CoverLetterDraftsController#create` and
 * `OutreachDraftsController#create` both map their generator's `skipped` result (no
 * `OPENROUTER_API_KEY`) to `llm_unavailable` + 503, while a generator that actually failed is
 * 502. Screens keep the two apart because "try again later" and "try again" are different
 * instructions, and the first one is the truth when no key is configured.
 */
export function isServiceUnavailable(error: unknown): boolean {
  return asAPIError(error)?.status === 503;
}

/** The Rails envelope `error.code` for `error`, or `""` when it is not an `APIError`. */
export function apiErrorCode(error: unknown): string {
  return asAPIError(error)?.code ?? "";
}

/**
 * Walks the `cause` chain for an `APIError`, mirroring Go's `errors.As` unwrap loop so an error
 * wrapped by a caller (e.g. TanStack Query retry plumbing) is still recognized.
 */
export function asAPIError(error: unknown): APIError | undefined {
  const seen = new Set<unknown>();
  let current = error;
  while (current !== null && current !== undefined && !seen.has(current)) {
    if (current instanceof APIError) return current;
    seen.add(current);
    current = current instanceof Error ? current.cause : undefined;
  }
  return undefined;
}

function fallbackMessage(status: number, body: string): string {
  return body
    ? `api request failed: status ${status}: ${body}`
    : `api request failed: status ${status}`;
}

/**
 * Reads `{error: {code, message}}` out of an error body. Tolerant on purpose: a body that is not
 * that shape yields empty strings rather than a parse error stacked on top of the real failure.
 */
function parseErrorEnvelope(body: string): { code: string; message: string } {
  if (body === "") return { code: "", message: "" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { code: "", message: "" };
  }
  const result = ApiErrorPayloadSchema.safeParse(parsed);
  return result.success ? result.data.error : { code: "", message: "" };
}
