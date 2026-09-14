/**
 * Manual tracker parity (`FE-20`).
 *
 * Transcribed from `TestMarkAppliedDoesNotRegressTrackedApplications`,
 * `TestJobDetailRendersPipelineStatusControls`, `TestJobDetailNeverUpdatesPipelineStatusOnRender`,
 * and `TestJobDetailDoJobStatusUpdate` in `web/components/jobs_test.go`.
 *
 * These run through the whole `JobDetailScreen` rather than the two components in isolation,
 * for two reasons the Go tests could not reach:
 *
 * - The safety property is about **requests**, not state. "The tracker quick action never
 *   creates a draft or submits one" is only proven by watching `/api/applications` and
 *   `/api/applications/:id/submit` stay at zero while the tracker is written, and those
 *   endpoints are only wired up at screen level.
 * - The staleness bug this task exists to avoid (AGENTS.md 2026-09-08) is a *sequence*: change
 *   the status, let the refetch land, then change the stage and check what the second request
 *   carried. A component rendered with fixed props cannot go stale.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";

import { createQueryClient } from "../../api/query-client";
import type { ApplicationStatusUpdate, ApplicationTracker, JobDetail } from "../../api/schemas";
import { SESSION_EXPIRED } from "../../lib/messages";
import { canMarkApplied, pipelineStatusLabel } from "../../lib/pipeline";
import { apiHandlers, fixtures } from "../../test/handlers";
import { HttpResponse, http, installMockApi } from "../../test/msw";
import { JobDetailScreen } from "./job-detail";

/** Every tracker `PATCH` body, in order. This is what the assertions are really about. */
let trackerWrites: ApplicationStatusUpdate[] = [];
/** Requests to the two endpoints the tracker must never reach. */
let applicationWrites: string[] = [];

/** The posting the fake Rails answers with. Mutated by a successful tracker write. */
let answer: JobDetail = fixtures.jobDetail;
/** Set to a status to fail the tracker `PATCH`. */
let failTrackerWith: number | null = null;

installMockApi(
  http.get("/api/job_posts/:id", () => HttpResponse.json({ job_post: answer })),
  http.patch("/api/job_posts/:id/application_status", async ({ request }) => {
    const body = (await request.json()) as { application: ApplicationStatusUpdate };
    trackerWrites.push(body.application);
    if (failTrackerWith !== null) {
      return HttpResponse.json(
        { error: { code: "server_error", message: "boom" } },
        { status: failTrackerWith },
      );
    }
    // Rails' own behaviour: a blank stage means "this status's default stage".
    const stage =
      body.application.pipeline_stage === ""
        ? defaultStageFor(body.application.pipeline_status)
        : body.application.pipeline_stage;
    const application: ApplicationTracker = {
      ...(answer.application ?? fixtures.applicationTracker),
      pipeline_status: body.application.pipeline_status,
      pipeline_stage: stage,
    };
    // The screen refetches the posting, so the next read has to agree with this response.
    answer = { ...answer, application };
    return HttpResponse.json({ application });
  }),
  http.post("/api/applications", () => {
    applicationWrites.push("create");
    return HttpResponse.json({ application: { application_id: 31, status: "draft" } });
  }),
  http.post("/api/applications/:id/submit", () => {
    applicationWrites.push("submit");
    return HttpResponse.json(fixtures.submitResult);
  }),
  // The screen also reads the cover letter (`FE-20`); everything else falls through to the
  // shared handlers, which these more specific ones shadow because MSW takes the first match.
  ...apiHandlers(),
);

/** `Application::DEFAULT_PIPELINE_STAGE_BY_STATUS`. */
function defaultStageFor(status: string): string {
  return status === "applied" ? "waiting" : "";
}

beforeEach(() => {
  trackerWrites = [];
  applicationWrites = [];
  answer = fixtures.jobDetail;
  failTrackerWith = null;
});

/** A detail payload whose tracker is `application`, or untracked when it is `null`. */
function jobTracked(application: ApplicationTracker | null): JobDetail {
  return { ...fixtures.jobDetail, application };
}

/** A tracker row in one pipeline state. */
function tracker(pipeline_status: string, pipeline_stage = ""): ApplicationTracker {
  return { ...fixtures.applicationTracker, pipeline_status, pipeline_stage };
}

async function loadedDetail() {
  const view = render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={["/jobs/101"]}>
        <Routes>
          <Route path="/jobs/:id" element={<JobDetailScreen />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() => {
    expect(view.container.querySelector(".job-pipeline-status")).not.toBeNull();
  });
  return view;
}

