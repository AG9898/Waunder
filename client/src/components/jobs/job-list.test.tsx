/**
 * Jobs feed parity — the list half (`FE-15`).
 *
 * Transcribed from the render and pagination cases in `web/components/jobs_test.go`, with
 * two differences that are the point of the port rather than incidental:
 *
 * - The Go build could not invoke an `OnClick` from a test, so pagination was exercised
 *   through `applyPrevPage` / `applyNextPage` and the buttons themselves were never
 *   pressed. Here they are pressed, which is also what proves the disabled states are real
 *   rather than cosmetic.
 * - Rails is MSW, so the assertions are on the **request the feed sent** as much as on what
 *   it rendered. That is what pins "the server owns filtering and sorting": a client-side
 *   sort would pass any assertion about rendered rows, and only the query string and the
 *   rendered order together rule it out.
 *
 * The class names asserted below are a contract with `public/app.css` and the `FE-28`
 * parity gate, not implementation detail — `.job-score--high` and `.job-status--backlog`
 * are what colour the pills, and a renamed one is an unstyled pill, not a failing render.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";

import { createQueryClient } from "../../api/query-client";
import type { JobPage, JobSummary } from "../../api/schemas";
import { feedParams, pageIndicatorLabel } from "../../lib/job-feed";
import { HttpResponse, errorResponse, http, installMockApi } from "../../test/msw";
import { emptyJobPage, fixtures } from "../../test/handlers";
import { JobList } from "./job-list";

/** Every query string `GET /api/job_posts` was asked for, in order. */
let requested: string[] = [];
/** The page the fake Rails answers with; overridden per test. */
let answer: JobPage = fixtures.jobPage;
/** Set to a status to make the feed read fail instead. */
let failWith: number | null = null;

const server = installMockApi(
  http.get("/api/job_posts", ({ request }) => {
    requested.push(new URL(request.url).search.replace(/^\?/, ""));
    if (failWith !== null) {
      return HttpResponse.json(
        { error: { code: "server_error", message: "boom" } },
        { status: failWith },
      );
    }
    return HttpResponse.json(answer);
  }),
);

beforeEach(() => {
  requested = [];
  answer = fixtures.jobPage;
  failWith = null;
});

function renderFeed() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={["/jobs"]}>
        <JobList />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Waits for the first page of rows to be on screen. */
async function renderedFeed() {
  const view = renderFeed();
  await screen.findByRole("list", { name: "" }).catch(() => undefined);
  await waitFor(() => expect(view.container.querySelector(".job-list-items")).not.toBeNull());
  return view;
}

/** A feed page built from one row, with an explicit envelope. */
function pageOf(jobs: JobSummary[], page: Partial<JobPage["page"]> = {}): JobPage {
  return {
    job_posts: jobs,
    page: { number: 1, size: 30, total: jobs.length, has_next: false, ...page },
    application_counts: fixtures.applicationCounts,
  };
}

/* -------------------------------------------------------------------------- */
/* Rows                                                                        */
/* -------------------------------------------------------------------------- */

