/**
 * One typed function per method on the Go `RailsClient` interface.
 *
 * Ported from `web/components/client.go` (see docs/GO_MIGRATION.md). This module owns the
 * *shape* of each call and nothing else: HTTP method, path, request body, and which response
 * envelope key the payload comes back under. Transport lives in `http.ts`, payload validation
 * in `schemas.ts`, cache identity in `keys.ts`. No business logic lives here — Rails owns
 * normalization, filtering, sorting, paging, route resolution, scoring, and every safety gate.
 *
 * Two rules the port preserves exactly, because both have already caused production bugs:
 *
 * - **An unset feed filter is omitted from the query string**, never sent as `""` or an `"all"`
 *   sentinel. Rails matches `source=All` literally and returns nothing — the go-app `<select>`
 *   bug (AGENTS.md 2026-06-24). `jobFeedQuery` reproduces `JobFeedParams.query()` byte for byte,
 *   including Go's key sort and `+`-for-space escaping.
 * - **`updateApplicationDraft` sends only the reviewed `answers`.** ATS kind, apply URL, and
 *   resume metadata stay Rails-owned (AGENTS.md 2026-06-22); echoing them back would let the
 *   client edit the trusted-submit contract.
 *
 * Nothing here approves or submits an application as a side effect. `createApplication` starts
 * draft generation only, and `submitApplication` is the one function that dispatches a trusted
 * submit — it exists solely to be called from an explicit owner action.
 */
import { apiGet, apiSend, type ApiRequestOptions } from "./http";
import {
  ApplicationDraftEnvelopeSchema,
  ApplicationTrackerEnvelopeSchema,
  ContactCandidatesEnvelopeSchema,
  CoverLetterDraftEnvelopeSchema,
  CreateApplicationEnvelopeSchema,
  DigestEnvelopeSchema,
  IngestionBatchPageSchema,
  IntakeEnvelopeSchema,
  JobDetailEnvelopeSchema,
  JobPageSchema,
  JobPostSummariesEnvelopeSchema,
  JobPostSummaryEnvelopeSchema,
  ManualJobResultSchema,
  OutreachDraftEnvelopeSchema,
  PostingLookupEnvelopeSchema,
  ProfileEnvelopeSchema,
  SubmitResultSchema,
  VapidPublicKeyEnvelopeSchema,
} from "./schemas";
import type {
  ApplicationDraft,
  ApplicationStatusUpdate,
  ApplicationTracker,
  AutofillPreview,
  ContactCandidate,
  CoverLetterDraft,
  CreateApplicationResult,
  Digest,
  IngestionBatchPage,
  IntakeStatus,
  JobDetail,
  JobFeedParams,
  JobPage,
  JobSummary,
  ManualJobInput,
  ManualJobResult,
  OutreachDraft,
  PostingLookup,
  Profile,
  ProfileEdit,
  PushSubscription,
  StructuredAnswer,
  SubmitResult,
} from "./schemas";

/* -------------------------------------------------------------------------- */
/* Session                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * `POST /api/session` — form-encoded, exactly as `Login` sent it.
 *
 * On success Rails sets the signed, httponly `waunder_session` cookie and answers with no
 * payload, so the body is never read. Nothing here stores the passphrase or the cookie; every
 * later request carries it because the browser attaches it to same-origin requests.
 */
export function login(passphrase: string, options: ApiRequestOptions = {}): Promise<void> {
  return apiSend("POST", "/api/session", null, { ...options, form: { passphrase } });
}

/* -------------------------------------------------------------------------- */
/* Intake                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * `GET /api/intake` — persisted email-intake state and the held-reference count.
 * Reading it may schedule Rails' once-daily maintenance sweep, so it is not free of side
 * effects on the server; it remains a read from the client's point of view.
 */
export async function fetchIntake(options: ApiRequestOptions = {}): Promise<IntakeStatus> {
  const { intake } = await apiGet("/api/intake", IntakeEnvelopeSchema, options);
  return intake;
}

/**
 * `PATCH /api/intake` — pause or resume future inbound email processing. Paused webhooks are
 * retained as lightweight references; resuming queues them, and the returned `queued_count`
 * reports how many.
 */
