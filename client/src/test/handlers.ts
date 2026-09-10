/**
 * A working fake Rails for the whole test suite: one MSW handler per endpoint, backed by
 * fixtures shaped like what the real serializers emit.
 *
 * Screen tests from `FE-08` onward install these once and override only the handler whose
 * response they care about:
 *
 * ```ts
 * const server = installMockApi(...apiHandlers());
 * it("shows the empty feed", async () => {
 *   server.use(jsonResponse("get", "/api/job_posts", { ...emptyJobPage }));
 * });
 * ```
 *
 * Two properties make this worth having as a shared module rather than per-file stubs:
 *
 * - **Every fixture is typed as the schema's output type**, so a schema change that adds or
 *   retypes a field fails `npm run typecheck` here instead of surfacing as a confusing
 *   `ResponseFormatError` inside an unrelated screen test.
 * - **The handlers respond to the request**, not just to the path: the feed echoes the requested
 *   page, the detail handlers use the id from the URL, and the intake toggle reflects the posted
 *   value. That keeps pagination and navigation testable without a per-test handler.
 *
 * The fixtures deliberately contain no real personal data and no live URLs beyond LinkedIn-shaped
 * example paths. Nothing here reaches the network: `installMockApi` errors on an unhandled request.
 */
import { HttpResponse, http, type HttpHandler } from "./msw";
import type {
  ApplicationCounts,
  ApplicationDraft,
  ApplicationTracker,
  ContactCandidate,
  CoverLetterDraft,
  Digest,
  IngestionBatch,
  IngestionBatchPage,
  IntakeStatus,
  JobDetail,
  JobPage,
  JobSummary,
  ManualJobResult,
  OutreachDraft,
  PageMeta,
  PostingLookup,
  Profile,
  SubmitResult,
} from "../api/schemas";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const intake: IntakeStatus = {
  enabled: true,
  paused_at: "",
  resumed_at: "2026-09-09T08:00:00Z",
  held_count: 0,
  processing_count: 0,
  queued_count: 0,
};

/** The abbreviated tracker the job-posts feed serializes (five keys short of the full one). */
const feedTracker: ApplicationTracker = {
  application_id: 41,
  job_post_id: 101,
  job_title: "",
  company: "",
  status: "draft",
  automation_status: "draft",
  pipeline_status: "applied",
  pipeline_stage: "waiting",
  pipeline_note: "Referred by a former colleague.",
  last_status_change_at: "2026-09-08T17:20:00Z",
  next_follow_up_on: "2026-09-15",
  approved_at: "",
  submitted_at: "",
  failure_reason: "",
  draft_ready: false,
  worker_report: null,
};

const scoredJob: JobSummary = {
  id: 101,
  title: "Senior Backend Engineer",
  company: "Northwind Robotics",
  source: "linkedin",
  match_score: 82,
  scoring_status: "scored",
  triage_status: "eligible",
  triage_score: 7,
  triage_reasons: ["title match: backend engineer", "location: Vancouver"],
  lifecycle_state: "active",
  summary: "Rails and Postgres platform team, hybrid in Vancouver.",
  created_at: "2026-09-08T15:04:05Z",
  application: feedTracker,
};

/** An untracked, not-yet-scored posting: `match_score` stays null, never 0. */
const unscoredJob: JobSummary = {
  id: 102,
  title: "Platform Engineer",
  company: "Cascadia Analytics",
  source: "glassdoor",
  match_score: null,
  scoring_status: "deferred",
  triage_status: "eligible",
  triage_score: 5,
  triage_reasons: ["title match: platform engineer"],
  lifecycle_state: "active",
  summary: "",
  created_at: "2026-09-08T15:06:11Z",
  application: null,
};

const applicationCounts: ApplicationCounts = {
  all: 2,
  not_applied: 1,
  applied: 1,
  in_progress: 0,
  closed: 0,
};

const page: PageMeta = { number: 1, size: 30, total: 2, has_next: false };

const jobPage: JobPage = {
  job_posts: [scoredJob, unscoredJob],
  page,
  application_counts: applicationCounts,
};

const coverLetterDraft: CoverLetterDraft = {
  id: 9,
  job_post_id: 101,
  body: "Dear hiring team, ...",
  generated_at: "2026-09-09T12:00:00Z",
};

