/**
 * Manual import parity (`FE-23`).
 *
 * Transcribed from `TestManualEntryRendersForm`, `TestManualEntrySubmitPostsInputAndSurfacesJob`,
 * `TestManualEntryRejectsEmptyInputWithoutCalling`, `TestManualEntryApplyCreateResultErrors`,
 * `TestImportMessageAndLinkLabel`, `TestManualEntryRendersAllImportResults`,
 * `TestManualEntryNeverImportsOnRender`, `TestEntryButtonLabel`, and
 * `TestManualEntryNeverLooksUpOnRender` in `web/components/manual_entry_test.go`; the posting
 * lookup's own cases are in `lookup.test.tsx` (`FE-24`). Go drove `doSubmit` directly and rendered a
 * component whose `state: entryDone` was set by hand, so it never showed that a press reached the
 * network or that the result on screen was the one Rails sent. Here every case presses the real
 * control, and the fake Rails records every request that arrived.
 */
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { delay } from "msw";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { queryKeys } from "../../api/keys";
import { createQueryClient } from "../../api/query-client";
import type { ManualJobResult } from "../../api/schemas";
import {
  EMPTY_MANUAL_ENTRY_FORM,
  IMPORT_HINT,
  entryButtonLabel,
  importInputPresent,
  importLinkLabel,
  importMessage,
  importOutcome,
  manualJobInput,
} from "../../lib/manual-entry";
import { SESSION_EXPIRED } from "../../lib/messages";
import { HttpResponse, http, installMockApi, type JsonBodyType } from "../../test/msw";
import { ManualEntryScreen } from "./manual-entry";

const IMPORT_INVALID = "Could not add that job. Provide a valid URL or paste the posting text.";
const IMPORT_FAILED = "Could not add the job. Please try again.";

/** A manual import answer; every field Rails serializes, overridable per case. */
function importResult(
  job: Partial<ManualJobResult["job_post"]> = {},
  outcome: Partial<ManualJobResult["import"]> = {},
): ManualJobResult {
  return {
    job_post: {
      id: 42,
      title: "Staff Engineer",
      company: "Acme",
      posting_url: "https://boards.greenhouse.io/acme/jobs/42",
      source: "manual",
      scoring_status: "pending",
      route: { route_type: "greenhouse", recommended_route: "direct_ats", application_url: "" },
      ...job,
    },
    import: { status: "new", application_status: "", ...outcome },
  };
}

/** Every request the screen sent, as `METHOD /path`, in order. */
let requests: string[] = [];
let createBodies: unknown[] = [];
let createReply: { status: number; body: JsonBodyType } = { status: 201, body: {} };
/** Held open so an in-flight request lasts long enough for `waitFor` to observe it. */
let createDelayMs = 0;

const server = installMockApi(
  http.post("/api/job_posts", async ({ request }) => {
    createBodies.push(await request.json());
    if (createDelayMs > 0) await delay(createDelayMs);
    return HttpResponse.json(createReply.body, { status: createReply.status });
  }),
);