export async function setIntake(
  enabled: boolean,
  options: ApiRequestOptions = {},
): Promise<IntakeStatus> {
  const { intake } = await apiSend("PATCH", "/api/intake", IntakeEnvelopeSchema, {
    ...options,
    json: { intake: { enabled } },
  });
  return intake;
}

/* -------------------------------------------------------------------------- */
/* Jobs feed                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * `GET /api/job_posts` — one page of the feed, filtered/sorted/paged entirely server-side.
 * The response carries the rows, the page envelope that drives Prev/Next, and the per-group
 * tracker counts, so no screen recomputes any of them.
 */
export function fetchJobs(
  params: JobFeedParams = {},
  options: ApiRequestOptions = {},
): Promise<JobPage> {
  return apiGet(jobsPath(params), JobPageSchema, options);
}

/**
 * `POST /api/job_posts/:id/score` — explicitly score one posting the triage budget deferred.
 * Sends no body, matching Go. It never creates an application and never submits.
 */
export async function scoreJobPost(
  id: number,
  options: ApiRequestOptions = {},
): Promise<JobSummary> {
  const { job_post } = await apiSend(
    "POST",
    `/api/job_posts/${segment(id)}/score`,
    JobPostSummaryEnvelopeSchema,
    options,
  );
  return job_post;
}

/**
 * `PATCH /api/job_posts/:id/lifecycle` for a single id, `PATCH /api/job_posts/lifecycle` for
 * several — the same split `SetJobLifecycle` made, so the bulk path stays one Rails transaction.
 *
 * `"removed"` is a soft delete Rails owns: no row is destroyed, and this never submits anything.
 * Returns the updated rows either way, so a caller does not care which endpoint was used.
 */
export async function setJobLifecycle(
  ids: readonly number[],
  state: string,
  options: ApiRequestOptions = {},
): Promise<JobSummary[]> {
  const only = ids.length === 1 ? ids[0] : undefined;
  if (only !== undefined) {
    const { job_post } = await apiSend(
      "PATCH",
      `/api/job_posts/${segment(only)}/lifecycle`,
      JobPostSummaryEnvelopeSchema,
      { ...options, json: { lifecycle_state: state } },
    );
    return [job_post];
  }
  const { job_posts } = await apiSend(
    "PATCH",
    "/api/job_posts/lifecycle",
    JobPostSummariesEnvelopeSchema,
    { ...options, json: { ids: [...ids], lifecycle_state: state } },
  );
  return job_posts;
}

/** `GET /api/job_posts/:id` — one posting with its detail fields and resolved route. */
export async function fetchJob(id: number, options: ApiRequestOptions = {}): Promise<JobDetail> {
  const { job_post } = await apiGet(
    `/api/job_posts/${segment(id)}`,
    JobDetailEnvelopeSchema,
    options,
  );
  return job_post;
}

/**
 * `GET /api/job_posts/:id/cover_letter_draft` — the current manually usable cover letter, or
 * `null` when the owner has not generated one. Read-only: it starts nothing and submits nothing.
 */
export async function fetchCoverLetter(
  jobId: number,
  options: ApiRequestOptions = {},
): Promise<CoverLetterDraft | null> {
  const { cover_letter_draft } = await apiGet(
    `/api/job_posts/${segment(jobId)}/cover_letter_draft`,
    CoverLetterDraftEnvelopeSchema,
    options,
  );
  return cover_letter_draft;
}

/**
 * `POST /api/job_posts/:id/cover_letter_draft` — create or replace the cover letter. Sends `{}`,
 * as Go did. It never creates an Application, changes tracker state, or submits.
 *
 * Rails answers under the same `cover_letter_draft` key as the read, so this shares the read's
 * nullable envelope rather than fabricating a zero-valued draft the way Go's value type did.
 */
export async function generateCoverLetter(
  jobId: number,
  options: ApiRequestOptions = {},
): Promise<CoverLetterDraft | null> {
  const { cover_letter_draft } = await apiSend(
    "POST",
    `/api/job_posts/${segment(jobId)}/cover_letter_draft`,
    CoverLetterDraftEnvelopeSchema,
    { ...options, json: {} },
  );
  return cover_letter_draft;
}

