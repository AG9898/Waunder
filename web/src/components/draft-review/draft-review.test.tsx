/**
 * Draft review parity (`FE-26`).
 *
 * Transcribed from `web/components/draft_test.go` — `TestDraftReviewRendersFields`,
 * `TestDraftReviewFetchesByID`, `TestDraftReviewLoadError`, `TestDraftReviewDoesNotSubmitOnMount`,
 * `TestDraftReviewApproveAndSubmit`, `TestDraftReviewSavesAutofillPreview`,
 * `TestDraftReviewSubmitSavesDirtyPreviewFirst`, `TestDraftReviewSubmitStopsWhenSavedPreviewHasWarnings`,
 * `TestDraftReviewSubmitBlocksUntilReady`, `TestDraftReviewSubmitError`,
 * `TestDraftReviewSubmitUnauthorized`, `TestSubmitButtonLabel`,
 * `TestDraftReviewRendersWarningsAndWorkerFailure`, `TestSubmitResultLabel`, and
 * `TestDraftHeadingFallback` — with the difference the port makes possible: Go could not press a
 * button from a test and drove `doSubmit` directly, so the button's own `disabled` state was never
 * proven. Here the buttons are pressed, Rails is MSW, and every request the screen sends is recorded
 * through MSW's `request:start` event, so "submit never fires on its own" is an assertion on the
 * wire rather than on a mock's counter.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { delay } from "msw";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { APIError } from "../../api/errors";
import { createQueryClient } from "../../api/query-client";
import type { ApplicationDraft, StructuredAnswer } from "../../api/schemas";
import {
  canSubmit,
  draftHeading,
  parseApplicationId,
  previewSaveButtonLabel,
  showWorkerReport,
  submitButtonLabel,
  submitResultLabel,
  type SubmitPhase,
} from "../../lib/draft-review";
import {
  SESSION_EXPIRED,
  blockedSubmitMessage,
  draftSaveErrorMessage,
  submitErrorMessage,
} from "../../lib/messages";
import { apiHandlers, fixtures } from "../../test/handlers";
import { HttpResponse, http, installMockApi } from "../../test/msw";
import { DraftReviewScreen } from "./draft-review";

/** Go's `sampleDraft`, restated on the shared fixture so only the tested fields differ. */
const READY: ApplicationDraft = {
  ...fixtures.applicationDraft,
  application_id: 7,
  job_title: "Staff Engineer",
  company: "Acme",
  status: "draft",
  pipeline_status: "drafting",
  pipeline_stage: "",
  resume_emphasis_notes: "Lead with the payments platform work.",
  cover_letter: "Dear hiring team, I am excited to apply.",
  draft_ready: true,
  structured_answers: [{ field: "Why this role?", value: "Deep backend fit." }],
  autofill_payload: {
    ats: "greenhouse",
    apply_url: "https://boards.greenhouse.io/acme/jobs/7",
    answers: [
      { field: "first_name", value: "Ada" },
      { field: "last_name", value: "Lovelace" },
    ],
    resume_ref: "resume-primary",
  },
  autofill_warnings: [],
  failure_reason: "",
  worker_report: null,
};

function draftWith(overrides: Partial<ApplicationDraft>): ApplicationDraft {
  return { ...READY, ...overrides };
}

/** Every request the screen sent, as `METHOD /path`, in order. */
let requests: string[] = [];
/** Every `PATCH /api/applications/:id/draft` body. */
let draftWrites: unknown[] = [];
/** The draft `GET` answers with. */
let answer: ApplicationDraft = READY;
/** When set, the draft `PATCH` answers with this draft instead of echoing the answers. */
let savedAnswer: ApplicationDraft | null = null;
/** When set, the read fails with this status. */
let failReadWith: number | null = null;
/** When set, the draft `PATCH` fails with this status. */
let failSaveWith: number | null = null;
/** When set, the submit fails with this status and code. */
let failSubmitWith: { status: number; code: string } | null = null;
/** The submit's answer. */
let submitAnswer = { status: "dispatched", application_id: 7, ats: "greenhouse" };
/** Milliseconds the submit waits before answering, so the in-flight state is observable. */
let submitDelay = 0;

