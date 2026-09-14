import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  ApplicationStatusUpdate,
  ApplicationTracker,
  JobDetail,
  JobSummary,
  Profile,
} from "./schemas";
import {
  ApiErrorPayloadSchema,
  ApplicationDraftSchema,
  ApplicationStatusUpdateSchema,
  ApplicationTrackerSchema,
  ContactCandidatesEnvelopeSchema,
  CoverLetterDraftEnvelopeSchema,
  CreateApplicationEnvelopeSchema,
  DigestEnvelopeSchema,
  IngestionBatchPageSchema,
  IntakeEnvelopeSchema,
  JobDetailEnvelopeSchema,
  JobFeedParamsSchema,
  JobPageSchema,
  JobPostSummariesEnvelopeSchema,
  JobPostSummaryEnvelopeSchema,
  JobSummarySchema,
  ManualJobInputSchema,
  ManualJobResultSchema,
  OutreachDraftEnvelopeSchema,
  PostingLookupEnvelopeSchema,
  ProfileEditSchema,
  ProfileEnvelopeSchema,
  PushSubscriptionSchema,
  SubmitResultSchema,
  VapidPublicKeyEnvelopeSchema,
} from "./schemas";

/**
 * Fixtures mirror what the Rails serializers actually emit (api/app/controllers/api/*.rb),
 * including the keys they leave out. Where a fixture is deliberately partial, the test
 * says which serializer produces it.
 */

const scoredRow = {
  id: 41,
  title: "Data Analyst",
  company: "Northwind",
  source: "linkedin",
  created_at: "2026-09-01T15:04:05Z",
  application: null,
  match_score: 82,
  scoring_status: "scored",
  triage_status: "eligible",
  triage_score: 60,
  triage_reasons: ["title_match", "location_priority"],
  lifecycle_state: "active",
  summary: "Analytics role with a strong SQL emphasis.",
};

