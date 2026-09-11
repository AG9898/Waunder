/**
 * Jobs feed parity — the write half (`FE-17`): bins, selection, bulk and per-row lifecycle,
 * and score-on-demand.
 *
 * Transcribed from the lifecycle and scoring cases in `web/components/jobs_test.go`, with the
 * same two differences that made `FE-15`'s port worth doing. The Go build could not invoke an
 * `OnClick` from a test, so every one of these paths was exercised through a `do*` / `apply*`
 * helper and **no button was ever pressed** (AGENTS.md 2026-06-13) — the disabled states,
 * the bin-dependent button set, and the "never writes on render" rule were all asserted
 * against state rather than against the screen. Here the controls are clicked, and Rails is
 * MSW, so the assertions are on the *request that was actually sent*.
 *
 * That matters most for the endpoint split: a test that only checked `SetJobLifecycle` was
 * called cannot tell a bulk PATCH from N member PATCHes, and the collection endpoint is what
 * keeps a bulk transition in one Rails transaction.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createQueryClient } from "../../api/query-client";
import type { JobPage, JobSummary } from "../../api/schemas";
import {
  BIN_OPTIONS,
  bulkSelectionLabel,
  clearSelection,
  scoreButtonLabel,
  toggleSelection,
  visibleSelection,
} from "../../lib/job-actions";
import { DEFAULT_SELECTION, writeSelection, type JobFilterSelection } from "../../lib/job-filters";
import { HttpResponse, http, installMockApi, type JsonBodyType } from "../../test/msw";
import { fixtures } from "../../test/handlers";
import { JobList } from "./job-list";

/* -------------------------------------------------------------------------- */
/* Fake Rails                                                                  */
/* -------------------------------------------------------------------------- */

interface Sent {
  method: string;
  path: string;
  search: string;
  body: unknown;
}

/** Every request the feed sent, in order. */
let sent: Sent[] = [];
/** The page the fake Rails answers the feed with. */
let answer: JobPage = pageOf([fixtures.scoredJob, fixtures.unscoredJob]);
/** Set to a status to make the next write fail. */
let failWrite: number | null = null;
/** While set, every write blocks on this until `releaseWrites()` is called. */
let pending: Promise<void> | null = null;
let release: (() => void) | null = null;

function record(method: string, request: Request, body: unknown = null) {
  const url = new URL(request.url);
  sent.push({ method, path: url.pathname, search: url.search.replace(/^\?/, ""), body });
}

function writeAnswer(body: JsonBodyType) {
  if (failWrite !== null) {
    return HttpResponse.json(
      { error: { code: "server_error", message: "boom" } },
      { status: failWrite },
    );
  }
  return HttpResponse.json(body);
}

/**
 * Holds every subsequent write open, so a test can observe the in-flight state. Paired with
 * `releaseWrites()`, which `afterEach` also calls — a request left hanging past the test
 * outlives the component that made it.
 */
function holdWrites() {
  pending = new Promise<void>((resolve) => {
    release = resolve;
  });
}

function releaseWrites() {
  release?.();
  pending = null;
  release = null;
}

async function gate() {
  if (pending) await pending;
}

installMockApi(
  http.get("/api/job_posts", ({ request }) => {
    record("GET", request);
    return HttpResponse.json(answer);
  }),
  // Registered before the `:id` route on purpose: `/api/job_posts/:id/lifecycle` would
  // otherwise match the collection path with id="lifecycle" and swallow every bulk write.
  http.patch("/api/job_posts/lifecycle", async ({ request }) => {
    const body = (await request.json()) as { ids?: number[]; lifecycle_state?: string };
    record("PATCH", request, body);
    await gate();
    return writeAnswer({
      job_posts: (body.ids ?? []).map((id) => ({
        ...fixtures.scoredJob,
        id,
        lifecycle_state: body.lifecycle_state ?? "active",
      })),
    });
  }),
  http.patch("/api/job_posts/:id/lifecycle", async ({ params, request }) => {
    const body = (await request.json()) as { lifecycle_state?: string };
    record("PATCH", request, body);
    await gate();
    return writeAnswer({
      job_post: {
        ...fixtures.scoredJob,
        id: Number(params.id),
        lifecycle_state: body.lifecycle_state ?? "active",
      },
    });
  }),
  http.post("/api/job_posts/:id/score", async ({ params, request }) => {
    record("POST", request, null);
    await gate();
    return writeAnswer({
      job_post: { ...fixtures.unscoredJob, id: Number(params.id), scoring_status: "pending" },
    });
  }),
);

