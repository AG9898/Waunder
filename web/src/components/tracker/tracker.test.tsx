/**
 * Application tracker parity (`FE-22`).
 *
 * Transcribed from `web/components/applications_test.go`, with the differences that are the point
 * of the port:
 *
 * - The Go tests asserted `m.gotParams.Status == "all"` on a mock client. Here Rails is MSW, so
 *   the assertion is on the **query string that left the screen** — the only place a missing
 *   `status` parameter is visible, and exactly what a green spec missed when the table rendered
 *   empty in production (AGENTS.md 2026-09-08).
 * - Go exercised tab, bin, sort, and paging through `applyGroup` / `applyBin` / … because an
 *   `OnClick` could not be invoked from a test. Here the controls are pressed.
 * - A status write is proven by its request, the absence of any draft or submit request, and the
 *   refetch that follows — including a row leaving the tab it was edited in.
 * - The Surface v2 grid rules are `app.css` facts. jsdom has no layout, so the stylesheet is parsed
 *   and the pinned-column, scroll, row-height, and gridline rules are pinned next to the markup
 *   that keys off them.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { delay } from "msw";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryRouter } from "react-router";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createQueryClient } from "../../api/query-client";
import {
  ApplicationTrackerSchema,
  type ApplicationCounts,
  type ApplicationStatusUpdate,
  type ApplicationTracker,
  type JobPage,
  type JobSummary,
  type PageMeta,
} from "../../api/schemas";
import { SESSION_EXPIRED } from "../../lib/messages";
import {
  DEFAULT_TRACKER_SELECTION,
  appliedToCount,
  isStatusWrite,
  nextTrackerPage,
  parseTrackerBin,
  parseTrackerSort,
  previousTrackerPage,
  selectTrackerBin,
  selectTrackerGroup,
  selectTrackerSort,
  trackerAppliedLabel,
  trackerDate,
  trackerDateOnly,
  trackerEmptyMessage,
  trackerFollowUpState,
  trackerParams,
  trackerStageLabel,
  trackerStatusValue,
  trackerUpdatedLabel,
} from "../../lib/tracker";
import { fixtures } from "../../test/handlers";
import { HttpResponse, http, installMockApi } from "../../test/msw";
import { TrackerScreen } from "./tracker";

const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

class TestResizeObserver {
  observe(): void {
    void 0;
  }

  unobserve(): void {
    void 0;
  }

  disconnect(): void {
    void 0;
  }
}

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterAll(() => {
  HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- */
/* Fake Rails                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * `Api::JobPostsController::APPLICATION_GROUPS`, inverted. Transcribed from the controller rather
 * than taken from `trackerGroup`, so the fake Rails does not agree with the code under test by
 * construction (`labels.test.ts` checks `trackerGroup` against the real constant).
 */
const RAILS_GROUP_BY_STATUS: Readonly<Record<string, string>> = {
  interested: "not_applied",
  drafting: "not_applied",
  needs_review: "not_applied",
  applied: "applied",
  interviewing: "in_progress",
  offer: "in_progress",
  rejected: "closed",
  withdrawn: "closed",
  archived: "closed",
};

function railsGroup(application: ApplicationTracker | null): string {
  if (application === null) return "not_applied";
  return RAILS_GROUP_BY_STATUS[application.pipeline_status] ?? "not_applied";
}

/** `Application::DEFAULT_PIPELINE_STAGE_BY_STATUS`. */
function defaultStageFor(status: string): string {
  return status === "applied" ? "waiting" : "";
}

/** The fake Rails' job posts. A successful status write updates their trackers. */
let rows: JobSummary[] = [];
/** Every `GET /api/job_posts` query, in order. */
let requests: URLSearchParams[] = [];
/** Every status `PATCH`, in order: the job id from the path and the `application` body. */
let statusWrites: { id: number; body: ApplicationStatusUpdate }[] = [];
/** Requests to the two endpoints the tracker must never reach. */
let applicationRequests: string[] = [];
/** Overrides the counts Rails reports; `null` tallies `rows`. */
let countsOverride: ApplicationCounts | null = null;
/** Overrides the page envelope for a requested page; `null` reports one full page. */
let pageFor: ((number: number) => PageMeta) | null = null;
let failReadWith: number | null = null;
let failWriteWith: number | null = null;
/** Delays every read after the first, so an in-flight tab switch is observable. */
let laterReadDelay = 0;
let writeDelay = 0;

function errorBody(status: number) {
  return HttpResponse.json({ error: { code: "server_error", message: "boom" } }, { status });
}

installMockApi(
  http.get("/api/job_posts", async ({ request }) => {
    const query = new URL(request.url).searchParams;
    requests.push(query);
    if (requests.length > 1 && laterReadDelay > 0) await delay(laterReadDelay);
    if (failReadWith !== null) return errorBody(failReadWith);

    const group = query.get("application") ?? "";
    const matching = rows.filter((job) => group === "" || railsGroup(job.application) === group);
    const number = Number(query.get("page") ?? "1");
    const page: JobPage = {
      job_posts: matching,
      page: pageFor?.(number) ?? { number, size: 30, total: matching.length, has_next: false },
      application_counts: countsOverride ?? tally(rows),
    };
    return HttpResponse.json(page);
  }),
  http.patch("/api/job_posts/:id/application_status", async ({ params, request }) => {
    const id = Number(params.id);
    const body = (await request.json()) as { application: ApplicationStatusUpdate };
    statusWrites.push({ id, body: body.application });
    if (writeDelay > 0) await delay(writeDelay);
    if (failWriteWith !== null) return errorBody(failWriteWith);

    const stage =
      body.application.pipeline_stage || defaultStageFor(body.application.pipeline_status);
    let application: ApplicationTracker = fixtures.feedTracker;
    rows = rows.map((job) => {
      if (job.id !== id) return job;
      application = {
        ...(job.application ?? fixtures.feedTracker),
        job_post_id: id,
        pipeline_status: body.application.pipeline_status,
        pipeline_stage: stage,
        last_status_change_at: "2026-09-10T12:00:00Z",
      };
      return { ...job, application };
    });
    return HttpResponse.json({ application });
  }),
  http.post("/api/applications", () => {
    applicationRequests.push("create");
    return HttpResponse.json({ application: { application_id: 31, status: "draft" } });
  }),
  http.post("/api/applications/:id/submit", () => {
    applicationRequests.push("submit");
    return HttpResponse.json(fixtures.submitResult);
  }),
);

/** Rails' `application_counts`, over every row (the fake applies no other filter). */
function tally(jobs: JobSummary[]): ApplicationCounts {
  const counts: ApplicationCounts = {
    all: jobs.length,
    not_applied: 0,
    applied: 0,
    in_progress: 0,
    closed: 0,
  };
  for (const job of jobs) {
    counts[railsGroup(job.application) as Exclude<keyof ApplicationCounts, "all">] += 1;
  }
  return counts;
}

/** A tracker row in one pipeline state. */
function tracker(
  pipeline_status: string,
  pipeline_stage = "",
  last_status_change_at = "2026-09-05T09:30:00Z",
  next_follow_up_on = fixtures.feedTracker.next_follow_up_on,
): ApplicationTracker {
  return {
    ...fixtures.feedTracker,
    pipeline_status,
    pipeline_stage,
    last_status_change_at,
    next_follow_up_on,
  };
}

/** `trackerJobs()` from the Go test: one applied-and-waiting row, one untracked row. */
function trackerJobs(): JobSummary[] {
  return [
    {
      ...fixtures.scoredJob,
      id: 42,
      title: "Staff Engineer",
      company: "Acme",
      source: "linkedin",
      match_score: 82,
      scoring_status: "scored",
      created_at: "2026-09-01T10:00:00Z",
      application: {
        ...tracker("applied", "waiting"),
        application_id: 7,
        job_post_id: 42,
        next_follow_up_on: "2099-09-15",
      },
    },
    {
      ...fixtures.unscoredJob,
      id: 43,
      title: "Principal Engineer",
      company: "Globex",
      source: "glassdoor",
      match_score: null,
      scoring_status: "deferred",
      created_at: "2026-09-03T10:00:00Z",
      application: null,
    },
  ];
}