const server = installMockApi(
  http.get("/api/applications/:id", () => {
    if (failReadWith !== null) {
      return HttpResponse.json(
        { error: { code: "not_found", message: "no such application" } },
        { status: failReadWith },
      );
    }
    return HttpResponse.json({ application: answer });
  }),
  http.patch("/api/applications/:id/draft", async ({ request }) => {
    const body = (await request.json()) as {
      application_draft: { autofill_payload: { answers: StructuredAnswer[] } };
    };
    draftWrites.push(body);
    if (failSaveWith !== null) {
      return HttpResponse.json(
        { error: { code: "server_error", message: "boom" } },
        { status: failSaveWith },
      );
    }
    const saved =
      savedAnswer ??
      draftWith({
        autofill_payload: {
          ...answer.autofill_payload,
          answers: body.application_draft.autofill_payload.answers,
        },
      });
    answer = saved;
    return HttpResponse.json({ application: saved });
  }),
  http.post("/api/applications/:id/submit", async () => {
    if (submitDelay > 0) await delay(submitDelay);
    if (failSubmitWith !== null) {
      return HttpResponse.json(
        { error: { code: failSubmitWith.code, message: "refused" } },
        { status: failSubmitWith.status },
      );
    }
    return HttpResponse.json(submitAnswer);
  }),
  ...apiHandlers(),
);

