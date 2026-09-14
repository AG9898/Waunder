/**
 * Ingestion landing parity (`FE-18`).
 *
 * Transcribed from `TestDigestRendersBatches`, `TestDigestRendersLifecycleStatusPill`,
 * `TestDigestLinksCarryBatchProvenance`, `TestDigestReopensBatchFromQuery`,
 * `TestDigestPaginationControls`, `TestDigestNextPageAdvancesAndRequestsNext`,
 * `TestDigestRendersPausedIntakeWithoutChangingItOnMount`,
 * `TestDigestDoSetIntakeResumesHeldAlerts`, and `TestDigestDoSetIntakeReportsError` in
 * `web/components/jobs_test.go`, with the differences the port makes possible:
 *
 * - Go could not press a button from a test, so the intake toggle and the Prev/Next controls
 *   were exercised through `doSetIntake` / `applyNextPage` — the buttons themselves were
 *   never clicked and their disabled states were never proven. Here they are clicked.
 * - `TestDigestReopensBatchFromQuery` had to render `renderBatches()` directly, because the
 *   test engine left the URL empty and the lifecycle hooks would have cleared `openBatch`.
 *   `MemoryRouter` supplies a real URL, so the whole screen renders the way an owner sees it.
 * - The batch summary's own text (source, count, time) had no Go test at all.
 *
 * Two class-name families asserted below are contracts with `public/app.css` and the `FE-28`
 * parity gate rather than implementation detail: `.digest*` is the whole screen's styling,
 * and `.job-score--<band>` / `.job-status--<state>` colour the pills.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";

import { createQueryClient } from "../../api/query-client";
import type { IngestionBatch, IngestionBatchPage, IntakeStatus } from "../../api/schemas";
import {
  batchCountLabel,
  batchSourceLabel,
  formatBatchDate,
  formatBatchTime,
  intakeResultMessage,
} from "../../lib/ingestion-batches";
import { fixtures } from "../../test/handlers";
import { HttpResponse, http, installMockApi } from "../../test/msw";
import { IngestionBatchesScreen } from "./ingestion-batches";

/** Every `?page=` the screen asked `GET /api/ingestion_batches` for, in order. */
let requestedPages: string[] = [];
/** How many times the screen wrote intake. Zero on render is a safety assertion, not a detail. */
let intakeWrites = 0;
/** The last `{intake: {enabled}}` body the toggle sent. */
let lastIntakeEnabled: boolean | null = null;

let batchAnswer: IngestionBatchPage = fixtures.ingestionBatchPage;
let intakeAnswer: IntakeStatus = fixtures.intake;
/** Set to a status to make that read fail instead. */
let failBatchesWith: number | null = null;
let failIntakeWriteWith: number | null = null;
/**
 * Holds the intake PATCH open so its in-flight state can be observed. MSW answers within the
 * same tick otherwise, and "Updating…" is gone before a query can find it — the control is
 * only ever disabled for the length of the request.
 */
let intakeGate: Promise<void> | null = null;
let releaseIntake: (() => void) | null = null;

installMockApi(
  http.get("/api/ingestion_batches", ({ request }) => {
    requestedPages.push(new URL(request.url).searchParams.get("page") ?? "");
    if (failBatchesWith !== null) {
      return HttpResponse.json(
        { error: { code: "server_error", message: "boom" } },
        { status: failBatchesWith },
      );
    }
    return HttpResponse.json(batchAnswer);
  }),
  http.get("/api/intake", () => HttpResponse.json({ intake: intakeAnswer })),
  http.patch("/api/intake", async ({ request }) => {
    intakeWrites += 1;
    if (intakeGate !== null) await intakeGate;
    const body = (await request.json()) as { intake?: { enabled?: boolean } };
    lastIntakeEnabled = body.intake?.enabled ?? null;
    if (failIntakeWriteWith !== null) {
      return HttpResponse.json(
        { error: { code: "server_error", message: "boom" } },
        { status: failIntakeWriteWith },
      );
    }
    return HttpResponse.json({
      intake: {
        ...intakeAnswer,
        enabled: lastIntakeEnabled ?? true,
        queued_count: lastIntakeEnabled === true ? intakeAnswer.held_count : 0,
      },
    });
  }),
);

