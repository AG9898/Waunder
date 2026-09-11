/**
 * Filter panel parity (`FE-16`) — the rendered half, driven through the real feed.
 *
 * Most cases render `<JobList />` rather than `<JobFilters />` alone, because the things this
 * task must get right are only observable end to end: that the restored selection reaches the
 * **first** request rather than a corrected second one, that a control change produces a new
 * query string, and that Reset leaves the view tab where it was. A panel test in isolation
 * would pass on a screen that never wired the selection into `useQuery`.
 *
 * The class names asserted below are a contract with `public/app.css` and the `FE-28` parity
 * gate, not implementation detail: `.job-filters-panel`, `.job-filters-summary-count`,
 * `.job-filter-score-band`, and `.job-filters-reset` are each styled by name.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createQueryClient } from "../../api/query-client";
import type { JobPage } from "../../api/schemas";
import {
  DEFAULT_SELECTION,
  JOB_FILTERS_STORAGE_KEY,
  type JobFilterSelection,
} from "../../lib/job-filters";
import { fixtures } from "../../test/handlers";
import { HttpResponse, http, installMockApi } from "../../test/msw";
import { JobFilters } from "./job-filters";
import { JobList } from "./job-list";

/** Every query string `GET /api/job_posts` was asked for, in order. */
let requested: string[] = [];
let answer: JobPage = fixtures.jobPage;

installMockApi(
  http.get("/api/job_posts", ({ request }) => {
    requested.push(new URL(request.url).search.replace(/^\?/, ""));
    return HttpResponse.json(answer);
  }),
);

beforeEach(() => {
  requested = [];
  answer = fixtures.jobPage;
  localStorage.clear();
});

/** Seeds `waunder.jobFilters` exactly as `persistFilters` would have. */
function seedStorage(stored: Record<string, unknown>) {
  localStorage.setItem(JOB_FILTERS_STORAGE_KEY, JSON.stringify(stored));
}

function renderFeed() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={["/jobs"]}>
        <JobList />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Renders the feed and waits for its first request to have been answered. */
async function renderedFeed() {
  const view = renderFeed();
  await waitFor(() => expect(requested.length).toBeGreaterThan(0));
  await waitFor(() => expect(view.container.querySelector(".job-list-items")).not.toBeNull());
  return view;
}

/** The panel on its own, for the cases that are purely about its markup. */
function renderPanel(selection: Partial<JobFilterSelection> = {}) {
  const onChange = vi.fn();
  const view = render(
    <JobFilters selection={{ ...DEFAULT_SELECTION, ...selection }} onChange={onChange} />,
  );
  return { ...view, onChange };
}

/* -------------------------------------------------------------------------- */
/* The collapsed panel                                                         */
/* -------------------------------------------------------------------------- */