/** `GET /api/digest` — the daily digest payload that backs the push notification's landing view. */
export async function fetchDigest(options: ApiRequestOptions = {}): Promise<Digest> {
  const { digest } = await apiGet("/api/digest", DigestEnvelopeSchema, options);
  return digest;
}

/**
 * `GET /api/ingestion_batches` — one page of ingestion history, newest first, with each alert or
 * digest email's postings grouped into a batch. `page=1` is omitted from the query string so
 * Rails applies its own default, exactly as `IngestionBatches` did.
 */
export function fetchIngestionBatches(
  page = 1,
  options: ApiRequestOptions = {},
): Promise<IngestionBatchPage> {
  const query = page > 1 ? `?page=${segment(page)}` : "";
  return apiGet(`/api/ingestion_batches${query}`, IngestionBatchPageSchema, options);
}

/* -------------------------------------------------------------------------- */
/* Applications                                                                */
/* -------------------------------------------------------------------------- */

/**
 * `POST /api/applications` — start (or reuse) an application for a job and kick off draft
 * generation in Rails. Idempotent server-side: it reuses the latest draft/approved application.
 *
 * It returns only the id to navigate to for review. **It approves nothing and submits nothing** —
 * that stays the separate, explicit `submitApplication` action on the review screen.
 */
export async function createApplication(
  jobId: number,
  options: ApiRequestOptions = {},
): Promise<CreateApplicationResult> {
  const { application } = await apiSend(
    "POST",
    "/api/applications",
    CreateApplicationEnvelopeSchema,
    { ...options, json: { application: { job_post_id: jobId } } },
  );
  return application;
}

/**
 * `GET /api/applications/:id` — the generated draft for review: resume emphasis, cover letter,
 * structured answers, the worker-shaped autofill preview, `draft_ready`, any autofill warnings,
 * and the latest worker report. Rendering it neither approves nor submits.
 */
export async function fetchApplicationDraft(
  id: number,
  options: ApiRequestOptions = {},
): Promise<ApplicationDraft> {
  const { application } = await apiGet(
    `/api/applications/${segment(id)}`,
    ApplicationDraftEnvelopeSchema,
    options,
  );
  return application;
}

/**
 * `PATCH /api/applications/:id/draft` — persist the owner's reviewed answer values.
 *
 * Only `answers` is sent. The ATS kind, apply URL, and resume reference on the preview are
 * Rails-owned parts of the trusted-submit contract, so they are deliberately not echoed back
 * even though the caller holds them (AGENTS.md 2026-06-22).
 */
export async function updateApplicationDraft(
  id: number,
  autofill: Pick<AutofillPreview, "answers">,
  options: ApiRequestOptions = {},
): Promise<ApplicationDraft> {
  const answers: StructuredAnswer[] = autofill.answers.map(({ field, value }) => ({
    field,
    value,
  }));
  const { application } = await apiSend(
    "PATCH",
    `/api/applications/${segment(id)}/draft`,
    ApplicationDraftEnvelopeSchema,
    { ...options, json: { application_draft: { autofill_payload: { answers } } } },
  );
  return application;
}

/**
 * `POST /api/applications/:id/submit` — approve and dispatch the trusted submit. Sends no body.
 *
 * **Only ever called from an explicit owner action on one application.** Rails is still the final
 * safety gate (supported ATS, clean payload), and mutations are configured never to retry, so a
 * failed call cannot re-dispatch on its own.
 */
export function submitApplication(
  id: number,
  options: ApiRequestOptions = {},
): Promise<SubmitResult> {
  return apiSend("POST", `/api/applications/${segment(id)}/submit`, SubmitResultSchema, options);
}

/**
 * `PATCH /api/job_posts/:id/application_status` — the owner's manual tracker edit. Rails creates
 * the Application on first use, so an untouched posting can be marked applied.
 *
 * This is the tracker lifecycle, not the worker one: it never enqueues a worker job. Omit
 * `pipeline_note` / `next_follow_up_on` to preserve what Rails already holds — sending `""`
 * erases them.
 */