beforeEach(() => {
  requestedPages = [];
  intakeWrites = 0;
  lastIntakeEnabled = null;
  batchAnswer = fixtures.ingestionBatchPage;
  intakeAnswer = fixtures.intake;
  failBatchesWith = null;
  failIntakeWriteWith = null;
  releaseIntake?.();
  intakeGate = null;
  releaseIntake = null;
});

function renderLanding(url = "/") {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[url]}>
        <IngestionBatchesScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Renders and waits for the loaded screen (both reads settled). */
async function renderedLanding(url = "/") {
  const view = renderLanding(url);
  await waitFor(() => expect(view.container.querySelector(".digest-content")).not.toBeNull());
  return view;
}

/** A batch built from the pieces a test cares about. */
function batchOf(overrides: Partial<IngestionBatch> = {}): IngestionBatch {
  return { ...fixtures.ingestionBatch, jobs: [fixtures.scoredJob], count: 1, ...overrides };
}

function pageOf(batches: IngestionBatch[], page: Partial<IngestionBatchPage["page"]> = {}) {
  return {
    batches,
    page: { number: 1, size: 30, total: batches.length, has_next: false, ...page },
  };
}

/* -------------------------------------------------------------------------- */
/* Batches                                                                     */
/* -------------------------------------------------------------------------- */