function statusSelect(container: HTMLElement): HTMLSelectElement {
  return select(container, ".pipeline-status-select");
}

function stageSelect(container: HTMLElement): HTMLSelectElement {
  return select(container, ".pipeline-stage-select");
}

function select(container: HTMLElement, selector: string): HTMLSelectElement {
  const found = container.querySelector<HTMLSelectElement>(selector);
  if (found === null) throw new Error(`no ${selector} rendered`);
  return found;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

describe("tracker helpers", () => {
  // TestMarkAppliedDoesNotRegressTrackedApplications, table unchanged.
  it("offers the quick action only where it cannot walk the tracker backwards", () => {
    expect(canMarkApplied(null)).toBe(true);
    for (const status of ["interested", "drafting", "needs_review"]) {
      expect(canMarkApplied(tracker(status))).toBe(true);
    }
    for (const status of [
      "applied",
      "interviewing",
      "offer",
      "rejected",
      "withdrawn",
      "archived",
    ]) {
      expect(canMarkApplied(tracker(status))).toBe(false);
    }
  });

  it("appends the stage only where it adds something", () => {
    expect(pipelineStatusLabel("applied", "waiting")).toBe("Applied · Waiting");
    expect(pipelineStatusLabel("applied", "")).toBe("Applied");
    // The two pre-application states describe a conversation that has not happened yet.
    expect(pipelineStatusLabel("interested", "waiting")).toBe("Interested");
    expect(pipelineStatusLabel("drafting", "technical")).toBe("Drafting");
    // Neither an unknown status nor an unknown stage is shown raw.
    expect(pipelineStatusLabel("", "")).toBe("Interested");
    expect(pipelineStatusLabel("applied", "invented")).toBe("Applied");
  });
});

/* -------------------------------------------------------------------------- */
/* Rendering                                                                   */
/* -------------------------------------------------------------------------- */

describe("tracker rendering", () => {
  // TestJobDetailRendersPipelineStatusControls.
  it("renders both selects on the posting's current state", async () => {
    answer = jobTracked(tracker("interviewing", "technical"));
    const { container } = await loadedDetail();

    expect(screen.getByRole("heading", { name: "Application status" })).toBeInTheDocument();
    expect(statusSelect(container).value).toBe("interviewing");
    expect(stageSelect(container).value).toBe("technical");
    expect(container.querySelector(".job-tracker-current")?.textContent).toBe(
      "Interviewing · Technical",
    );
    expect(container.querySelector(".manual-tracker-current")?.textContent).toBe(
      "Interviewing · Technical",
    );
  });

  it("shows the quick action but no status line for an untracked posting", async () => {
    answer = jobTracked(null);
    const { container } = await loadedDetail();

    expect(container.querySelector(".manual-tracker-current")).toBeNull();
    expect(container.querySelector(".job-tracker-current")).toBeNull();
    expect(screen.getByRole("button", { name: "Mark as applied" })).toBeInTheDocument();
    // Untracked defaults, matching Go's `status := "interested"; stage := ""`.
    expect(statusSelect(container).value).toBe("interested");
    expect(stageSelect(container).value).toBe("none");
  });

  it("withholds the quick action once the posting has moved past applying", async () => {
    answer = jobTracked(tracker("interviewing", "onsite"));
    const { container } = await loadedDetail();

    expect(container.querySelector(".job-mark-applied")).toBeNull();
  });

  /*
   * The empty stage keeps go-app's `none` sentinel as its DOM value (`optionNodes`), even
   * though React would render `value=""` correctly. It is normalized away before the request —
   * `pipeline_stage` is validated against /\A[a-z0-9_]+\z/, so Rails would happily store a
   * stage literally named "none".
   */
  it("renders the empty stage as the none sentinel", async () => {
    answer = jobTracked(tracker("applied", ""));
    const { container } = await loadedDetail();

    const options = [...stageSelect(container).options];
    expect(options[0]?.value).toBe("none");
    expect(options[0]?.textContent).toBe("No stage");
    expect(options.filter((option) => option.value === "")).toEqual([]);
  });

  // TestJobDetailNeverUpdatesPipelineStatusOnRender.
  it("never writes the tracker on render", async () => {
    await loadedDetail();
    expect(trackerWrites).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Writing                                                                     */
/* -------------------------------------------------------------------------- */

describe("tracker writes", () => {
  // TestJobDetailDoJobStatusUpdate.
  it("marks the posting applied and waiting, and touches nothing else", async () => {
    answer = jobTracked(null);
    const { container } = await loadedDetail();

    fireEvent.click(screen.getByRole("button", { name: "Mark as applied" }));

    await waitFor(() => {
      expect(container.querySelector(".manual-tracker-current")?.textContent).toBe(
        "Applied · Waiting",
      );
    });
    expect(trackerWrites).toEqual([{ pipeline_status: "applied", pipeline_stage: "waiting" }]);
    // The whole point of the quick action: the owner applied by hand, so Waunder must not
    // create a draft application or dispatch the submit worker.
    expect(applicationWrites).toEqual([]);
  });

  it("omits the note and follow-up date so Rails keeps the ones it holds", async () => {
    answer = jobTracked(tracker("interested"));
    const { container } = await loadedDetail();

    fireEvent.click(screen.getByRole("button", { name: "Mark as applied" }));
    // The write disables every tracker control until its refetch lands, so the second edit has
    // to wait for that rather than for the response alone.
    await waitFor(() => {
      expect(statusSelect(container)).toBeEnabled();
      expect(trackerWrites).toHaveLength(1);
    });
    fireEvent.change(statusSelect(container), { target: { value: "interviewing" } });
    await waitFor(() => {
      expect(trackerWrites).toHaveLength(2);
    });

    // Absent, not empty: `update_pipeline_status` assigns each only when it is non-nil, so an
    // empty string would erase the note the fixture's tracker carries.
    for (const write of trackerWrites) {
      expect(write).not.toHaveProperty("pipeline_note");
      expect(write).not.toHaveProperty("next_follow_up_on");
    }
    expect(fixtures.applicationTracker.pipeline_note).not.toBe("");
  });

  /*
   * A status change deliberately sends a blank stage: `assign_pipeline_status` reads that as
   * "use this status's default", which is how moving to Applied from the select lands in the
   * same state the quick action writes.
   */
  it("lets Rails pick the stage when the status changes", async () => {
    answer = jobTracked(tracker("interested"));
    const { container } = await loadedDetail();

    fireEvent.change(statusSelect(container), { target: { value: "applied" } });

    await waitFor(() => {
      expect(trackerWrites).toEqual([{ pipeline_status: "applied", pipeline_stage: "" }]);
    });
    await waitFor(() => {
      expect(stageSelect(container).value).toBe("waiting");
    });
  });

  /*
   * The bug this task exists to avoid (AGENTS.md 2026-09-08): go-app's `jobStageSetter(status)`
   * captured the status when the handler was built and could keep that closure across renders,
   * so a stage change after a status change wrote the *old* status back. The second request
   * below must carry "interviewing", not the "interested" the screen first rendered.
   */
  it("sends the status the tracker holds now, not the one it was rendered with", async () => {
    answer = jobTracked(tracker("interested"));
    const { container } = await loadedDetail();

    fireEvent.change(statusSelect(container), { target: { value: "interviewing" } });
    await waitFor(() => {
      expect(statusSelect(container).value).toBe("interviewing");
      expect(stageSelect(container)).toBeEnabled();
    });

    fireEvent.change(stageSelect(container), { target: { value: "onsite" } });

    await waitFor(() => {
      expect(trackerWrites).toHaveLength(2);
    });
    expect(trackerWrites[1]).toEqual({ pipeline_status: "interviewing", pipeline_stage: "onsite" });
  });

  it("normalizes the none sentinel back to an empty stage", async () => {
    answer = jobTracked(tracker("applied", "waiting"));
    const { container } = await loadedDetail();

    fireEvent.change(stageSelect(container), { target: { value: "none" } });

    await waitFor(() => {
      expect(trackerWrites).toEqual([{ pipeline_status: "applied", pipeline_stage: "" }]);
    });
  });

  it("reports a failed write in both tracker blocks and leaves the status alone", async () => {
    failTrackerWith = 500;
    answer = jobTracked(tracker("interested"));
    const { container } = await loadedDetail();

    fireEvent.change(statusSelect(container), { target: { value: "applied" } });

    await waitFor(() => {
      expect(container.querySelector(".job-pipeline-error")?.textContent).toBe(
        "Could not update application status.",
      );
    });
    expect(container.querySelector(".manual-status-error")?.textContent).toBe(
      "Could not update application status.",
    );
    expect(container.querySelector(".job-tracker-current")?.textContent).toBe("Interested");
  });

  it("reports an expired session as one", async () => {
    failTrackerWith = 401;
    answer = jobTracked(tracker("interested"));
    const { container } = await loadedDetail();

    fireEvent.change(statusSelect(container), { target: { value: "applied" } });

    await waitFor(() => {
      expect(container.querySelector(".job-pipeline-error")?.textContent).toBe(SESSION_EXPIRED);
    });
  });
});
