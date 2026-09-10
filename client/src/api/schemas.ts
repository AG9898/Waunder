/**
 * Runtime schemas for every payload that crosses the Rails API boundary.
 *
 * Ported from `web/components/client.go` (see docs/GO_MIGRATION.md). Schemas only:
 * no fetch code, no endpoint functions, no display helpers.
 *
 * Why runtime validation at all: Go's `json.Unmarshal` silently zero-values a shape
 * mismatch, so a renamed or retyped field reaches a screen as `""`/`0`/`nil` instead of
 * an error. That is how the empty Applications table shipped — the client asked for a
 * default it did not mean and nothing anywhere complained. These schemas reject a wrong
 * *type* loudly while still reproducing Go's decode semantics for absence.
 *
 * Go decode parity, exactly:
 *
 * - A **missing** key and an explicit **null** are the same thing to `json.Unmarshal`
 *   on a non-pointer field: the field keeps its zero value. Rails leans on this — the
 *   digest serializer emits 6 of `JobSummary`'s 13 keys, and every `belongs_to` name is
 *   `company&.name`, i.e. `null` when absent. So `goString`/`goInt`/`goBool`/`goStrings`
 *   accept `T | null | undefined` and resolve to `""`/`0`/`false`/`[]`.
 * - A **pointer** field (`*int`, `*ApplicationTracker`, …) keeps `nil` distinct from the
 *   zero value. `nullableInt`/`nullableStruct` resolve to `T | null`, so a `match_score`
 *   of `null` NEVER becomes `0` — `MatchScoreLabel` renders "Scoring…" for the first and
 *   "0%" for the second, and conflating them is a visible lie about an unscored posting.
 * - A **wrong type** (`match_score: "85"`, `job_posts: {}`, `triage_reasons: [1]`) fails
 *   parsing. This is the one deliberate divergence from Go, which errors on some of these
 *   and silently zero-values others.
 * - **Unknown keys are stripped, not rejected** (zod's default), matching `json.Unmarshal`.
 *   Rails already sends keys the Go structs never declared (`profile.work_history`,
 *   `contact_candidates[].created_at`), and a strict schema would reject live payloads.
 *
 * Request-side schemas (`ManualJobInput`, `ProfileEdit`, `ApplicationStatusUpdate`,
 * `PushSubscription`, `JobFeedParams`) describe what the client sends, so they mirror the
 * Go struct's own optionality: a `,omitempty` field is `.optional()` — omitted, never sent
 * as `""` — and everything else is required.
 */
import { z } from "zod";

/* -------------------------------------------------------------------------- */
/* Go decode parity primitives                                                 */
/* -------------------------------------------------------------------------- */

/** A Go `string` field: missing or null decodes to `""`. */
const goString = z
  .string()
  .nullish()
  .transform((value) => value ?? "");

/** A Go `int` field: missing or null decodes to `0`. */
const goInt = z
  .number()
  .int()
  .nullish()
  .transform((value) => value ?? 0);

/** A Go `bool` field: missing or null decodes to `false`. */
const goBool = z
  .boolean()
  .nullish()
  .transform((value) => value ?? false);

/** A Go `[]string` field: missing or null decodes to `[]`. */
const goStrings = z
  .array(z.string())
  .nullish()
  .transform((value) => value ?? []);

/** A Go `[]T` field: missing or null decodes to `[]`. */
const goArray = <T extends z.ZodType>(schema: T) =>
  z
    .array(schema)
    .nullish()
    .transform((value) => value ?? []);

/**
 * A Go nested struct *value* field: missing or null decodes to the struct's zero value.
 * Every field of these schemas is absence-tolerant, so re-parsing `{}` yields exactly the
 * zero value Go would have produced.
 */
const goStruct = <T extends z.ZodObject>(schema: T) =>
  schema.nullish().transform((value) => value ?? schema.parse({}));

/** A Go `*int` field: missing or null stays `null`, never `0`. */
const nullableInt = z
  .number()
  .int()
  .nullish()
  .transform((value) => value ?? null);

/** A Go `*T` struct pointer: missing or null stays `null`. */
const nullableStruct = <T extends z.ZodObject>(schema: T) =>
  schema.nullish().transform((value) => value ?? null);

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Rails' error envelope, as `apiErrorPayload` reads it. Tolerant on purpose: Go returns
 * empty code/message when the body is not this shape rather than surfacing a parse error
 * on top of the original failure.
 */
export const ApiErrorPayloadSchema = z.object({
  error: goStruct(z.object({ code: goString, message: goString })),
});
export type ApiErrorPayload = z.infer<typeof ApiErrorPayloadSchema>;

