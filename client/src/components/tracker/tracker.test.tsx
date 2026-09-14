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
 * - The responsive-table rules are `app.css` facts. jsdom has no layout, so the stylesheet is parsed
 *   and the rules the markup depends on are pinned next to the markup that keys off them.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { delay } from "msw";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";

import { createQueryClient } from "../../api/query-client";
import type {
  ApplicationCounts,
  ApplicationStatusUpdate,
  ApplicationTracker,
  JobPage,
  JobSummary,
  PageMeta,
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
  trackerDate,
  trackerEmptyMessage,
  trackerParams,
  trackerStageLabel,
  trackerStatusValue,
  trackerUpdatedLabel,
} from "../../lib/tracker";
import { fixtures } from "../../test/handlers";
import { HttpResponse, http, installMockApi } from "../../test/msw";
import { TrackerScreen } from "./tracker";

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
): ApplicationTracker {
  return { ...fixtures.feedTracker, pipeline_status, pipeline_stage, last_status_change_at };
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
      application: { ...tracker("applied", "waiting"), application_id: 7, job_post_id: 42 },
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

function statusSelectFor(title: string): HTMLSelectElement {
  return screen.getByRole<HTMLSelectElement>("combobox", {
    name: `Application status for ${title}`,
  });
}

function rowFor(title: string): HTMLElement {
  const row = statusSelectFor(title).closest("tr");
  if (row === null) throw new Error(`no row for ${title}`);
  return row;
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

function stat(caption: string): string | null | undefined {
  const stats = Array.from(document.querySelectorAll(".applications-stat"));
  const found = stats.find(
    (candidate) => candidate.querySelector(".applications-stat-label")?.textContent === caption,
  );
  return found?.querySelector(".applications-stat-value")?.textContent;
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
    expect(stat("Applied to")).toBe("5");

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
    expect(statusSelectFor("Staff Engineer").value).toBe("applied");
    expect(staff.querySelector(".tracker-stage")?.textContent).toBe("Waiting");
    expect(
      Array.from(staff.querySelectorAll(".tracker-cell-date")).map((cell) => cell.textContent),
    ).toEqual(["1 Sep 2026", "5 Sep 2026"]);

    const principal = rowFor("Principal Engineer");
    expect(within(principal).getByRole("link", { name: "Principal Engineer" })).toHaveAttribute(
      "href",
      "/jobs/43",
    );
    expect(principal.querySelector(".tracker-cell-company")?.textContent).toBe("Globex");
    expect(principal.querySelector(".tracker-stage")).toBeNull();
    expect(
      Array.from(principal.querySelectorAll(".tracker-cell-date")).map((cell) => cell.textContent),
    ).toEqual(["3 Sep 2026", "—"]);
  });

  it("offers the Not applied placeholder only while a job is untracked", async () => {
    await loadedTracker();

    const untracked = Array.from(statusSelectFor("Principal Engineer").options);
    expect(statusSelectFor("Principal Engineer").value).toBe("not_applied");
    expect(untracked[0]?.textContent).toBe("Not applied");
    expect(untracked.map((option) => option.value).slice(1)).toEqual([
      "interested",
      "drafting",
      "applied",
      "interviewing",
      "offer",
      "rejected",
      "withdrawn",
      "archived",
      "needs_review",
    ]);

    const tracked = Array.from(statusSelectFor("Staff Engineer").options);
    expect(tracked.map((option) => option.value)).not.toContain("not_applied");
    expect(tracked).toHaveLength(9);
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
    expect(stat("Applied to")).toBe("5");
    expect(stat("Jobs tracked")).toBe("12");
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

    expect(container.querySelector(".tracker-pagination")).toHaveClass("job-pagination");
    expect(container.querySelector(".tracker-page-indicator")?.textContent).toBe("Page 1 of 3");
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(container.querySelector(".tracker-page-indicator")?.textContent).toBe("Page 2 of 3");
    });
    expect(requests.at(-1)?.get("page")).toBe("2");
    expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await waitFor(() => {
      expect(container.querySelector(".tracker-page-indicator")?.textContent).toBe("Page 1 of 3");
    });
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
/* One markup, two layouts                                                     */
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

describe("one table markup, two layouts", () => {
  it("renders a single real table whose every cell labels itself with its column header", async () => {
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

    // No second, card-shaped markup: the same table is what app.css lays out both ways.
    expect(container.querySelectorAll("table")).toHaveLength(1);
    const headers = Array.from(container.querySelectorAll("thead th")).map((th) => th.textContent);
    expect(headers).toEqual(["Job", "Company", "Status", "Intaked", "Updated"]);
    expect(Array.from(container.querySelectorAll("thead th")).map((th) => th.className)).toEqual([
      "tracker-col-job",
      "tracker-col-company",
      "tracker-col-status",
      "tracker-col-date",
      "tracker-col-date",
    ]);

    const bodyRows = Array.from(container.querySelectorAll<HTMLTableRowElement>("tbody tr"));
    expect(bodyRows.map((row) => row.className)).toEqual([
      "tracker-row tracker-row--not_applied",
      "tracker-row tracker-row--applied",
      "tracker-row tracker-row--in_progress",
      "tracker-row tracker-row--closed",
      "tracker-row tracker-row--not_applied",
    ]);
    for (const row of bodyRows) {
      const cells = Array.from(row.cells);
      // On a phone the header row is hidden, so each cell's data-label is the only label shown.
      expect(cells.map((cell) => cell.dataset.label)).toEqual(headers);
      for (const cell of cells) expect(cell).toHaveClass("tracker-cell");
      // The tint is painted by the leading cell in table mode, so the title cell must lead.
      expect(cells[0]).toHaveClass("tracker-cell-job");
    }
  });

  it("paints each cell's label from data-label on mobile and hides the header row", () => {
    const mobile = rulesOf(unconditional(stylesheet()));

    expect(declared(mobile, ".tracker-cell::before", "content")).toBe("attr(data-label)");
    expect(declared(mobile, ".tracker-cell-job::before", "content")).toBe("none");
    expect(declared(mobile, ".tracker-table", "display")).toBe("block");
    expect(declared(mobile, ".tracker-row", "display")).toBe("block");
    expect(declared(mobile, ".tracker-table tbody", "display")).toBe("block");
    expect(declared(mobile, ".tracker-table thead", "position")).toBe("absolute");
    expect(declared(mobile, ".tracker-table thead", "clip-path")).toBe("inset(50%)");
    // The card carries the group on its left border.
    expect(declared(mobile, ".tracker-row--applied", "border-left-color")).toBe(
      "var(--color-accent)",
    );
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

  it("sets explicit table display values inside the container query, never revert", () => {
    const css = stylesheet();
    const desktop = rulesOf(atRuleBody(css, "@container (min-width: 800px)"));

    expect(declared(desktop, ".tracker-table", "display")).toBe("table");
    expect(declared(desktop, ".tracker-table thead", "display")).toBe("table-header-group");
    expect(declared(desktop, ".tracker-table tbody", "display")).toBe("table-row-group");
    expect(declared(desktop, ".tracker-row", "display")).toBe("table-row");
    expect(declared(desktop, ".tracker-cell", "display")).toBe("table-cell");
    expect(declared(desktop, ".tracker-cell::before", "content")).toBe("none");

    const trackerRules = [...rulesOf(unconditional(css)), ...desktop].filter(([selector]) =>
      selector.includes("tracker"),
    );
    expect(trackerRules.length).toBeGreaterThan(20);
    for (const [selector, body] of trackerRules) {
      expect(body, selector).not.toMatch(/\brevert\b/);
    }
  });

  it("tints the group with an inset box-shadow on the leading cell, not a border on the row", () => {
    const desktop = rulesOf(atRuleBody(stylesheet(), "@container (min-width: 800px)"));

    expect(declared(desktop, ".tracker-row", "border")).toBe("0");
    expect(declared(desktop, ".tracker-cell-job", "box-shadow")).toBe(
      "inset 3px 0 0 var(--color-border-strong)",
    );
    for (const [group, color] of [
      ["applied", "var(--color-accent)"],
      ["in_progress", "var(--color-warning)"],
      ["closed", "var(--color-ink-faint)"],
    ] as const) {
      expect(declared(desktop, `.tracker-row--${group} .tracker-cell-job`, "box-shadow")).toBe(
        `inset 3px 0 0 ${color}`,
      );
      expect(desktop.has(`.tracker-row--${group}`)).toBe(false);
    }
    for (const [selector, body] of desktop) {
      if (selector.startsWith(".tracker-row")) expect(body, selector).not.toMatch(/border-left/);
    }
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

    fireEvent.change(statusSelectFor("Principal Engineer"), { target: { value: "applied" } });

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
      expect(statusSelectFor("Principal Engineer").value).toBe("applied");
    });
    expect(requests[1]?.get("status")).toBe("all");
    expect(rowFor("Principal Engineer").querySelector(".tracker-stage")?.textContent).toBe(
      "Waiting",
    );
    expect(
      Array.from(statusSelectFor("Principal Engineer").options).map((option) => option.value),
    ).not.toContain("not_applied");
    expect(tabCount("Applied")).toBe("2");
    expect(container.querySelector(".tracker-status-error")).toBeNull();
  });

  it("lets the refetch move a row out of the tab it was edited in", async () => {
    const { container } = await loadedTracker();
    fireEvent.click(tab("Not applied"));
    await waitFor(() => {
      expect(container.querySelectorAll(".tracker-row")).toHaveLength(1);
    });
    expect(tabCount("Not applied")).toBe("1");

    fireEvent.change(statusSelectFor("Principal Engineer"), { target: { value: "applied" } });

    await waitFor(() => {
      expect(container.querySelector(".tracker-empty")?.textContent).toBe(
        "Nothing left to apply to in this view.",
      );
    });
    expect(tabCount("Not applied")).toBe("0");
    expect(tabCount("Applied")).toBe("2");
    expect(stat("Applied to")).toBe("2");
  });

  it("disables every status select while a write is in flight and marks only its own row", async () => {
    writeDelay = 250;
    await loadedTracker();

    fireEvent.change(statusSelectFor("Principal Engineer"), { target: { value: "interviewing" } });

    await waitFor(() => {
      expect(rowFor("Principal Engineer").querySelector(".tracker-saving")?.textContent).toBe(
        "Saving…",
      );
    });
    expect(statusSelectFor("Principal Engineer")).toBeDisabled();
    expect(statusSelectFor("Staff Engineer")).toBeDisabled();
    expect(rowFor("Staff Engineer").querySelector(".tracker-saving")).toBeNull();

    // Re-enabled only once the refetched page has landed, not when the PATCH answers.
    await waitFor(() => {
      expect(statusSelectFor("Staff Engineer")).toBeEnabled();
    });
    expect(requests).toHaveLength(2);
    expect(statusSelectFor("Principal Engineer").value).toBe("interviewing");
    expect(document.querySelector(".tracker-saving")).toBeNull();
    expect(statusWrites).toHaveLength(1);
  });

  // TestApplicationsViewSetStatusIgnoresNotAppliedPlaceholder.
  it("treats choosing the Not applied placeholder as a no-op", async () => {
    await loadedTracker();

    fireEvent.change(statusSelectFor("Principal Engineer"), { target: { value: "not_applied" } });
    await settle();

    expect(statusWrites).toEqual([]);
    expect(requests).toHaveLength(1);
  });

  // TestApplicationsViewSetStatusError.
  it("reports a failed write above the rows, keeps them, and does not retry", async () => {
    failWriteWith = 500;
    const { container } = await loadedTracker();

    fireEvent.change(statusSelectFor("Principal Engineer"), { target: { value: "applied" } });

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("Could not update application status.");
    });
    expect(screen.getByRole("alert")).toHaveClass("tracker-status-error");
    expect(container.querySelectorAll(".tracker-row")).toHaveLength(2);
    expect(statusSelectFor("Principal Engineer").value).toBe("not_applied");
    expect(statusSelectFor("Principal Engineer")).toBeEnabled();
    await settle();
    expect(statusWrites).toHaveLength(1);
    expect(requests).toHaveLength(1);
  });

  it("reports an expired session on a write as one", async () => {
    failWriteWith = 401;
    await loadedTracker();

    fireEvent.change(statusSelectFor("Principal Engineer"), { target: { value: "applied" } });

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe(SESSION_EXPIRED);
    });
  });
});
