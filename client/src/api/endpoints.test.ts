/**
 * Endpoint, query-key, and QueryClient contract (`FE-05`).
 *
 * Three things are pinned here, each for a reason that has already bitten this project:
 *
 * 1. **Method, path, and request body of every endpoint function.** Each case registers an MSW
 *    handler at the *literal* path it expects and captures the intercepted `Request`. Because
 *    `installMockApi` errors on an unhandled request, a wrong path fails the test even before the
 *    assertions run. The Go `RailsClient` interface is the source of truth, and a coverage test
 *    asserts the exported set still matches it method for method.
 * 2. **The jobs feed query string.** Every expectation in that block was produced by *running*
 *    `JobFeedParams.query().Encode()` in Go against the same inputs, not written by hand, so it is
 *    real parity rather than a restatement of the TypeScript implementation.
 * 3. **The retry policy.** A 401 retried three times, or a mutation retried at all, would be a
 *    safety problem rather than a slow request — `submitApplication` dispatches a trusted submit.
 */
import { describe, expect, it } from "vitest";

import * as endpoints from "./endpoints";
import {
  createApplication,
  createJobPost,
  fetchApplicationDraft,
  fetchContacts,
  fetchCoverLetter,
  fetchDigest,
  fetchIngestionBatches,
  fetchIntake,
  fetchJob,
  fetchJobs,
  fetchProfile,
  fetchVapidPublicKey,
  generateCoverLetter,
  generateOutreach,
  jobFeedQuery,
  jobsPath,
  login,
  lookupPosting,
  scoreJobPost,
  setIntake,
  setJobLifecycle,
  submitApplication,
  updateApplicationDraft,
  updateJobApplicationStatus,
  updateProfile,
  subscribePush,
  unsubscribePush,
} from "./endpoints";
import { APIError, ResponseFormatError } from "./errors";
import { queryKeys } from "./keys";
import { QUERY_STALE_TIME_MS, createQueryClient, shouldRetryQuery } from "./query-client";
import type { JobFeedParams, ManualJobInput, ProfileEdit, PushSubscription } from "./schemas";
import { apiHandlers, fixtures } from "../test/handlers";
import { captureRequest, installMockApi, type JsonBodyType, type MockMethod } from "../test/msw";

const server = installMockApi(...apiHandlers());

/* -------------------------------------------------------------------------- */
/* Method / path / body of every endpoint                                      */
/* -------------------------------------------------------------------------- */

interface EndpointCase {
  /** The Go `RailsClient` method this case ports. */
  name: string;
  method: MockMethod;
  path: string;
  /** Payload the handler answers with; it must satisfy the endpoint's response schema. */
  response: JsonBodyType;
  /** Expected JSON request body. Omit for a bodyless request. */
  json?: unknown;
  /** Expected form-encoded request body. */
  form?: string;
  call: () => Promise<unknown>;
}

const manualInput: ManualJobInput = {
  url: "https://jobs.harbour.example/postings/staff-engineer",
  application_url: "",
  text: "",
  title: "",
  company: "",
};

const profileEdit: ProfileEdit = {
  full_name: "Owner Name",
  headline: "Backend engineer",
  summary: "",
  location: "Vancouver, BC",
  linkedin_url: "",
  github_url: "",
  portfolio_url: "",
};

const pushSubscription: PushSubscription = {
  endpoint: "https://push.example/endpoint/abc",
  keys: { p256dh: "p256dh-value", auth: "auth-value" },
};

