/**
 * Job detail parity (`FE-19`).
 *
 * Transcribed from `TestJobDetailRendersScoredFields`, `TestJobDetailFetchesByID`,
 * `TestManualApplicationLinkFallbackAndSafety`, `TestJobDetailRendersApplyButton`,
 * `TestJobDetailNeverAppliesOnRender`, `TestJobDetailApplyHappyPath`,
 * `TestJobDetailApplyError`, `TestJobDetailRendersLifecycleControls`,
 * `TestJobDetailNeverMutatesLifecycleOnRender`, `TestJobDetailDoSetLifecycle`,
 * `TestJobDetailDoSetLifecycleError`, and `TestJobDetailBackTarget` in
 * `web/components/jobs_test.go`, with the differences the port makes possible:
 *
 * - Go could not invoke an `OnClick` from a test, so Apply, Backlog, Remove, and Restore were
 *   exercised through `doApply` / `doSetLifecycle` and the buttons themselves were never
 *   pressed. Here they are pressed, through a real router, so the navigation the Apply button
 *   performs is asserted rather than inferred from a return value.
 * - Rails is MSW, so the assertions land on the **requests actually sent** — which is the only
 *   way "this screen never applies on mount" can be proven rather than described.
 *
 * The class names below are a contract with `public/app.css` and the `FE-28` parity gate:
 * `.job-relevant` / `.job-missing` / `.job-red-flags` colour their bullets, `.job-score--high`
 * colours the score pill, and the `.job-workspace` children are ordered by CSS, so a renamed
 * or unwrapped one is a silently broken layout rather than a failing render.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";

import { createQueryClient } from "../../api/query-client";
import type { JobDetail } from "../../api/schemas";
import {
  applyButtonLabel,
  backLink,
  externalApplicationURL,
  parseJobId,
  routeLabel,
} from "../../lib/job-detail";
import { fixtures } from "../../test/handlers";
import { HttpResponse, errorResponse, http, installMockApi } from "../../test/msw";
import { JobDetailScreen } from "./job-detail";

/** Every `GET /api/job_posts/:id` the screen asked for, by id. */
let requestedIds: string[] = [];
/** Every `POST /api/applications` body. Length 0 after a render is a safety assertion. */
let createdApplications: unknown[] = [];
/** Every single-row lifecycle `PATCH`, as `[id, state]`. */
let lifecycleWrites: [string, string][] = [];

/** The posting the fake Rails answers with; overridden per test. */
let answer: JobDetail = fixtures.jobDetail;
/** Set to a status to fail the detail read instead. */
let failReadWith: number | null = null;
/** Set to a status to fail `POST /api/applications`. */
let failCreateWith: number | null = null;
/** Set to a status to fail the lifecycle `PATCH`. */
let failLifecycleWith: number | null = null;

const server = installMockApi(
  http.get("/api/job_posts/:id", ({ params }) => {
    requestedIds.push(String(params.id));
    if (failReadWith !== null) {
      return HttpResponse.json(
        { error: { code: "not_found", message: "no such job" } },
        { status: failReadWith },
      );
    }
    return HttpResponse.json({ job_post: answer });
  }),
  http.post("/api/applications", async ({ request }) => {
    createdApplications.push(await request.json());
    if (failCreateWith !== null) {
      return HttpResponse.json(
        { error: { code: "server_error", message: "boom" } },
        { status: failCreateWith },
      );
    }
    return HttpResponse.json(
      { application: { application_id: 31, status: "draft" } },
      { status: 201 },
    );
  }),
  http.patch("/api/job_posts/:id/lifecycle", async ({ params, request }) => {
    const body = (await request.json()) as { lifecycle_state?: string };
    const state = body.lifecycle_state ?? "";
    lifecycleWrites.push([String(params.id), state]);
    if (failLifecycleWith !== null) {
      return HttpResponse.json(
        { error: { code: "server_error", message: "boom" } },
        { status: failLifecycleWith },
      );
    }
    // The screen re-reads the job after a transition, so move the answer too.
    answer = { ...answer, lifecycle_state: state };
    return HttpResponse.json({ job_post: { ...fixtures.scoredJob, lifecycle_state: state } });
  }),
);

beforeEach(() => {
  requestedIds = [];
  createdApplications = [];
  lifecycleWrites = [];
  answer = fixtures.jobDetail;
  failReadWith = null;
  failCreateWith = null;
  failLifecycleWith = null;
});