describe("inferred types", () => {
  // Checked by `npm run typecheck`, not at runtime: these fail the build if a pointer
  // field collapses into its zero value or a value field grows an accidental `null`.
  it("keeps pointer fields nullable and value fields plain", () => {
    expectTypeOf<JobSummary["match_score"]>().toEqualTypeOf<number | null>();
    expectTypeOf<JobSummary["triage_score"]>().toEqualTypeOf<number | null>();
    expectTypeOf<JobDetail["match_score"]>().toEqualTypeOf<number | null>();
    expectTypeOf<JobSummary["application"]>().toEqualTypeOf<ApplicationTracker | null>();
    expectTypeOf<ApplicationTracker["worker_report"]>().toBeNullable();
    expectTypeOf<Profile["resume"]>().toBeNullable();

    expectTypeOf<JobSummary["title"]>().toEqualTypeOf<string>();
    expectTypeOf<JobSummary["triage_reasons"]>().toEqualTypeOf<string[]>();
    expectTypeOf<ApplicationTracker["draft_ready"]>().toEqualTypeOf<boolean>();
    expectTypeOf<Profile["contact"]["email_present"]>().toEqualTypeOf<boolean>();
  });

  it("keeps the omitempty request fields optional and the rest required", () => {
    expectTypeOf<ApplicationStatusUpdate["pipeline_status"]>().toEqualTypeOf<string>();
    expectTypeOf<ApplicationStatusUpdate["pipeline_note"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<ApplicationStatusUpdate["next_follow_up_on"]>().toEqualTypeOf<
      string | undefined
    >();
  });
});

describe("Go decode parity", () => {
  it("resolves a missing key and an explicit null to the same zero value", () => {
    const fromNulls = JobSummarySchema.parse({
      id: 7,
      title: null,
      company: null,
      source: null,
      created_at: null,
      application: null,
      match_score: null,
      scoring_status: null,
      triage_status: null,
      triage_score: null,
      triage_reasons: null,
      lifecycle_state: null,
      summary: null,
    });
    const fromOmissions = JobSummarySchema.parse({ id: 7 });

    expect(fromNulls).toEqual(fromOmissions);
    expect(fromOmissions).toEqual({
      id: 7,
      title: "",
      company: "",
      source: "",
      created_at: "",
      application: null,
      match_score: null,
      scoring_status: "",
      triage_status: "",
      triage_score: null,
      triage_reasons: [],
      lifecycle_state: "",
      summary: "",
    });
  });

  it("strips unknown keys instead of rejecting them, like json.Unmarshal", () => {
    // Rails' profile payload carries work_history/education/skills, which the Go struct
    // never declared. A strict schema would reject the live response.
    const parsed = ProfileEnvelopeSchema.parse({
      profile: {
        full_name: "A. Guo",
        work_history: [{ company: "Northwind" }],
        education: [],
        skills: ["sql"],
        contact: { email_present: true, phone_present: false, street_address_present: false },
        resume: null,
      },
    });

    expect(parsed.profile).not.toHaveProperty("work_history");
    expect(parsed.profile.full_name).toBe("A. Guo");
    expect(parsed.profile.contact.email_present).toBe(true);
    expect(parsed.profile.resume).toBeNull();
  });
});

describe("JobSummarySchema", () => {
  it("parses a fully scored feed row", () => {
    expect(JobSummarySchema.parse(scoredRow)).toEqual(scoredRow);
  });

  it("keeps an unscored posting's null match_score distinct from a real zero", () => {
    const unscored = JobSummarySchema.parse({
      ...scoredRow,
      match_score: null,
      triage_score: null,
      scoring_status: "deferred",
    });
    const zeroScored = JobSummarySchema.parse({ ...scoredRow, match_score: 0 });

    expect(unscored.match_score).toBeNull();
    expect(unscored.match_score).not.toBe(0);
    expect(unscored.triage_score).toBeNull();
    expect(zeroScored.match_score).toBe(0);
  });

  it("parses the digest serializer's six-key row", () => {
    // Api::DigestController#serialize_summary emits only these keys.
    const parsed = JobSummarySchema.parse({
      id: 12,
      title: "Business Analyst",
      company: "Acme",
      match_score: null,
      scoring_status: "pending",
      summary: "",
    });

    expect(parsed.source).toBe("");
    expect(parsed.lifecycle_state).toBe("");
    expect(parsed.created_at).toBe("");
    expect(parsed.application).toBeNull();
    expect(parsed.triage_reasons).toEqual([]);
  });

  it("attaches the feed serializer's partial tracker without inventing missing keys", () => {
    // Api::JobPostsController#serialize_application omits job_title, company,
    // approved_at, draft_ready, and worker_report.
    const parsed = JobSummarySchema.parse({
      ...scoredRow,
      application: {
        application_id: 9,
        job_post_id: 41,
        status: "draft",
        automation_status: "draft",
        pipeline_status: "applied",
        pipeline_stage: "waiting",
        pipeline_note: null,
        last_status_change_at: "2026-09-02T10:00:00Z",
        next_follow_up_on: null,
        submitted_at: null,
        failure_reason: null,
      },
    });

    expect(parsed.application?.pipeline_status).toBe("applied");
    expect(parsed.application?.job_title).toBe("");
    expect(parsed.application?.approved_at).toBe("");
    expect(parsed.application?.draft_ready).toBe(false);
    expect(parsed.application?.worker_report).toBeNull();
  });
});

describe("job feed page", () => {
  it("parses rows, page envelope, and tracker counts", () => {
    const parsed = JobPageSchema.parse({
      job_posts: [scoredRow],
      page: { number: 2, size: 30, total: 41, has_next: false },
      application_counts: { all: 41, not_applied: 30, applied: 8, in_progress: 2, closed: 1 },
    });

    expect(parsed.job_posts).toHaveLength(1);
    expect(parsed.page).toEqual({ number: 2, size: 30, total: 41, has_next: false });
    expect(parsed.application_counts.not_applied).toBe(30);
  });

  it("zero-fills an absent page envelope rather than throwing", () => {
    const parsed = JobPageSchema.parse({ job_posts: [] });

    expect(parsed.page).toEqual({ number: 0, size: 0, total: 0, has_next: false });
    expect(parsed.application_counts.all).toBe(0);
  });

  it("rejects a mistyped score instead of silently defaulting it", () => {
    const result = JobPageSchema.safeParse({
      job_posts: [{ ...scoredRow, match_score: "82" }],
      page: { number: 1, size: 30, total: 1, has_next: false },
      application_counts: { all: 1, not_applied: 1, applied: 0, in_progress: 0, closed: 0 },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["job_posts", 0, "match_score"]);
  });

  it("rejects an object where the rows array belongs", () => {
    expect(JobPageSchema.safeParse({ job_posts: {} }).success).toBe(false);
  });

  it("rejects a non-string element inside a string array", () => {
    expect(JobSummarySchema.safeParse({ ...scoredRow, triage_reasons: ["ok", 2] }).success).toBe(
      false,
    );
  });

  it("rejects a fractional id", () => {
    expect(JobSummarySchema.safeParse({ ...scoredRow, id: 41.5 }).success).toBe(false);
  });
});

describe("job detail", () => {
  it("parses a scored detail payload with route, cover letter, and tracker", () => {
    const parsed = JobDetailEnvelopeSchema.parse({
      job_post: {
        id: 41,
        title: "Data Analyst",
        company: "Northwind",
        source: "linkedin",
        posting_url: "https://www.linkedin.com/jobs/view/4231",
        compensation: "$90k–$110k",
        match_score: 82,
        scoring_status: "scored",
        triage_status: "eligible",
        triage_score: 60,
        triage_reasons: ["title_match"],
        lifecycle_state: "active",
        summary: "Analytics role.",
        relevant_requirements: ["SQL", "dbt"],
        missing_requirements: ["Looker"],
        red_flags: [],
        resume_alignment_notes: "Lead with the warehouse work.",
        application_strategy: "Apply direct.",
        cover_letter_draft: {
          id: 3,
          job_post_id: 41,
          body: "Dear hiring team,",
          generated_at: "2026-09-02T09:00:00Z",
        },
        application: null,
        route: {
          route_type: "linkedin_easy_apply",
          recommended_route: "job_board_apply",
          application_url: "https://www.linkedin.com/jobs/view/4231",
        },
      },
    });

    expect(parsed.job_post.route.route_type).toBe("linkedin_easy_apply");
    expect(parsed.job_post.cover_letter_draft?.body).toBe("Dear hiring team,");
    expect(parsed.job_post.application).toBeNull();
  });

  it("keeps an unresolved route as zero values and a missing cover letter as null", () => {
    const parsed = JobDetailEnvelopeSchema.parse({
      job_post: {
        id: 42,
        route: { route_type: null, recommended_route: null, application_url: null },
        cover_letter_draft: null,
      },
    });

    expect(parsed.job_post.route).toEqual({
      route_type: "",
      recommended_route: "",
      application_url: "",
    });
    expect(parsed.job_post.cover_letter_draft).toBeNull();
    expect(parsed.job_post.match_score).toBeNull();
  });

  it("parses the standalone cover-letter envelope, including the empty case", () => {
    expect(CoverLetterDraftEnvelopeSchema.parse({ cover_letter_draft: null })).toEqual({
      cover_letter_draft: null,
    });
    expect(
      CoverLetterDraftEnvelopeSchema.parse({
        cover_letter_draft: { id: 3, job_post_id: 41, body: "x", generated_at: "" },
      }).cover_letter_draft?.id,
    ).toBe(3);
  });
});

describe("application draft", () => {
  it("parses a ready draft with its autofill preview", () => {
    const parsed = ApplicationDraftSchema.parse({
      application_id: 9,
      job_title: "Data Analyst",
      company: "Northwind",
      status: "draft",
      pipeline_status: "drafting",
      pipeline_stage: null,
      pipeline_note: null,
      last_status_change_at: "2026-09-02T10:00:00Z",
      next_follow_up_on: null,
      resume_emphasis_notes: "Lead with the warehouse work.",
      cover_letter: "Dear hiring team,",
      draft_ready: true,
      failure_reason: null,
      structured_answers: [{ field: "email", value: "owner@example.com" }],
      autofill_payload: {
        ats: "greenhouse",
        apply_url: "https://boards.greenhouse.io/acme/jobs/1",
        answers: [{ field: "email", value: "owner@example.com" }],
        resume_ref: "resume-1",
      },
      autofill_warnings: [],
      worker_report: null,
    });

    expect(parsed.draft_ready).toBe(true);
    expect(parsed.autofill_payload.answers).toEqual([
      { field: "email", value: "owner@example.com" },
    ]);
    expect(parsed.worker_report).toBeNull();
  });

  it("parses an application whose draft generation has not produced one yet", () => {
    // Api::ApplicationsController#serialize_draft reads draft&.field, so every
    // draft-owned key is null while GenerateApplicationDraftJob is still pending.
    const parsed = ApplicationDraftSchema.parse({
      application_id: 9,
      job_title: "Data Analyst",
      company: "Northwind",
      status: "draft",
      pipeline_status: "drafting",
      pipeline_stage: null,
      pipeline_note: null,
      last_status_change_at: null,
      next_follow_up_on: null,
      resume_emphasis_notes: null,
      cover_letter: null,
      draft_ready: false,
      failure_reason: null,
      structured_answers: [],
      autofill_payload: { ats: null, apply_url: null, answers: [], resume_ref: null },
      autofill_warnings: [],
      worker_report: null,
    });

    expect(parsed.draft_ready).toBe(false);
    expect(parsed.cover_letter).toBe("");
    expect(parsed.autofill_payload).toEqual({
      ats: "",
      apply_url: "",
      answers: [],
      resume_ref: "",
    });
    expect(parsed.worker_report).toBeNull();
  });

  it("parses a paused worker report and its warnings", () => {
    const parsed = ApplicationDraftSchema.parse({
      application_id: 9,
      draft_ready: true,
      autofill_warnings: [
        { field: "sponsorship", code: "sensitive_field", message: "Answer this manually." },
      ],
      worker_report: {
        status: "paused",
        reason: "unknown_field",
        logs: ["opened form"],
        screenshots: ["https://example.test/shot.png"],
      },
    });

    expect(parsed.autofill_warnings[0]?.code).toBe("sensitive_field");
    expect(parsed.worker_report?.status).toBe("paused");
    expect(parsed.worker_report?.logs).toEqual(["opened form"]);
  });

  it("rejects a worker report whose logs are not an array of strings", () => {
    const result = ApplicationDraftSchema.safeParse({
      application_id: 9,
      worker_report: { status: "failed", reason: "boom", logs: "boom", screenshots: [] },
    });

    expect(result.success).toBe(false);
  });
});

describe("application tracker and submit", () => {
  it("parses the full tracker serializer", () => {
    const parsed = ApplicationTrackerSchema.parse({
      application_id: 9,
      job_post_id: 41,
      job_title: "Data Analyst",
      company: "Northwind",
      status: "submitted",
      automation_status: "submitted",
      pipeline_status: "applied",
      pipeline_stage: "waiting",
      pipeline_note: "Referred by R.",
      last_status_change_at: "2026-09-02T10:00:00Z",
      next_follow_up_on: "2026-09-16",
      approved_at: "2026-09-02T09:59:00Z",
      submitted_at: "2026-09-02T10:00:00Z",
      failure_reason: null,
      draft_ready: true,
      worker_report: null,
    });

    expect(parsed.submitted_at).toBe("2026-09-02T10:00:00Z");
    expect(parsed.failure_reason).toBe("");
  });

  it("parses the create and submit results", () => {
    expect(
      CreateApplicationEnvelopeSchema.parse({
        application: { application_id: 9, status: "draft" },
      }),
    ).toEqual({ application: { application_id: 9, status: "draft" } });

    expect(
      SubmitResultSchema.parse({ status: "dispatched", application_id: 9, ats: "greenhouse" }),
    ).toEqual({ status: "dispatched", application_id: 9, ats: "greenhouse" });
  });
});

describe("ingestion history and digest", () => {
  it("parses a page of ingestion batches with their nested postings", () => {
    const parsed = IngestionBatchPageSchema.parse({
      batches: [
        {
          id: "linkedin-1757000000",
          source: "linkedin",
          ingested_at: "2026-09-04T13:20:00Z",
          date: "2026-09-04",
          count: 2,
          jobs: [scoredRow, { ...scoredRow, id: 42, match_score: null }],
        },
      ],
      page: { number: 1, size: 30, total: 1, has_next: false },
    });

    expect(parsed.batches[0]?.count).toBe(2);
    expect(parsed.batches[0]?.jobs[1]?.match_score).toBeNull();
  });

  it("parses the digest envelope", () => {
    const parsed = DigestEnvelopeSchema.parse({
      digest: { date: "2026-09-04", jobs: [scoredRow] },
    });

    expect(parsed.digest.date).toBe("2026-09-04");
    expect(parsed.digest.jobs).toHaveLength(1);
  });

  it("treats an empty digest as an empty list, not a failure", () => {
    expect(DigestEnvelopeSchema.parse({ digest: { date: "2026-09-04" } }).digest.jobs).toEqual([]);
  });
});

describe("intake", () => {
  it("parses the paused state and a resume's queued count", () => {
    const paused = IntakeEnvelopeSchema.parse({
      intake: {
        enabled: false,
        paused_at: "2026-09-04T08:00:00Z",
        resumed_at: null,
        held_count: 3,
        processing_count: 0,
      },
    });

    expect(paused.intake.enabled).toBe(false);
    expect(paused.intake.resumed_at).toBe("");
    // queued_count is only present on the PATCH response.
    expect(paused.intake.queued_count).toBe(0);

    const resumed = IntakeEnvelopeSchema.parse({
      intake: { enabled: true, held_count: 0, processing_count: 0, queued_count: 3 },
    });
    expect(resumed.intake.queued_count).toBe(3);
  });

  it("rejects a stringly-typed enabled flag", () => {
    expect(IntakeEnvelopeSchema.safeParse({ intake: { enabled: "true" } }).success).toBe(false);
  });
});

describe("lifecycle envelopes", () => {
  it("parses the single-row and bulk lifecycle responses", () => {
    expect(JobPostSummaryEnvelopeSchema.parse({ job_post: scoredRow }).job_post.id).toBe(41);
    expect(
      JobPostSummariesEnvelopeSchema.parse({ job_posts: [scoredRow, scoredRow] }).job_posts,
    ).toHaveLength(2);
  });
});

describe("profile", () => {
  it("parses a profile with an ingested resume", () => {
    const parsed = ProfileEnvelopeSchema.parse({
      profile: {
        full_name: "A. Guo",
        headline: "Data analyst",
        summary: "",
        location: "Vancouver",
        linkedin_url: "https://www.linkedin.com/in/example",
        github_url: "",
        portfolio_url: "https://example.test",
        contact: { email_present: true, phone_present: true, street_address_present: false },
        resume: {
          title: "CV_AG",
          parse_status: "parsed",
          file_attached: true,
          filename: "cv.pdf",
        },
      },
    });

    expect(parsed.profile.contact.street_address_present).toBe(false);
    expect(parsed.profile.resume?.parse_status).toBe("parsed");
  });

  it("zero-fills the contact flags when Rails omits the block", () => {
    const parsed = ProfileEnvelopeSchema.parse({ profile: { full_name: "A. Guo" } });

    expect(parsed.profile.contact).toEqual({
      email_present: false,
      phone_present: false,
      street_address_present: false,
    });
    expect(parsed.profile.resume).toBeNull();
  });
});

describe("contacts and outreach", () => {
  it("parses saved contact candidates", () => {
    const parsed = ContactCandidatesEnvelopeSchema.parse({
      contact_candidates: [
        {
          id: 5,
          job_post_id: 41,
          name: "R. Chen",
          title: "Analytics Lead",
          company_name: "Northwind",
          linkedin_url: "https://www.linkedin.com/in/rchen",
          relevance_reason: "Runs the team that owns the role.",
          created_at: "2026-09-03T12:00:00Z",
        },
      ],
    });

    expect(parsed.contact_candidates[0]?.name).toBe("R. Chen");
  });

  it("parses a generated outreach draft", () => {
    const parsed = OutreachDraftEnvelopeSchema.parse({
      outreach_draft: {
        id: 2,
        contact_candidate_id: 5,
        message: "Hi R — I just applied to the analyst role.",
        loose_template: "short intro",
      },
    });

    expect(parsed.outreach_draft.message).toContain("Hi R");
  });
});

describe("posting lookup", () => {
  it("parses a successful lookup", () => {
    const parsed = PostingLookupEnvelopeSchema.parse({
      lookup: {
        status: "ok",
        provider: "greenhouse",
        error: null,
        title: "Data Analyst",
        company: "Acme",
        location: "Vancouver, BC",
        compensation: "",
        description: "You will own the warehouse.",
      },
    });

    expect(parsed.lookup.status).toBe("ok");
    expect(parsed.lookup.error).toBe("");
  });

  it("parses an unavailable lookup, which carries no field keys at all", () => {
    // Api::JobPostsController#lookup splats result.fields, and the unavailable Result
    // has none of them - only status and error.
    const parsed = PostingLookupEnvelopeSchema.parse({
      lookup: {
        status: "unavailable",
        error: "Could not read the title and company from that link",
      },
    });

    expect(parsed.lookup.status).toBe("unavailable");
    expect(parsed.lookup.title).toBe("");
    expect(parsed.lookup.company).toBe("");
    expect(parsed.lookup.description).toBe("");
    expect(parsed.lookup.provider).toBe("");
  });

  it("parses an unsupported lookup", () => {
    const parsed = PostingLookupEnvelopeSchema.parse({
      lookup: { status: "unsupported", error: "That host is not fetched" },
    });

    expect(parsed.lookup.status).toBe("unsupported");
  });
});

describe("manual import", () => {
  it("parses the sibling job_post and import envelope", () => {
    const parsed = ManualJobResultSchema.parse({
      job_post: {
        id: 77,
        title: "Data Analyst",
        company: "Acme",
        posting_url: "https://boards.greenhouse.io/acme/jobs/1",
        source: "manual",
        scoring_status: "pending",
        route: {
          route_type: "greenhouse",
          recommended_route: "direct_ats",
          application_url: "https://boards.greenhouse.io/acme/jobs/1",
        },
      },
      import: { status: "new", application_status: null },
    });

    expect(parsed.job_post.id).toBe(77);
    expect(parsed.import.status).toBe("new");
    expect(parsed.import.application_status).toBe("");
  });

  it("parses an already-submitted match, which does carry an application status", () => {
    const parsed = ManualJobResultSchema.parse({
      job_post: { id: 77, route: null },
      import: { status: "already_submitted", application_status: "submitted" },
    });

    expect(parsed.import.application_status).toBe("submitted");
    expect(parsed.job_post.route.route_type).toBe("");
  });
});

describe("push", () => {
  it("parses the VAPID public key envelope", () => {
    expect(VapidPublicKeyEnvelopeSchema.parse({ vapid_public_key: "BPk" }).vapid_public_key).toBe(
      "BPk",
    );
    expect(VapidPublicKeyEnvelopeSchema.parse({}).vapid_public_key).toBe("");
  });

  it("requires both browser-supplied subscription keys on the request", () => {
    expect(
      PushSubscriptionSchema.parse({
        endpoint: "https://push.example.test/abc",
        keys: { p256dh: "key", auth: "auth" },
      }).keys.auth,
    ).toBe("auth");

    expect(
      PushSubscriptionSchema.safeParse({
        endpoint: "https://push.example.test/abc",
        keys: { p256dh: "key" },
      }).success,
    ).toBe(false);
  });
});

describe("request payloads", () => {
  it("requires every manual entry and profile edit field to be sent", () => {
    expect(ManualJobInputSchema.safeParse({ url: "https://example.test" }).success).toBe(false);
    expect(
      ManualJobInputSchema.parse({
        url: "https://example.test",
        application_url: "",
        text: "",
        title: "",
        company: "",
      }).text,
    ).toBe("");

    expect(ProfileEditSchema.safeParse({ full_name: "A. Guo" }).success).toBe(false);
  });

  it("lets a status update omit the note and follow-up date so Rails preserves them", () => {
    const parsed = ApplicationStatusUpdateSchema.parse({
      pipeline_status: "applied",
      pipeline_stage: "waiting",
    });

    expect(parsed).toEqual({ pipeline_status: "applied", pipeline_stage: "waiting" });
    expect(Object.keys(parsed)).not.toContain("pipeline_note");
    expect(Object.keys(parsed)).not.toContain("next_follow_up_on");
  });

  it("accepts an omitted feed filter but rejects an empty-string sentinel", () => {
    expect(JobFeedParamsSchema.parse({})).toEqual({});
    expect(
      JobFeedParamsSchema.parse({ status: "all", state: "open", sort: "activity", page: 2 }),
    ).toEqual({ status: "all", state: "open", sort: "activity", page: 2 });

    // The go-app select bug: an "All" option that reports "" (or its own label) as the
    // value turns into source=All / score_band="" and matches nothing in Rails.
    expect(JobFeedParamsSchema.safeParse({ score_band: "" }).success).toBe(false);
    expect(JobFeedParamsSchema.safeParse({ status: "All" }).success).toBe(false);
    expect(JobFeedParamsSchema.safeParse({ page: 0 }).success).toBe(false);
  });
});

describe("error payload", () => {
  it("reads Rails' error envelope", () => {
    expect(
      ApiErrorPayloadSchema.parse({
        error: { code: "llm_unavailable", message: "Cover-letter generation is not configured" },
      }).error.code,
    ).toBe("llm_unavailable");
  });

  it("resolves a body without an error block to empty strings, as Go does", () => {
    expect(ApiErrorPayloadSchema.parse({}).error).toEqual({ code: "", message: "" });
  });
});