describe("the filter panel", () => {
  it("is collapsed by default, so the controls do not push the feed off a phone screen", () => {
    const { container } = renderPanel();

    const panel = container.querySelector<HTMLDetailsElement>(".job-filters-panel");
    expect(panel).not.toBeNull();
    expect(panel?.open).toBe(false);
  });

  it("labels the summary with the same words jobs.go used", () => {
    const { container } = renderPanel();

    expect(container.querySelector(".job-filters-summary-label")?.textContent).toBe(
      "Filters & sort",
    );
  });

  it("shows no count when nothing is filtered", () => {
    const { container } = renderPanel();

    expect(container.querySelector(".job-filters-summary-count")).toBeNull();
  });

  it("badges the summary with how many filters are applied", () => {
    const { container } = renderPanel({ scoreBand: "high", location: "Vancouver" });

    expect(container.querySelector(".job-filters-summary-count")?.textContent).toBe("2");
  });

  it("does not count the sort or the view as filters", () => {
    const { container } = renderPanel({ sort: "score", view: "unscored" });

    expect(container.querySelector(".job-filters-summary-count")).toBeNull();
  });

  it("renders every control, collapsed or not", () => {
    // <details> keeps its children mounted, which is why the panel needs no open/closed state.
    const { container } = renderPanel();

    for (const selector of [
      ".job-filter-score-band",
      ".job-filter-source",
      ".job-filter-location",
      ".job-filter-date-from",
      ".job-filter-date-to",
      ".job-filter-sort",
    ]) {
      expect(container.querySelector(selector)).not.toBeNull();
    }
  });

  it("gives the no-filter option a real empty value attribute", () => {
    // go-app omitted an empty `value`, and a browser then reports such an option's *text* as
    // its value — which sent `source=All` to Rails and matched nothing (AGENTS.md 2026-06-24).
    // Asserting the attribute exists and is empty rules that out directly.
    const { container } = renderPanel();

    for (const selector of [".job-filter-score-band", ".job-filter-source"]) {
      const all = container.querySelector<HTMLOptionElement>(`${selector} option`);
      expect(all?.textContent).toBe("All");
      expect(all?.getAttribute("value")).toBe("");
      expect(all?.value).toBe("");
    }
  });

  it("reflects the current selection in each control", () => {
    const { container } = renderPanel({
      scoreBand: "mid",
      source: "glassdoor",
      location: "Calgary",
      dateFrom: "2026-06-01",
      dateTo: "2026-06-23",
      sort: "score",
    });

    const value = (selector: string) =>
      container.querySelector<HTMLSelectElement | HTMLInputElement>(selector)?.value;
    expect(value(".job-filter-score-band")).toBe("mid");
    expect(value(".job-filter-source")).toBe("glassdoor");
    expect(value(".job-filter-location")).toBe("Calgary");
    expect(value(".job-filter-date-from")).toBe("2026-06-01");
    expect(value(".job-filter-date-to")).toBe("2026-06-23");
    expect(value(".job-filter-sort")).toBe("score");
  });
});

/* -------------------------------------------------------------------------- */
/* Reset                                                                       */
/* -------------------------------------------------------------------------- */