beforeEach(() => {
  rows = trackerJobs();
  requests = [];
  statusWrites = [];
  applicationRequests = [];
  countsOverride = null;
  pageFor = null;
  failReadWith = null;
  failWriteWith = null;
  laterReadDelay = 0;
  writeDelay = 0;
});

function renderTracker() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={["/applications"]}>
        <TrackerScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Renders the screen and waits for the table. */
async function loadedTracker() {
  const view = renderTracker();
  await waitFor(() => {
    expect(view.container.querySelector(".tracker-table")).not.toBeNull();
  });
  return view;
}

function statusTriggerFor(title: string): HTMLButtonElement {
  return screen.getByRole<HTMLButtonElement>("button", {
    name: `Application status for ${title}`,
  });
}

function stageTriggerFor(title: string): HTMLButtonElement {
  return screen.getByRole<HTMLButtonElement>("button", {
    name: `Application stage for ${title}`,
  });
}

function statusValueFor(title: string): string | undefined {
  return statusTriggerFor(title).querySelector<HTMLElement>("[data-slot='status-chip']")?.dataset
    .status;
}

function rowFor(title: string): HTMLElement {
  const row = statusTriggerFor(title).closest("tr");
  if (row === null) throw new Error(`no row for ${title}`);
  return row;
}

async function openStatusFor(title: string): Promise<HTMLElement> {
  fireEvent.click(statusTriggerFor(title));
  return waitFor(() => screen.getByRole<HTMLElement>("listbox"));
}

async function chooseStatus(title: string, value: string): Promise<void> {
  const list = await openStatusFor(title);
  const option = list.querySelector<HTMLElement>(`[cmdk-item][data-value="${value}"]`);
  if (option === null) throw new Error(`no status option ${value}`);
  fireEvent.click(option);
}

async function openStageFor(title: string): Promise<HTMLElement> {
  fireEvent.click(stageTriggerFor(title));
  return waitFor(() => screen.getByRole<HTMLElement>("listbox"));
}

async function chooseStage(title: string, value: string): Promise<void> {
  const list = await openStageFor(title);
  const domValue = value === "" ? "none" : value;
  const option = list.querySelector<HTMLElement>(`[cmdk-item][data-value="${domValue}"]`);
  if (option === null) throw new Error(`no stage option ${value}`);
  fireEvent.click(option);
}

function groupTabs(): HTMLElement[] {
  return within(screen.getByRole("tablist", { name: "Application status" })).getAllByRole("tab");
}

function tab(label: string): HTMLElement {
  const found = groupTabs().find(
    (candidate) => candidate.querySelector(".tracker-tab-label")?.textContent === label,
  );
  if (found === undefined) throw new Error(`no ${label} tab`);
  return found;
}

function tabCount(label: string): string | null | undefined {
  return tab(label).querySelector(".tracker-tab-count")?.textContent;
}

function summary(): string | null | undefined {
  return document.querySelector(".applications-summary")?.textContent;
}

/** Lets any request a click would have started actually start. */
function settle(ms = 60): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