/* -------------------------------------------------------------------------- */
/* Intake                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Owner-visible state of inbound job-alert processing. `queued_count` is populated only
 * by a resume action (PATCH), reporting how many held references were requeued.
 */
export const IntakeStatusSchema = z.object({
  enabled: goBool,
  paused_at: goString,
  resumed_at: goString,
  held_count: goInt,
  processing_count: goInt,
  queued_count: goInt,
});
export type IntakeStatus = z.infer<typeof IntakeStatusSchema>;

/* -------------------------------------------------------------------------- */
/* Jobs: feed rows, detail, route, pagination                                  */
/* -------------------------------------------------------------------------- */

/** Latest terminal report from the Playwright worker for an application. */
export const WorkerReportSchema = z.object({
  status: goString,
  reason: goString,
  logs: goStrings,
  screenshots: goStrings,
});
export type WorkerReport = z.infer<typeof WorkerReportSchema>;

/**
 * User-facing status row for a job application. The pipeline fields are the owner's
 * tracker; `automation_status` stays Rails' worker-submit lifecycle.
 *
 * Two serializers produce this shape and they differ: the applications controller emits
 * every key, while the job-posts feed omits `job_title`, `company`, `approved_at`,
 * `draft_ready`, and `worker_report`. Both parse — those keys resolve to zero values,
 * exactly as the Go struct does today.
 */
export const ApplicationTrackerSchema = z.object({
  application_id: goInt,
  job_post_id: goInt,
  job_title: goString,
  company: goString,
  status: goString,
  automation_status: goString,
  pipeline_status: goString,
  pipeline_stage: goString,
  pipeline_note: goString,
  last_status_change_at: goString,
  next_follow_up_on: goString,
  approved_at: goString,
  submitted_at: goString,
  failure_reason: goString,
  draft_ready: goBool,
  worker_report: nullableStruct(WorkerReportSchema),
});
export type ApplicationTracker = z.infer<typeof ApplicationTrackerSchema>;

/**
 * Compact job-feed row. `match_score` is `*int` in Go: `null` means "no numeric score
 * yet" and is rendered from `scoring_status`, while `0` is a real 0% match.
 */
export const JobSummarySchema = z.object({
  id: goInt,
  title: goString,
  company: goString,
  source: goString,
  match_score: nullableInt,
  scoring_status: goString,
  triage_status: goString,
  triage_score: nullableInt,
  triage_reasons: goStrings,
  lifecycle_state: goString,
  summary: goString,
  /** RFC 3339 timestamp of when the posting was intaked. */
  created_at: goString,
  /** The job's most recent tracked application, or null when it is untracked. */
  application: nullableStruct(ApplicationTrackerSchema),
});
export type JobSummary = z.infer<typeof JobSummarySchema>;

/** Deterministically resolved application route, owned by ApplicationRouteResolver. */
export const JobRouteSchema = z.object({
  route_type: goString,
  recommended_route: goString,
  application_url: goString,
});
export type JobRoute = z.infer<typeof JobRouteSchema>;

/** Saved, owner-requested cover letter for a job: generated once, copied manually. */
export const CoverLetterDraftSchema = z.object({
  id: goInt,
  job_post_id: goInt,
  body: goString,
  generated_at: goString,
});
export type CoverLetterDraft = z.infer<typeof CoverLetterDraftSchema>;

/** Full scored view of one job, plus its resolved route and latest tracker row. */
export const JobDetailSchema = z.object({
  id: goInt,
  title: goString,
  company: goString,
  source: goString,
  posting_url: goString,
  compensation: goString,
  match_score: nullableInt,
  scoring_status: goString,
  triage_status: goString,
  triage_score: nullableInt,
  triage_reasons: goStrings,
  lifecycle_state: goString,
  summary: goString,
  relevant_requirements: goStrings,
  missing_requirements: goStrings,
  red_flags: goStrings,
  resume_alignment_notes: goString,
  application_strategy: goString,
  cover_letter_draft: nullableStruct(CoverLetterDraftSchema),
  route: goStruct(JobRouteSchema),
  application: nullableStruct(ApplicationTrackerSchema),
});
export type JobDetail = z.infer<typeof JobDetailSchema>;

/** Pagination envelope Rails returns alongside feed rows and ingestion batches. */
export const PageMetaSchema = z.object({
  number: goInt,
  size: goInt,
  total: goInt,
  has_next: goBool,
});
export type PageMeta = z.infer<typeof PageMetaSchema>;