describe("batches", () => {
  it("renders each batch newest-first with its source, count, and time", async () => {
    batchAnswer = pageOf([
      batchOf({
        id: "glassdoor-1",
        source: "glassdoor",
        date: "2026-06-23",
        ingested_at: "2026-06-23T08:04:00Z",
        count: 2,
        jobs: [fixtures.scoredJob, fixtures.unscoredJob],
      }),
      batchOf({
        id: "linkedin-1",
        source: "linkedin",
        date: "2026-06-22",
        ingested_at: "2026-06-22T07:31:00Z",
        count: 1,
      }),
    ]);
    const { container } = await renderedLanding();

    expect(screen.getByRole("heading", { name: "Recent ingestions" })).toBeTruthy();
    const summaries = [...container.querySelectorAll(".digest-batch-summary")].map(
      (el) => el.textContent ?? "",
    );
    // Order is the server's, and is never re-sorted here.
    expect(summaries[0]).toContain("Glassdoor");
    expect(summaries[0]).toContain("2 jobs");
    expect(summaries[0]).toContain("8:04 AM");
    expect(summaries[1]).toContain("LinkedIn");
    expect(summaries[1]).toContain("1 job");

    // A date header per day, in the server's order.
    expect([...container.querySelectorAll(".digest-date")].map((el) => el.textContent)).toEqual([
      "Tue, Jun 23",
      "Mon, Jun 22",
    ]);
  });

  it("emits one date header for several batches that share a day", async () => {
    batchAnswer = pageOf([
      batchOf({ id: "glassdoor-1", source: "glassdoor", date: "2026-06-23" }),
      batchOf({ id: "linkedin-1", source: "linkedin", date: "2026-06-23" }),
    ]);
    const { container } = await renderedLanding();

    expect(container.querySelectorAll(".digest-batch")).toHaveLength(2);
    expect(container.querySelectorAll(".digest-date")).toHaveLength(1);
  });

  it("renders every posting in the DOM while the batch is collapsed", async () => {
    batchAnswer = pageOf([batchOf({ jobs: [fixtures.scoredJob, fixtures.unscoredJob], count: 2 })]);
    const { container } = await renderedLanding();

    const details = container.querySelector<HTMLDetailsElement>(".digest-batch");
    // The point of the native disclosure: nothing was clicked, and both rows are present.
    expect(details?.open).toBe(false);
    expect(container.querySelectorAll(".digest-item")).toHaveLength(2);
    expect(screen.getByText(fixtures.scoredJob.title)).toBeTruthy();
    expect(screen.getByText(fixtures.unscoredJob.title)).toBeTruthy();
  });

  it("gives each posting a score pill and a lifecycle pill", async () => {
    batchAnswer = pageOf([
      batchOf({
        jobs: [
          { ...fixtures.scoredJob, match_score: 82, scoring_status: "scored" },
          {
            ...fixtures.unscoredJob,
            lifecycle_state: "backlog",
            match_score: null,
            scoring_status: "deferred",
          },
        ],
        count: 2,
      }),
    ]);
    const { container } = await renderedLanding();

    const [first, second] = [...container.querySelectorAll(".digest-item")];
    expect(first?.querySelector(".job-score--high")?.textContent).toBe("82%");
    expect(first?.querySelector(".job-status--active")?.textContent).toBe("Active");
    expect(second?.querySelector(".job-score--pending")).not.toBeNull();
    expect(second?.querySelector(".job-status--backlog")?.textContent).toBe("Backlog");
  });

  it("links each posting to its detail, carrying the batch it came from", async () => {
    batchAnswer = pageOf([
      batchOf({ id: "glassdoor-1", jobs: [{ ...fixtures.scoredJob, id: 3 }] }),
    ]);
    await renderedLanding();

    const link = screen.getByRole("link", { name: new RegExp(fixtures.scoredJob.title) });
    // The job detail reads `from` to decide where Back returns to, and `batch` to say which
    // block to re-expand — dropping either strands the owner at the top of the landing.
    expect(link.getAttribute("href")).toBe("/jobs/3?from=digest&batch=glassdoor-1");
  });

  it("expands only the batch named by ?batch= and leaves the rest closed", async () => {
    batchAnswer = pageOf([
      batchOf({ id: "glassdoor-1", source: "glassdoor", date: "2026-06-23" }),
      batchOf({ id: "linkedin-1", source: "linkedin", date: "2026-06-22" }),
    ]);
    const { container } = await renderedLanding("/?from=digest&batch=linkedin-1");

    const blocks = [...container.querySelectorAll<HTMLDetailsElement>(".digest-batch")];
    expect(blocks.map((el) => el.open)).toEqual([false, true]);
  });

  it("renders the empty state when nothing has been ingested", async () => {
    batchAnswer = pageOf([]);
    const { container } = await renderedLanding();

    expect(screen.getByText("No ingestions yet.")).toBeTruthy();
    expect(container.querySelector(".digest-empty")).not.toBeNull();
    // The intake panel stays: it is what explains an empty landing.
    expect(container.querySelector(".intake-control")).not.toBeNull();
  });

  it("shows the load error when either read fails", async () => {
    // A 4xx, not a 5xx: reads retry a Rails 5xx twice with backoff (`query-client.ts`), which
    // outlasts `waitFor`'s default timeout (AGENTS.md 2026-09-11).
    failBatchesWith = 404;
    const { container } = await renderedLoadError();

    expect(container.querySelector(".digest-content")).toBeNull();
  });
});

/** Renders and waits for the failure panel. */
async function renderedLoadError() {
  const view = renderLanding();
  await waitFor(() => expect(view.container.querySelector(".load-error")).not.toBeNull());
  return view;
}

/* -------------------------------------------------------------------------- */
/* Pagination                                                                  */
/* -------------------------------------------------------------------------- */