describe("tracker helpers", () => {
  /*
   * Produced by running `trackerDate` from applications.go under Go 1.26 — not a restatement of
   * the TypeScript. The offset is kept rather than converted, lowercase `t`/`z` are refused, a
   * fraction needs a digit, U+00A0 is trimmed while U+FEFF is not, and year 0000 parses.
   */
  it.each([
    ["2026-09-05T09:30:00Z", "5 Sep 2026"],
    ["2026-09-01T10:00:00Z", "1 Sep 2026"],
    ["2026-09-08T23:30:00-07:00", "8 Sep 2026"],
    ["2026-09-08T00:30:00+09:00", "8 Sep 2026"],
    ["2026-09-08T17:20:00.123456Z", "8 Sep 2026"],
    ["2026-09-08T17:20:00,123Z", "8 Sep 2026"],
    ["2026-09-08T10:00:00.1234567891234Z", "8 Sep 2026"],
    ["2026-09-08T10:00:00.5+01:00", "8 Sep 2026"],
    ["  2026-09-08T17:20:00Z\n", "8 Sep 2026"],
    ["2026-09-08T10:00:00Z ", "8 Sep 2026"],
    [" 2026-09-08T10:00:00Z", "8 Sep 2026"],
    ["﻿2026-09-08T10:00:00Z", "—"],
    ["2026-09-08t17:20:00z", "—"],
    ["2026-09-08 17:20:00Z", "—"],
    ["2026-09-08T17:20Z", "—"],
    ["2026-09-08", "—"],
    ["", "—"],
    ["not a date", "—"],
    ["2026-02-30T10:00:00Z", "—"],
    ["2026-13-01T10:00:00Z", "—"],
    ["2026-00-10T10:00:00Z", "—"],
    ["2026-09-00T10:00:00Z", "—"],
    ["2026-09-31T10:00:00Z", "—"],
    ["2025-02-29T10:00:00Z", "—"],
    ["2024-02-29T10:00:00Z", "29 Feb 2024"],
    ["2026-09-08T24:00:00Z", "—"],
    ["2026-09-08T23:60:00Z", "—"],
    ["2026-09-08T23:59:60Z", "—"],
    ["2026-09-08T10:00:00+24:00", "8 Sep 2026"],
    ["2026-09-08T10:00:00+05:60", "8 Sep 2026"],
    ["2026-09-08T10:00:00+25:00", "—"],
    ["2026-09-08T10:00:00+05:61", "—"],
    ["2026-09-08T10:00:00-00:00", "8 Sep 2026"],
    ["2026-09-08T10:00:00+0500", "—"],
    ["2026-09-08T10:00:00+05:00:00", "—"],
    ["2026-09-08T10:00:00.Z", "—"],
    ["2026-09-08T10:00:00,Z", "—"],
    ["2026-09-08T10:00:00.5", "—"],
    ["2026-09-08T10:00:00ZZ", "—"],
    ["2026-9-8T10:00:00Z", "—"],
    ["+2026-09-08T10:00:00Z", "—"],
    ["0001-01-01T00:00:00Z", "1 Jan 0001"],
    ["0000-01-01T00:00:00Z", "1 Jan 0000"],
  ])("trackerDate(%j) is %j", (input, want) => {
    expect(trackerDate(input)).toBe(want);
  });

  // TestTrackerDateFormatting.
  it("renders an untracked job's last update as an em dash", () => {
    const [applied, untracked] = trackerJobs();
    expect(trackerUpdatedLabel(untracked as JobSummary)).toBe("—");
    expect(trackerUpdatedLabel(applied as JobSummary)).toBe("5 Sep 2026");
  });

  it("zero-fills a missing applied timestamp like the other tracker fields", () => {
    expect(ApplicationTrackerSchema.parse({}).applied_at).toBe("");
    expect(ApplicationTrackerSchema.parse({ applied_at: null }).applied_at).toBe("");
  });

  it("formats applied and follow-up dates from their Rails calendar values", () => {
    const [applied] = trackerJobs();
    expect(trackerAppliedLabel(applied as JobSummary)).toBe("8 Sep 2026");
    expect(trackerDateOnly("2026-09-15")).toBe("15 Sep 2026");
    expect(trackerDateOnly("")).toBe("—");
  });

  it.each([
    ["2026-09-14", "14 Sep 2026", "overdue"],
    ["2026-09-15", "Today", "today"],
    ["2026-09-16", "16 Sep 2026", "future"],
  ] as const)("assigns the %s follow-up tone", (value, label, tone) => {
    expect(
      trackerFollowUpState(
        tracker("applied", "waiting", "2026-09-05T09:30:00Z", value),
        "2026-09-15",
      ),
    ).toEqual({
      label,
      tone,
    });
  });

  it("renders an empty follow-up as an em dash without a tone", () => {
    expect(trackerFollowUpState(null, "2026-09-15")).toEqual({ label: "—", tone: null });
  });

  // TestApplicationsViewEmptyStatesExplainTheActiveTab.
  it("explains an empty result in the terms of the active tab", () => {
    expect(trackerEmptyMessage("")).toBe("No jobs intaked yet.");
    expect(trackerEmptyMessage("not_applied")).toBe("Nothing left to apply to in this view.");
    expect(trackerEmptyMessage("applied")).toBe("No applications submitted yet.");
    expect(trackerEmptyMessage("in_progress")).toBe("Nothing in progress yet.");
    expect(trackerEmptyMessage("closed")).toBe("No closed applications yet.");
  });

  // TestApplicationsViewRequestsEveryIntakedJob.
  it("always asks for status=all, the open bin, and the newest intake first", () => {
    expect(trackerParams(DEFAULT_TRACKER_SELECTION)).toEqual({
      status: "all",
      state: "open",
      sort: "newest",
      page: 1,
    });
    // The All tab sends no group rather than an "all" sentinel; a real tab sends its group.
    expect(trackerParams(DEFAULT_TRACKER_SELECTION)).not.toHaveProperty("application");
    expect(trackerParams({ ...DEFAULT_TRACKER_SELECTION, group: "applied" }).application).toBe(
      "applied",
    );
    expect(trackerParams({ ...DEFAULT_TRACKER_SELECTION, bin: "removed" }).status).toBe("all");
  });

  // TestApplicationsViewGroupTabFiltersServerSide and TestApplicationsViewBinAndSortControls.
  it("returns to page 1 on a change and returns the same selection when nothing changed", () => {
    const onPage3 = { ...DEFAULT_TRACKER_SELECTION, pageNum: 3 };

    expect(selectTrackerGroup(onPage3, "applied")).toEqual({
      ...onPage3,
      group: "applied",
      pageNum: 1,
    });
    expect(selectTrackerGroup(onPage3, "")).toBe(onPage3);
    expect(selectTrackerBin(onPage3, "removed")).toEqual({
      ...onPage3,
      bin: "removed",
      pageNum: 1,
    });
    expect(selectTrackerBin(onPage3, "open")).toBe(onPage3);
    expect(selectTrackerSort(onPage3, "activity")).toEqual({
      ...onPage3,
      sort: "activity",
      pageNum: 1,
    });
    expect(selectTrackerSort(onPage3, "newest")).toBe(onPage3);

    expect(parseTrackerBin("backlog")).toBe("backlog");
    expect(parseTrackerBin("")).toBeNull();
    expect(parseTrackerSort("oldest")).toBeNull();
    expect(parseTrackerSort("score")).toBe("score");
  });

  // TestApplicationsViewPagination.
  it("pages from the envelope Rails served, never past either end", () => {
    const first: PageMeta = { number: 1, size: 30, total: 75, has_next: true };
    expect(nextTrackerPage(DEFAULT_TRACKER_SELECTION, first).pageNum).toBe(2);
    expect(previousTrackerPage(DEFAULT_TRACKER_SELECTION, first)).toBe(DEFAULT_TRACKER_SELECTION);

    const last: PageMeta = { number: 3, size: 30, total: 75, has_next: false };
    expect(nextTrackerPage(DEFAULT_TRACKER_SELECTION, last)).toBe(DEFAULT_TRACKER_SELECTION);
    expect(previousTrackerPage(DEFAULT_TRACKER_SELECTION, last).pageNum).toBe(2);
    // A zero page number from a malformed envelope still steps to page 2, as Go's did.
    expect(nextTrackerPage(DEFAULT_TRACKER_SELECTION, { ...first, number: 0 }).pageNum).toBe(2);
  });

  it("counts applied, in progress, and closed as applied to", () => {
    expect(appliedToCount({ all: 12, not_applied: 7, applied: 3, in_progress: 1, closed: 1 })).toBe(
      5,
    );
  });

  it("treats the placeholder and an empty value as non-writes", () => {
    expect(isStatusWrite("not_applied")).toBe(false);
    expect(isStatusWrite("")).toBe(false);
    expect(isStatusWrite("applied")).toBe(true);
  });

  it("shows the placeholder for an untracked status and a stage pill only when it has a label", () => {
    expect(trackerStatusValue(null)).toBe("not_applied");
    expect(trackerStatusValue(tracker(""))).toBe("not_applied");
    expect(trackerStatusValue(tracker("interviewing"))).toBe("interviewing");

    expect(trackerStageLabel(null)).toBe("");
    expect(trackerStageLabel(tracker("applied", "waiting"))).toBe("Waiting");
    expect(trackerStageLabel(tracker("applied", ""))).toBe("");
    expect(trackerStageLabel(tracker("", "waiting"))).toBe("");
    expect(trackerStageLabel(tracker("applied", "invented"))).toBe("");
  });
});

/* -------------------------------------------------------------------------- */
/* The request                                                                 */
/* -------------------------------------------------------------------------- */