/**
 * Per-tracker-group tally of the current feed query, computed over every filter EXCEPT
 * the application group itself. A job post with no application counts toward
 * `not_applied`.
 */
export const ApplicationCountsSchema = z.object({
  all: goInt,
  not_applied: goInt,
  applied: goInt,
  in_progress: goInt,
  closed: goInt,
});
export type ApplicationCounts = z.infer<typeof ApplicationCountsSchema>;

/** One page of the job feed: rows, page envelope, and the tracker-group counts. */
export const JobPageSchema = z.object({
  job_posts: goArray(JobSummarySchema),
  page: goStruct(PageMetaSchema),
  application_counts: goStruct(ApplicationCountsSchema),
});
export type JobPage = z.infer<typeof JobPageSchema>;

/** Daily digest landing payload: the date it covers and the jobs surfaced for it. */
export const DigestSchema = z.object({
  date: goString,
  jobs: goArray(JobSummarySchema),
});
export type Digest = z.infer<typeof DigestSchema>;

/**
 * One ingestion event: the postings from a single alert or digest email, grouped by
 * source and arrival time. `id` is synthetic (`<source>-<first_created_epoch>`), derived
 * in Rails — there is no persisted batch row.
 */
export const IngestionBatchSchema = z.object({
  id: goString,
  source: goString,
  ingested_at: goString,
  date: goString,
  count: goInt,
  jobs: goArray(JobSummarySchema),
});
export type IngestionBatch = z.infer<typeof IngestionBatchSchema>;

/** One page of ingestion history. */
export const IngestionBatchPageSchema = z.object({
  batches: goArray(IngestionBatchSchema),
  page: goStruct(PageMetaSchema),
});
export type IngestionBatchPage = z.infer<typeof IngestionBatchPageSchema>;

/* -------------------------------------------------------------------------- */
/* Applications: draft review and trusted submit                               */
/* -------------------------------------------------------------------------- */

/** One reviewed question/answer pair the worker will fill. */
export const StructuredAnswerSchema = z.object({
  field: goString,
  value: goString,
});
export type StructuredAnswer = z.infer<typeof StructuredAnswerSchema>;

/**
 * Mirrors the worker's `ApplicationTask` payload (`workers/src/types.ts`). Sensitive
 * questions are excluded by construction upstream — the draft generator instructs the
 * model to omit them, so they never reach this preview.
 */
export const AutofillPreviewSchema = z.object({
  ats: goString,
  apply_url: goString,
  answers: goArray(StructuredAnswerSchema),
  resume_ref: goString,
});
export type AutofillPreview = z.infer<typeof AutofillPreviewSchema>;

/** An answer field Rails will not let through the trusted-submit gate unhandled. */
export const AutofillWarningSchema = z.object({
  field: goString,
  code: goString,
  message: goString,
});
export type AutofillWarning = z.infer<typeof AutofillWarningSchema>;

/** Generated, reviewable application draft. Rendering it never approves or submits. */
export const ApplicationDraftSchema = z.object({
  application_id: goInt,
  job_title: goString,
  company: goString,
  status: goString,
  pipeline_status: goString,
  pipeline_stage: goString,
  pipeline_note: goString,
  last_status_change_at: goString,
  next_follow_up_on: goString,
  resume_emphasis_notes: goString,
  cover_letter: goString,
  draft_ready: goBool,
  failure_reason: goString,
  structured_answers: goArray(StructuredAnswerSchema),
  autofill_payload: goStruct(AutofillPreviewSchema),
  autofill_warnings: goArray(AutofillWarningSchema),
  worker_report: nullableStruct(WorkerReportSchema),
});
export type ApplicationDraft = z.infer<typeof ApplicationDraftSchema>;

/**
 * Outcome of starting an application from a job. Draft generation runs asynchronously in
 * Rails, so this carries only the id to navigate to for review — it approves nothing.
 */
export const CreateApplicationResultSchema = z.object({
  application_id: goInt,
  status: goString,
});
export type CreateApplicationResult = z.infer<typeof CreateApplicationResultSchema>;

/** Outcome of an explicit approve+submit action, including the ATS Rails resolved. */
export const SubmitResultSchema = z.object({
  status: goString,
  application_id: goInt,
  ats: goString,
});
export type SubmitResult = z.infer<typeof SubmitResultSchema>;

/* -------------------------------------------------------------------------- */
/* Contacts and outreach                                                       */
/* -------------------------------------------------------------------------- */

/** A person worth reaching out to about a posting. Carries no send action. */
export const ContactCandidateSchema = z.object({
  id: goInt,
  job_post_id: goInt,
  name: goString,
  title: goString,
  company_name: goString,
  linkedin_url: goString,
  relevance_reason: goString,
});
export type ContactCandidate = z.infer<typeof ContactCandidateSchema>;