const cases: EndpointCase[] = [
  {
    name: "Login",
    method: "post",
    path: "/api/session",
    response: {},
    form: "passphrase=open+sesame",
    call: () => login("open sesame"),
  },
  {
    name: "Intake",
    method: "get",
    path: "/api/intake",
    response: { intake: fixtures.intake },
    call: () => fetchIntake(),
  },
  {
    name: "SetIntake",
    method: "patch",
    path: "/api/intake",
    response: { intake: fixtures.intake },
    json: { intake: { enabled: false } },
    call: () => setIntake(false),
  },
  {
    name: "Jobs",
    method: "get",
    path: "/api/job_posts",
    response: fixtures.jobPage,
    call: () => fetchJobs({ sort: "score" }),
  },
  {
    name: "ScoreJobPost",
    method: "post",
    path: "/api/job_posts/42/score",
    response: { job_post: fixtures.scoredJob },
    call: () => scoreJobPost(42),
  },
  {
    name: "SetJobLifecycle (single id, member endpoint)",
    method: "patch",
    path: "/api/job_posts/7/lifecycle",
    response: { job_post: fixtures.scoredJob },
    json: { lifecycle_state: "backlog" },
    call: () => setJobLifecycle([7], "backlog"),
  },
  {
    name: "SetJobLifecycle (several ids, bulk endpoint)",
    method: "patch",
    path: "/api/job_posts/lifecycle",
    response: { job_posts: [fixtures.scoredJob, fixtures.unscoredJob] },
    json: { ids: [7, 8], lifecycle_state: "removed" },
    call: () => setJobLifecycle([7, 8], "removed"),
  },
  {
    name: "Job",
    method: "get",
    path: "/api/job_posts/42",
    response: { job_post: fixtures.jobDetail },
    call: () => fetchJob(42),
  },
  {
    name: "CoverLetter",
    method: "get",
    path: "/api/job_posts/42/cover_letter_draft",
    response: { cover_letter_draft: fixtures.coverLetterDraft },
    call: () => fetchCoverLetter(42),
  },
  {
    name: "GenerateCoverLetter",
    method: "post",
    path: "/api/job_posts/42/cover_letter_draft",
    response: { cover_letter_draft: fixtures.coverLetterDraft },
    json: {},
    call: () => generateCoverLetter(42),
  },
  {
    name: "Digest",
    method: "get",
    path: "/api/digest",
    response: { digest: fixtures.digest },
    call: () => fetchDigest(),
  },
  {
    name: "IngestionBatches",
    method: "get",
    path: "/api/ingestion_batches",
    response: fixtures.ingestionBatchPage,
    call: () => fetchIngestionBatches(),
  },
  {
    name: "CreateApplication",
    method: "post",
    path: "/api/applications",
    response: { application: { application_id: 41, status: "draft" } },
    json: { application: { job_post_id: 101 } },
    call: () => createApplication(101),
  },
  {
    name: "ApplicationDraft",
    method: "get",
    path: "/api/applications/41",
    response: { application: fixtures.applicationDraft },
    call: () => fetchApplicationDraft(41),
  },
  {
    name: "UpdateApplicationDraft",
    method: "patch",
    path: "/api/applications/41/draft",
    response: { application: fixtures.applicationDraft },
    json: {
      application_draft: {
        autofill_payload: { answers: [{ field: "full_name", value: "Owner Name" }] },
      },
    },
    call: () =>
      updateApplicationDraft(41, {
        answers: [{ field: "full_name", value: "Owner Name" }],
      }),
  },
  {
    name: "SubmitApplication",
    method: "post",
    path: "/api/applications/41/submit",
    response: fixtures.submitResult,
    call: () => submitApplication(41),
  },
  {
    name: "UpdateJobApplicationStatus",
    method: "patch",
    path: "/api/job_posts/101/application_status",
    response: { application: fixtures.applicationTracker },
    json: { application: { pipeline_status: "applied", pipeline_stage: "waiting" } },
    call: () =>
      updateJobApplicationStatus(101, { pipeline_status: "applied", pipeline_stage: "waiting" }),
  },
  {
    name: "Profile",
    method: "get",
    path: "/api/profile",
    response: { profile: fixtures.profile },
    call: () => fetchProfile(),
  },
  {
    name: "UpdateProfile",
    method: "patch",
    path: "/api/profile",
    response: { profile: fixtures.profile },
    json: { profile: profileEdit },
    call: () => updateProfile(profileEdit),
  },
  {
    name: "VAPIDPublicKey",
    method: "get",
    path: "/api/push/vapid_public_key",
    response: { vapid_public_key: fixtures.vapidPublicKey },
    call: () => fetchVapidPublicKey(),
  },
  {
    name: "Subscribe",
    method: "post",
    path: "/api/push_subscription",
    response: {},
    json: { subscription: pushSubscription },
    call: () => subscribePush(pushSubscription),
  },
  {
    name: "Unsubscribe",
    method: "delete",
    path: "/api/push_subscription",
    response: {},
    json: { subscription: { endpoint: pushSubscription.endpoint } },
    call: () => unsubscribePush(pushSubscription.endpoint),
  },
  {
    name: "Contacts",
    method: "get",
    path: "/api/job_posts/101/contact_candidates",
    response: { contact_candidates: fixtures.contactCandidates },
    call: () => fetchContacts(101),
  },
  {
    name: "GenerateOutreach",
    method: "post",
    path: "/api/contact_candidates/7/outreach_drafts",
    response: { outreach_draft: fixtures.outreachDraft },
    json: { outreach_draft: { loose_template: "short and specific" } },
    call: () => generateOutreach(7, "short and specific"),
  },
  {
    name: "CreateJobPost",
    method: "post",
    path: "/api/job_posts",
    response: fixtures.manualJobResult,
    json: { job_post: manualInput },
    call: () => createJobPost(manualInput),
  },
  {
    name: "LookupPosting",
    method: "post",
    path: "/api/job_posts/lookup",
    response: { lookup: fixtures.postingLookup },
    json: { url: manualInput.url },
    call: () => lookupPosting(manualInput.url),
  },
];