describe("job feed rows", () => {
  it("renders the screen root, chrome, and import action before any data arrives", () => {
    const { container } = renderFeed();

    expect(container.querySelector(".job-list")).not.toBeNull();
    // AppChrome is the first child of the page container, as renderAppTabs() was: the
    // fixed bottom bar takes its containing block from the screen root.
    expect(container.querySelector(".job-list")?.firstElementChild).toHaveClass("app-chrome");
    expect(screen.getByRole("heading", { name: "Jobs" })).toBeInTheDocument();
    // Scoped to the screen's own action: the chrome carries an "Import job" link too.
    expect(container.querySelector(".job-list-import")).toHaveAttribute("href", "/jobs/new");
  });

  it("renders each row's title, company, and link to the posting", async () => {
    const { container } = await renderedFeed();

    const rows = container.querySelectorAll(".job-list-item");
    expect(rows).toHaveLength(2);
    const first = rows[0] as HTMLElement;
    expect(first.querySelector(".job-list-link")).toHaveAttribute("href", "/jobs/101");
    expect(within(first).getByText("Senior Backend Engineer")).toHaveClass("job-title");
    expect(within(first).getByText("Northwind Robotics")).toHaveClass("job-company");
  });

  it("colour-codes the score pill by band and never paints an unscored job as a weak match", async () => {
    answer = pageOf([
      { ...fixtures.scoredJob, id: 1, match_score: 82 },
      { ...fixtures.scoredJob, id: 2, match_score: 60 },
      { ...fixtures.scoredJob, id: 3, match_score: 12 },
      { ...fixtures.unscoredJob, id: 4, match_score: null, scoring_status: "deferred" },
    ]);
    const { container } = await renderedFeed();

    const pills = [...container.querySelectorAll(".job-score")];
    expect(pills.map((pill) => pill.className)).toEqual([
      "job-score job-score--high",
      "job-score job-score--mid",
      "job-score job-score--low",
      "job-score job-score--pending",
    ]);
    expect(pills.map((pill) => pill.textContent)).toEqual(["82%", "60%", "12%", "Queued later"]);
  });

  it("renders the lifecycle pill for every bin, defaulting an absent state to active", async () => {
    answer = pageOf([
      { ...fixtures.scoredJob, id: 1, lifecycle_state: "active" },
      { ...fixtures.scoredJob, id: 2, lifecycle_state: "backlog" },
      { ...fixtures.scoredJob, id: 3, lifecycle_state: "removed" },
      // An older payload — the ingestion-batch serializer only started sending this field
      // for this pill (AGENTS.md 2026-06-24).
      { ...fixtures.scoredJob, id: 4, lifecycle_state: "" },
    ]);
    const { container } = await renderedFeed();

    expect([...container.querySelectorAll(".job-status")].map((pill) => pill.className)).toEqual([
      "job-status job-status--active",
      "job-status job-status--backlog",
      "job-status job-status--removed",
      "job-status job-status--active",
    ]);
    expect(container.querySelectorAll(".job-status")[3]).toHaveTextContent("Active");
  });

  it("leads the origin pill with a self-hosted brand logo", async () => {
    answer = pageOf([{ ...fixtures.scoredJob, source: "linkedin" }]);
    const { container } = await renderedFeed();

    const pill = container.querySelector(".job-source");
    expect(pill).toHaveTextContent("LinkedIn");
    const logo = pill?.querySelector("img");
    // Same-origin and unprefixed: Vite serves public/ at the site root, so go-app's
    // /web/icons/... would 404 silently and drop only the logo.
    expect(logo).toHaveAttribute("src", "/icons/linkedin.svg");
    expect(logo).toHaveAttribute("alt", "LinkedIn");
    expect(logo).toHaveClass("job-source-logo");
  });

  it("uses the emoji marker for a source with no brand logo", async () => {
    answer = pageOf([{ ...fixtures.scoredJob, source: "manual" }]);
    const { container } = await renderedFeed();

    expect(container.querySelector(".job-source-logo")).toBeNull();
    expect(container.querySelector(".job-source-emoji")).toHaveTextContent("✍️");
    expect(container.querySelector(".job-source")).toHaveTextContent("Manual entry");
  });

  it("omits the origin pill entirely when the posting records no source", async () => {
    answer = pageOf([{ ...fixtures.scoredJob, source: "" }]);
    const { container } = await renderedFeed();

    expect(container.querySelector(".job-source")).toBeNull();
  });

  it("renders no location element, because the feed payload carries none", async () => {
    const { container } = await renderedFeed();

    expect(container.querySelector(".job-location")).toBeNull();
    expect(Object.keys(fixtures.scoredJob)).not.toContain("location");
  });
});

/* -------------------------------------------------------------------------- */
/* The server owns the feed                                                    */
/* -------------------------------------------------------------------------- */

describe("server-owned filtering and sorting", () => {
  it("asks for the scored, active working set oldest-first, and sends no page on page 1", async () => {
    await renderedFeed();

    expect(requested).toEqual(["sort=oldest&state=active&status=scored"]);
    expect(feedParams(1)).toEqual({ status: "scored", state: "active", sort: "oldest", page: 1 });
  });

  it("renders rows in the order Rails returned them, without re-sorting by score", async () => {
    answer = pageOf([
      { ...fixtures.scoredJob, id: 1, title: "Third best", match_score: 20 },
      { ...fixtures.scoredJob, id: 2, title: "Best", match_score: 95 },
      { ...fixtures.scoredJob, id: 3, title: "Second best", match_score: 55 },
    ]);
    const { container } = await renderedFeed();

    expect([...container.querySelectorAll(".job-title")].map((node) => node.textContent)).toEqual([
      "Third best",
      "Best",
      "Second best",
    ]);
  });

  it("renders every row Rails sent, without dropping any client-side", async () => {
    answer = pageOf([
      { ...fixtures.scoredJob, id: 1, lifecycle_state: "backlog" },
      { ...fixtures.unscoredJob, id: 2, match_score: null },
      { ...fixtures.scoredJob, id: 3, source: "" },
    ]);
    const { container } = await renderedFeed();

    expect(container.querySelectorAll(".job-list-item")).toHaveLength(3);
  });
});