/**
 * A generated outreach message. PREFILLED FOR MANUAL SENDING ONLY — Rails never sends it
 * and no client code may add a send action.
 */
export const OutreachDraftSchema = z.object({
  id: goInt,
  contact_candidate_id: goInt,
  message: goString,
  loose_template: goString,
});
export type OutreachDraft = z.infer<typeof OutreachDraftSchema>;

/* -------------------------------------------------------------------------- */
/* Profile                                                                     */
/* -------------------------------------------------------------------------- */

/** Presence flags only. Raw encrypted contact PII never leaves Rails. */
export const ProfileContactSchema = z.object({
  email_present: goBool,
  phone_present: goBool,
  street_address_present: goBool,
});
export type ProfileContact = z.infer<typeof ProfileContactSchema>;

/** Metadata for the current primary resume document; null until one is ingested. */
export const ResumeSummarySchema = z.object({
  title: goString,
  parse_status: goString,
  file_attached: goBool,
  filename: goString,
});
export type ResumeSummary = z.infer<typeof ResumeSummarySchema>;

/** The single-user structured profile as Rails serializes it. */
export const ProfileSchema = z.object({
  full_name: goString,
  headline: goString,
  summary: goString,
  location: goString,
  linkedin_url: goString,
  github_url: goString,
  portfolio_url: goString,
  contact: goStruct(ProfileContactSchema),
  resume: nullableStruct(ResumeSummarySchema),
});
export type Profile = z.infer<typeof ProfileSchema>;

/* -------------------------------------------------------------------------- */
/* Manual entry and posting lookup                                             */
/* -------------------------------------------------------------------------- */

/**
 * What a posting URL advertises about itself, as Rails extracted it. `status` is "ok"
 * when at least one field was read, "unsupported" for a URL Rails will not fetch, and
 * "unavailable" when the posting could not be read. The last two are not errors — they
 * just leave the form for the owner to fill in by hand, and Rails omits the field keys
 * entirely for them.
 */
export const PostingLookupSchema = z.object({
  status: goString,
  provider: goString,
  error: goString,
  title: goString,
  company: goString,
  location: goString,
  compensation: goString,
  description: goString,
});
export type PostingLookup = z.infer<typeof PostingLookupSchema>;

/** The JobPost half of a manual import response. */
export const ManualJobPostSchema = z.object({
  id: goInt,
  title: goString,
  company: goString,
  posting_url: goString,
  source: goString,
  scoring_status: goString,
  route: goStruct(JobRouteSchema),
});
export type ManualJobPost = z.infer<typeof ManualJobPostSchema>;

/**
 * Rails' typed manual-import outcome: "new" (HTTP 201) for a fresh import, or
 * "already_tracked"/"already_submitted" (HTTP 200) for an exact URL-identity match.
 * `application_status` is Rails' automation status on the matched application, not a
 * browser-derived tracking decision.
 */
export const ManualJobImportResultSchema = z.object({
  status: goString,
  application_status: goString,
});
export type ManualJobImportResult = z.infer<typeof ManualJobImportResultSchema>;

/**
 * The whole `POST /api/job_posts` response. The import envelope is a sibling of the job
 * post, not nested inside it — the Go client flattens the two into one struct after
 * decoding, which is why `ManualJobResult` there carries an untagged `Import` field.
 */
export const ManualJobResultSchema = z.object({
  job_post: goStruct(ManualJobPostSchema),
  import: goStruct(ManualJobImportResultSchema),
});
export type ManualJobResult = z.infer<typeof ManualJobResultSchema>;

/* -------------------------------------------------------------------------- */
/* Response envelopes                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Rails wraps most payloads in a single named key; the Go client declares an anonymous
 * struct per call site to unwrap it. `JobPage`, `IngestionBatchPage`, `SubmitResult`, and
 * `ManualJobResult` are the exceptions — they are already top-level.
 */