describe("endpoint functions", () => {
  it.each(cases)("$name sends $method $path", async (testCase) => {
    const received: { request?: Request } = {};
    server.use(captureRequest(testCase.method, testCase.path, received, testCase.response));

    await testCase.call();
    const request = requireRequest(received);

    expect(request.method).toBe(testCase.method.toUpperCase());
    expect(new URL(request.url).pathname).toBe(testCase.path);

    if (testCase.json !== undefined) {
      expect(request.headers.get("Content-Type")).toBe("application/json");
      expect(await request.json()).toEqual(testCase.json);
    } else if (testCase.form !== undefined) {
      expect(request.headers.get("Content-Type")).toBe("application/x-www-form-urlencoded");
      expect(await request.text()).toBe(testCase.form);
    } else {
      // Go sent these with no body at all, only an Accept header.
      expect(await request.text()).toBe("");
      expect(request.headers.get("Content-Type")).toBeNull();
    }
  });

  it("exports exactly one function per RailsClient method, plus sign-out", () => {
    // Keys are the Go interface's 25 methods; values are the ported names.
    const ported: Record<string, string> = {
      Login: "login",
      Intake: "fetchIntake",
      SetIntake: "setIntake",
      Jobs: "fetchJobs",
      ScoreJobPost: "scoreJobPost",
      SetJobLifecycle: "setJobLifecycle",
      Job: "fetchJob",
      CoverLetter: "fetchCoverLetter",
      GenerateCoverLetter: "generateCoverLetter",
      Digest: "fetchDigest",
      IngestionBatches: "fetchIngestionBatches",
      CreateApplication: "createApplication",
      ApplicationDraft: "fetchApplicationDraft",
      UpdateApplicationDraft: "updateApplicationDraft",
      SubmitApplication: "submitApplication",
      UpdateJobApplicationStatus: "updateJobApplicationStatus",
      Profile: "fetchProfile",
      UpdateProfile: "updateProfile",
      VAPIDPublicKey: "fetchVapidPublicKey",
      Subscribe: "subscribePush",
      Unsubscribe: "unsubscribePush",
      Contacts: "fetchContacts",
      GenerateOutreach: "generateOutreach",
      CreateJobPost: "createJobPost",
      LookupPosting: "lookupPosting",
    };
    // The two query-string helpers are not endpoints; every other export must be one.
    const helpers = ["jobFeedQuery", "jobsPath"];
    // Endpoints with no Go counterpart. `DELETE /api/session` is served by Rails but the Go
    // build never called it: sign-out arrives with the login port (`FE-09`), which owns its
    // method/path assertion in `src/lib/auth.test.tsx`.
    const added = ["logout"];

    const exported = Object.entries(endpoints)
      .filter(([, value]) => typeof value === "function")
      .map(([name]) => name);

    expect(Object.keys(ported)).toHaveLength(25);
    expect(exported.sort()).toEqual([...Object.values(ported), ...helpers, ...added].sort());
    // Every case above names a real Go method, so the table cannot drift from the interface.
    for (const testCase of cases) {
      expect(Object.keys(ported)).toContain(testCase.name.split(" ")[0]);
    }
  });

  it("refuses a non-integer id rather than sending /api/job_posts/NaN", async () => {
    await expect(fetchJob(Number.NaN)).rejects.toThrow(TypeError);
    await expect(fetchJob(1.5)).rejects.toThrow(/must be an integer/);
  });

  it("surfaces a wrong-typed 2xx payload instead of handing back a zero value", async () => {
    server.use(captureRequest("get", "/api/profile", {}, { profile: "not an object" }));

    await expect(fetchProfile()).rejects.toThrow(ResponseFormatError);
  });
});