describe("pagination", () => {
  it("reads Prev/Next and the indicator from the response envelope", async () => {
    batchAnswer = pageOf([batchOf()], { number: 1, size: 30, total: 45, has_next: true });
    await renderedLanding();

    expect(screen.getByText("Page 1 of 2")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Previous" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Next" }).hasAttribute("disabled")).toBe(false);
  });

  it("asks the server for the next page and steps back again", async () => {
    batchAnswer = pageOf([batchOf()], { number: 1, size: 30, total: 60, has_next: true });
    await renderedLanding();
    expect(requestedPages).toEqual([""]);

    batchAnswer = pageOf([batchOf({ id: "linkedin-2" })], {
      number: 2,
      size: 30,
      total: 60,
      has_next: false,
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("Page 2 of 2")).toBeTruthy());
    // Page 1 sends no `page` param at all, so it shares a cache entry with an
    // unparameterized read — page 2 is explicit.
    expect(requestedPages).toEqual(["", "2"]);

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await waitFor(() => expect(screen.getByText("Page 1 of 2")).toBeTruthy());
  });

  it("disables Next when the envelope reports no further page", async () => {
    batchAnswer = pageOf([batchOf()], { number: 1, size: 30, total: 1, has_next: false });
    await renderedLanding();

    expect(screen.getByRole("button", { name: "Next" }).hasAttribute("disabled")).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Intake                                                                      */
/* -------------------------------------------------------------------------- */

describe("intake control", () => {
  it("renders a paused pipeline and its held count without changing it", async () => {
    intakeAnswer = { ...fixtures.intake, enabled: false, held_count: 4 };
    const { container } = await renderedLanding();

    expect(screen.getByRole("heading", { name: "Job alert intake" })).toBeTruthy();
    expect(container.querySelector(".intake-status--paused")?.textContent).toBe("Paused");
    expect(screen.getByText("4 alerts held for later.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Resume intake" })).toBeTruthy();
    // The safety assertion Go pinned too: rendering the landing must never resume a pipeline
    // the owner deliberately paused, which would spend LLM budget on the held backlog.
    expect(intakeWrites).toBe(0);
  });

  it("renders a running pipeline with no held count", async () => {
    intakeAnswer = { ...fixtures.intake, enabled: true, held_count: 0 };
    const { container } = await renderedLanding();

    expect(container.querySelector(".intake-status--on")?.textContent).toBe("Running");
    expect(container.querySelector(".intake-held-count")).toBeNull();
    expect(screen.getByRole("button", { name: "Pause intake" })).toBeTruthy();
  });

  it("resumes intake and reports how many held alerts were queued", async () => {
    intakeAnswer = { ...fixtures.intake, enabled: false, held_count: 2 };
    const { container } = await renderedLanding();

    fireEvent.click(screen.getByRole("button", { name: "Resume intake" }));

    await waitFor(() =>
      expect(container.querySelector(".intake-message")?.textContent).toBe(
        "Intake resumed. Processing 2 held alerts.",
      ),
    );
    expect(intakeWrites).toBe(1);
    expect(lastIntakeEnabled).toBe(true);
    // The answered status is written straight into the cache, so the panel flips without a
    // second read.
    expect(container.querySelector(".intake-status--on")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Pause intake" })).toBeTruthy();
  });

  it("pauses intake and promises the alerts are held", async () => {
    intakeAnswer = { ...fixtures.intake, enabled: true, held_count: 0 };
    const { container } = await renderedLanding();

    fireEvent.click(screen.getByRole("button", { name: "Pause intake" }));

    await waitFor(() =>
      expect(container.querySelector(".intake-message")?.textContent).toBe(
        "Intake paused. New alerts will be held for later.",
      ),
    );
    expect(lastIntakeEnabled).toBe(false);
    expect(container.querySelector(".intake-status--paused")).not.toBeNull();
  });

  it("reports a failed toggle and leaves the pipeline where it was", async () => {
    intakeAnswer = { ...fixtures.intake, enabled: false, held_count: 1 };
    failIntakeWriteWith = 500;
    const { container } = await renderedLanding();

    fireEvent.click(screen.getByRole("button", { name: "Resume intake" }));

    await waitFor(() =>
      expect(container.querySelector(".intake-error")?.textContent).toBe(
        "Could not update intake. Please try again.",
      ),
    );
    // A mutation never retries (`query-client.ts`), so one click is one request.
    expect(intakeWrites).toBe(1);
    expect(container.querySelector(".intake-status--paused")).not.toBeNull();
    expect(container.querySelector(".intake-message")).toBeNull();
  });

  it("disables the toggle while it is in flight and keeps the batches on screen", async () => {
    intakeAnswer = { ...fixtures.intake, enabled: true };
    const { container } = await renderedLanding();

    intakeGate = new Promise<void>((resolve) => {
      releaseIntake = resolve;
    });
    fireEvent.click(screen.getByRole("button", { name: "Pause intake" }));

    // The disabled state is proven by the real button, which Go could never press.
    const toggle = await screen.findByRole("button", { name: "Updating…" });
    expect(toggle.hasAttribute("disabled")).toBe(true);
    // The batches stay put: a toggle is not a reload, and blanking the list under it would
    // make a pause look like it had dropped everything already ingested.
    expect(within(container).getByText(fixtures.scoredJob.title)).toBeTruthy();

    releaseIntake?.();
    await waitFor(() => expect(container.querySelector(".intake-message")).not.toBeNull());
  });
});

/* -------------------------------------------------------------------------- */
/* Pure helpers                                                                */
/* -------------------------------------------------------------------------- */

describe("formatters", () => {
  // The expectations below were produced by running the Go originals (`time.Parse` +
  // `Format`) rather than restating the TypeScript, so they are evidence rather than a
  // mirror. See AGENTS.md for the full table.
  it("formats a batch date from the literal day, never the local clock", () => {
    expect(formatBatchDate("2026-09-08")).toBe("Tue, Sep 8");
    expect(formatBatchDate("2026-01-02")).toBe("Fri, Jan 2");
  });

  it("returns an unparseable date unchanged, as Go did", () => {
    for (const bad of ["2026-13-01", "2026-02-30", "2026-9-8", "", "yesterday"]) {
      expect(formatBatchDate(bad)).toBe(bad);
    }
  });

  it("formats a batch time in the offset the timestamp was written in", () => {
    expect(formatBatchTime("2026-09-08T15:04:05Z")).toBe("3:04 PM");
    expect(formatBatchTime("2026-09-08T00:04:05Z")).toBe("12:04 AM");
    expect(formatBatchTime("2026-09-08T12:00:00Z")).toBe("12:00 PM");
    expect(formatBatchTime("2026-09-08T09:05:00.123Z")).toBe("9:05 AM");
    // Go's `time.Parse` keeps the written offset rather than converting to the local zone,
    // so this reads the same 3:04 as the `Z` case above.
    expect(formatBatchTime("2026-09-08T15:04:05-07:00")).toBe("3:04 PM");
  });

  it("omits the time chip for an empty or unparseable timestamp", () => {
    for (const bad of ["", "nope", "2026-09-08", "2026-09-08T15:04:05"]) {
      expect(formatBatchTime(bad)).toBe("");
    }
  });

  it("labels counts and sources", () => {
    expect(batchCountLabel(1)).toBe("1 job");
    expect(batchCountLabel(0)).toBe("0 jobs");
    expect(batchCountLabel(6)).toBe("6 jobs");
    expect(batchSourceLabel("linkedin")).toBe("LinkedIn");
    expect(batchSourceLabel("")).toBe("Other");
  });

  it("says what the intake toggle just did", () => {
    const base = fixtures.intake;
    expect(intakeResultMessage({ ...base, enabled: true, queued_count: 2 })).toBe(
      "Intake resumed. Processing 2 held alerts.",
    );
    expect(intakeResultMessage({ ...base, enabled: true, queued_count: 0 })).toBe(
      "Intake resumed.",
    );
    expect(intakeResultMessage({ ...base, enabled: false, queued_count: 0 })).toBe(
      "Intake paused. New alerts will be held for later.",
    );
  });
});