export const IntakeEnvelopeSchema = z.object({ intake: goStruct(IntakeStatusSchema) });
export const JobPostSummaryEnvelopeSchema = z.object({ job_post: goStruct(JobSummarySchema) });
export const JobPostSummariesEnvelopeSchema = z.object({ job_posts: goArray(JobSummarySchema) });
export const JobDetailEnvelopeSchema = z.object({ job_post: goStruct(JobDetailSchema) });
export const CoverLetterDraftEnvelopeSchema = z.object({
  cover_letter_draft: nullableStruct(CoverLetterDraftSchema),
});
export const DigestEnvelopeSchema = z.object({ digest: goStruct(DigestSchema) });
export const CreateApplicationEnvelopeSchema = z.object({
  application: goStruct(CreateApplicationResultSchema),
});
export const ApplicationDraftEnvelopeSchema = z.object({
  application: goStruct(ApplicationDraftSchema),
});
export const ApplicationTrackerEnvelopeSchema = z.object({
  application: goStruct(ApplicationTrackerSchema),
});
export const ProfileEnvelopeSchema = z.object({ profile: goStruct(ProfileSchema) });
export const VapidPublicKeyEnvelopeSchema = z.object({ vapid_public_key: goString });
export const ContactCandidatesEnvelopeSchema = z.object({
  contact_candidates: goArray(ContactCandidateSchema),
});
export const OutreachDraftEnvelopeSchema = z.object({
  outreach_draft: goStruct(OutreachDraftSchema),
});
export const PostingLookupEnvelopeSchema = z.object({ lookup: goStruct(PostingLookupSchema) });

/* -------------------------------------------------------------------------- */
/* Request payloads                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Owner-submitted manual entry. Rails requires at least one of `url` or `text` and
 * validates that the URL is HTTP(S); the client carries no validation of its own beyond
 * a "needs URL or text" hint. All five keys are always sent, matching the Go struct.
 */
export const ManualJobInputSchema = z.object({
  url: z.string(),
  application_url: z.string(),
  text: z.string(),
  title: z.string(),
  company: z.string(),
});
export type ManualJobInput = z.infer<typeof ManualJobInputSchema>;

/**
 * The editable profile fields. Sensitive contact details and the structured resume
 * arrays are sourced from the resume ingest and are not writable here.
 */
export const ProfileEditSchema = z.object({
  full_name: z.string(),
  headline: z.string(),
  summary: z.string(),
  location: z.string(),
  linkedin_url: z.string(),
  github_url: z.string(),
  portfolio_url: z.string(),
});
export type ProfileEdit = z.infer<typeof ProfileEditSchema>;

/**
 * The user-facing pipeline edit. `pipeline_note` and `next_follow_up_on` carry
 * `,omitempty` in Go: the status controls edit status/stage only, so omitting the other
 * two preserves the note and follow-up date already in Rails. Sending `""` would erase
 * them, so these must stay absent rather than empty.
 */
export const ApplicationStatusUpdateSchema = z.object({
  pipeline_status: z.string(),
  pipeline_stage: z.string(),
  pipeline_note: z.string().optional(),
  next_follow_up_on: z.string().optional(),
});
export type ApplicationStatusUpdate = z.infer<typeof ApplicationStatusUpdateSchema>;

/** Browser-supplied encryption keys for a push subscription. */
export const PushSubscriptionKeysSchema = z.object({
  p256dh: z.string(),
  auth: z.string(),
});
export type PushSubscriptionKeys = z.infer<typeof PushSubscriptionKeysSchema>;

/** The browser Web Push subscription posted to Rails for daily digest dispatch. */
export const PushSubscriptionSchema = z.object({
  endpoint: z.string(),
  keys: PushSubscriptionKeysSchema,
});
export type PushSubscription = z.infer<typeof PushSubscriptionSchema>;

/**
 * The owner-selected feed query for `GET /api/job_posts`.
 *
 * Not a JSON body — these become query params, and every one of them is optional because
 * Rails applies its own defaults (`status=scored`, `state=active`, `sort=oldest`,
 * `page=1`) for anything absent. An unset filter must be **omitted**, never sent as `""`
 * or an "all" sentinel: Rails matches `source=All` literally and returns nothing, which
 * is exactly the go-app select bug. The literal unions make that a type error rather than
 * a silent empty feed.
 */
export const JobFeedParamsSchema = z.object({
  status: z.enum(["scored", "unscored", "all"]).optional(),
  state: z.enum(["active", "open", "backlog", "removed"]).optional(),
  sort: z.enum(["oldest", "score", "newest", "activity"]).optional(),
  application: z.enum(["not_applied", "applied", "in_progress", "closed"]).optional(),
  score_band: z.enum(["high", "mid", "low", "unscored"]).optional(),
  /** Exact ingestion source, e.g. "linkedin". */
  source: z.string().optional(),
  /** Case-insensitive substring match. */
  location: z.string().optional(),
  /** YYYY-MM-DD bounds on created_at. */
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  /** 1-based; Rails treats anything <= 0 as page 1. */
  page: z.number().int().positive().optional(),
});
export type JobFeedParams = z.infer<typeof JobFeedParamsSchema>;