/* -------------------------------------------------------------------------- */
/* Jobs feed query serialization                                               */
/* -------------------------------------------------------------------------- */

/**
 * Every expected string here was printed by running Go's `JobFeedParams.query().Encode()` on
 * the same input, so this block is a parity fixture rather than a mirror of the TS code.
 */
const goEncoded: [label: string, params: JobFeedParams, expected: string][] = [
  ["no params at all", {}, ""],
  ["page 1 (Rails' own default)", { page: 1 }, ""],
  [
    "every filter set",
    {
      status: "all",
      state: "open",
      sort: "activity",
      application: "in_progress",
      score_band: "high",
      source: "linkedin",
      location: "Vancouver",
      date_from: "2026-09-01",
      date_to: "2026-09-30",
      page: 4,
    },
    "application=in_progress&date_from=2026-09-01&date_to=2026-09-30&location=Vancouver&page=4&score_band=high&sort=activity&source=linkedin&state=open&status=all",
  ],
  ["a whitespace-only filter", { source: "   " }, ""],
  [
    "a padded value, sent untrimmed with + for space",
    { location: " vancouver " },
    "location=+vancouver+",
  ],
  ["a comma and a space", { location: "Vancouver, BC" }, "location=Vancouver%2C+BC"],
  [
    "characters encodeURIComponent leaves literal",
    { source: "a*b(c)!d'e" },
    "source=a%2Ab%28c%29%21d%27e",
  ],
  ["a tilde, which Go treats as unreserved", { location: "a~b" }, "location=a~b"],
  ["query-string metacharacters", { location: "a+b&c=d" }, "location=a%2Bb%26c%3Dd"],
  ["a non-ASCII value", { location: "Montréal" }, "location=Montr%C3%A9al"],
  ["one filter", { sort: "score" }, "sort=score"],
  [
    "two filters, sorted by key",
    { source: "glassdoor", status: "unscored" },
    "source=glassdoor&status=unscored",
  ],
  ["page 3", { page: 3 }, "page=3"],
];