describe("tracker request", () => {
  /*
   * The regression this screen is known for: a client that left `status` unset and trusted the
   * server default to mean "every job" got scored-only, and triage leaves most intaked postings
   * unscored. Assert the parameter is present, not merely that the rows look right.
   */
  it("sends status=all and state=open explicitly on the first request", async () => {
    await loadedTracker();

    expect(requests).toHaveLength(1);
    const query = requests[0] as URLSearchParams;
    expect(query.has("status")).toBe(true);
    expect(query.get("status")).toBe("all");
    expect(query.has("state")).toBe(true);
    expect(query.get("state")).toBe("open");
    expect(query.get("sort")).toBe("newest");
    // All sends no group, and page 1 sends no page.
    expect(query.has("application")).toBe(false);
    expect(query.has("page")).toBe(false);
  });

  it("sends the group, bin, and sort the owner picks, each returning to page 1", async () => {
    pageFor = (number) => ({ number, size: 30, total: 75, has_next: number < 3 });
    const { container } = await loadedTracker();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(requests.at(-1)?.get("page")).toBe("2");
    });

    fireEvent.click(tab("Applied"));
    await waitFor(() => {
      expect(requests.at(-1)?.get("application")).toBe("applied");
    });
    expect(requests.at(-1)?.has("page")).toBe(false);
    expect(requests.at(-1)?.get("status")).toBe("all");
    expect(tab("Applied")).toHaveAttribute("aria-selected", "true");
    expect(tab("Applied")).toHaveClass("tracker-tab", "view-selector-option-active");
    expect(tab("All")).toHaveAttribute("aria-selected", "false");

    const bin = container.querySelector<HTMLSelectElement>(".tracker-bin-select");
    fireEvent.change(bin as HTMLSelectElement, { target: { value: "removed" } });
    await waitFor(() => {
      expect(requests.at(-1)?.get("state")).toBe("removed");
    });
    expect(requests.at(-1)?.get("application")).toBe("applied");
    expect(bin?.value).toBe("removed");

    const sort = container.querySelector<HTMLSelectElement>(".tracker-sort-select");
    fireEvent.change(sort as HTMLSelectElement, { target: { value: "activity" } });
    await waitFor(() => {
      expect(requests.at(-1)?.get("sort")).toBe("activity");
    });
    expect(requests.at(-1)?.get("status")).toBe("all");
  });

  it("does not refetch when the current tab is pressed again", async () => {
    await loadedTracker();

    fireEvent.click(tab("All"));
    await settle();

    expect(requests).toHaveLength(1);
  });

  /*
   * Go's `load()` set the rows to loading and left `counts` alone until the answer arrived. The
   * previous page is kept as placeholder data for exactly that: the stats and the tab totals must
   * not flash to zero, while the rows must not claim to belong to the newly selected tab.
   */
  it("keeps the totals on screen while a new tab loads, but not the old tab's rows", async () => {
    countsOverride = { all: 12, not_applied: 7, applied: 3, in_progress: 1, closed: 1 };
    laterReadDelay = 250;
    const { container } = await loadedTracker();

    fireEvent.click(tab("Closed"));

    await waitFor(() => {
      expect(container.querySelector(".loading")).not.toBeNull();
    });
    expect(container.querySelector(".tracker-table")).toBeNull();
    expect(tabCount("All")).toBe("12");
    expect(summary()).toBe("5 applied to · 12 jobs tracked");

    await waitFor(() => {
      expect(container.querySelector(".tracker-empty")?.textContent).toBe(
        "No closed applications yet.",
      );
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Rendering                                                                   */
/* -------------------------------------------------------------------------- */

describe("tracker rendering", () => {
  // TestApplicationsViewRendersTrackerRows.
  it("renders every row with its link, company, status control, stage, and dates", async () => {
    const { container } = await loadedTracker();

    const root = container.querySelector(".applications");
    expect(root?.firstElementChild).toHaveClass("app-chrome");
    expect(container.querySelector(".app-tab-active")).toHaveAttribute("href", "/applications");
    expect(screen.getByRole("heading", { name: "Applications" })).toBeInTheDocument();

    const staff = rowFor("Staff Engineer");
    expect(within(staff).getByRole("link", { name: "Staff Engineer" })).toHaveAttribute(
      "href",
      "/jobs/42",
    );
    expect(within(staff).getByRole("link", { name: "Staff Engineer" })).toHaveClass(
      "tracker-job-link",
    );
    expect(staff.querySelector(".tracker-cell-company")?.textContent).toBe("Acme");
    expect(statusValueFor("Staff Engineer")).toBe("applied");
    expect(staff.querySelector(".tracker-stage")?.textContent).toBe("Waiting");
    expect(
      Array.from(staff.querySelectorAll(".tracker-cell-date")).map((cell) => cell.textContent),
    ).toEqual(["8 Sep 2026", "1 Sep 2026", "5 Sep 2026"]);
    expect(staff.querySelector(".tracker-cell-score .job-score")).toHaveClass("job-score--high");
    expect(staff.querySelector(".tracker-cell-score .job-score")).toHaveTextContent("82%");
    expect(staff.querySelector(".tracker-cell-stage .tracker-stage")).toHaveTextContent("Waiting");
    expect(staff.querySelector(".tracker-cell-follow-up")?.textContent).toBe("15 Sep 2099");
    expect(staff.querySelector(".tracker-cell-note")?.textContent).toBe(
      "Referred by a former colleague.",
    );
    expect(staff.querySelector(".tracker-job-heading .job-source-logo")).toHaveAttribute(
      "src",
      "/icons/linkedin.svg",
    );

    const principal = rowFor("Principal Engineer");
    expect(within(principal).getByRole("link", { name: "Principal Engineer" })).toHaveAttribute(
      "href",
      "/jobs/43",
    );
    expect(principal.querySelector(".tracker-cell-company")?.textContent).toBe("Globex");
    expect(principal.querySelector(".tracker-stage")).toBeNull();
    expect(
      Array.from(principal.querySelectorAll(".tracker-cell-date")).map((cell) => cell.textContent),
    ).toEqual(["—", "3 Sep 2026", "—"]);
    expect(principal.querySelector(".tracker-cell-score .job-score")).toHaveTextContent(
      "Queued later",
    );
    expect(principal.querySelector(".tracker-cell-stage")?.textContent).toBe("—");
    expect(
      within(principal).queryByRole("button", { name: "Application stage for Principal Engineer" }),
    ).toBeNull();
    expect(principal.querySelector(".tracker-cell-follow-up")?.textContent).toBe("—");
    expect(principal.querySelector(".tracker-cell-note")?.textContent).toBe("—");
  });

  it("offers the Not applied placeholder only while a job is untracked", async () => {
    await loadedTracker();

    const untracked = await openStatusFor("Principal Engineer");
    expect(statusValueFor("Principal Engineer")).toBe("not_applied");
    expect(untracked.querySelector<HTMLElement>('[data-value="not_applied"]')?.textContent).toBe(
      "Not applied",
    );
    expect(
      Array.from(untracked.querySelectorAll<HTMLElement>("[cmdk-item]"), (option) =>
        option.getAttribute("data-value"),
      ).slice(0, 1),
    ).toEqual(["not_applied"]);
    expect(
      Array.from(untracked.querySelectorAll<HTMLElement>("[cmdk-item]"), (option) =>
        option.getAttribute("data-value"),
      ).slice(1),
    ).toEqual([
      "interested",
      "drafting",
      "needs_review",
      "applied",
      "interviewing",
      "offer",
      "rejected",
      "withdrawn",
      "archived",
    ]);

    fireEvent.click(statusTriggerFor("Principal Engineer"));
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    const tracked = await openStatusFor("Staff Engineer");
    expect(tracked.querySelector('[data-value="not_applied"]')).toBeNull();
    expect(tracked.querySelectorAll("[cmdk-item]")).toHaveLength(9);
  });

  it("opens grouped statuses from Enter, checks the current one, and dismisses without a write", async () => {
    await loadedTracker();

    fireEvent.keyDown(statusTriggerFor("Staff Engineer"), { key: "Enter" });
    const list = await waitFor(() => screen.getByRole<HTMLElement>("listbox"));
    expect(
      Array.from(
        list.querySelectorAll<HTMLElement>("[cmdk-group-heading]"),
        (heading) => heading.textContent,
      ),
    ).toEqual(["Not applied", "Applied", "In progress", "Closed"]);
    expect(list.querySelector('[data-value="applied"]')).toHaveAttribute("data-current", "true");
    expect(list.querySelector('[data-value="applied"] .status-cell-check')).not.toBeNull();

    const current = list.querySelector<HTMLElement>('[data-value="applied"]');
    if (current === null) throw new Error("no current status option");
    fireEvent.click(current);
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());

    await openStatusFor("Principal Engineer");
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(statusWrites).toEqual([]);
  });

  it("opens the stage list, checks the current stage, and leaves untracked rows read-only", async () => {
    await loadedTracker();

    const list = await openStageFor("Staff Engineer");
    expect(
      Array.from(list.querySelectorAll<HTMLElement>("[cmdk-item]"), (option) => option.textContent),
    ).toEqual([
      "No stage",
      "Waiting",
      "Recruiter screen",
      "Phone screen",
      "Technical",
      "Take-home",
      "Onsite",
      "Final",
      "Reference check",
      "Offer negotiation",
    ]);
    expect(list.querySelector('[data-value="waiting"]')).toHaveAttribute(
      "data-current",
      "true",
    );
    expect(list.querySelector('[data-value="waiting"] .stage-cell-check')).not.toBeNull();

    const current = list.querySelector<HTMLElement>('[data-value="waiting"]');
    if (current === null) throw new Error("no current stage option");
    fireEvent.click(current);
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(statusWrites).toEqual([]);

    await openStageFor("Staff Engineer");
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(statusWrites).toEqual([]);
    expect(
      within(rowFor("Principal Engineer")).queryByRole("button", {
        name: "Application stage for Principal Engineer",
      }),
    ).toBeNull();
  });

  // TestApplicationsViewRendersGroupTabsWithCounts.
  it("takes every tab total and both header stats from application_counts", async () => {
    countsOverride = { all: 12, not_applied: 7, applied: 3, in_progress: 1, closed: 1 };
    await loadedTracker();

    expect(
      groupTabs().map((candidate) => candidate.querySelector(".tracker-tab-label")?.textContent),
    ).toEqual(["All", "Not applied", "Applied", "In progress", "Closed"]);
    expect(
      groupTabs().map((candidate) => candidate.querySelector(".tracker-tab-count")?.textContent),
    ).toEqual(["12", "7", "3", "1", "1"]);
    // Two rows on the page, twelve in Rails' tally: the totals are never counted client-side.
    expect(document.querySelectorAll(".tracker-row")).toHaveLength(2);
    expect(tab("All")).toHaveAttribute("aria-selected", "true");
    expect(summary()).toBe("5 applied to · 12 jobs tracked");
    expect(document.querySelector(".applications-stats")).toBeNull();
  });

  // TestApplicationsViewRendersControls.
  it("renders the bin and sort selects with their options and defaults", async () => {
    const { container } = await loadedTracker();

    const bin = container.querySelector<HTMLSelectElement>(".tracker-bin-select");
    const sort = container.querySelector<HTMLSelectElement>(".tracker-sort-select");
    expect(bin?.value).toBe("open");
    expect(Array.from(bin?.options ?? []).map((option) => option.textContent)).toEqual([
      "Active + backlog",
      "Active only",
      "Backlog only",
      "Removed",
    ]);
    expect(sort?.value).toBe("newest");
    expect(Array.from(sort?.options ?? []).map((option) => option.textContent)).toEqual([
      "Newest intake",
      "Recent activity",
      "Highest match",
    ]);
  });

  // TestApplicationsViewPagination.
  it("pages with the envelope Rails returned", async () => {
    pageFor = (number) => ({ number, size: 30, total: 75, has_next: number < 3 });
    const { container } = await loadedTracker();

    expect(container.querySelector(".tracker-footer")).not.toBeNull();
    expect(container.querySelector(".tracker-pagination")).toHaveClass("job-pagination");
    expect(container.querySelector(".tracker-row-range")?.textContent).toBe("Rows 1–30 of 75");
    expect(container.querySelector(".tracker-page-indicator")?.textContent).toBe("Page 1 of 3");
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(container.querySelector(".tracker-page-indicator")?.textContent).toBe("Page 2 of 3");
    });
    expect(container.querySelector(".tracker-row-range")?.textContent).toBe("Rows 31–60 of 75");
    expect(requests.at(-1)?.get("page")).toBe("2");
    expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(container.querySelector(".tracker-page-indicator")?.textContent).toBe("Page 3 of 3");
    });
    expect(container.querySelector(".tracker-row-range")?.textContent).toBe("Rows 61–75 of 75");
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await waitFor(() => {
      expect(container.querySelector(".tracker-page-indicator")?.textContent).toBe("Page 2 of 3");
    });

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await waitFor(() => {
      expect(container.querySelector(".tracker-page-indicator")?.textContent).toBe("Page 1 of 3");
    });
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  });

  // TestApplicationsViewEmptyStatesExplainTheActiveTab, through the tabs themselves.
  it("names the active tab in the empty state", async () => {
    rows = [];
    const { container } = renderTracker();

    for (const [label, message] of [
      ["All", "No jobs intaked yet."],
      ["Not applied", "Nothing left to apply to in this view."],
      ["Applied", "No applications submitted yet."],
      ["In progress", "Nothing in progress yet."],
      ["Closed", "No closed applications yet."],
    ] as const) {
      await waitFor(() => {
        expect(container.querySelector(".tracker-empty")).not.toBeNull();
      });
      fireEvent.click(tab(label));
      await waitFor(() => {
        expect(container.querySelector(".tracker-empty")?.textContent).toBe(message);
      });
    }
    expect(container.querySelector(".tracker-table")).toBeNull();
  });

  // TestApplicationsViewUnauthorized.
  it("renders an expired session with the sign-in link", async () => {
    failReadWith = 401;
    const { container } = renderTracker();

    await waitFor(() => {
      expect(container.querySelector(".load-error")?.textContent).toContain(SESSION_EXPIRED);
    });
    expect(container.querySelector(".sign-in-link")).toHaveAttribute("href", "/login");
  });

  it("reports any other read failure without a sign-in link", async () => {
    failReadWith = 422;
    const { container } = renderTracker();

    await waitFor(() => {
      expect(container.querySelector(".load-error")?.textContent).toBe(
        "Could not load data. Please try again.",
      );
    });
    expect(container.querySelector(".sign-in-link")).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* One markup, one Surface v2 grid                                             */
/* -------------------------------------------------------------------------- */

/** `public/app.css` with comments removed. */
function stylesheet(): string {
  return readFileSync(
    join(import.meta.dirname, "..", "..", "..", "public", "app.css"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "");
}

/** The index of the `}` closing the block whose `{` is at `open`. */
function closingBrace(css: string, open: number): number {
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error("unbalanced braces in app.css");
}

/** The body of the at-rule block written exactly as `prelude`. */
function atRuleBody(css: string, prelude: string): string {
  const start = css.indexOf(`${prelude} {`);
  if (start < 0) throw new Error(`app.css has no "${prelude}" block`);
  const open = css.indexOf("{", start);
  return css.slice(open + 1, closingBrace(css, open));
}

/** The stylesheet with every at-rule removed, leaving the unconditional (mobile-first) rules. */
function unconditional(css: string): string {
  let out = "";
  let cursor = 0;
  for (let at = css.indexOf("@", cursor); at >= 0; at = css.indexOf("@", cursor)) {
    out += css.slice(cursor, at);
    const brace = css.indexOf("{", at);
    const semicolon = css.indexOf(";", at);
    cursor =
      semicolon >= 0 && (brace < 0 || semicolon < brace)
        ? semicolon + 1
        : closingBrace(css, brace) + 1;
  }
  return out + css.slice(cursor);
}

/** `selector → declarations` for a run of flat rules, with selector lists split. */
function rulesOf(css: string): Map<string, string> {
  const rules = new Map<string, string>();
  for (const [, selectors = "", body = ""] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const selector of selectors.split(",")) {
      const key = selector.trim().replace(/\s+/g, " ");
      rules.set(key, `${rules.get(key) ?? ""};${body}`);
    }
  }
  return rules;
}

/** The last value `property` is given in a rule's declarations, as the cascade would apply it. */
function declared(rules: Map<string, string>, selector: string, property: string): string {
  const body = rules.get(selector);
  if (body === undefined) throw new Error(`app.css has no "${selector}" rule here`);
  const values = [...body.matchAll(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "g"))];
  return values.at(-1)?.[1]?.trim() ?? "";
}

describe("Surface v2 tracker grid", () => {
  it("styles the tracker toolbar and footer as compact surface controls", () => {
    const css = stylesheet();
    const mobile = rulesOf(unconditional(css));
    const desktop = rulesOf(atRuleBody(css, "@container (min-width: 800px)"));

    expect(declared(mobile, ".tracker-toolbar", "display")).toBe("flex");
    expect(declared(mobile, ".tracker-columns-trigger", "min-height")).toBe(
      "var(--control-h-touch)",
    );
    expect(declared(mobile, ".tracker-footer", "border-top")).toBe(
      "1px solid var(--color-grid-line)",
    );
    expect(declared(desktop, ".tracker-columns-trigger", "min-height")).toBe(
      "var(--control-h-desktop)",
    );
    expect(declared(desktop, ".tracker-footer .tracker-page-prev", "min-height")).toBe(
      "var(--control-h-desktop)",
    );
  });

  it("renders one grid with row numbers, icons, pinned Job, and mobile company text", async () => {
    rows = [
      { ...fixtures.unscoredJob, id: 1, title: "Untracked", application: null },
      {
        ...fixtures.scoredJob,
        id: 2,
        title: "Waiting",
        application: tracker("applied", "waiting"),
      },
      {
        ...fixtures.scoredJob,
        id: 3,
        title: "Onsite",
        application: tracker("interviewing", "onsite"),
      },
      { ...fixtures.scoredJob, id: 4, title: "Declined", application: tracker("rejected") },
      { ...fixtures.scoredJob, id: 5, title: "Considering", application: tracker("interested") },
    ];
    const { container } = await loadedTracker();

    // No second, card-shaped markup: the same grid is what app.css lays out at every width.
    expect(container.querySelectorAll("table")).toHaveLength(1);
    expect(container.querySelector(".tracker-grid-scroll")).not.toBeNull();
    const headers = Array.from(container.querySelectorAll("thead th")).map(
      (th) => th.querySelector(".tracker-header-label")?.textContent ?? th.textContent,
    );
    expect(headers).toEqual([
      "#",
      "Job",
      "Company",
      "Score",
      "Status",
      "Stage",
      "Applied",
      "Intaked",
      "Updated",
      "Follow-up",
      "Note",
    ]);
    expect(container.querySelectorAll("thead th .tracker-column-icon")).toHaveLength(11);
    expect(Array.from(container.querySelectorAll("thead th")).map((th) => th.className)).toEqual([
      "tracker-row-number-header",
      "tracker-col-job",
      "tracker-col-company",
      "tracker-col-score",
      "tracker-col-status",
      "tracker-col-stage",
      "tracker-col-date",
      "tracker-col-date",
      "tracker-col-date",
      "tracker-col-date",
      "tracker-col-note",
    ]);

    const bodyRows = Array.from(container.querySelectorAll<HTMLTableRowElement>("tbody tr"));
    expect(bodyRows.map((row) => row.className)).toEqual([
      "tracker-row tracker-row--not_applied",
      "tracker-row tracker-row--applied",
      "tracker-row tracker-row--in_progress",
      "tracker-row tracker-row--closed",
      "tracker-row tracker-row--not_applied",
    ]);
    expect(bodyRows.map((row) => row.cells[0]?.textContent)).toEqual(["1", "2", "3", "4", "5"]);
    for (const [index, row] of bodyRows.entries()) {
      const cells = Array.from(row.cells);
      expect(cells.map((cell) => cell.dataset.column)).toEqual([
        "row-number",
        "job",
        "company",
        "score",
        "status",
        "stage",
        "applied",
        "intaked",
        "updated",
        "follow_up",
        "note",
      ]);
      for (const cell of cells) expect(cell).toHaveClass("tracker-cell");
      const numberCell = cells[0];
      const jobCell = cells[1];
      if (numberCell === undefined || jobCell === undefined)
        throw new Error("tracker row is incomplete");
      expect(numberCell).toHaveClass("tracker-cell-number");
      expect(jobCell).toHaveClass("tracker-cell-job");
      expect(jobCell).toHaveAttribute("data-pinned", "left");
      expect(jobCell.querySelector(".tracker-job-company-mobile")).toHaveTextContent(
        [
          "Cascadia",
          "Northwind Robotics",
          "Northwind Robotics",
          "Northwind Robotics",
          "Northwind Robotics",
        ][index] ?? "",
      );
      expect(cells.some((cell) => cell.hasAttribute("data-label"))).toBe(false);
    }
  });

  it("uses the mobile grid dimensions and scroll fade without the retired card labels", () => {
    const mobile = rulesOf(unconditional(stylesheet()));

    expect(declared(mobile, ".tracker-wrap", "overflow")).toBe("hidden");
    expect(declared(mobile, ".tracker-grid-scroll", "overflow-x")).toBe("auto");
    expect(declared(mobile, ".tracker-grid-scroll::after", "width")).toBe("28px");
    expect(declared(mobile, ".tracker-table", "width")).toBe("max-content");
    expect(declared(mobile, ".tracker-table", "min-width")).toBe("100%");
    expect(declared(mobile, ".tracker-table", "table-layout")).toBe("fixed");
    expect(declared(mobile, ".tracker-table th", "height")).toBe("34px");
    expect(declared(mobile, ".tracker-row", "height")).toBe("56px");
    expect(declared(mobile, ".tracker-cell", "height")).toBe("56px");
    expect(declared(mobile, ".tracker-cell-number", "position")).toBe("sticky");
    expect(declared(mobile, '.tracker-table [data-pinned="left"]', "position")).toBe("sticky");
    expect(declared(mobile, ".tracker-job-company-mobile", "display")).toBe("block");
    expect(declared(mobile, ".tracker-row--editing .tracker-cell", "background")).toBe(
      "var(--color-row-active)",
    );
    expect(declared(mobile, ".tracker-row--editing .tracker-cell-number", "color")).toBe(
      "var(--color-accent-strong)",
    );
    expect(declared(mobile, ".tracker-cell-status:focus-within", "box-shadow")).toBe(
      "inset 0 0 0 2px var(--color-accent)",
    );
    expect(declared(mobile, ".tracker-cell-stage:focus-within", "box-shadow")).toBe(
      "inset 0 0 0 2px var(--color-accent)",
    );
    expect(declared(mobile, ".tracker-cell-score .job-score", "border-radius")).toBe(
      "var(--radius-pill)",
    );
    expect(declared(mobile, ".tracker-follow-up--overdue", "font-weight")).toBe("600");
    expect(declared(mobile, ".tracker-follow-up--overdue::before", "width")).toBe("6px");
    expect(declared(mobile, ".tracker-follow-up--today", "color")).toBe(
      "var(--color-accent-strong)",
    );
    expect(declared(mobile, ".tracker-follow-up--future", "color")).toBe("var(--color-ink-soft)");
    expect(declared(mobile, ".tracker-note", "text-overflow")).toBe("ellipsis");
    expect(declared(mobile, ".tracker-note", "white-space")).toBe("nowrap");
    expect(declared(mobile, ".tracker-note", "overflow")).toBe("hidden");
    expect(declared(mobile, ".status-cell-trigger", "min-height")).toBe("var(--control-h-touch)");
    expect(unconditional(stylesheet())).not.toContain("data-label");
  });

  it("follows the selected layout: the switch is a container query on the screen root", () => {
    const css = stylesheet();

    expect(css).toMatch(/:is\([^)]*\.applications[^)]*\)\s*\{\s*container-type:\s*inline-size;/);
    expect(css).toContain("@container (min-width: 800px) {");
    // No viewport media query touches the tracker, or forced Mobile on a wide screen would break.
    for (const [, prelude = ""] of css.matchAll(/@media([^{]*)\{/g)) {
      const body = atRuleBody(css, `@media${prelude.trimEnd()}`);
      expect(body).not.toMatch(/tracker/);
    }
  });

  it("tightens rows on desktop and keeps the same table display values", () => {
    const css = stylesheet();
    const desktop = rulesOf(atRuleBody(css, "@container (min-width: 800px)"));

    expect(declared(desktop, ".tracker-wrap", "--tracker-row-number-width")).toBe("48px");
    expect(declared(desktop, ".tracker-table th", "height")).toBe("36px");
    expect(declared(desktop, ".tracker-sort", "min-height")).toBe("36px");
    expect(declared(desktop, ".tracker-row", "height")).toBe("40px");
    expect(declared(desktop, ".tracker-cell", "height")).toBe("40px");
    expect(declared(desktop, ".tracker-grid-scroll::after", "display")).toBe("none");
    expect(declared(desktop, ".tracker-job-company-mobile", "display")).toBe("none");
    expect(declared(desktop, ".status-cell-trigger", "min-height")).toBe(
      "var(--control-h-desktop)",
    );

    const trackerRules = [...rulesOf(unconditional(css)), ...desktop].filter(([selector]) =>
      selector.includes("tracker"),
    );
    expect(trackerRules.length).toBeGreaterThan(20);
    for (const [selector, body] of trackerRules) {
      expect(body, selector).not.toMatch(/\brevert\b/);
    }
  });

  it("pins the rail and Job column while preserving group tint and gridlines", () => {
    const mobile = rulesOf(unconditional(stylesheet()));

    expect(declared(mobile, ".tracker-row-number-header", "left")).toBe("0");
    expect(declared(mobile, ".tracker-cell-job", "border-right")).toBe(
      "1px solid var(--color-border-strong)",
    );
    expect(declared(mobile, ".tracker-cell-job", "box-shadow")).toBe(
      "inset 3px 0 0 var(--color-border-strong)",
    );
    expect(declared(mobile, ".tracker-cell", "border-bottom")).toBe(
      "1px solid var(--color-grid-line)",
    );
    for (const [group, color] of [
      ["applied", "var(--color-accent)"],
      ["in_progress", "var(--color-warning)"],
      ["closed", "var(--color-ink-faint)"],
    ] as const) {
      expect(declared(mobile, `.tracker-row--${group} .tracker-cell-job`, "box-shadow")).toBe(
        `inset 3px 0 0 ${color}`,
      );
    }
  });

  it("keeps a long note in its fixed, single-line cell", async () => {
    const longNote = "follow-up-".repeat(40);
    rows = [
      {
        ...fixtures.scoredJob,
        id: 77,
        title: "Long note",
        application: { ...fixtures.applicationTracker, job_post_id: 77, pipeline_note: longNote },
      },
    ];
    const { container } = await loadedTracker();
    const row = rowFor("Long note");
    const note = row.querySelector(".tracker-note");
    const noteCell = row.querySelector<HTMLElement>('[data-column="note"]');

    expect(note).toHaveTextContent(longNote);
    expect(note).toHaveClass("tracker-note");
    expect(noteCell?.style.width).toBe("240px");
    expect(container.querySelector(".tracker-cell-note")).toBe(noteCell);
  });
});

/* -------------------------------------------------------------------------- */
/* Writing                                                                     */
/* -------------------------------------------------------------------------- */

describe("tracker writes", () => {
  // TestApplicationsViewNeverWritesStatusOnRender.
  it("never writes a status, drafts, or submits on render", async () => {
    await loadedTracker();
    await settle();

    expect(statusWrites).toEqual([]);
    expect(applicationRequests).toEqual([]);
  });

  // TestApplicationsViewSetStatusWritesThroughJobEndpoint.
  it("writes through the job-post endpoint, then refetches instead of patching the row", async () => {
    const { container } = await loadedTracker();

    await chooseStatus("Principal Engineer", "applied");

    await waitFor(() => {
      expect(statusWrites).toEqual([
        { id: 43, body: { pipeline_status: "applied", pipeline_stage: "" } },
      ]);
    });
    // Absent, not empty: Rails assigns each only when non-nil, so "" would erase a saved note.
    expect(statusWrites[0]?.body).not.toHaveProperty("pipeline_note");
    expect(statusWrites[0]?.body).not.toHaveProperty("next_follow_up_on");
    // Rails creates the Application on first use; nothing drafts or dispatches the submit worker.
    expect(applicationRequests).toEqual([]);

    await waitFor(() => {
      expect(requests).toHaveLength(2);
      expect(statusValueFor("Principal Engineer")).toBe("applied");
    });
    expect(requests[1]?.get("status")).toBe("all");
    expect(rowFor("Principal Engineer").querySelector(".tracker-stage")?.textContent).toBe(
      "Waiting",
    );
    const trackedOptions = await openStatusFor("Principal Engineer");
    expect(trackedOptions.querySelector('[data-value="not_applied"]')).toBeNull();
    fireEvent.click(statusTriggerFor("Principal Engineer"));
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(tabCount("Applied")).toBe("2");
    expect(container.querySelector(".toast")).toBeNull();
  });

  it("writes the current status and selected stage only, then refetches", async () => {
    await loadedTracker();

    await chooseStage("Staff Engineer", "technical");

    await waitFor(() => {
      expect(statusWrites).toEqual([
        { id: 42, body: { pipeline_status: "applied", pipeline_stage: "technical" } },
      ]);
    });
    expect(statusWrites[0]?.body).not.toHaveProperty("pipeline_note");
    expect(statusWrites[0]?.body).not.toHaveProperty("next_follow_up_on");

    await waitFor(() => {
      expect(requests).toHaveLength(2);
      expect(rowFor("Staff Engineer").querySelector(".tracker-stage")?.textContent).toBe(
        "Technical",
      );
    });
    expect(rowFor("Staff Engineer").querySelector(".tracker-cell-note")?.textContent).toBe(
      "Referred by a former colleague.",
    );
    expect(rowFor("Staff Engineer").querySelector(".tracker-cell-follow-up")?.textContent).toBe(
      "15 Sep 2099",
    );
  });

  it("sends a blank stage for No stage, never the DOM sentinel", async () => {
    await loadedTracker();

    await chooseStage("Staff Engineer", "");

    await waitFor(() => {
      expect(statusWrites).toEqual([
        { id: 42, body: { pipeline_status: "applied", pipeline_stage: "" } },
      ]);
    });
    expect(statusWrites[0]?.body.pipeline_stage).not.toBe("none");
  });

  it("lets the refetch move a row out of the tab it was edited in", async () => {
    const { container } = await loadedTracker();
    fireEvent.click(tab("Not applied"));
    await waitFor(() => {
      expect(container.querySelectorAll(".tracker-row")).toHaveLength(1);
    });
    expect(tabCount("Not applied")).toBe("1");

    await chooseStatus("Principal Engineer", "applied");

    await waitFor(() => {
      expect(container.querySelector(".tracker-empty")?.textContent).toBe(
        "Nothing left to apply to in this view.",
      );
    });
    expect(tabCount("Not applied")).toBe("0");
    expect(tabCount("Applied")).toBe("2");
    expect(summary()).toBe("2 applied to · 2 jobs tracked");
  });

  it("disables every status editor while a write is in flight and marks only its own row", async () => {
    writeDelay = 250;
    await loadedTracker();

    await chooseStatus("Principal Engineer", "interviewing");

    await waitFor(() => {
      expect(rowFor("Principal Engineer").querySelector(".tracker-saving")?.textContent).toBe(
        "Saving…",
      );
    });
    expect(rowFor("Principal Engineer")).toHaveClass("tracker-row--editing");
    expect(rowFor("Principal Engineer").querySelector(".tracker-cell-number")).not.toBeNull();
    expect(statusTriggerFor("Principal Engineer")).toBeDisabled();
    expect(statusTriggerFor("Staff Engineer")).toBeDisabled();
    expect(rowFor("Staff Engineer").querySelector(".tracker-saving")).toBeNull();

    // Re-enabled only once the refetched page has landed, not when the PATCH answers.
    await waitFor(() => {
      expect(statusTriggerFor("Staff Engineer")).toBeEnabled();
    });
    expect(requests).toHaveLength(2);
    expect(statusValueFor("Principal Engineer")).toBe("interviewing");
    expect(document.querySelector(".tracker-saving")).toBeNull();
    expect(statusWrites).toHaveLength(1);
  });

  it("shares the row saving state with the stage editor", async () => {
    writeDelay = 250;
    await loadedTracker();

    await chooseStage("Staff Engineer", "technical");

    await waitFor(() => {
      expect(rowFor("Staff Engineer").querySelector(".tracker-saving")?.textContent).toBe(
        "Saving…",
      );
    });
    expect(rowFor("Staff Engineer")).toHaveClass("tracker-row--editing");
    expect(stageTriggerFor("Staff Engineer")).toBeDisabled();
    expect(statusTriggerFor("Staff Engineer")).toBeDisabled();
    expect(statusTriggerFor("Principal Engineer")).toBeDisabled();

    await waitFor(() => expect(stageTriggerFor("Staff Engineer")).toBeEnabled());
    expect(statusWrites).toHaveLength(1);
  });

  // TestApplicationsViewSetStatusIgnoresNotAppliedPlaceholder.
  it("treats choosing the Not applied placeholder as a no-op", async () => {
    await loadedTracker();

    const list = await openStatusFor("Principal Engineer");
    const placeholder = list.querySelector<HTMLElement>('[data-value="not_applied"]');
    if (placeholder === null) throw new Error("no Not applied option");
    fireEvent.click(placeholder);
    await settle();

    expect(statusWrites).toEqual([]);
    expect(requests).toHaveLength(1);
  });

  // TestApplicationsViewSetStatusError.
  it("reports a failed write above the rows, keeps them, and does not retry", async () => {
    failWriteWith = 500;
    const { container } = await loadedTracker();

    await chooseStatus("Principal Engineer", "applied");

    await waitFor(() => {
      expect(container.querySelector(".toast")).toHaveTextContent(
        "Could not update application status.",
      );
    });
    // Announced through the polite live region, and dismissible (UI-05).
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(container.querySelector(".toast")).toBeNull();
    expect(container.querySelectorAll(".tracker-row")).toHaveLength(2);
    expect(statusValueFor("Principal Engineer")).toBe("not_applied");
    expect(statusTriggerFor("Principal Engineer")).toBeEnabled();
    await settle();
    expect(statusWrites).toHaveLength(1);
    expect(requests).toHaveLength(1);
  });

  it("reports an expired session on a write as one", async () => {
    failWriteWith = 401;
    await loadedTracker();

    await chooseStatus("Principal Engineer", "applied");

    await waitFor(() => {
      expect(screen.getByRole("region", { name: "Notifications" })).toHaveTextContent(
        SESSION_EXPIRED,
      );
    });
  });
});

/* -------------------------------------------------------------------------- */
/* TanStack Table: sorting, visibility, virtualization (UI-04)                 */
/* -------------------------------------------------------------------------- */

describe("tracker table behaviour", () => {
  function titles(container: HTMLElement): string[] {
    return Array.from(container.querySelectorAll("tbody .tracker-job-title")).map(
      (title) => title.textContent ?? "",
    );
  }

  it("sorts the loaded rows by a header click without a new request, and back to Rails' order", async () => {
    rows = [
      { ...fixtures.scoredJob, id: 1, title: "Bravo", application: null },
      { ...fixtures.scoredJob, id: 2, title: "Alpha", application: null },
      { ...fixtures.scoredJob, id: 3, title: "Charlie", application: null },
    ];
    const { container } = await loadedTracker();
    const before = requests.length;
    const jobHeader = () => container.querySelector("th.tracker-col-job") as HTMLElement;
    const sortButton = () => within(jobHeader()).getByRole("button", { name: "Job" });

    expect(titles(container)).toEqual(["Bravo", "Alpha", "Charlie"]);
    fireEvent.click(sortButton());
    expect(titles(container)).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(jobHeader()).toHaveAttribute("aria-sort", "ascending");
    expect(jobHeader()).toHaveClass("tracker-header-sorted");
    expect(jobHeader().querySelector(".tracker-sort-arrow")).not.toBeNull();
    expect(jobHeader().textContent).toContain("Job");
    fireEvent.click(sortButton());
    expect(titles(container)).toEqual(["Charlie", "Bravo", "Alpha"]);
    fireEvent.click(sortButton());
    expect(titles(container)).toEqual(["Bravo", "Alpha", "Charlie"]);
    expect(jobHeader()).not.toHaveClass("tracker-header-sorted");
    expect(requests.length).toBe(before);
  });

  it("sorts every non-status column over the loaded page", async () => {
    rows = [
      {
        ...fixtures.scoredJob,
        id: 1,
        title: "One",
        match_score: 82,
        application: {
          ...fixtures.applicationTracker,
          job_post_id: 1,
          pipeline_stage: "waiting",
          applied_at: "2026-09-03T10:00:00Z",
          next_follow_up_on: "2026-09-16",
          pipeline_note: "Z note",
        },
      },
      {
        ...fixtures.scoredJob,
        id: 2,
        title: "Two",
        match_score: 41,
        application: {
          ...fixtures.applicationTracker,
          job_post_id: 2,
          pipeline_stage: "technical",
          applied_at: "2026-09-01T10:00:00Z",
          next_follow_up_on: "2026-09-14",
          pipeline_note: "A note",
        },
      },
      {
        ...fixtures.scoredJob,
        id: 3,
        title: "Three",
        match_score: 65,
        application: {
          ...fixtures.applicationTracker,
          job_post_id: 3,
          pipeline_stage: "onsite",
          applied_at: "2026-09-02T10:00:00Z",
          next_follow_up_on: "2026-09-15",
          pipeline_note: "M note",
        },
      },
    ];
    const { container } = await loadedTracker();
    const before = requests.length;

    for (const [id, label] of [
      ["score", "Score"],
      ["stage", "Stage"],
      ["applied", "Applied"],
      ["follow_up", "Follow-up"],
      ["note", "Note"],
    ] as const) {
      const header = container.querySelector<HTMLElement>(`th[data-column="${id}"]`);
      if (header === null) throw new Error(`no ${id} header`);
      fireEvent.click(within(header).getByRole("button", { name: label }));
      expect(header).toHaveAttribute("aria-sort", "ascending");
    }
    expect(requests).toHaveLength(before);
  });

  it("hides a column's header and cells together, and never offers to hide Job", async () => {
    const { container } = await loadedTracker();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Columns" }));
    const menu = await screen.findByRole("menu");
    const toggles = within(menu).getAllByRole("menuitemcheckbox");
    expect(toggles.map((toggle) => toggle.textContent)).toEqual([
      "Company",
      "Score",
      "Status",
      "Stage",
      "Applied",
      "Intaked",
      "Updated",
      "Follow-up",
      "Note",
    ]);
    expect(within(menu).queryByRole("menuitemcheckbox", { name: "Job" })).toBeNull();
    const companyToggle = within(menu).getByRole("menuitemcheckbox", { name: "Company" });
    expect(companyToggle).toHaveAttribute("aria-checked", "true");

    fireEvent.click(companyToggle);
    expect(companyToggle).toHaveAttribute("aria-checked", "false");

    const headers = Array.from(container.querySelectorAll("thead th")).map(
      (th) => th.querySelector(".tracker-header-label")?.textContent ?? th.textContent,
    );
    expect(headers).toEqual([
      "#",
      "Job",
      "Score",
      "Status",
      "Stage",
      "Applied",
      "Intaked",
      "Updated",
      "Follow-up",
      "Note",
    ]);
    for (const row of Array.from(container.querySelectorAll<HTMLTableRowElement>("tbody tr"))) {
      expect(Array.from(row.cells).map((cell) => cell.dataset.column)).toEqual([
        "row-number",
        "job",
        "score",
        "status",
        "stage",
        "applied",
        "intaked",
        "updated",
        "follow_up",
        "note",
      ]);
      expect(row.cells[0]).toHaveClass("tracker-cell-number");
      expect(row.cells[1]).toHaveClass("tracker-cell-job");
    }
  });

  it("virtualizes a long page behind spacer rows and renders a short one in full", async () => {
    rows = Array.from({ length: 400 }, (_, i) => ({
      ...fixtures.scoredJob,
      id: i + 1,
      title: `Job ${String(i + 1)}`,
      application: null,
    }));
    const { container } = await loadedTracker();

    const rendered = container.querySelectorAll("tbody tr.tracker-row");
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThan(400);
    expect(container.querySelector("tbody tr.tracker-spacer")).not.toBeNull();
  });

  it("gives virtualization spacers explicit table display values", () => {
    const css = stylesheet();
    const mobile = rulesOf(unconditional(css));
    const desktop = rulesOf(atRuleBody(css, "@container (min-width: 800px)"));
    expect(declared(mobile, ".tracker-spacer", "display")).toBe("table-row");
    expect(declared(mobile, ".tracker-spacer td", "display")).toBe("table-cell");
    expect(declared(desktop, ".tracker-spacer", "display")).toBe("table-row");
    expect(declared(desktop, ".tracker-spacer td", "display")).toBe("table-cell");
  });
});