afterEach(releaseWrites);

beforeEach(() => {
  sent = [];
  answer = pageOf([fixtures.scoredJob, fixtures.unscoredJob]);
  failWrite = null;
  releaseWrites();
  // The feed persists its selection (`FE-16`), and jsdom's storage outlives a test within a
  // file — so clear it, or one test's bin becomes the next one's starting bin.
  localStorage.clear();
});

function pageOf(jobs: JobSummary[]): JobPage {
  return {
    job_posts: jobs,
    page: { number: 1, size: 30, total: jobs.length, has_next: false },
    application_counts: fixtures.applicationCounts,
  };
}

/** Seeds the persisted selection, so the feed opens on a given bin or view. */
function openOn(selection: Partial<JobFilterSelection>) {
  writeSelection({ ...DEFAULT_SELECTION, ...selection });
}

async function renderedFeed() {
  const view = render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={["/jobs"]}>
        <JobList />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(view.container.querySelector(".job-list-items")).not.toBeNull());
  return view;
}

/** Every feed read so far, as query strings. */
const feedReads = () =>
  sent.filter((one) => one.path === "/api/job_posts").map((one) => one.search);
/** Every write so far — anything that is not the feed read. */
const writes = () => sent.filter((one) => one.path !== "/api/job_posts");

/* -------------------------------------------------------------------------- */
/* Pure helpers                                                                */
/* -------------------------------------------------------------------------- */