describe("jobFeedQuery", () => {
  it.each(goEncoded)("matches Go for %s", (_label, params, expected) => {
    expect(jobFeedQuery(params)).toBe(expected);
  });

  it("omits the query string entirely when nothing is set", () => {
    expect(jobsPath()).toBe("/api/job_posts");
    expect(jobsPath({ page: 1 })).toBe("/api/job_posts");
    expect(jobsPath({ source: "linkedin" })).toBe("/api/job_posts?source=linkedin");
  });

  it("never sends an unset filter as an empty or sentinel value", async () => {
    const received: { request?: Request } = {};
    server.use(captureRequest("get", "/api/job_posts", received, fixtures.jobPage));

    await fetchJobs({ status: "all", state: "open" });
    const params = new URL(requireRequest(received).url).searchParams;

    expect(params.has("source")).toBe(false);
    expect(params.has("score_band")).toBe(false);
    expect(params.has("page")).toBe(false);
    expect(params.get("status")).toBe("all");
  });

  it("sends the ingestion-batches page only past page 1", async () => {
    const received: { request?: Request } = {};
    server.use(
      captureRequest("get", "/api/ingestion_batches", received, fixtures.ingestionBatchPage),
    );

    await fetchIngestionBatches(1);
    expect(new URL(requireRequest(received).url).search).toBe("");

    await fetchIngestionBatches(3);
    expect(new URL(requireRequest(received).url).search).toBe("?page=3");
  });
});

/* -------------------------------------------------------------------------- */
/* Query keys                                                                  */
/* -------------------------------------------------------------------------- */