export async function updateJobApplicationStatus(
  jobId: number,
  update: ApplicationStatusUpdate,
  options: ApiRequestOptions = {},
): Promise<ApplicationTracker> {
  const { application } = await apiSend(
    "PATCH",
    `/api/job_posts/${segment(jobId)}/application_status`,
    ApplicationTrackerEnvelopeSchema,
    { ...options, json: { application: update } },
  );
  return application;
}

/* -------------------------------------------------------------------------- */
/* Profile                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * `GET /api/profile` — the single-user structured profile. Sensitive contact details come back
 * as presence flags only; Rails never serializes the raw encrypted PII.
 */
export async function fetchProfile(options: ApiRequestOptions = {}): Promise<Profile> {
  const { profile } = await apiGet("/api/profile", ProfileEnvelopeSchema, options);
  return profile;
}

/**
 * `PATCH /api/profile` — write the editable structured fields and return the refreshed profile.
 * The resume-sourced arrays and encrypted contact details are not writable here.
 */
export async function updateProfile(
  edit: ProfileEdit,
  options: ApiRequestOptions = {},
): Promise<Profile> {
  const { profile } = await apiSend("PATCH", "/api/profile", ProfileEnvelopeSchema, {
    ...options,
    json: { profile: edit },
  });
  return profile;
}

/* -------------------------------------------------------------------------- */
/* Web push                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * `GET /api/push/vapid_public_key` — the public web-push key. Public by design; the private
 * VAPID secret never leaves Rails. Fetching it here is what lets the `web` service drop the
 * `VAPID_PUBLIC_KEY` environment variable the WASM bundle needed.
 */
export async function fetchVapidPublicKey(options: ApiRequestOptions = {}): Promise<string> {
  const { vapid_public_key } = await apiGet(
    "/api/push/vapid_public_key",
    VapidPublicKeyEnvelopeSchema,
    options,
  );
  return vapid_public_key;
}

/**
 * `POST /api/push_subscription` — store a browser Web Push subscription for the daily digest.
 * Rails answers with no payload, so the body is never read.
 */
export function subscribePush(
  subscription: PushSubscription,
  options: ApiRequestOptions = {},
): Promise<void> {
  return apiSend("POST", "/api/push_subscription", null, {
    ...options,
    json: { subscription },
  });
}

/** `DELETE /api/push_subscription` — drop the stored subscription for one endpoint. */
export function unsubscribePush(endpoint: string, options: ApiRequestOptions = {}): Promise<void> {
  return apiSend("DELETE", "/api/push_subscription", null, {
    ...options,
    json: { subscription: { endpoint } },
  });
}

/* -------------------------------------------------------------------------- */
/* Contacts and outreach                                                       */
/* -------------------------------------------------------------------------- */

/**
 * `GET /api/job_posts/:id/contact_candidates` — saved people worth reaching out to about a
 * posting, each with a relevance reason. Read-only.
 */
export async function fetchContacts(
  jobId: number,
  options: ApiRequestOptions = {},
): Promise<ContactCandidate[]> {
  const { contact_candidates } = await apiGet(
    `/api/job_posts/${segment(jobId)}/contact_candidates`,
    ContactCandidatesEnvelopeSchema,
    options,
  );
  return contact_candidates;
}

/**
 * `POST /api/contact_candidates/:id/outreach_drafts` — draft an outreach message from a loose
 * template. Rails runs this synchronously through the LLM and returns the draft.
 *
 * **It NEVER sends anything.** The draft is prefilled for manual sending only, and no client code
 * may add a send action (CLAUDE.md "Never auto-send LinkedIn messages").
 */
export async function generateOutreach(
  candidateId: number,
  looseTemplate: string,
  options: ApiRequestOptions = {},
): Promise<OutreachDraft> {
  const { outreach_draft } = await apiSend(
    "POST",
    `/api/contact_candidates/${segment(candidateId)}/outreach_drafts`,
    OutreachDraftEnvelopeSchema,
    { ...options, json: { outreach_draft: { loose_template: looseTemplate } } },
  );
  return outreach_draft;
}

/* -------------------------------------------------------------------------- */
/* Manual entry                                                                */
/* -------------------------------------------------------------------------- */