describe("lib/job-actions", () => {
  it("lists the bins in renderBinTabs' order with its labels", () => {
    expect(BIN_OPTIONS).toEqual([
      { value: "active", label: "Active" },
      { value: "backlog", label: "Backlog" },
      { value: "removed", label: "Removed" },
    ]);
  });

  it("labels the score button from scoreButtonLabel's case table", () => {
    expect(scoreButtonLabel(true, "deferred")).toBe("Scoring...");
    // The in-flight state wins over Rails' own status, as it did in Go.
    expect(scoreButtonLabel(true, "pending")).toBe("Scoring...");
    expect(scoreButtonLabel(false, "pending")).toBe("Queued");
    expect(scoreButtonLabel(false, "deferred")).toBe("Score");
    expect(scoreButtonLabel(false, "")).toBe("Score");
  });

  it("singularizes the bulk count, as bulkSelectionLabel did", () => {
    expect(bulkSelectionLabel(0)).toBe("0 selected");
    expect(bulkSelectionLabel(1)).toBe("1 selected");
    expect(bulkSelectionLabel(2)).toBe("2 selected");
  });

  it("toggles a row's selection without mutating the set it was given", () => {
    const before = new Set([1]);
    const on = toggleSelection(before, 2);
    expect([...on]).toEqual([1, 2]);
    expect([...before]).toEqual([1]);
    expect([...toggleSelection(on, 1)]).toEqual([2]);
  });

  it("drops the acted-on ids after a lifecycle write, leaving the rest", () => {
    expect([...clearSelection(new Set([1, 2, 3]), [1, 3])]).toEqual([2]);
    expect([...clearSelection(new Set([1]), [9])]).toEqual([1]);
  });

  it("restricts a bulk action to checked rows that are actually loaded, in row order", () => {
    const rows = [{ id: 7 }, { id: 3 }, { id: 5 }];
    // 99 was checked on another page and nothing prunes it; sending it would move a row
    // the owner is not looking at.
    expect(visibleSelection(rows, new Set([5, 99, 7]))).toEqual([7, 5]);
    expect(visibleSelection(rows, new Set())).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Bin tabs                                                                    */
/* -------------------------------------------------------------------------- */

describe("lifecycle bin tabs", () => {
  it("renders the three bins as tabs with Active current by default", async () => {
    const { container } = await renderedFeed();

    const tabs = [...container.querySelectorAll(".job-bin-tab")];
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Active", "Backlog", "Removed"]);
    expect(container.querySelector(".job-bin-tabs")).toHaveAttribute("role", "tablist");
    // The active class is the CSS contract; aria-selected is what a screen reader reads.
    expect(tabs[0]).toHaveClass("view-selector-option-active");
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).not.toHaveClass("view-selector-option-active");
    expect(tabs[1]).toHaveAttribute("aria-selected", "false");
  });

  it("switches bins through the state parameter, not by splitting the rows it has", async () => {
    await renderedFeed();
    expect(feedReads()).toEqual(["sort=oldest&state=active&status=scored"]);

    fireEvent.click(screen.getByRole("tab", { name: "Backlog" }));

    await waitFor(() => expect(feedReads()).toContain("sort=oldest&state=backlog&status=scored"));
    // A bin is a server query: the same two rows come back because the fake Rails answers
    // the same page, which is exactly what a client-side split could not produce.
    expect(screen.getByRole("tab", { name: "Backlog" })).toHaveClass("view-selector-option-active");
  });

  it("returns to page 1 when the bin changes, because page 4 of Active is not page 4 of Backlog", async () => {
    openOn({ pageNum: 3 });
    await renderedFeed();
    expect(feedReads()[0]).toContain("page=3");

    fireEvent.click(screen.getByRole("tab", { name: "Removed" }));

    await waitFor(() => expect(feedReads()).toHaveLength(2));
    expect(feedReads()[1]).toBe("sort=oldest&state=removed&status=scored");
  });

  it("swallows a click on the bin already being shown", async () => {
    await renderedFeed();

    fireEvent.click(screen.getByRole("tab", { name: "Active" }));

    await waitFor(() => expect(feedReads()).toHaveLength(1));
  });

  it("restores the bin the owner left on, before the first fetch", async () => {
    openOn({ bin: "backlog" });
    await renderedFeed();

    // One request, and it already asks for the backlog — not a default fetch corrected after.
    expect(feedReads()).toEqual(["sort=oldest&state=backlog&status=scored"]);
    expect(screen.getByRole("tab", { name: "Backlog" })).toHaveAttribute("aria-selected", "true");
  });
});

/* -------------------------------------------------------------------------- */
/* The manage bar                                                              */
/* -------------------------------------------------------------------------- */

describe("the per-row manage bar", () => {
  it("groups the checkbox with the lifecycle buttons instead of floating it above the card", async () => {
    const { container } = await renderedFeed();

    const row = container.querySelector(".job-list-item") as HTMLElement;
    const bar = row.querySelector(".job-list-actions") as HTMLElement;
    expect(bar).not.toBeNull();
    // The bar is a sibling of the link card, and both controls live inside it — the
    // pre-2026-06-24 layout had the checkbox as a bare grid child of the row.
    expect(bar.parentElement).toBe(row);
    expect(bar.querySelector(".job-select-label .job-select")).not.toBeNull();
    expect(bar.querySelector(".job-lifecycle-actions")).not.toBeNull();
    expect(row.querySelector(":scope > .job-select")).toBeNull();
  });

  it("names each checkbox after its row, so thirty of them are distinguishable", async () => {
    await renderedFeed();

    expect(
      screen.getByRole("checkbox", { name: "Select Senior Backend Engineer" }),
    ).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select Platform Engineer" })).toBeInTheDocument();
  });

  it("offers Backlog and Remove in the Active bin", async () => {
    const { container } = await renderedFeed();

    const bar = container.querySelector(".job-list-actions") as HTMLElement;
    expect(within(bar).getByRole("button", { name: "Backlog" })).toHaveClass(
      "job-lifecycle-backlog",
    );
    expect(within(bar).getByRole("button", { name: "Remove" })).toHaveClass("job-lifecycle-remove");
    expect(bar.querySelector(".job-lifecycle-restore")).toBeNull();
    // The wrapping <div> is what `.job-lifecycle-actions > div` lays out as its own flex row.
    expect(
      bar.querySelector(".job-lifecycle-actions > div > .job-lifecycle-backlog"),
    ).not.toBeNull();
  });

  it("offers only Restore in the Backlog and Removed bins", async () => {
    for (const bin of ["backlog", "removed"] as const) {
      localStorage.clear();
      openOn({ bin });
      const { container, unmount } = await renderedFeed();

      const bar = container.querySelector(".job-list-actions") as HTMLElement;
      expect(within(bar).getByRole("button", { name: "Restore" })).toHaveClass(
        "job-lifecycle-restore",
      );
      expect(bar.querySelector(".job-lifecycle-backlog")).toBeNull();
      expect(bar.querySelector(".job-lifecycle-remove")).toBeNull();
      unmount();
    }
  });

  it("writes nothing on render — no lifecycle transition and no scoring request", async () => {
    openOn({ view: "unscored" });
    await renderedFeed();

    // Remove is a soft delete and Score spends OpenRouter budget; neither may happen
    // because a row scrolled into view.
    expect(writes()).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Lifecycle writes                                                            */
/* -------------------------------------------------------------------------- */

describe("lifecycle writes", () => {
  it("sends a single row through the member PATCH", async () => {
    const { container } = await renderedFeed();
    const bar = container.querySelector(".job-list-actions") as HTMLElement;

    fireEvent.click(within(bar).getByRole("button", { name: "Backlog" }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      method: "PATCH",
      path: "/api/job_posts/101/lifecycle",
      body: { lifecycle_state: "backlog" },
    });
  });

  it("sends a multi-row selection through the collection PATCH, in one request", async () => {
    await renderedFeed();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Senior Backend Engineer" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Platform Engineer" }));
    expect(screen.getByText("2 selected")).toHaveClass("job-bulk-count");

    fireEvent.click(screen.getByRole("button", { name: "Remove selected" }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    // One transaction, not two member PATCHes.
    expect(writes()[0]).toMatchObject({
      method: "PATCH",
      path: "/api/job_posts/lifecycle",
      body: { ids: [101, 102], lifecycle_state: "removed" },
    });
  });

  it("targets the bin's transition: Restore sends active from the backlog", async () => {
    openOn({ bin: "backlog" });
    const { container } = await renderedFeed();
    const bar = container.querySelector(".job-list-actions") as HTMLElement;

    fireEvent.click(within(bar).getByRole("button", { name: "Restore" }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]?.body).toEqual({ lifecycle_state: "active" });
  });

  it("refetches the feed after a write instead of splicing the row out locally", async () => {
    const { container } = await renderedFeed();
    expect(feedReads()).toHaveLength(1);

    fireEvent.click(
      within(container.querySelector(".job-list-actions") as HTMLElement).getByRole("button", {
        name: "Backlog",
      }),
    );

    // The invalidation is the whole mechanism: a lifecycle change moves a row out of the
    // current bin *and* pulls one forward from a later page, so only Rails knows what this
    // page holds now.
    await waitFor(() => expect(feedReads()).toHaveLength(2));
    expect(feedReads()[1]).toBe(feedReads()[0]);
    // The fake Rails still answers with both rows, and both are still on screen — proof the
    // screen renders the server's answer rather than a local splice.
    expect(container.querySelectorAll(".job-list-item")).toHaveLength(2);
  });

  it("clears the selection of the rows a bulk write moved", async () => {
    await renderedFeed();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Senior Backend Engineer" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Platform Engineer" }));

    fireEvent.click(screen.getByRole("button", { name: "Backlog selected" }));

    await waitFor(() => expect(screen.getByText("0 selected")).toBeInTheDocument());
    expect(screen.getByRole("checkbox", { name: "Select Platform Engineer" })).not.toBeChecked();
  });

  it("disables every lifecycle control while a write is in flight", async () => {
    holdWrites();
    const { container } = await renderedFeed();
    const bar = container.querySelector(".job-list-actions") as HTMLElement;

    fireEvent.click(within(bar).getByRole("button", { name: "Backlog" }));

    // A per-row write disables the bulk bar and every other row too: both PATCH the same
    // rows, so a second click mid-flight lands a row in a bin the owner did not choose.
    await waitFor(() => expect(within(bar).getByRole("button", { name: "Remove" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Backlog selected" })).toBeDisabled();
    const rows = container.querySelectorAll(".job-list-actions");
    expect(within(rows[1] as HTMLElement).getByRole("button", { name: "Backlog" })).toBeDisabled();
  });

  it("disables the bulk buttons when nothing on this page is checked", async () => {
    await renderedFeed();

    expect(screen.getByText("0 selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Backlog selected" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove selected" })).toBeDisabled();
  });

  it("reports a failed write once, shared by the row and bulk controls, and does not retry", async () => {
    failWrite = 500;
    const { container } = await renderedFeed();

    fireEvent.click(
      within(container.querySelector(".job-list-actions") as HTMLElement).getByRole("button", {
        name: "Remove",
      }),
    );

    await waitFor(() =>
      expect(container.querySelector(".job-lifecycle-error")).toHaveTextContent(
        "Could not update the job. Please try again.",
      ),
    );
    // A replayed write can re-dispatch work the owner did not ask for; mutations never retry.
    expect(writes()).toHaveLength(1);
    // And nothing was refetched, because nothing changed.
    expect(feedReads()).toHaveLength(1);
  });

  it("says the session expired on a 401 rather than blaming the job", async () => {
    failWrite = 401;
    const { container } = await renderedFeed();

    fireEvent.click(
      within(container.querySelector(".job-list-actions") as HTMLElement).getByRole("button", {
        name: "Remove",
      }),
    );

    await waitFor(() =>
      expect(container.querySelector(".job-lifecycle-error")).toHaveTextContent(
        "Your session expired. Please sign in again.",
      ),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Score on demand                                                             */
/* -------------------------------------------------------------------------- */

describe("score on demand", () => {
  it("is offered only in the Unscored view", async () => {
    const { container, unmount } = await renderedFeed();
    expect(container.querySelector(".job-list-score-action")).toBeNull();
    unmount();

    localStorage.clear();
    openOn({ view: "unscored" });
    const second = await renderedFeed();
    expect(second.container.querySelectorAll(".job-list-score-button")).toHaveLength(2);
  });

  it("posts to the member score endpoint for that row only", async () => {
    openOn({ view: "unscored" });
    const { container } = await renderedFeed();

    fireEvent.click(
      within(container.querySelectorAll(".job-list-actions")[1] as HTMLElement).getByRole(
        "button",
        { name: "Score" },
      ),
    );

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: "POST", path: "/api/job_posts/102/score" });
  });

  it("shows the pending state on the requested row and leaves the other alone", async () => {
    holdWrites();
    openOn({ view: "unscored" });
    const { container } = await renderedFeed();
    const bars = container.querySelectorAll(".job-list-actions");

    fireEvent.click(within(bars[0] as HTMLElement).getByRole("button", { name: "Score" }));

    await waitFor(() =>
      expect(
        within(bars[0] as HTMLElement).getByRole("button", { name: "Scoring..." }),
      ).toBeDisabled(),
    );
    // Scoring is per row, unlike a lifecycle write: several postings can legitimately be
    // queued at once.
    expect(within(bars[1] as HTMLElement).getByRole("button", { name: "Score" })).toBeEnabled();
  });

  it("refuses a second request while Rails already reports the posting as queued", async () => {
    openOn({ view: "unscored" });
    answer = pageOf([{ ...fixtures.unscoredJob, scoring_status: "pending" }]);
    const { container } = await renderedFeed();

    const button = container.querySelector(".job-list-score-button") as HTMLButtonElement;
    expect(button).toHaveTextContent("Queued");
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(writes()).toEqual([]);
  });

  it("reports a failed request beside the row it failed for", async () => {
    failWrite = 502;
    openOn({ view: "unscored" });
    const { container } = await renderedFeed();
    const bars = container.querySelectorAll(".job-list-actions");

    fireEvent.click(within(bars[0] as HTMLElement).getByRole("button", { name: "Score" }));

    await waitFor(() =>
      expect(container.querySelector(".job-list-score-error")).toHaveTextContent(
        "Could not request scoring.",
      ),
    );
    // One error, on one row — a shared message could not say which posting failed.
    expect(container.querySelectorAll(".job-list-score-error")).toHaveLength(1);
    expect((bars[0] as HTMLElement).querySelector(".job-list-score-error")).not.toBeNull();
    expect(writes()).toHaveLength(1);
  });

  it("refetches the feed after a successful request instead of swapping the row in place", async () => {
    openOn({ view: "unscored" });
    const { container } = await renderedFeed();
    expect(feedReads()).toHaveLength(1);

    fireEvent.click(
      within(container.querySelectorAll(".job-list-actions")[0] as HTMLElement).getByRole(
        "button",
        { name: "Score" },
      ),
    );

    await waitFor(() => expect(feedReads()).toHaveLength(2));
  });
});