const jobDetail: JobDetail = {
  id: 101,
  title: "Senior Backend Engineer",
  company: "Northwind Robotics",
  source: "linkedin",
  posting_url: "https://www.linkedin.com/jobs/view/4100000001",
  compensation: "",
  match_score: 82,
  scoring_status: "scored",
  triage_status: "eligible",
  triage_score: 7,
  triage_reasons: ["title match: backend engineer", "location: Vancouver"],
  lifecycle_state: "active",
  summary: "Rails and Postgres platform team, hybrid in Vancouver.",
  relevant_requirements: ["Rails", "PostgreSQL", "Background job design"],
  missing_requirements: ["Kubernetes"],
  red_flags: [],
  resume_alignment_notes: "Lead with the Rails ingestion pipeline work.",
  application_strategy: "Apply directly through the company site; skip the job board.",
  cover_letter_draft: coverLetterDraft,
  route: {
    route_type: "greenhouse",
    recommended_route: "direct_ats",
    application_url: "https://boards.greenhouse.io/northwind/jobs/4100000001",
  },
  application: feedTracker,
};

const digest: Digest = { date: "2026-09-09", jobs: [scoredJob] };

const ingestionBatch: IngestionBatch = {
  id: "linkedin-1757343845",
  source: "linkedin",
  ingested_at: "2026-09-08T15:04:05Z",
  date: "2026-09-08",
  count: 2,
  jobs: [scoredJob, unscoredJob],
};

const ingestionBatchPage: IngestionBatchPage = {
  batches: [ingestionBatch],
  page: { number: 1, size: 10, total: 1, has_next: false },
};

/** The full tracker the applications controller serializes, with every key populated. */
const applicationTracker: ApplicationTracker = {
  ...feedTracker,
  job_title: "Senior Backend Engineer",
  company: "Northwind Robotics",
  draft_ready: true,
};

const applicationDraft: ApplicationDraft = {
  application_id: 41,
  job_title: "Senior Backend Engineer",
  company: "Northwind Robotics",
  status: "draft",
  pipeline_status: "applied",
  pipeline_stage: "waiting",
  pipeline_note: "Referred by a former colleague.",
  last_status_change_at: "2026-09-08T17:20:00Z",
  next_follow_up_on: "2026-09-15",
  resume_emphasis_notes: "Lead with the Rails ingestion pipeline work.",
  cover_letter: "Dear hiring team, ...",
  draft_ready: true,
  failure_reason: "",
  structured_answers: [{ field: "Why this role?", value: "The platform team's scope fits ..." }],
  autofill_payload: {
    ats: "greenhouse",
    apply_url: "https://boards.greenhouse.io/northwind/jobs/4100000001",
    answers: [
      { field: "full_name", value: "Owner Name" },
      { field: "email", value: "owner@example.com" },
    ],
    resume_ref: "resume-primary",
  },
  autofill_warnings: [],
  worker_report: null,
};

const submitResult: SubmitResult = { status: "queued", application_id: 41, ats: "greenhouse" };

const profile: Profile = {
  full_name: "Owner Name",
  headline: "Backend engineer",
  summary: "Builds Rails services and data pipelines.",
  location: "Vancouver, BC",
  linkedin_url: "https://www.linkedin.com/in/example",
  github_url: "https://github.com/example",
  portfolio_url: "https://example.com",
  contact: { email_present: true, phone_present: true, street_address_present: false },
  resume: {
    title: "Owner Name — CV",
    parse_status: "parsed",
    file_attached: true,
    filename: "cv.pdf",
  },
};

const vapidPublicKey =
  "BFakePublicVapidKeyForTestsOnly0000000000000000000000000000000000000000000000";

const contactCandidates: ContactCandidate[] = [
  {
    id: 7,
    job_post_id: 101,
    name: "Priya Raman",
    title: "Engineering Manager, Platform",
    company_name: "Northwind Robotics",
    linkedin_url: "https://www.linkedin.com/in/example-manager",
    relevance_reason: "Hiring manager for the posted team.",
  },
];