describe("reset", () => {
  it("is disabled when nothing is filtered", () => {
    const { container } = renderPanel();

    expect(container.querySelector(".job-filters-reset")).toBeDisabled();
  });

  it("is enabled once a filter is applied", () => {
    const { container } = renderPanel({ source: "linkedin" });

    expect(container.querySelector(".job-filters-reset")).not.toBeDisabled();
  });

  it("clears the filters and the sort, and leaves the view and bin alone", () => {
    const { container, onChange } = renderPanel({
      view: "unscored",
      bin: "backlog",
      sort: "score",
      scoreBand: "high",
      source: "linkedin",
      location: "Vancouver",
      dateFrom: "2026-06-01",
      dateTo: "2026-06-23",
      pageNum: 3,
    });

    fireEvent.click(container.querySelector(".job-filters-reset") as HTMLButtonElement);

    expect(onChange).toHaveBeenCalledWith({
      view: "unscored",
      bin: "backlog",
      sort: "oldest",
      scoreBand: "",
      source: "",
      location: "",
      dateFrom: "",
      dateTo: "",
      pageNum: 1,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* The view selector                                                           */
/* -------------------------------------------------------------------------- */

describe("the scored/unscored view selector", () => {
  it("marks the current view active, for CSS and for a screen reader", () => {
    const { container } = renderPanel({ view: "unscored" });

    const tabs = container.querySelectorAll(".view-selector-option");
    expect(tabs[0]).not.toHaveClass("view-selector-option-active");
    expect(tabs[1]).toHaveClass("view-selector-option-active");
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
  });

  it("reports a change to the other view", () => {
    const { onChange } = renderPanel({ view: "scored" });

    fireEvent.click(screen.getByRole("tab", { name: "Unscored" }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ view: "unscored", pageNum: 1 }),
    );
  });

  it("swallows a click on the view already selected", () => {
    const { onChange } = renderPanel({ view: "scored" });

    fireEvent.click(screen.getByRole("tab", { name: "Scored" }));

    expect(onChange).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* Persistence, through the real feed                                          */
/* -------------------------------------------------------------------------- */

describe("filter persistence", () => {
  it("restores the saved selection before the first fetch", async () => {
    // The router recreates the feed on every navigation to /jobs, so this — not component
    // state — is what survives a trip into a job and back.
    seedStorage({
      view: "unscored",
      bin: "active",
      sort: "score",
      score_band: "high",
      source: "linkedin",
      location: "Vancouver",
      date_from: "2026-06-01",
      date_to: "2026-06-23",
      page_num: 2,
    });

    await renderedFeed();

    // One request, already carrying the restored selection: no default fetch first.
    expect(requested).toEqual([
      "date_from=2026-06-01&date_to=2026-06-23&location=Vancouver&page=2&score_band=high" +
        "&sort=score&source=linkedin&state=active&status=unscored",
    ]);
  });

  it("shows the restored selection in the controls", async () => {
    seedStorage({ score_band: "low", source: "manual", sort: "score" });

    const { container } = await renderedFeed();

    expect(container.querySelector<HTMLSelectElement>(".job-filter-score-band")?.value).toBe("low");
    expect(container.querySelector<HTMLSelectElement>(".job-filter-source")?.value).toBe("manual");
    expect(container.querySelector(".job-filters-summary-count")?.textContent).toBe("2");
  });

  it("saves the selection after a change, in the shape jobs.go writes", async () => {
    const { container } = await renderedFeed();

    fireEvent.change(container.querySelector(".job-filter-source") as HTMLSelectElement, {
      target: { value: "glassdoor" },
    });

    await waitFor(() => {
      const raw = localStorage.getItem(JOB_FILTERS_STORAGE_KEY);
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw ?? "")).toMatchObject({ source: "glassdoor", page_num: 1 });
    });
  });

  it("refetches with the new filter instead of filtering the rows it already has", async () => {
    const { container } = await renderedFeed();

    fireEvent.change(container.querySelector(".job-filter-score-band") as HTMLSelectElement, {
      target: { value: "high" },
    });

    await waitFor(() => expect(requested).toHaveLength(2));
    expect(requested[1]).toBe("score_band=high&sort=oldest&state=active&status=scored");
  });

  it("returns to page 1 when a filter changes", async () => {
    seedStorage({ page_num: 3 });
    const { container } = await renderedFeed();
    expect(requested[0]).toContain("page=3");

    fireEvent.change(container.querySelector(".job-filter-location") as HTMLInputElement, {
      target: { value: "Vancouver" },
    });

    await waitFor(() => expect(requested).toHaveLength(2));
    expect(requested[1]).not.toContain("page=");
  });

  it("sends no parameter at all for a filter cleared back to All", async () => {
    seedStorage({ source: "linkedin" });
    const { container } = await renderedFeed();

    fireEvent.change(container.querySelector(".job-filter-source") as HTMLSelectElement, {
      target: { value: "" },
    });

    await waitFor(() => expect(requested).toHaveLength(2));
    expect(requested[1]).toBe("sort=oldest&state=active&status=scored");
    expect(requested[1]).not.toContain("source");
  });

  it("keeps the view when Reset clears the filters", async () => {
    seedStorage({ view: "unscored", source: "linkedin", score_band: "low" });
    const { container } = await renderedFeed();

    fireEvent.click(container.querySelector(".job-filters-reset") as HTMLButtonElement);

    await waitFor(() => expect(requested).toHaveLength(2));
    expect(requested[1]).toBe("sort=oldest&state=active&status=unscored");
  });

  it("renders the feed even when localStorage cannot be used", async () => {
    // A browser configured to block site data throws from the property getter itself, which
    // would otherwise take the whole screen down on its first render.
    const blocked = vi.spyOn(globalThis, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });

    try {
      const { container } = await renderedFeed();

      expect(container.querySelector(".job-list-items")).not.toBeNull();
      expect(requested).toEqual(["sort=oldest&state=active&status=scored"]);
    } finally {
      blocked.mockRestore();
    }
  });
});