beforeEach(() => {
  requests = [];
  draftWrites = [];
  answer = READY;
  savedAnswer = null;
  failReadWith = null;
  failSaveWith = null;
  failSubmitWith = null;
  submitAnswer = { status: "dispatched", application_id: 7, ats: "greenhouse" };
  submitDelay = 0;
  server.events.on("request:start", ({ request }) => {
    requests.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});

afterEach(() => {
  server.events.removeAllListeners();
});

function renderReview(path = "/applications/7") {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/applications/:id" element={<DraftReviewScreen />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function loadedReview(path = "/applications/7") {
  const view = renderReview(path);
  await screen.findByRole("heading", { level: 1 });
  return view;
}

function submitButton(): HTMLButtonElement {
  return screen.getByRole("button", {
    name: /submit|Submitting|Submitted|Preparing draft|Manual review required/,
  });
}

function textareas(container: HTMLElement): HTMLTextAreaElement[] {
  return Array.from(
    container.querySelectorAll<HTMLTextAreaElement>("textarea.draft-autofill-value"),
  );
}

/** Only the writes, so a refetch after a save or submit does not blur the order being asserted. */
function writes(): string[] {
  return requests.filter((line) => !line.startsWith("GET "));
}

describe("draft review helpers", () => {
  it("labels the submit button the way Go's case table did", () => {
    const pending = draftWith({ draft_ready: false });
    const warned = draftWith({
      autofill_warnings: [{ field: "salary", code: "sensitive", message: "Needs manual review" }],
    });
    const cases: [SubmitPhase, ApplicationDraft, boolean, string][] = [
      ["idle", READY, false, "Approve and submit"],
      ["idle", READY, true, "Save and submit"],
      ["idle", pending, false, "Preparing draft..."],
      ["idle", warned, false, "Manual review required"],
      ["error", READY, false, "Approve and submit"],
      ["sending", READY, false, "Submitting…"],
      ["done", READY, false, "Submitted"],
    ];
    for (const [phase, draft, dirty, want] of cases) {
      expect(submitButtonLabel(phase, draft, dirty)).toBe(want);
    }
  });

  it("labels the preview save control", () => {
    expect(previewSaveButtonLabel("idle", false)).toBe("Preview saved");
    expect(previewSaveButtonLabel("idle", true)).toBe("Save preview");
    expect(previewSaveButtonLabel("pending", true)).toBe("Saving...");
    expect(previewSaveButtonLabel("success", false)).toBe("Saved");
    expect(previewSaveButtonLabel("success", true)).toBe("Save preview");
    expect(previewSaveButtonLabel("error", false)).toBe("Preview saved");
  });

  it("falls back from title and company to the application id", () => {
    expect(draftHeading(READY)).toBe("Staff Engineer — Acme");
    expect(draftHeading(draftWith({ company: "" }))).toBe("Staff Engineer");
    expect(draftHeading(draftWith({ job_title: "", application_id: 9 }))).toBe("Application #9");
  });

  it("reports the status Rails returned, with Go's sentence for a dispatch", () => {
    expect(submitResultLabel({ status: "dispatched", application_id: 7, ats: "lever" })).toBe(
      "Submitted: dispatched to lever.",
    );
    expect(submitResultLabel({ status: "queued", application_id: 7, ats: "greenhouse" })).toBe(
      "Submitted: queued to greenhouse.",
    );
    expect(submitResultLabel({ status: "", application_id: 7, ats: "" })).toBe(
      "Submitted: application dispatched.",
    );
  });

  it("gates submit on readiness, completeness, and warnings", () => {
    const withValue = (value: string) =>
      draftWith({
        autofill_payload: { ...READY.autofill_payload, answers: [{ field: "first_name", value }] },
      });
    expect(canSubmit(READY)).toBe(true);
    expect(canSubmit(draftWith({ draft_ready: false }))).toBe(false);
    expect(
      canSubmit(draftWith({ autofill_payload: { ...READY.autofill_payload, ats: " " } })),
    ).toBe(false);
    expect(
      canSubmit(draftWith({ autofill_payload: { ...READY.autofill_payload, apply_url: "" } })),
    ).toBe(false);
    expect(
      canSubmit(draftWith({ autofill_payload: { ...READY.autofill_payload, answers: [] } })),
    ).toBe(false);
    expect(canSubmit(withValue("  \t"))).toBe(false);
    // Go's `strings.TrimSpace` strips a no-break space and NEL but keeps a byte-order mark.
    expect(canSubmit(withValue("\u00a0"))).toBe(false);
    expect(canSubmit(withValue("\u0085"))).toBe(false);
    expect(canSubmit(withValue("\uFEFF"))).toBe(true);
    expect(
      canSubmit(
        draftWith({ autofill_warnings: [{ field: "salary", code: "sensitive", message: "x" }] }),
      ),
    ).toBe(false);
  });

  it("shows the worker report only for a paused or failed application with something to say", () => {
    const report = { status: "paused", reason: "", logs: ["opened form"], screenshots: [] };
    expect(showWorkerReport(draftWith({ status: "paused", worker_report: report }))).toBe(true);
    expect(showWorkerReport(draftWith({ status: "failed", failure_reason: "timeout" }))).toBe(true);
    expect(showWorkerReport(draftWith({ status: "failed" }))).toBe(false);
    expect(showWorkerReport(draftWith({ status: "draft", worker_report: report }))).toBe(false);
  });

  it("maps submit refusals and save failures to owner copy", () => {
    const refusal = (status: number, code: string) =>
      new APIError(status, JSON.stringify({ error: { code, message: "refused" } }));
    expect(submitErrorMessage(refusal(422, "draft_required"))).toBe(
      "The draft is still being prepared. Try again in a moment.",
    );
    expect(submitErrorMessage(refusal(422, "unsafe_payload"))).toBe(
      "Manual review is required before auto-submit.",
    );
    expect(submitErrorMessage(refusal(422, "unsupported_ats"))).toBe(
      "Auto-submit is not supported for this application route.",
    );
    expect(submitErrorMessage(refusal(422, "invalid_payload"))).toBe(
      "The autofill preview needs review before submit.",
    );
    expect(submitErrorMessage(new APIError(500, ""))).toBe("Submit failed. Please try again.");
    expect(submitErrorMessage(new APIError(403, ""))).toBe("Submit failed. Please try again.");
    expect(submitErrorMessage(new APIError(401, ""))).toBe(SESSION_EXPIRED);
    expect(draftSaveErrorMessage(new APIError(500, ""))).toBe(
      "Could not save the autofill preview. Please try again.",
    );
    expect(draftSaveErrorMessage(new APIError(401, ""))).toBe(SESSION_EXPIRED);
    expect(blockedSubmitMessage(true)).toBe("Manual review is required before auto-submit.");
    expect(blockedSubmitMessage(false)).toBe(
      "The draft is still being prepared. Try again in a moment.",
    );
  });

  it("reads the application id from the route param", () => {
    expect(parseApplicationId("42")).toBe(42);
    expect(parseApplicationId("abc")).toBe(0);
    expect(parseApplicationId(undefined)).toBe(0);
  });
});

describe("DraftReviewScreen rendering", () => {
  it("renders the draft's materials, preview, and submit control in Go's markup", async () => {
    const { container } = await loadedReview();
    const root = container.querySelector(".draft-review");
    expect(root?.firstElementChild?.className).toContain("app-chrome");
    expect(root?.querySelector(".draft-back")?.getAttribute("href")).toBe("/jobs");

    const body = container.querySelector(".draft-body");
    expect(Array.from(body?.children ?? []).map((child) => child.className)).toEqual([
      "draft-title",
      "draft-status",
      "draft-pipeline-status",
      "draft-manual-intro",
      "draft-materials",
      "draft-automation",
    ]);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Staff Engineer — Acme");
    expect(container.querySelector(".draft-status")?.textContent).toBe("Status: draft");
    expect(container.querySelector(".draft-pipeline-status")?.textContent).toBe(
      "Application: Drafting",
    );
    const intro = container.querySelector(".job-route-link");
    expect(intro?.getAttribute("href")).toBe("https://boards.greenhouse.io/acme/jobs/7");
    expect(intro?.getAttribute("rel")).toBe("noopener noreferrer");

    const materials = within(container.querySelector<HTMLElement>(".draft-materials")!);
    materials.getByText("Lead with the payments platform work.");
    materials.getByText("Dear hiring team, I am excited to apply.");
    materials.getByText("Why this role?");
    materials.getByText("Deep backend fit.");
    materials.getByRole("button", { name: "Copy cover letter" });
    materials.getByRole("button", { name: "Copy answer" });

    const automation = container.querySelector(".draft-automation");
    expect(automation?.tagName).toBe("DETAILS");
    expect(automation?.hasAttribute("open")).toBe(false);
    expect(Array.from(automation?.children ?? []).map((child) => child.className)).toEqual([
      "",
      "draft-autofill",
      "draft-submit",
    ]);
    expect(container.querySelector(".draft-autofill-ats")?.textContent).toBe("ATS: greenhouse");
    expect(textareas(container).map((area) => area.value)).toEqual(["Ada", "Lovelace"]);
    expect(
      Array.from(container.querySelectorAll(".draft-autofill-answer .draft-answer-field")).map(
        (node) => node.textContent,
      ),
    ).toEqual(["first_name", "last_name"]);
    expect(screen.getByRole("button", { name: "Preview saved" })).toHaveProperty("disabled", true);
    expect(container.querySelector(".draft-submit-note")?.textContent).toBe(
      "Submitting dispatches a trusted automated submission. This is your explicit approval.",
    );
    expect(submitButton().textContent).toBe("Approve and submit");
    expect(submitButton().disabled).toBe(false);
    expect(container.querySelector(".draft-worker-report")).toBeNull();
  });

  it("asks Rails for the application in the path", async () => {
    await loadedReview("/applications/42");
    expect(requests).toContain("GET /api/applications/42");
  });

  it("renders the load error for a missing application and an expired session", async () => {
    failReadWith = 404;
    const missing = renderReview();
    await screen.findByText("Could not load data. Please try again.");
    expect(missing.container.querySelector(".draft-body")).toBeNull();
    missing.unmount();

    failReadWith = 401;
    renderReview();
    await screen.findByText(SESSION_EXPIRED);
  });

  it("renders a draft that is still being prepared with submit disabled", async () => {
    answer = draftWith({
      draft_ready: false,
      structured_answers: [],
      cover_letter: "",
      resume_emphasis_notes: "",
      autofill_payload: { ats: "", apply_url: "", answers: [], resume_ref: "" },
    });
    const { container } = await loadedReview();
    expect(container.querySelector(".draft-autofill-pending")?.textContent).toBe(
      "Preparing draft...",
    );
    expect(container.querySelector(".draft-autofill-form")).toBeNull();
    expect(container.querySelector(".job-route-link")).toBeNull();
    expect(container.querySelector(".draft-submit-note")?.textContent).toBe(
      "The draft is still being prepared.",
    );
    expect(submitButton().textContent).toBe("Preparing draft...");
    expect(submitButton().disabled).toBe(true);
  });

  it("keeps submit disabled when Rails marks the draft not ready even with a full preview", async () => {
    answer = draftWith({ draft_ready: false });
    await loadedReview();
    expect(submitButton().disabled).toBe(true);
  });

  it("renders manual-review warnings in the list and under their field, with submit disabled", async () => {
    answer = draftWith({
      autofill_warnings: [
        { field: "last_name", code: "sensitive", message: "Needs manual review" },
      ],
    });
    const { container } = await loadedReview();
    expect(container.querySelector(".draft-autofill-warnings")?.textContent).toBe(
      "last_name: Needs manual review",
    );
    const items = container.querySelectorAll(".draft-autofill-answer");
    expect(items[0]?.querySelector(".draft-autofill-warning")).toBeNull();
    expect(items[1]?.querySelector(".draft-autofill-warning")?.textContent).toBe(
      "Needs manual review",
    );
    expect(container.querySelector(".draft-submit-note")?.textContent).toBe(
      "This application has fields that need manual review before trusted auto-submit.",
    );
    expect(submitButton().textContent).toBe("Manual review required");
    expect(submitButton().disabled).toBe(true);
    fireEvent.click(submitButton());
    await act(() => delay(20));
    expect(writes()).toEqual([]);
  });

  it("renders the worker's failure reason, distinct report reason, logs, and screenshots", async () => {
    answer = draftWith({
      status: "paused",
      failure_reason: "required field was not in the approved payload",
      worker_report: {
        status: "paused",
        reason: "unknown field: visa status",
        logs: ["opened form", "paused on required field"],
        screenshots: ["screenshots/7-1.png"],
      },
    });
    const { container } = await loadedReview();
    const report = container.querySelector<HTMLElement>(".draft-worker-report");
    expect(report?.previousElementSibling?.className).toBe("draft-autofill");
    expect(
      Array.from(report?.querySelectorAll(".draft-worker-reason") ?? []).map(
        (node) => node.textContent,
      ),
    ).toEqual(["required field was not in the approved payload", "unknown field: visa status"]);
    expect(
      Array.from(report?.querySelectorAll(".draft-worker-logs li") ?? []).map((n) => n.textContent),
    ).toEqual(["opened form", "paused on required field"]);
    expect(report?.querySelector(".draft-worker-screenshots li")?.textContent).toBe(
      "screenshots/7-1.png",
    );
  });

  it("does not repeat a report reason that matches the failure reason", async () => {
    answer = draftWith({
      status: "failed",
      failure_reason: "timeout",
      worker_report: { status: "failed", reason: "timeout", logs: [], screenshots: [] },
    });
    const { container } = await loadedReview();
    expect(container.querySelectorAll(".draft-worker-reason")).toHaveLength(1);
    expect(container.querySelector(".draft-worker-logs")).toBeNull();
  });

  it("offers only the answer values as editable controls", async () => {
    const { container } = await loadedReview();
    // Scoped to the draft: the chrome above it carries the layout preference's own control.
    const body = container.querySelector(".draft-body");
    expect(body?.querySelectorAll("input, select")).toHaveLength(0);
    expect(body?.querySelectorAll("textarea")).toHaveLength(2);
    // The ATS, apply URL, and answer field names are text, not controls.
    expect(container.querySelector(".draft-autofill-ats")?.tagName).toBe("P");
    expect(container.querySelector(".draft-autofill-url")?.tagName).toBe("A");
  });

  it("wraps a long apply URL rendered as link text", async () => {
    // jsdom has no layout, so the rule that does the wrapping is read out of app.css and the
    // rendered element is checked to be the one it names (AGENTS.md 2026-06-18).
    const css = readFileSync(
      join(import.meta.dirname, "..", "..", "..", "public", "app.css"),
      "utf8",
    );
    const rule = /\n\.draft-autofill-url\s*\{([^}]*)\}/.exec(css);
    expect(rule?.[1]).toMatch(/word-break:\s*break-all;/);

    const url = `https://boards.greenhouse.io/acme/jobs/${"7".repeat(160)}?gh_src=${"x".repeat(80)}`;
    answer = draftWith({ autofill_payload: { ...READY.autofill_payload, apply_url: url } });
    const { container } = await loadedReview();
    const link = container.querySelector<HTMLAnchorElement>(".draft-autofill-url");
    expect(link?.textContent).toBe(url);
    expect(link?.getAttribute("href")).toBe(url);
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("renders a non-http apply URL as text rather than a link", async () => {
    answer = draftWith({
      autofill_payload: { ...READY.autofill_payload, apply_url: "javascript:alert(1)" },
    });
    const { container } = await loadedReview();
    const node = container.querySelector(".draft-autofill-url");
    expect(node?.tagName).toBe("SPAN");
    expect(node?.textContent).toBe("javascript:alert(1)");
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
    expect(container.querySelector(".job-route-link")).toBeNull();
  });
});

describe("DraftReviewScreen writes", () => {
  it("sends no submit and no draft write after a full render lifecycle", async () => {
    await loadedReview();
    await act(() => delay(50));
    expect(requests).toEqual(["GET /api/applications/7"]);
  });

  it("saves edited answers through PATCH with only the answers", async () => {
    const { container } = await loadedReview();
    fireEvent.change(textareas(container)[0]!, { target: { value: "Augusta Ada" } });
    expect(screen.getByRole("button", { name: "Save preview" }).hasAttribute("disabled")).toBe(
      false,
    );
    expect(submitButton().textContent).toBe("Save and submit");

    fireEvent.click(screen.getByRole("button", { name: "Save preview" }));
    await screen.findByText("Preview saved.");
    expect(draftWrites).toEqual([
      {
        application_draft: {
          autofill_payload: {
            answers: [
              { field: "first_name", value: "Augusta Ada" },
              { field: "last_name", value: "Lovelace" },
            ],
          },
        },
      },
    ]);
    expect(writes()).toEqual(["PATCH /api/applications/7/draft"]);
    expect(screen.getByRole("button", { name: "Saved" })).toHaveProperty("disabled", true);
    expect(textareas(container)[0]?.value).toBe("Augusta Ada");
    expect(submitButton().textContent).toBe("Approve and submit");
  });

  it("returns the save control to idle when an answer changes after a save", async () => {
    const { container } = await loadedReview();
    fireEvent.change(textareas(container)[0]!, { target: { value: "Augusta Ada" } });
    fireEvent.click(screen.getByRole("button", { name: "Save preview" }));
    await screen.findByText("Preview saved.");
    fireEvent.change(textareas(container)[1]!, { target: { value: "King" } });
    expect(screen.queryByText("Preview saved.")).toBeNull();
    screen.getByRole("button", { name: "Save preview" });
  });

  it("reports a failed save and keeps the edits", async () => {
    failSaveWith = 500;
    const { container } = await loadedReview();
    fireEvent.change(textareas(container)[0]!, { target: { value: "Augusta Ada" } });
    fireEvent.click(screen.getByRole("button", { name: "Save preview" }));
    await screen.findByText("Could not save the autofill preview. Please try again.");
    expect(textareas(container)[0]?.value).toBe("Augusta Ada");
    expect(draftWrites).toHaveLength(1);
  });

  it("disables submit when an edit clears a value", async () => {
    const { container } = await loadedReview();
    fireEvent.change(textareas(container)[1]!, { target: { value: "   " } });
    expect(submitButton().disabled).toBe(true);
    expect(submitButton().textContent).toBe("Preparing draft...");
  });

  it("submits on an explicit click and renders the returned status", async () => {
    submitDelay = 150;
    const { container } = await loadedReview();
    fireEvent.click(submitButton());
    await waitFor(() => {
      expect(submitButton().textContent).toBe("Submitting…");
    });
    expect(submitButton().disabled).toBe(true);

    await screen.findByText("Submitted: dispatched to greenhouse.");
    expect(container.querySelector(".draft-submit-result")?.textContent).toBe(
      "Submitted: dispatched to greenhouse.",
    );
    expect(submitButton().textContent).toBe("Submitted");
    expect(submitButton().disabled).toBe(true);
    expect(writes()).toEqual(["POST /api/applications/7/submit"]);
    expect(draftWrites).toEqual([]);

    // The refetch after submit lands and nothing is dispatched again.
    await waitFor(() => {
      expect(requests.filter((line) => line === "GET /api/applications/7")).toHaveLength(2);
    });
    fireEvent.click(submitButton());
    await act(() => delay(20));
    expect(writes()).toEqual(["POST /api/applications/7/submit"]);
  });

  it("renders a status other than dispatched as Rails sent it", async () => {
    submitAnswer = { status: "queued", application_id: 7, ats: "lever" };
    await loadedReview();
    fireEvent.click(submitButton());
    await screen.findByText("Submitted: queued to lever.");
  });

  it("saves dirty answers before submitting, in that order", async () => {
    const { container } = await loadedReview();
    fireEvent.change(textareas(container)[0]!, { target: { value: "Augusta Ada" } });
    fireEvent.click(submitButton());
    await screen.findByText("Submitted: dispatched to greenhouse.");
    expect(writes()).toEqual([
      "PATCH /api/applications/7/draft",
      "POST /api/applications/7/submit",
    ]);
  });

  it("stops before submit when the saved answers come back with warnings", async () => {
    savedAnswer = draftWith({
      autofill_warnings: [
        { field: "salary expectation", code: "sensitive", message: "Needs manual review" },
      ],
    });
    const { container } = await loadedReview();
    fireEvent.change(textareas(container)[0]!, { target: { value: "Augusta Ada" } });
    fireEvent.click(submitButton());
    await screen.findByText("Manual review is required before auto-submit.", {
      selector: ".draft-submit-error",
    });
    expect(writes()).toEqual(["PATCH /api/applications/7/draft"]);
    expect(submitButton().disabled).toBe(true);
  });

  it("stops before submit when the save fails", async () => {
    failSaveWith = 500;
    const { container } = await loadedReview();
    fireEvent.change(textareas(container)[0]!, { target: { value: "Augusta Ada" } });
    fireEvent.click(submitButton());
    await screen.findByText("Could not save the autofill preview. Please try again.", {
      selector: ".draft-submit-error",
    });
    expect(writes()).toEqual(["PATCH /api/applications/7/draft"]);
  });

  it.each([
    [422, "unsafe_payload", "Manual review is required before auto-submit."],
    [422, "unsupported_ats", "Auto-submit is not supported for this application route."],
    [500, "server_error", "Submit failed. Please try again."],
    [401, "unauthorized", SESSION_EXPIRED],
  ])("renders a %i %s refusal once, without a retry", async (status, code, message) => {
    failSubmitWith = { status, code };
    await loadedReview();
    fireEvent.click(submitButton());
    await screen.findByText(message, { selector: ".draft-submit-error" });
    await act(() => delay(50));
    expect(writes()).toEqual(["POST /api/applications/7/submit"]);
    // A refused submit can be tried again by hand; nothing did so on its own.
    expect(submitButton().disabled).toBe(false);
  });
});