/**
 * `POST /api/job_posts` — a manual import: a listing URL and/or pasted posting text, plus an
 * optional external application URL.
 *
 * Rails owns normalization, URL-identity matching, route resolution, and scoring. The typed
 * result reports whether a new post was created or an existing tracked/submitted post matched,
 * and the `import` envelope is a **sibling** of `job_post`, not nested inside it
 * (AGENTS.md 2026-09-08).
 */
export function createJobPost(
  input: ManualJobInput,
  options: ApiRequestOptions = {},
): Promise<ManualJobResult> {
  return apiSend("POST", "/api/job_posts", ManualJobResultSchema, {
    ...options,
    json: { job_post: input },
  });
}

/**
 * `POST /api/job_posts/lookup` — read what a posting URL advertises about itself so manual entry
 * can prefill. Rails owns the fetch, the private-address guard, and the deterministic extraction;
 * **nothing is persisted**, so the owner still reviews and edits before importing.
 *
 * `status` of `"unsupported"` / `"unavailable"` is not an error — it just leaves the form blank.
 */
export async function lookupPosting(
  url: string,
  options: ApiRequestOptions = {},
): Promise<PostingLookup> {
  const { lookup } = await apiSend("POST", "/api/job_posts/lookup", PostingLookupEnvelopeSchema, {
    ...options,
    json: { url },
  });
  return lookup;
}

/* -------------------------------------------------------------------------- */
/* Jobs feed query serialization                                               */
/* -------------------------------------------------------------------------- */

/** Feed params in the order `JobFeedParams.query()` sets them; `page` is handled separately. */
const FEED_FILTERS = [
  ["status", "status"],
  ["state", "state"],
  ["sort", "sort"],
  ["application", "application"],
  ["score_band", "score_band"],
  ["source", "source"],
  ["location", "location"],
  ["date_from", "date_from"],
  ["date_to", "date_to"],
] as const satisfies readonly (readonly [string, keyof JobFeedParams])[];

/**
 * Renders feed params into a query string **identical** to Go's
 * `JobFeedParams.query().Encode()`.
 *
 * Three details are load-bearing rather than incidental:
 *
 * - A filter whose value is empty *after trimming* is omitted entirely, and the value that is
 *   sent is the **untrimmed** original — precisely what Go's `set` closure did. An unset filter
 *   must never reach Rails as `""` or `"All"`.
 * - `page` is sent only when greater than 1, so page 1 inherits Rails' default.
 * - Keys are sorted and escaped the way `url.Values.Encode` does: byte-wise key order, space as
 *   `+`, and `!*'()` percent-encoded (which `encodeURIComponent` alone leaves literal).
 *
 * The result is also the cache identity of a feed page (`queryKeys.jobs.list`), so two param
 * objects that serialize the same share one cache entry.
 */
export function jobFeedQuery(params: JobFeedParams = {}): string {
  const pairs: [string, string][] = [];
  for (const [key, field] of FEED_FILTERS) {
    const value = params[field];
    if (typeof value === "string" && value.trim() !== "") pairs.push([key, value]);
  }
  if (params.page !== undefined && params.page > 1) pairs.push(["page", String(params.page)]);

  pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return pairs.map(([key, value]) => `${queryEscape(key)}=${queryEscape(value)}`).join("&");
}

/** `GET /api/job_posts` with its query string, or bare when every filter is unset. */
export function jobsPath(params: JobFeedParams = {}): string {
  const query = jobFeedQuery(params);
  return query === "" ? "/api/job_posts" : `/api/job_posts?${query}`;
}

/** Characters `encodeURIComponent` leaves literal but Go's `url.QueryEscape` percent-encodes. */
const GO_ESCAPED = /[!'()*]/g;

/** `url.QueryEscape`: unreserved is `A-Za-z0-9-_.~`, space becomes `+`, the rest is `%XX`. */
function queryEscape(value: string): string {
  return encodeURIComponent(value)
    .replace(GO_ESCAPED, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, "+");
}

/**
 * Guards a numeric id before it is interpolated into a path. `assertApiPath` only checks the
 * prefix, so a `NaN` or fractional id would otherwise reach Rails as `/api/job_posts/NaN`.
 */
function segment(id: number): string {
  if (!Number.isSafeInteger(id)) {
    throw new TypeError(`api path id must be an integer, got ${JSON.stringify(id)}`);
  }
  return String(id);
}