/* -------------------------------------------------------------------------- */
/* Pagination                                                                  */
/* -------------------------------------------------------------------------- */

describe("pagination", () => {
  it("disables both ends when the envelope reports a single page", async () => {
    answer = pageOf([fixtures.scoredJob], { number: 1, total: 1, has_next: false });
    await renderedFeed();

    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByText("Page 1 of 1")).toHaveClass("job-page-indicator");
  });

  it("advances to the next page and asks Rails for it", async () => {
    answer = pageOf([fixtures.scoredJob], { number: 1, size: 1, total: 2, has_next: true });
    await renderedFeed();

    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
    answer = pageOf([fixtures.unscoredJob], { number: 2, size: 1, total: 2, has_next: false });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => expect(screen.getByText("Page 2 of 2")).toBeInTheDocument());
    expect(requested).toEqual([
      "sort=oldest&state=active&status=scored",
      "page=2&sort=oldest&state=active&status=scored",
    ]);
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("steps back to the previous page", async () => {
    answer = pageOf([fixtures.scoredJob], { number: 1, size: 1, total: 2, has_next: true });
    await renderedFeed();
    answer = pageOf([fixtures.unscoredJob], { number: 2, size: 1, total: 2, has_next: false });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("Page 2 of 2")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));

    await waitFor(() => expect(screen.getByText("Page 1 of 2")).toBeInTheDocument());
    expect(screen.getByText("Senior Backend Engineer")).toBeInTheDocument();
    // Page 1 is still fresh in the cache, so stepping back costs no request — the two
    // pages are distinct cache entries because `page` is part of the query key.
    expect(requested).toEqual([
      "sort=oldest&state=active&status=scored",
      "page=2&sort=oldest&state=active&status=scored",
    ]);
  });

  it("reads the position from the envelope, falling back when the total is unknown", () => {
    expect(pageIndicatorLabel({ number: 2, size: 30, total: 61, has_next: true })).toBe(
      "Page 2 of 3",
    );
    expect(pageIndicatorLabel({ number: 3, size: 0, total: 0, has_next: false })).toBe("Page 3");
    expect(pageIndicatorLabel({ number: 0, size: 30, total: 30, has_next: false })).toBe(
      "Page 1 of 1",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Load states                                                                 */
/* -------------------------------------------------------------------------- */

describe("load states", () => {
  it("shows the loading state before the first page arrives", () => {
    const { container } = renderFeed();

    expect(container.querySelector(".loading")).toHaveTextContent("Loading…");
    expect(container.querySelector(".job-list-items")).toBeNull();
  });

  it("shows the error state when the feed read fails", async () => {
    // A 4xx is Rails' considered answer, so it fails immediately; a 5xx would be retried
    // twice first (api/query-client.ts) and is covered by the policy's own test.
    failWith = 422;
    const { container } = renderFeed();

    await waitFor(() => expect(container.querySelector(".load-error")).not.toBeNull());
    expect(container.querySelector(".load-error")).toHaveTextContent(
      "Could not load data. Please try again.",
    );
    // A transport failure is not a dead session, so no sign-in link.
    expect(container.querySelector(".sign-in-link")).toBeNull();
  });

  it("offers a sign-in link when the session expired", async () => {
    server.use(errorResponse("get", "/api/job_posts", 401, "unauthorized", "Unauthorized"));
    const { container } = renderFeed();

    await waitFor(() => expect(container.querySelector(".sign-in-link")).not.toBeNull());
    expect(container.querySelector(".load-error")).toHaveTextContent("Your session expired");
    expect(container.querySelector(".sign-in-link")).toHaveAttribute("href", "/login");
  });

  it("shows the empty-feed state with a way forward", async () => {
    answer = emptyJobPage;
    const { container } = renderFeed();

    await waitFor(() => expect(container.querySelector(".job-list-empty")).not.toBeNull());
    expect(container.querySelector(".job-list-empty p")).toHaveTextContent("No scored jobs yet.");
    expect(screen.getByRole("link", { name: "Import a job" })).toHaveAttribute("href", "/jobs/new");
    // No pagination chrome to page through nothing.
    expect(container.querySelector(".job-pagination")).toBeNull();
  });
});
