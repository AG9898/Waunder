/**
 * Transport-layer contract (`FE-04`).
 *
 * Every case runs the real `fetch` against the MSW harness rather than a stubbed function, so
 * headers, credentials, status handling, and body parsing are exercised end to end. The
 * status-code matrix is the point of the file: 200, a 4xx carrying Rails' error envelope, 401
 * specifically, a 500 with no envelope, and a 2xx whose body is unusable.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { APIError, ResponseFormatError, apiErrorCode, asAPIError, isUnauthorized } from "./errors";
import { apiGet, apiSend } from "./http";
import { IntakeEnvelopeSchema, JobPageSchema } from "./schemas";
import {
  HttpResponse,
  captureRequest,
  errorResponse,
  http,
  installMockApi,
  jsonResponse,
  textResponse,
} from "../test/msw";

const server = installMockApi();

const intakePayload = {
  intake: {
    enabled: true,
    paused_at: "",
    resumed_at: "2026-09-10T08:00:00Z",
    held_count: 0,
    processing_count: 0,
    queued_count: 3,
  },
};

describe("a 200 response", () => {
  it("returns the schema-validated payload", async () => {
    server.use(jsonResponse("get", "/api/intake", intakePayload));

    const { intake } = await apiGet("/api/intake", IntakeEnvelopeSchema);

    expect(intake.enabled).toBe(true);
    expect(intake.queued_count).toBe(3);
  });

  it("keeps the FE-03 absence tolerance: a partial serializer payload decodes to zero values", async () => {
    server.use(jsonResponse("get", "/api/intake", { intake: { enabled: false } }));

    const { intake } = await apiGet("/api/intake", IntakeEnvelopeSchema);

    expect(intake).toEqual({
      enabled: false,
      paused_at: "",
      resumed_at: "",
      held_count: 0,
      processing_count: 0,
      queued_count: 0,
    });
  });

  it("requests same-origin with credentials and an application/json Accept header", async () => {
    const received: { request?: Request } = {};
    server.use(captureRequest("get", "/api/intake", received, intakePayload));

    await apiGet("/api/intake", IntakeEnvelopeSchema);

    const request = received.request;
    expect(request).toBeDefined();
    // "same-origin" is the whole auth mechanism: the browser attaches the httponly session
    // cookie on its own. "include" would carry it cross-origin and must never appear here.
    expect(request?.credentials).toBe("same-origin");
    expect(new URL(request!.url).origin).toBe(window.location.origin);
    expect(request?.headers.get("Accept")).toBe("application/json");
  });

  it("passes the query string through untouched", async () => {
    const received: { request?: Request } = {};
    server.use(
      captureRequest("get", "/api/job_posts", received, {
        job_posts: [],
        page: {},
        application_counts: {},
      }),
    );

    await apiGet("/api/job_posts?status=all&state=open&page=2", JobPageSchema);

    expect(new URL(received.request!.url).search).toBe("?status=all&state=open&page=2");
  });
});

describe("a 4xx with the Rails error envelope", () => {
  it("throws an APIError exposing the code and the message", async () => {
    server.use(
      errorResponse(
        "post",
        "/api/applications/7/submit",
        422,
        "unsafe_payload",
        "Autofill payload contains sensitive fields",
      ),
    );

    const error = await captureError(() =>
      apiSend("POST", "/api/applications/7/submit", IntakeEnvelopeSchema),
    );

    expect(error).toBeInstanceOf(APIError);
    expect((error as APIError).status).toBe(422);
    expect((error as APIError).code).toBe("unsafe_payload");
    expect((error as APIError).message).toBe("Autofill payload contains sensitive fields");
    expect(apiErrorCode(error)).toBe("unsafe_payload");
    expect(isUnauthorized(error)).toBe(false);
  });
});

describe("a 401", () => {
  it("is detected by isUnauthorized", async () => {
    server.use(errorResponse("get", "/api/intake", 401, "unauthorized", "Sign in required"));

    const error = await captureError(() => apiGet("/api/intake", IntakeEnvelopeSchema));

    expect(isUnauthorized(error)).toBe(true);
    expect((error as APIError).status).toBe(401);
  });

  it("is distinct from a 403: an authorization refusal must not sign the owner out", async () => {
    server.use(errorResponse("get", "/api/intake", 403, "forbidden", "Not allowed"));

    const error = await captureError(() => apiGet("/api/intake", IntakeEnvelopeSchema));

    expect(error).toBeInstanceOf(APIError);
    expect(isUnauthorized(error)).toBe(false);
  });

  it("is still detected through a wrapping error's cause chain", async () => {
    server.use(errorResponse("get", "/api/intake", 401, "unauthorized", "Sign in required"));

    const error = await captureError(() => apiGet("/api/intake", IntakeEnvelopeSchema));
    const wrapped = new Error("query failed", { cause: error });

    expect(isUnauthorized(wrapped)).toBe(true);
    expect(asAPIError(wrapped)?.status).toBe(401);
  });

  it("reports nothing for an error that is not an APIError", () => {
    expect(isUnauthorized(new Error("offline"))).toBe(false);
    expect(isUnauthorized(undefined)).toBe(false);
    expect(apiErrorCode(new Error("offline"))).toBe("");
  });
});

describe("a 500 without an envelope", () => {
  it("falls back to the status-and-body message and leaves the code empty", async () => {
    server.use(textResponse("get", "/api/intake", "<html>Application error</html>", 500));

    const error = await captureError(() => apiGet("/api/intake", IntakeEnvelopeSchema));

    expect(error).toBeInstanceOf(APIError);
    expect((error as APIError).status).toBe(500);
    expect((error as APIError).code).toBe("");
    expect((error as APIError).message).toBe(
      "api request failed: status 500: <html>Application error</html>",
    );
    expect((error as APIError).body).toBe("<html>Application error</html>");
  });

  it("still reports the status when the body is empty", async () => {
    server.use(http.get("/api/intake", () => new HttpResponse(null, { status: 503 })));

    const error = await captureError(() => apiGet("/api/intake", IntakeEnvelopeSchema));

    expect((error as APIError).message).toBe("api request failed: status 503");
  });

  it("truncates a very long error body the way Go's 2048-byte LimitReader did", async () => {
    server.use(textResponse("get", "/api/intake", "x".repeat(5000), 500));

    const error = await captureError(() => apiGet("/api/intake", IntakeEnvelopeSchema));

    expect((error as APIError).body).toHaveLength(2048);
  });
});

describe("an unusable 2xx body", () => {
  it("rejects a non-JSON body with a ResponseFormatError", async () => {
    server.use(textResponse("get", "/api/intake", "<html>proxy error</html>"));

    const error = await captureError(() => apiGet("/api/intake", IntakeEnvelopeSchema));

    expect(error).toBeInstanceOf(ResponseFormatError);
    expect((error as ResponseFormatError).path).toBe("/api/intake");
    expect((error as ResponseFormatError).message).toContain("body is not JSON");
  });

  it("rejects a wrong-typed field instead of silently zero-valuing it", async () => {
    // Go's json.Unmarshal would have made this a 0, which is how a "scored 0%" lie reaches
    // the owner. The schema rejects it and the transport surfaces the break.
    server.use(jsonResponse("get", "/api/intake", { intake: { held_count: "12" } }));

    const error = await captureError(() => apiGet("/api/intake", IntakeEnvelopeSchema));

    expect(error).toBeInstanceOf(ResponseFormatError);
    expect((error as ResponseFormatError).message).toContain("intake");
  });

  it("rejects a body that is valid JSON but the wrong shape entirely", async () => {
    server.use(jsonResponse("get", "/api/job_posts", { job_posts: {} }));

    const error = await captureError(() => apiGet("/api/job_posts", JobPageSchema));

    expect(error).toBeInstanceOf(ResponseFormatError);
  });
});

describe("write requests", () => {
  it("sends a JSON body and returns the validated response", async () => {
    const received: { request?: Request } = {};
    server.use(captureRequest("patch", "/api/intake", received, intakePayload));

    const { intake } = await apiSend("PATCH", "/api/intake", IntakeEnvelopeSchema, {
      json: { intake: { enabled: false } },
    });

    expect(received.request?.headers.get("Content-Type")).toBe("application/json");
    await expect(received.request?.json()).resolves.toEqual({ intake: { enabled: false } });
    expect(intake.queued_count).toBe(3);
  });

  it("sends a form-encoded body for the session endpoint", async () => {
    const received: { request?: Request } = {};
    server.use(captureRequest("post", "/api/session", received));

    await apiSend("POST", "/api/session", null, { form: { passphrase: "a b&c" } });

    expect(received.request?.headers.get("Content-Type")).toBe("application/x-www-form-urlencoded");
    await expect(received.request?.text()).resolves.toBe("passphrase=a+b%26c");
  });

  it("sends no body at all when neither json nor form is given", async () => {
    const received: { request?: Request } = {};
    server.use(captureRequest("post", "/api/job_posts/4/score", received, intakePayload));

    await apiSend("POST", "/api/job_posts/4/score", IntakeEnvelopeSchema);

    expect(received.request?.headers.get("Content-Type")).toBeNull();
  });

  it("resolves without reading the body when no schema is given", async () => {
    server.use(textResponse("delete", "/api/push_subscription", "not json at all", 204));

    await expect(apiSend("DELETE", "/api/push_subscription", null)).resolves.toBeUndefined();
  });

  it("surfaces a non-2xx as an APIError even with no schema", async () => {
    server.use(
      errorResponse("post", "/api/session", 401, "invalid_passphrase", "Wrong passphrase"),
    );

    const error = await captureError(() =>
      apiSend("POST", "/api/session", null, { form: { passphrase: "nope" } }),
    );

    expect(isUnauthorized(error)).toBe(true);
    expect((error as APIError).code).toBe("invalid_passphrase");
  });
});

describe("same-origin enforcement", () => {
  it.each(["https://evil.example/api/intake", "//evil.example/api/intake", "api/intake"])(
    "refuses to send the session cookie to %s",
    async (path) => {
      await expect(apiGet(path, IntakeEnvelopeSchema)).rejects.toThrow(TypeError);
    },
  );

  it("never reads document.cookie: the session cookie is httponly", () => {
    const files = sourceFiles(join(import.meta.dirname, ".."));

    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(`${file}: ${readFileSync(file, "utf8")}`).not.toContain("document.cookie");
    }
  });
});

describe("cancellation", () => {
  it("propagates an aborted signal", async () => {
    server.use(jsonResponse("get", "/api/intake", intakePayload));
    const controller = new AbortController();
    controller.abort();

    await expect(
      apiGet("/api/intake", IntakeEnvelopeSchema, { signal: controller.signal }),
    ).rejects.toThrow();
  });
});

/** Returns the error a rejecting call threw, failing the test if it resolved instead. */
async function captureError(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to reject, but it resolved");
}

/**
 * Every application source file under `src/`. Test files are excluded — this one names
 * `document.cookie` in order to forbid it, and asserting on the assertion is not the point.
 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (/\.(test|spec)\.tsx?$/.test(path)) return [];
    return /\.tsx?$/.test(path) ? [path] : [];
  });
}