/** A detail payload built on the fixture, so only the fields under test are restated. */
function jobWith(overrides: Partial<JobDetail>): JobDetail {
  return { ...fixtures.jobDetail, ...overrides };
}

/**
 * Renders the screen at `path` inside a real router, with a catch-all that records where an
 * in-app navigation landed — that is how the Apply button's destination is asserted.
 */
function renderDetail(path = "/jobs/101") {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/jobs/:id" element={<JobDetailScreen />} />
          <Route path="*" element={<LandingProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Stands in for every other screen, rendering the path a navigation reached. */
function LandingProbe() {
  return <p data-testid="landed">{useLocation().pathname}</p>;
}

/** Renders and waits for the loaded body. */
async function loadedDetail(path = "/jobs/101") {
  const view = renderDetail(path);
  await waitFor(() => {
    expect(view.container.querySelector(".job-detail-body")).not.toBeNull();
  });
  return view;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

describe("job detail helpers", () => {
  it("resolves the back target from the query string", () => {
    // The exact case table from TestJobDetailBackTarget.
    expect(backLink("")).toEqual({ href: "/jobs", label: "← Jobs" });
    expect(backLink("?from=digest&batch=glassdoor-1")).toEqual({
      href: "/?batch=glassdoor-1",
      label: "← Ingestions",
    });
    expect(backLink("?from=digest")).toEqual({ href: "/", label: "← Ingestions" });
    expect(backLink("?foo=bar")).toEqual({ href: "/jobs", label: "← Jobs" });
  });

  it("accepts only external http(s) application links", () => {
    // TestManualApplicationLinkFallbackAndSafety's table, unchanged.
    expect(
      externalApplicationURL("https://employer.example/apply", "https://board.example/job"),
    ).toBe("https://employer.example/apply");
    expect(externalApplicationURL("", "https://board.example/job")).toBe(
      "https://board.example/job",
    );
    expect(externalApplicationURL("javascript:alert(1)", "https://board.example/job")).toBe(
      "https://board.example/job",
    );
    expect(externalApplicationURL("/relative", "")).toBe("");
    expect(externalApplicationURL("http://board.example/job")).toBe("http://board.example/job");
  });

  it("labels the route by recommendation, then type, then unknown", () => {
    expect(
      routeLabel({
        route_type: "greenhouse",
        recommended_route: "direct_ats",
        application_url: "",
      }),
    ).toBe("direct_ats");
    expect(
      routeLabel({ route_type: "greenhouse", recommended_route: "", application_url: "" }),
    ).toBe("greenhouse");
    expect(routeLabel({ route_type: "", recommended_route: "", application_url: "" })).toBe(
      "unknown",
    );
  });

  it("reads the job id from the route param and falls back to 0", () => {
    expect(parseJobId("101")).toBe(101);
    // go-app's `^/jobs/\d+$` never matched these; React Router does, so they must resolve to
    // the id Rails answers 404 for rather than being fabricated into a path segment.
    expect(parseJobId("abc")).toBe(0);
    expect(parseJobId("")).toBe(0);
    expect(parseJobId(undefined)).toBe(0);
    expect(parseJobId("-3")).toBe(0);
    expect(parseJobId("1.5")).toBe(0);
  });

  it("labels the apply button as a draft action in both states", () => {
    expect(applyButtonLabel(false)).toBe("Prepare application draft");
    expect(applyButtonLabel(true)).toBe("Preparing…");
  });
});

/* -------------------------------------------------------------------------- */
/* Rendering                                                                   */
/* -------------------------------------------------------------------------- */

describe("job detail rendering", () => {
  it("renders every scored field", async () => {
    answer = jobWith({
      title: "Staff Engineer",
      company: "Acme",
      source: "linkedin",
      compensation: "$180k – $210k",
      match_score: 88,
      scoring_status: "scored",
      summary: "Great role for a platform generalist.",
      relevant_requirements: ["Go", "Distributed systems"],
      missing_requirements: ["Kubernetes"],
      red_flags: ["On-call rotation heavy"],
      resume_alignment_notes: "Strong alignment on backend depth.",
      application_strategy: "Lead with the payments platform project.",
      route: {
        route_type: "greenhouse",
        recommended_route: "direct_ats",
        application_url: "https://boards.greenhouse.io/acme/jobs/7",
      },
    });
    const { container } = await loadedDetail();

    for (const text of [
      "Staff Engineer",
      "Acme",
      "$180k – $210k",
      "Great role for a platform generalist.",
      "Go",
      "Distributed systems",
      "Kubernetes",
      "On-call rotation heavy",
      "Strong alignment on backend depth.",
      "Lead with the payments platform project.",
      "direct_ats",
    ]) {
      expect(screen.getByText(text, { exact: false })).toBeTruthy();
    }
    expect(screen.getByText("Match: 88%")).toBeTruthy();
    expect(container.querySelector(".job-score--high")).not.toBeNull();
    expect(screen.getByText("Source: LinkedIn", { exact: false })).toBeTruthy();
    expect(container.querySelector(".job-source-logo")?.getAttribute("src")).toBe(
      "/icons/linkedin.svg",
    );
    expect(container.querySelector<HTMLAnchorElement>(".job-route-link")?.href).toBe(
      "https://boards.greenhouse.io/acme/jobs/7",
    );
  });

  it("bands an unscored posting as pending rather than low", async () => {
    answer = jobWith({ match_score: null, scoring_status: "deferred" });
    const { container } = await loadedDetail();

    expect(screen.getByText("Match: Queued later")).toBeTruthy();
    expect(container.querySelector(".job-score--pending")).not.toBeNull();
    expect(container.querySelector(".job-score--low")).toBeNull();
  });

  it("omits every optional block Rails sent empty", async () => {
    answer = jobWith({
      source: "",
      compensation: "",
      summary: "",
      relevant_requirements: [],
      missing_requirements: [],
      red_flags: [],
      resume_alignment_notes: "",
      application_strategy: "",
    });
    const { container } = await loadedDetail();

    for (const selector of [
      ".job-source",
      ".job-compensation",
      ".job-relevant",
      ".job-missing",
      ".job-red-flags",
      ".job-alignment",
      ".job-strategy",
    ]) {
      expect(container.querySelector(selector)).toBeNull();
    }
    // The summary is the one block that falls back rather than disappearing: triage leaves
    // most inbound postings unscored, so an empty detail screen would be the common case.
    expect(
      screen.getByText(
        "No assessment yet. You can still review the original posting and apply manually.",
      ),
    ).toBeTruthy();
  });

  it("renders only the lists Rails filled", async () => {
    answer = jobWith({
      relevant_requirements: ["Rails"],
      missing_requirements: [],
      red_flags: ["Equity unclear"],
    });
    const { container } = await loadedDetail();

    expect(
      within(container.querySelector<HTMLElement>(".job-relevant")!).getByText("Rails"),
    ).toBeTruthy();
    expect(container.querySelector(".job-missing")).toBeNull();
    expect(
      within(container.querySelector<HTMLElement>(".job-red-flags")!).getByText("Equity unclear"),
    ).toBeTruthy();
  });

  it("keeps the workspace children in the order app.css positions them", async () => {
    const { container } = await loadedDetail();
    const workspace = container.querySelector<HTMLElement>(".job-workspace");
    const aside = workspace?.querySelector<HTMLElement>(".job-workspace-actions");

    // `.job-workspace-actions` is `display: contents` at phone width, so these become direct
    // flex children of `.job-workspace` and are positioned by the `order` rules in app.css.
    expect(aside?.getAttribute("aria-label")).toBe("Application workspace");
    expect(Array.from(aside?.children ?? []).map((child) => child.className)).toEqual([
      "manual-application",
      "job-optional-actions",
      "job-lifecycle",
    ]);
    expect(workspace?.querySelector(".job-assessment")).not.toBeNull();
  });

  it("puts every LLM-generated block in a tag the app.css wrap reset covers", async () => {
    // jsdom has no layout, so overflow cannot be measured. What *can* be pinned is the
    // structural precondition: `p, li, h1, h2, span { overflow-wrap: break-word; }` is the only
    // protection an unbroken token (a bare URL from the scorer) has, and a block rendered in a
    // <div> would sit outside it and overflow the card at phone width (AGENTS.md 2026-06-18).
    const css = readFileSync(
      join(import.meta.dirname, "..", "..", "..", "public", "app.css"),
      "utf8",
    );
    const reset = /\n([a-z0-9, ]+)\s*\{\s*overflow-wrap:\s*break-word;\s*\}/.exec(css);
    const wrapSafe = new Set((reset?.[1] ?? "").split(",").map((tag) => tag.trim().toLowerCase()));
    expect(wrapSafe).toContain("p");
    expect(wrapSafe).toContain("li");

    const token = `https://jobs.example.com/${"x".repeat(120)}`;
    answer = jobWith({
      summary: token,
      relevant_requirements: [token],
      missing_requirements: [token],
      red_flags: [token],
      resume_alignment_notes: token,
      application_strategy: token,
    });
    const { container } = await loadedDetail();

    const holders = Array.from(container.querySelectorAll("*")).filter(
      (node) => node.textContent === token && node.children.length === 0,
    );
    expect(holders.length).toBe(6);
    for (const node of holders) {
      expect(wrapSafe).toContain(node.tagName.toLowerCase());
    }
  });

  it("asks Rails for the id in the path, and for 0 when the path is not an id", async () => {
    await loadedDetail("/jobs/42");
    expect(requestedIds).toEqual(["42"]);

    failReadWith = 404;
    const { container } = renderDetail("/jobs/abc");
    await waitFor(() => {
      expect(container.querySelector(".load-error")).not.toBeNull();
    });
    // Rails stays the authority on whether an id exists: the screen asks and renders the 404,
    // exactly as the Go build did when `jobIDFromPath` failed and `JobID` stayed 0.
    expect(requestedIds).toEqual(["42", "0"]);
  });

  it("shows the loading state, then the load error, with a sign-in link on a 401", async () => {
    const pending = renderDetail();
    expect(pending.container.querySelector(".loading")).not.toBeNull();
    pending.unmount();

    failReadWith = 401;
    const { container } = renderDetail();
    await waitFor(() => {
      expect(container.querySelector(".load-error")).not.toBeNull();
    });
    expect(screen.getByText("Your session expired. Please sign in again.")).toBeTruthy();
    expect(container.querySelector<HTMLAnchorElement>(".sign-in-link")?.getAttribute("href")).toBe(
      "/login",
    );
    expect(container.querySelector(".job-detail-body")).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* The route out, and contacts                                                 */
/* -------------------------------------------------------------------------- */

describe("job detail application route", () => {
  it("falls back to the posting URL and refuses a non-external link", async () => {
    answer = jobWith({
      posting_url: "https://board.example/job",
      route: {
        route_type: "unknown",
        recommended_route: "",
        application_url: "javascript:alert(1)",
      },
    });
    const { container } = await loadedDetail();

    const link = container.querySelector<HTMLAnchorElement>(".job-route-link");
    expect(link?.getAttribute("href")).toBe("https://board.example/job");
    expect(link?.getAttribute("target")).toBe("_blank");
    // Without noopener the opened page gets a handle on this one through window.opener.
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("drops the link and says so when no external URL survives", async () => {
    answer = jobWith({
      posting_url: "",
      route: { route_type: "unknown", recommended_route: "manual", application_url: "/relative" },
    });
    const { container } = await loadedDetail();

    expect(container.querySelector(".job-route-link")).toBeNull();
    expect(container.querySelector(".job-route-type")?.textContent).toBe("manual");
    expect(
      screen.getByText(
        "No application link is available. Use the original alert to find the posting.",
      ),
    ).toBeTruthy();
  });

  it("omits the route block entirely when Rails resolved nothing", async () => {
    answer = jobWith({
      posting_url: "",
      route: { route_type: "", recommended_route: "", application_url: "" },
    });
    const { container } = await loadedDetail();

    expect(container.querySelector(".job-route")).toBeNull();
    expect(container.querySelector(".manual-application")).not.toBeNull();
  });

  it("links to this job's contacts screen", async () => {
    answer = jobWith({ id: 101 });
    const { container } = await loadedDetail();

    expect(container.querySelector(".job-contacts-link")?.getAttribute("href")).toBe(
      "/jobs/101/contacts",
    );
  });

  it("points the back link at the batch the owner came from", async () => {
    const { container } = await loadedDetail("/jobs/101?from=digest&batch=glassdoor-1");
    const back = container.querySelector(".job-detail-back");

    expect(back?.getAttribute("href")).toBe("/?batch=glassdoor-1");
    expect(back?.textContent).toBe("← Ingestions");
  });
});

/* -------------------------------------------------------------------------- */
/* Apply                                                                       */
/* -------------------------------------------------------------------------- */

describe("job detail apply action", () => {
  it("never creates an application on render", async () => {
    await loadedDetail();
    // The safety assertion, and the reason this screen can be opened freely: reading a posting
    // must never start an application, generate materials, or reach the submit path.
    expect(createdApplications).toEqual([]);
    expect(screen.getByRole("button", { name: "Prepare application draft" })).toBeTruthy();
  });

  it("posts the job id and navigates to the draft review screen", async () => {
    answer = jobWith({ id: 7 });
    await loadedDetail("/jobs/7");

    fireEvent.click(screen.getByRole("button", { name: "Prepare application draft" }));

    await waitFor(() => {
      expect(screen.queryByTestId("landed")).not.toBeNull();
    });
    expect(createdApplications).toEqual([{ application: { job_post_id: 7 } }]);
    expect(screen.getByTestId("landed").textContent).toBe("/applications/31");
  });

  it("reports a failure once, without retrying and without navigating", async () => {
    failCreateWith = 500;
    await loadedDetail();

    fireEvent.click(screen.getByRole("button", { name: "Prepare application draft" }));

    await waitFor(() => {
      expect(screen.getByText("Could not start the application. Please try again.")).toBeTruthy();
    });
    // Mutations never retry: a replayed write could create a second draft Application.
    expect(createdApplications).toHaveLength(1);
    expect(screen.queryByTestId("landed")).toBeNull();
  });

  it("uses the expired-session copy on a 401", async () => {
    failCreateWith = 401;
    await loadedDetail();

    fireEvent.click(screen.getByRole("button", { name: "Prepare application draft" }));

    await waitFor(() => {
      expect(screen.getByText("Your session expired. Please sign in again.")).toBeTruthy();
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Intake                                                                      */
/* -------------------------------------------------------------------------- */

describe("job detail intake controls", () => {
  it("offers Backlog and Remove for an active posting", async () => {
    answer = jobWith({ lifecycle_state: "active" });
    const { container } = await loadedDetail();

    expect(container.querySelector(".job-lifecycle-backlog")).not.toBeNull();
    expect(container.querySelector(".job-lifecycle-remove")).not.toBeNull();
    expect(container.querySelector(".job-lifecycle-restore")).toBeNull();
    // Scoped: "Intake" is also the label of the chrome's landing tab.
    expect(
      within(container.querySelector<HTMLElement>(".job-lifecycle")!).getByText("Intake"),
    ).toBeTruthy();
  });

  it("offers Restore for a posting already out of the active bin", async () => {
    for (const state of ["backlog", "removed"]) {
      answer = jobWith({ lifecycle_state: state });
      const { container, unmount } = await loadedDetail();
      expect(container.querySelector(".job-lifecycle-restore")).not.toBeNull();
      expect(container.querySelector(".job-lifecycle-backlog")).toBeNull();
      unmount();
    }
  });

  it("treats an empty lifecycle state as active, matching the column default", async () => {
    answer = jobWith({ lifecycle_state: "" });
    const { container } = await loadedDetail();

    expect(container.querySelector(".job-lifecycle-backlog")).not.toBeNull();
  });

  it("never moves a posting between bins on render", async () => {
    await loadedDetail();
    expect(lifecycleWrites).toEqual([]);
  });

  it("patches the single posting and re-reads it", async () => {
    answer = jobWith({ id: 101, lifecycle_state: "active" });
    const { container } = await loadedDetail("/jobs/101");

    fireEvent.click(screen.getByRole("button", { name: "Move to backlog" }));

    await waitFor(() => {
      expect(container.querySelector(".job-lifecycle-restore")).not.toBeNull();
    });
    // The member endpoint for one id, and the refetch — not a local patch of the cached job,
    // which would leave the feed and the ingestion landing showing the old bin.
    expect(lifecycleWrites).toEqual([["101", "backlog"]]);
    expect(requestedIds).toEqual(["101", "101"]);
  });

  it("sends removed for Remove, which is a soft delete Rails owns", async () => {
    await loadedDetail("/jobs/101");

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(lifecycleWrites).toEqual([["101", "removed"]]);
    });
  });

  it("reports a failed transition once and leaves the bin alone", async () => {
    failLifecycleWith = 500;
    answer = jobWith({ lifecycle_state: "active" });
    const { container } = await loadedDetail();

    fireEvent.click(screen.getByRole("button", { name: "Move to backlog" }));

    await waitFor(() => {
      expect(screen.getByText("Could not update the job. Please try again.")).toBeTruthy();
    });
    expect(lifecycleWrites).toHaveLength(1);
    expect(container.querySelector(".job-lifecycle-backlog")).not.toBeNull();
    expect(container.querySelector(".job-lifecycle-restore")).toBeNull();
  });

  it("uses the expired-session copy on a 401", async () => {
    server.use(errorResponse("patch", "/api/job_posts/:id/lifecycle", 401, "unauthorized", "nope"));
    await loadedDetail();

    fireEvent.click(screen.getByRole("button", { name: "Move to backlog" }));

    await waitFor(() => {
      expect(screen.getByText("Your session expired. Please sign in again.")).toBeTruthy();
    });
  });
});