describe("queryKeys", () => {
  const readKeys = [
    queryKeys.intake(),
    queryKeys.jobs.list(),
    queryKeys.jobs.detail(7),
    queryKeys.jobs.coverLetter(7),
    queryKeys.jobs.contacts(7),
    queryKeys.digest(),
    queryKeys.ingestionBatches.page(2),
    queryKeys.applications.draft(41),
    queryKeys.profile(),
    queryKeys.push.vapidPublicKey(),
  ];

  it("covers every read endpoint with a distinct key", () => {
    // Ten reads: intake, feed, detail, cover letter, contacts, digest, batches, draft,
    // profile, VAPID key. The remaining endpoint functions are writes and cache nothing.
    expect(readKeys).toHaveLength(10);
    expect(new Set(readKeys.map((key) => JSON.stringify(key))).size).toBe(10);
  });

  it("nests under a single root so everything can be invalidated at once", () => {
    for (const key of readKeys) {
      expect(hasPrefix(key, queryKeys.root())).toBe(true);
    }
  });

  it("nests per-job reads under the job detail key so one job can be invalidated precisely", () => {
    expect(hasPrefix(queryKeys.jobs.coverLetter(7), queryKeys.jobs.detail(7))).toBe(true);
    expect(hasPrefix(queryKeys.jobs.contacts(7), queryKeys.jobs.detail(7))).toBe(true);
    expect(hasPrefix(queryKeys.jobs.detail(7), queryKeys.jobs.root())).toBe(true);
    expect(hasPrefix(queryKeys.jobs.list(), queryKeys.jobs.root())).toBe(true);
    // A different job is untouched by invalidating this one.
    expect(hasPrefix(queryKeys.jobs.coverLetter(8), queryKeys.jobs.detail(7))).toBe(false);
    // The profile is untouched by invalidating every job.
    expect(hasPrefix(queryKeys.profile(), queryKeys.jobs.root())).toBe(false);
  });

  it("keys a feed page on the exact query string, so equivalent params share one entry", () => {
    expect(queryKeys.jobs.list({})).toEqual(queryKeys.jobs.list({ page: 1 }));
    expect(queryKeys.jobs.list({ source: "   " })).toEqual(queryKeys.jobs.list({}));
    expect(queryKeys.jobs.list({ source: "linkedin" })).not.toEqual(
      queryKeys.jobs.list({ source: "glassdoor" }),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* QueryClient configuration                                                   */
/* -------------------------------------------------------------------------- */

describe("createQueryClient", () => {
  it("never retries a mutation, because a replayed write can re-dispatch a trusted submit", () => {
    const defaults = createQueryClient().getDefaultOptions();

    expect(defaults.mutations?.retry).toBe(false);
  });

  it("keeps reads briefly fresh and refetches on focus and reconnect", () => {
    const defaults = createQueryClient().getDefaultOptions();

    expect(defaults.queries?.staleTime).toBe(QUERY_STALE_TIME_MS);
    expect(defaults.queries?.refetchOnWindowFocus).toBe(true);
    expect(defaults.queries?.refetchOnReconnect).toBe(true);
    expect(defaults.queries?.retry).toBe(shouldRetryQuery);
  });

  it.each([
    ["a transport failure", new TypeError("fetch failed"), true],
    ["a Rails 500", new APIError(500, ""), true],
    ["a 401", new APIError(401, ""), false],
    ["a 403", new APIError(403, ""), false],
    ["a 422", new APIError(422, ""), false],
    ["a contract break", new ResponseFormatError("/api/intake", "", "body is not JSON"), false],
  ])("retries %s: %s", (_label, error, expected) => {
    expect(shouldRetryQuery(1, error)).toBe(expected);
  });

  it("gives up after three attempts", () => {
    const error = new TypeError("fetch failed");

    expect(shouldRetryQuery(1, error)).toBe(true);
    expect(shouldRetryQuery(2, error)).toBe(true);
    expect(shouldRetryQuery(3, error)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* The shared handler set is a usable fake backend                             */
/* -------------------------------------------------------------------------- */

describe("apiHandlers", () => {
  it("answers every read with a payload its schema accepts", async () => {
    expect((await fetchIntake()).enabled).toBe(true);

    const page = await fetchJobs({ page: 2 });
    expect(page.job_posts).toHaveLength(2);
    expect(page.page.number).toBe(2);
    expect(page.application_counts.applied).toBe(1);
    // The unscored row keeps a null score rather than collapsing to 0%.
    expect(page.job_posts[1]?.match_score).toBeNull();

    expect((await fetchJob(555)).id).toBe(555);
    expect((await fetchCoverLetter(555))?.job_post_id).toBe(555);
    expect((await fetchDigest()).jobs).toHaveLength(1);
    expect((await fetchIngestionBatches(4)).page.number).toBe(4);
    expect((await fetchApplicationDraft(77)).application_id).toBe(77);
    expect((await fetchProfile()).contact.email_present).toBe(true);
    expect(await fetchVapidPublicKey()).toBe(fixtures.vapidPublicKey);
    expect((await fetchContacts(555))[0]?.job_post_id).toBe(555);
  });

  it("answers every write with a payload its schema accepts", async () => {
    await expect(login("open sesame")).resolves.toBeUndefined();
    expect((await setIntake(false)).enabled).toBe(false);
    expect((await scoreJobPost(9)).id).toBe(9);
    expect((await setJobLifecycle([9], "backlog"))[0]?.lifecycle_state).toBe("backlog");
    expect(await setJobLifecycle([9, 10], "removed")).toHaveLength(2);
    expect((await generateCoverLetter(9))?.job_post_id).toBe(9);
    expect((await createApplication(9)).status).toBe("draft");
    expect(
      (await updateApplicationDraft(77, { answers: [{ field: "email", value: "x@example.com" }] }))
        .autofill_payload.answers,
    ).toEqual([{ field: "email", value: "x@example.com" }]);
    expect((await submitApplication(77)).application_id).toBe(77);
    expect(
      (await updateJobApplicationStatus(9, { pipeline_status: "closed", pipeline_stage: "" }))
        .pipeline_status,
    ).toBe("closed");
    expect((await updateProfile(profileEdit)).headline).toBe("Backend engineer");
    await expect(subscribePush(pushSubscription)).resolves.toBeUndefined();
    await expect(unsubscribePush(pushSubscription.endpoint)).resolves.toBeUndefined();
    expect((await generateOutreach(7, "short")).contact_candidate_id).toBe(7);
    expect((await createJobPost(manualInput)).import.status).toBe("new");
    expect((await lookupPosting(manualInput.url)).status).toBe("ok");
  });
});

/** Narrows the captured request, so no test needs a non-null assertion. */
function requireRequest(received: { request?: Request }): Request {
  const { request } = received;
  if (request === undefined) throw new Error("no request was intercepted");
  return request;
}

/** Whether `key` starts with `prefix`, which is how TanStack Query matches for invalidation. */
function hasPrefix(key: readonly unknown[], prefix: readonly unknown[]): boolean {
  return prefix.every((part, index) => key[index] === part);
}