/** Prefilled for manual sending only — no endpoint anywhere sends this. */
const outreachDraft: OutreachDraft = {
  id: 3,
  contact_candidate_id: 7,
  message: "Hi Priya, I saw the platform role at Northwind ...",
  loose_template: "short, specific, mention the ingestion pipeline",
};

const manualJobResult: ManualJobResult = {
  job_post: {
    id: 103,
    title: "Staff Engineer",
    company: "Harbour Systems",
    posting_url: "https://jobs.harbour.example/postings/staff-engineer",
    source: "manual",
    scoring_status: "pending",
    route: {
      route_type: "unknown",
      recommended_route: "manual",
      application_url: "",
    },
  },
  import: { status: "new", application_status: "" },
};

const postingLookup: PostingLookup = {
  status: "ok",
  provider: "greenhouse",
  error: "",
  title: "Staff Engineer",
  company: "Harbour Systems",
  location: "Remote (Canada)",
  compensation: "",
  description: "Harbour Systems is hiring a staff engineer for the ingestion platform.",
};

/**
 * Every canned payload the handlers serve, exported so a test can assert against the same object
 * it will receive rather than restating it.
 */
export const fixtures = {
  intake,
  scoredJob,
  unscoredJob,
  feedTracker,
  applicationCounts,
  page,
  jobPage,
  jobDetail,
  coverLetterDraft,
  digest,
  ingestionBatch,
  ingestionBatchPage,
  applicationTracker,
  applicationDraft,
  submitResult,
  profile,
  vapidPublicKey,
  contactCandidates,
  outreachDraft,
  manualJobResult,
  postingLookup,
} as const;

/** An empty feed page, for the "no results" branch of a screen test. */
export const emptyJobPage: JobPage = {
  job_posts: [],
  page: { number: 1, size: 30, total: 0, has_next: false },
  application_counts: { all: 0, not_applied: 0, applied: 0, in_progress: 0, closed: 0 },
};

/* -------------------------------------------------------------------------- */
/* Handlers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One handler per endpoint in `endpoints.ts`. Pass the whole array to `installMockApi` as the
 * base set; `server.use(...)` overrides individual endpoints per test and the base is restored
 * after each one.
 */