beforeEach(() => {
  requests = [];
  createBodies = [];
  createReply = { status: 201, body: importResult() };
  createDelayMs = 0;
  server.events.on("request:start", ({ request }) => {
    requests.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});

afterEach(() => {
  server.events.removeAllListeners();
});

/** Prints where a navigation landed, so the result link can be followed. */
function LocationProbe() {
  const { pathname } = useLocation();
  return <p data-testid="location">{pathname}</p>;
}

function renderEntry(client: QueryClient = createQueryClient()) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/jobs/new"]}>
        <Routes>
          <Route path="/jobs/new" element={<ManualEntryScreen />} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function requireElement<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (found === null) throw new Error(`no ${selector} rendered`);
  return found;
}

function fill(container: HTMLElement, selector: string, value: string) {
  fireEvent.change(requireElement(container, selector), { target: { value } });
}

function valueOf(container: HTMLElement, selector: string): string {
  return requireElement<HTMLInputElement | HTMLTextAreaElement>(container, selector).value;
}

function pressImport(container: HTMLElement) {
  fireEvent.click(requireElement(container, ".manual-entry-submit"));
}

async function importedResult(container: HTMLElement): Promise<HTMLElement> {
  await waitFor(() => {
    expect(container.querySelector(".manual-entry-result")).not.toBeNull();
  });
  return requireElement<HTMLElement>(container, ".manual-entry-result");
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

describe("manual entry helpers", () => {
  // TestImportMessageAndLinkLabel, plus the company-only label and an unknown status.
  it.each([
    [
      "new pending",
      importResult({ id: 1, title: "Eng", company: "Acme" }, { status: "new" }),
      "Imported Eng — Acme. It is being scored and will appear in your feed.",
      "View job",
    ],
    [
      "tracked",
      importResult(
        { id: 2, title: "Eng", company: "", scoring_status: "" },
        { status: "already_tracked", application_status: "approved" },
      ),
      "Already tracked: Eng. Current application status: approved.",
      "View tracked job",
    ],
    [
      "submitted",
      importResult({ id: 3, title: "Eng", company: "" }, { status: "already_submitted" }),
      "Already submitted: Eng.",
      "View submitted job",
    ],
    [
      "possible match",
      importResult({ id: 4, title: "Eng", company: "" }, { status: "possible_match" }),
      "Possible match: Eng. Review the existing job before importing another.",
      "Review possible match",
    ],
    [
      "missing import defaults new",
      importResult({ id: 5, title: "", company: "", scoring_status: "scored" }, { status: "" }),
      "Imported Job #5.",
      "View job",
    ],
    [
      "a company with no title is still labelled by id",
      importResult({ id: 6, title: "", company: "Acme" }, { status: "new" }),
      "Imported Job #6. It is being scored and will appear in your feed.",
      "View job",
    ],
    [
      "an unknown status reads as new",
      importResult({ id: 7, title: "Eng", company: "" }, { status: "surprise" }),
      "Imported Eng. It is being scored and will appear in your feed.",
      "View job",
    ],
  ])("%s", (_name, result, message, link) => {
    expect(importMessage(result)).toBe(message);
    expect(importLinkLabel(result)).toBe(link);
  });

  it("gives each of the four outcomes its own message and link label", () => {
    const results = ["new", "already_tracked", "already_submitted", "possible_match"].map(
      (status) => importResult({}, { status }),
    );
    expect(results.map(importOutcome)).toEqual([
      "new",
      "already_tracked",
      "already_submitted",
      "possible_match",
    ]);
    expect(new Set(results.map(importMessage)).size).toBe(4);
    expect(new Set(results.map(importLinkLabel)).size).toBe(4);
  });

  // TestEntryButtonLabel. The lookup button's labels are in `lookup.test.tsx`.
  it("labels the import button for its in-flight state", () => {
    expect(entryButtonLabel(true)).toBe("Importing…");
    expect(entryButtonLabel(false)).toBe("Import job");
  });

  it("trims all five fields, URLs included, and sends every key even when blank", () => {
    const input = manualJobInput({
      url: "  https://boards.greenhouse.io/acme/jobs/42  ",
      application_url: "  https://careers.acme.com/apply/42  ",
      text: "  Build platforms.  ",
      title: " Staff Engineer ",
      company: "   ",
    });
    expect(input).toEqual({
      url: "https://boards.greenhouse.io/acme/jobs/42",
      application_url: "https://careers.acme.com/apply/42",
      text: "Build platforms.",
      title: "Staff Engineer",
      company: "",
    });
    expect(Object.keys(input).sort()).toEqual(
      ["application_url", "company", "text", "title", "url"].sort(),
    );
  });

  // TestManualEntryRejectsEmptyInputWithoutCalling, as a table.
  it.each([
    [{}, false],
    [{ url: "   ", text: " \n " }, false],
    [{ title: "Eng", company: "Acme", application_url: "https://careers.acme.com" }, false],
    [{ url: "careers.acme.com/jobs/1" }, true],
    [{ text: "Build platforms." }, true],
  ])("importInputPresent(%j) is %s", (partial, expected) => {
    expect(importInputPresent({ ...EMPTY_MANUAL_ENTRY_FORM.fields, ...partial })).toBe(expected);
  });
});

/* -------------------------------------------------------------------------- */
/* The form                                                                    */
/* -------------------------------------------------------------------------- */

describe("manual entry form", () => {
  // TestManualEntryRendersForm, TestManualEntryNeverImportsOnRender, and
  // TestManualEntryNeverLooksUpOnRender.
  it("renders Go's form, labels, and classes, and sends nothing on render", async () => {
    const { container } = renderEntry();

    const view = requireElement(container, ".manual-entry");
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    const back = requireElement<HTMLAnchorElement>(view, ".manual-entry-back");
    expect(view.contains(nav)).toBe(true);
    // The chrome renders inside the page container and before its content (`FE-08`).
    expect(nav.compareDocumentPosition(back) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(back).toHaveTextContent("← Jobs");
    expect(back).toHaveAttribute("href", "/jobs");
    // `.manual-entry > h1` is the title rule, so the heading must be a direct child.
    const heading = Array.from(view.children).find((child) => child.tagName === "H1");
    expect(heading).toHaveTextContent("Import a job");
    expect(requireElement(view, ".manual-entry-note").textContent).toBe(
      "Paste a listing link and the title, company, and description are read from the posting. Add an external application link when you have one.",
    );

    const form = requireElement<HTMLFormElement>(view, "form.manual-entry-form");
    expect(Array.from(form.children, (child) => child.className)).toEqual([
      "manual-entry-label",
      "manual-entry-lookup",
      "manual-entry-label",
      "manual-entry-label",
      "manual-entry-label",
      "manual-entry-label",
      "manual-entry-submit",
    ]);
    expect(
      Array.from(form.querySelectorAll(".manual-entry-label > span"), (span) => span.textContent),
    ).toEqual([
      "Job URL",
      "Title",
      "Company",
      "External application URL (optional)",
      "Posting text",
    ]);
    for (const [selector, tag, type, placeholder] of [
      [".manual-entry-url", "INPUT", "url", "https://…"],
      [".manual-entry-title", "INPUT", "text", null],
      [".manual-entry-company", "INPUT", "text", null],
      [".manual-entry-application-url", "INPUT", "url", "https://careers.example.com/apply"],
      [".manual-entry-text", "TEXTAREA", null, "Paste the job description…"],
    ] as const) {
      const field = requireElement(form, selector);
      expect(field.tagName).toBe(tag);
      expect(field.getAttribute("type")).toBe(type);
      expect(field.getAttribute("placeholder")).toBe(placeholder);
    }

    const lookUp = requireElement<HTMLButtonElement>(form, ".manual-entry-lookup-button");
    expect(lookUp).toHaveAttribute("type", "button");
    expect(lookUp).toBeDisabled();
    expect(lookUp).toHaveTextContent("Look up details");
    const submit = requireElement<HTMLButtonElement>(form, ".manual-entry-submit");
    expect(submit).toHaveAttribute("type", "submit");
    expect(submit).toBeEnabled();
    expect(submit).toHaveTextContent("Import job");
    expect(
      container.querySelector(
        ".manual-entry-error, .manual-entry-result, .manual-entry-lookup-note, .manual-entry-lookup-warning",
      ),
    ).toBeNull();

    await delay(50);
    expect(requests).toEqual([]);
  });

  // TestManualEntrySubmitPostsInputAndSurfacesJob.
  it("trims the fields, wraps all five in job_post, and renders the import Rails answered", async () => {
    const { container } = renderEntry();
    // A `type="url"` input strips surrounding whitespace from its own value, so URL trimming is
    // only observable through `manualJobInput` (above); the text fields keep theirs until sent.
    fill(container, ".manual-entry-url", "https://boards.greenhouse.io/acme/jobs/42");
    fill(container, ".manual-entry-application-url", "https://careers.acme.com/apply/42");
    fill(container, ".manual-entry-text", "  Build platforms.  ");
    fill(container, ".manual-entry-title", " Staff Engineer ");
    pressImport(container);

    const result = await importedResult(container);
    expect(createBodies).toEqual([
      {
        job_post: {
          url: "https://boards.greenhouse.io/acme/jobs/42",
          application_url: "https://careers.acme.com/apply/42",
          text: "Build platforms.",
          title: "Staff Engineer",
          company: "",
        },
      },
    ]);
    // No blur happened, so no lookup: the import is the only request.
    expect(requests).toEqual(["POST /api/job_posts"]);
    expect(result).toHaveClass("manual-entry-result", "manual-entry-result--new");
    expect(requireElement(result, ".manual-entry-result-msg").textContent).toBe(
      "Imported Staff Engineer — Acme. It is being scored and will appear in your feed.",
    );
    const link = requireElement<HTMLAnchorElement>(result, ".manual-entry-result-link");
    expect(link).toHaveAttribute("href", "/jobs/42");
    expect(link).toHaveTextContent("View job");

    fireEvent.click(link);
    expect(await screen.findByTestId("location")).toHaveTextContent("/jobs/42");
  });

  // TestManualEntryRendersAllImportResults, against real Rails status codes.
  it.each([
    [
      "new",
      201,
      { status: "new", application_status: "" },
      "Imported Staff Engineer — Acme. It is being scored and will appear in your feed.",
      "View job",
    ],
    [
      "already_tracked",
      200,
      { status: "already_tracked", application_status: "approved" },
      "Already tracked: Staff Engineer — Acme. Current application status: approved.",
      "View tracked job",
    ],
    [
      "already_submitted",
      200,
      { status: "already_submitted", application_status: "submitted" },
      "Already submitted: Staff Engineer — Acme.",
      "View submitted job",
    ],
    [
      "possible_match",
      200,
      { status: "possible_match", application_status: "" },
      "Possible match: Staff Engineer — Acme. Review the existing job before importing another.",
      "Review possible match",
    ],
  ])(
    "renders the %s outcome with its own sentence, link, and class",
    async (outcome, status, envelope, message, label) => {
      createReply = { status, body: importResult({ id: 77 }, envelope) };
      const { container } = renderEntry();
      fill(container, ".manual-entry-url", "https://boards.greenhouse.io/acme/jobs/77");
      pressImport(container);

      const result = await importedResult(container);
      expect(container.querySelectorAll(".manual-entry-result")).toHaveLength(1);
      expect(result).toHaveClass(`manual-entry-result--${outcome.replace(/_/g, "-")}`);
      expect(requireElement(result, ".manual-entry-result-msg").textContent).toBe(message);
      const link = requireElement(result, ".manual-entry-result-link");
      // For a match, the link goes to the posting Rails already had, never a new one.
      expect(link).toHaveAttribute("href", "/jobs/77");
      expect(link).toHaveTextContent(label);
      expect(container.querySelector(".manual-entry-error")).toBeNull();
    },
  );

  it("reads the outcome from the top-level import key, not from inside job_post", async () => {
    const answer = importResult();
    createReply = {
      status: 200,
      body: {
        job_post: { ...answer.job_post, import: { status: "already_submitted" } },
        import: { status: "already_tracked", application_status: "draft" },
      },
    };
    const { container } = renderEntry();
    fill(container, ".manual-entry-text", "Build platforms.");
    pressImport(container);

    const result = await importedResult(container);
    expect(result).toHaveClass("manual-entry-result--already-tracked");
    expect(requireElement(result, ".manual-entry-result-msg").textContent).toBe(
      "Already tracked: Staff Engineer — Acme. Current application status: draft.",
    );
  });

  it("treats an answer with no import key as a new import", async () => {
    const { job_post } = importResult({ id: 5, title: "", company: "", scoring_status: "scored" });
    createReply = { status: 201, body: { job_post } };
    const { container } = renderEntry();
    fill(container, ".manual-entry-text", "Build platforms.");
    pressImport(container);

    const result = await importedResult(container);
    expect(result).toHaveClass("manual-entry-result--new");
    expect(requireElement(result, ".manual-entry-result-msg").textContent).toBe("Imported Job #5.");
  });

  // TestManualEntryRejectsEmptyInputWithoutCalling.
  it.each([
    ["an empty form", {}],
    ["whitespace-only posting text", { ".manual-entry-text": "   \n  " }],
    [
      "a title, company, and application URL with no job URL or text",
      {
        ".manual-entry-title": "Staff Engineer",
        ".manual-entry-company": "Acme",
        ".manual-entry-application-url": "https://careers.acme.com/apply/42",
      },
    ],
  ])("hints instead of importing %s", async (_name, values: Record<string, string>) => {
    const { container } = renderEntry();
    for (const [selector, value] of Object.entries(values)) fill(container, selector, value);
    pressImport(container);

    expect(await screen.findByRole("alert")).toHaveTextContent(IMPORT_HINT);
    expect(requireElement(container, ".manual-entry-error").textContent).toBe(IMPORT_HINT);
    await delay(50);
    expect(requests).toEqual([]);

    // The hint is only a hint: adding posting text lets the same press through.
    fill(container, ".manual-entry-text", "Build platforms.");
    pressImport(container);
    await importedResult(container);
    expect(requests).toEqual(["POST /api/job_posts"]);
    expect(container.querySelector(".manual-entry-error")).toBeNull();
  });

  it("replaces a shown result with the hint when the form is emptied and pressed again", async () => {
    const { container } = renderEntry();
    fill(container, ".manual-entry-text", "Build platforms.");
    pressImport(container);
    await importedResult(container);

    fill(container, ".manual-entry-text", "");
    pressImport(container);
    expect(await screen.findByRole("alert")).toHaveTextContent(IMPORT_HINT);
    expect(container.querySelector(".manual-entry-result")).toBeNull();
    expect(createBodies).toHaveLength(1);
  });

  it("validates no URL itself: a scheme-less URL reaches Rails and Rails' sentence is shown", async () => {
    const railsSentence =
      "URL must be an HTTP or HTTPS URL, Application URL must be an HTTP or HTTPS URL";
    createReply = {
      status: 422,
      body: { error: { code: "invalid_input", message: railsSentence } },
    };
    const { container } = renderEntry();
    fill(container, ".manual-entry-url", "careers.acme.com/jobs/42");
    fill(container, ".manual-entry-application-url", "javascript:alert(1)");

    // The browser — and jsdom — call this a type mismatch, and a validating form would never fire
    // `submit`. `noValidate` is what lets the press through to Rails; removing it fails this test.
    const url = requireElement<HTMLInputElement>(container, ".manual-entry-url");
    expect(url.validity.typeMismatch).toBe(true);
    expect(requireElement<HTMLFormElement>(container, "form").noValidate).toBe(true);
    pressImport(container);

    expect(await screen.findByRole("alert")).toHaveTextContent(railsSentence);
    expect(requireElement(container, ".manual-entry-error").textContent).toBe(railsSentence);
    // Sent exactly as typed: no scheme added, nothing normalized, nothing rejected client-side.
    expect(createBodies).toEqual([
      {
        job_post: {
          url: "careers.acme.com/jobs/42",
          application_url: "javascript:alert(1)",
          text: "",
          title: "",
          company: "",
        },
      },
    ]);
    expect(valueOf(container, ".manual-entry-url")).toBe("careers.acme.com/jobs/42");
    expect(container.querySelector(".manual-entry-result")).toBeNull();
  });

  // TestManualEntryApplyCreateResultErrors.
  it.each([
    ["a 422 without a Rails sentence", 422, "invalid_input", "", IMPORT_INVALID],
    ["a 500", 500, "internal_error", "boom", IMPORT_FAILED],
    ["a 401", 401, "unauthorized", "Not signed in", SESSION_EXPIRED],
  ])("reports %s once, without retrying", async (_name, status, code, message, expected) => {
    createReply = { status, body: { error: { code, message } } };
    const { container } = renderEntry();
    fill(container, ".manual-entry-text", "Build platforms.");
    pressImport(container);

    expect(await screen.findByRole("alert")).toHaveTextContent(expected);
    await delay(50);
    expect(createBodies).toHaveLength(1);
    expect(container.querySelector(".manual-entry-result")).toBeNull();
    expect(requireElement(container, ".manual-entry-submit")).toBeEnabled();
  });

  it("disables the import button while the request is in flight", async () => {
    createDelayMs = 200;
    const { container } = renderEntry();
    fill(container, ".manual-entry-text", "Build platforms.");
    pressImport(container);

    const submit = requireElement<HTMLButtonElement>(container, ".manual-entry-submit");
    await waitFor(() => {
      expect(submit).toBeDisabled();
    });
    expect(submit).toHaveTextContent("Importing…");

    await importedResult(container);
    expect(submit).toBeEnabled();
    expect(submit).toHaveTextContent("Import job");
    expect(createBodies).toHaveLength(1);
  });

  it("marks the feed and the ingestion batches stale after an import, and not the profile", async () => {
    const client = createQueryClient();
    client.setQueryData(queryKeys.jobs.list(), {});
    client.setQueryData(queryKeys.ingestionBatches.page(1), {});
    client.setQueryData(queryKeys.profile(), {});
    const { container } = renderEntry(client);
    fill(container, ".manual-entry-text", "Build platforms.");
    pressImport(container);
    await importedResult(container);

    await waitFor(() => {
      expect(client.getQueryState(queryKeys.jobs.list())?.isInvalidated).toBe(true);
    });
    expect(client.getQueryState(queryKeys.ingestionBatches.page(1))?.isInvalidated).toBe(true);
    expect(client.getQueryState(queryKeys.profile())?.isInvalidated).toBe(false);
  });

  it("puts pasted posting text in a textarea the app.css wrap rule names", () => {
    // jsdom has no layout, and the `p, li, h1, h2, span` reset does not reach a <textarea>, so
    // `app.css` names `.manual-entry-text` in an `overflow-wrap` rule of its own (AGENTS.md
    // 2026-06-18). A pasted URL is exactly the long unbroken token that rule exists for.
    const css = readFileSync(
      join(import.meta.dirname, "..", "..", "..", "public", "app.css"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    const wrapSafe = new Set<string>();
    for (const [, selectors = "", body = ""] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (/overflow-wrap:\s*break-word/.test(body)) {
        for (const selector of selectors.split(",")) wrapSafe.add(selector.trim());
      }
    }
    expect(wrapSafe).toContain(".manual-entry-text");

    const { container } = renderEntry();
    const token = `https://careers.acme.com/${"x".repeat(160)}`;
    fill(container, ".manual-entry-text", token);
    const text = requireElement<HTMLTextAreaElement>(container, ".manual-entry-text");
    expect(text.tagName).toBe("TEXTAREA");
    expect(text.value).toBe(token);
  });
});