export function apiHandlers(): HttpHandler[] {
  return [
    // Session — both writes answer 204 with no body.
    http.post("/api/session", () => new HttpResponse(null, { status: 204 })),
    http.delete("/api/session", () => new HttpResponse(null, { status: 204 })),

    // Intake
    http.get("/api/intake", () => HttpResponse.json({ intake })),
    http.patch("/api/intake", async ({ request }) => {
      const body = (await request.json()) as { intake?: { enabled?: boolean } };
      const enabled = body.intake?.enabled ?? true;
      return HttpResponse.json({
        intake: {
          ...intake,
          enabled,
          paused_at: enabled ? "" : "2026-09-09T09:00:00Z",
          queued_count: enabled ? intake.held_count : 0,
        },
      });
    }),

    // Jobs feed
    http.get("/api/job_posts", ({ request }) => {
      const requested = Number(new URL(request.url).searchParams.get("page") ?? "1");
      const number = Number.isSafeInteger(requested) && requested > 0 ? requested : 1;
      return HttpResponse.json({ ...jobPage, page: { ...jobPage.page, number } });
    }),
    http.post("/api/job_posts/lookup", () => HttpResponse.json({ lookup: postingLookup })),
    http.post("/api/job_posts", () => HttpResponse.json(manualJobResult, { status: 201 })),
    http.patch("/api/job_posts/lifecycle", async ({ request }) => {
      const body = (await request.json()) as { ids?: number[]; lifecycle_state?: string };
      const state = body.lifecycle_state ?? "active";
      const job_posts = (body.ids ?? []).map((id) => ({
        ...scoredJob,
        id,
        lifecycle_state: state,
      }));
      return HttpResponse.json({ job_posts });
    }),
    http.patch("/api/job_posts/:id/lifecycle", async ({ params, request }) => {
      const body = (await request.json()) as { lifecycle_state?: string };
      return HttpResponse.json({
        job_post: {
          ...scoredJob,
          id: pathId(params.id),
          lifecycle_state: body.lifecycle_state ?? "active",
        },
      });
    }),
    http.post("/api/job_posts/:id/score", ({ params }) =>
      HttpResponse.json({
        job_post: { ...scoredJob, id: pathId(params.id), scoring_status: "scored" },
      }),
    ),
    http.patch("/api/job_posts/:id/application_status", async ({ params, request }) => {
      const body = (await request.json()) as {
        application?: { pipeline_status?: string; pipeline_stage?: string };
      };
      return HttpResponse.json({
        application: {
          ...applicationTracker,
          job_post_id: pathId(params.id),
          pipeline_status: body.application?.pipeline_status ?? applicationTracker.pipeline_status,
          pipeline_stage: body.application?.pipeline_stage ?? applicationTracker.pipeline_stage,
        },
      });
    }),
    http.get("/api/job_posts/:id/cover_letter_draft", ({ params }) =>
      HttpResponse.json({
        cover_letter_draft: { ...coverLetterDraft, job_post_id: pathId(params.id) },
      }),
    ),
    http.post("/api/job_posts/:id/cover_letter_draft", ({ params }) =>
      HttpResponse.json(
        { cover_letter_draft: { ...coverLetterDraft, job_post_id: pathId(params.id) } },
        { status: 201 },
      ),
    ),
    http.get("/api/job_posts/:id/contact_candidates", ({ params }) =>
      HttpResponse.json({
        contact_candidates: contactCandidates.map((candidate) => ({
          ...candidate,
          job_post_id: pathId(params.id),
        })),
      }),
    ),
    http.get("/api/job_posts/:id", ({ params }) =>
      HttpResponse.json({ job_post: { ...jobDetail, id: pathId(params.id) } }),
    ),

    // Digest and ingestion history
    http.get("/api/digest", () => HttpResponse.json({ digest })),
    http.get("/api/ingestion_batches", ({ request }) => {
      const requested = Number(new URL(request.url).searchParams.get("page") ?? "1");
      const number = Number.isSafeInteger(requested) && requested > 0 ? requested : 1;
      return HttpResponse.json({
        ...ingestionBatchPage,
        page: { ...ingestionBatchPage.page, number },
      });
    }),

    // Applications
    http.post("/api/applications", () =>
      HttpResponse.json(
        { application: { application_id: applicationDraft.application_id, status: "draft" } },
        { status: 201 },
      ),
    ),
    http.get("/api/applications/:id", ({ params }) =>
      HttpResponse.json({
        application: { ...applicationDraft, application_id: pathId(params.id) },
      }),
    ),
    http.patch("/api/applications/:id/draft", async ({ params, request }) => {
      const body = (await request.json()) as {
        application_draft?: { autofill_payload?: { answers?: { field: string; value: string }[] } };
      };
      const answers = body.application_draft?.autofill_payload?.answers ?? [];
      return HttpResponse.json({
        application: {
          ...applicationDraft,
          application_id: pathId(params.id),
          autofill_payload: { ...applicationDraft.autofill_payload, answers },
        },
      });
    }),
    http.post("/api/applications/:id/submit", ({ params }) =>
      HttpResponse.json({ ...submitResult, application_id: pathId(params.id) }),
    ),

    // Profile
    http.get("/api/profile", () => HttpResponse.json({ profile })),
    http.patch("/api/profile", async ({ request }) => {
      const body = (await request.json()) as { profile?: Partial<Profile> };
      return HttpResponse.json({ profile: { ...profile, ...body.profile } });
    }),

    // Web push — both writes answer 204 with no body.
    http.get("/api/push/vapid_public_key", () =>
      HttpResponse.json({ vapid_public_key: vapidPublicKey }),
    ),
    http.post("/api/push_subscription", () => new HttpResponse(null, { status: 204 })),
    http.delete("/api/push_subscription", () => new HttpResponse(null, { status: 204 })),

    // Outreach — generated for manual sending only; nothing is ever sent.
    http.post("/api/contact_candidates/:id/outreach_drafts", ({ params }) =>
      HttpResponse.json(
        { outreach_draft: { ...outreachDraft, contact_candidate_id: pathId(params.id) } },
        { status: 201 },
      ),
    ),
  ];
}

/** Reads a numeric path param out of MSW's `string | readonly string[]`. */
function pathId(value: string | readonly string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  return Number(raw ?? 0);
}
