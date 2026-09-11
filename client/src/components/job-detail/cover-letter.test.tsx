/**
 * Cover-letter panel parity (`FE-20`).
 *
 * Transcribed from `TestJobDetailRendersCoverLetterControlWithoutGenerating`,
 * `TestJobDetailDoGenerateCoverLetter`, and `TestJobDetailCoverLetterUnavailableError` in
 * `web/components/jobs_test.go`, plus the copy control `web/components/copy_button.go` never
 * had a test for at all.
 *
 * The panel is rendered directly rather than through `JobDetailScreen`: it owns its own query
 * and mutation, so this is the whole unit, and the assertions land on the requests MSW
 * actually received — which is the only way "opening a posting never spends LLM budget" can be
 * proven rather than described.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { delay } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createQueryClient } from "../../api/query-client";
import type { CoverLetterDraft } from "../../api/schemas";
import { SESSION_EXPIRED } from "../../lib/messages";
import { fixtures } from "../../test/handlers";
import { HttpResponse, http, installMockApi } from "../../test/msw";
import { CoverLetterPanel } from "./cover-letter";

/** Every `GET /api/job_posts/:id/cover_letter_draft`, by job id. */
let reads: string[] = [];
/** Every `POST` to the same path. Length 0 after a render is the safety assertion. */
let generates: string[] = [];

/** What the read answers with; `null` is "no letter saved yet". */
let saved: CoverLetterDraft | null = fixtures.coverLetterDraft;
/** Set to a status to fail the read instead. */
let failReadWith: number | null = null;
/** Set to a status to fail the generate instead. */
let failGenerateWith: number | null = null;
/** Held open so the in-flight state lasts long enough to observe. */
let generateDelayMs = 0;

installMockApi(
  http.get("/api/job_posts/:id/cover_letter_draft", ({ params }) => {
    reads.push(String(params.id));
    if (failReadWith !== null) {
      return HttpResponse.json(
        { error: { code: "not_found", message: "no such job" } },
        { status: failReadWith },
      );
    }
    return HttpResponse.json({ cover_letter_draft: saved });
  }),
  http.post("/api/job_posts/:id/cover_letter_draft", async ({ params }) => {
    generates.push(String(params.id));
    if (generateDelayMs > 0) await delay(generateDelayMs);
    if (failGenerateWith !== null) {
      return HttpResponse.json(
        { error: { code: "llm_unavailable", message: "not configured" } },
        { status: failGenerateWith },
      );
    }
    const draft: CoverLetterDraft = {
      ...fixtures.coverLetterDraft,
      id: 12,
      body: "Dear Northwind team, I would be excited to contribute.",
    };
    return HttpResponse.json({ cover_letter_draft: draft }, { status: 201 });
  }),
);

beforeEach(() => {
  reads = [];
  generates = [];
  saved = fixtures.coverLetterDraft;
  failReadWith = null;
  failGenerateWith = null;
  generateDelayMs = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPanel(jobId = 101) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <CoverLetterPanel jobId={jobId} />
    </QueryClientProvider>,
  );
}

/**
 * The generate button. Matched by class rather than by name, because "Copy cover letter" also
 * ends in "cover letter" and an accessible-name regexp would find both.
 */
function generateButton(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(".job-cover-letter-generate");
  if (button === null) throw new Error("no generate button rendered");
  return button;
}

/** Renders and waits for the read to settle, so the generate button is enabled. */
async function loadedPanel(jobId = 101) {
  const view = renderPanel(jobId);
  await waitFor(() => {
    expect(generateButton(view.container)).toBeEnabled();
  });
  return view;
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

describe("cover letter read", () => {
  it("reads the saved letter for the posting and renders it with a copy control", async () => {
    saved = { ...fixtures.coverLetterDraft, body: "Dear hiring team, I am excited to apply." };
    const { container } = await loadedPanel(7);

    expect(reads).toEqual(["7"]);
    expect(container.querySelector(".job-cover-letter-body")?.textContent).toBe(
      "Dear hiring team, I am excited to apply.",
    );
    expect(screen.getByRole("button", { name: "Copy cover letter" })).toBeInTheDocument();
    // The letter exists, so the button must say it replaces it.
    expect(generateButton(container)).toHaveTextContent("Regenerate cover letter");
  });

  it("offers to generate, and says the generator submits nothing, when none is saved", async () => {
    saved = null;
    const { container } = await loadedPanel();

    expect(container.querySelector(".job-cover-letter-empty")?.textContent).toBe(
      "Generate a tailored letter from this posting and your synced resume. It will never submit an application.",
    );
    expect(generateButton(container)).toHaveTextContent("Generate cover letter");
    expect(container.querySelector(".job-cover-letter-draft")).toBeNull();
  });

  // TestJobDetailRendersCoverLetterControlWithoutGenerating: the panel is a read on mount, and
  // `POST` spends OpenRouter budget. Opening a posting must never spend it.
  it("never generates on render", async () => {
    await loadedPanel();

    expect(generates).toEqual([]);
  });

  it("does not offer to replace a letter it could not read", async () => {
    failReadWith = 404;
    const { container } = renderPanel();

    await waitFor(() => {
      expect(container.querySelector(".job-cover-letter-error")).not.toBeNull();
    });
    // The `POST` replaces whatever is saved; with the read failed the panel cannot show what
    // that is, so it must not offer to discard it.
    expect(generateButton(container)).toBeDisabled();
    expect(generates).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Generating                                                                  */
/* -------------------------------------------------------------------------- */

describe("cover letter generation", () => {
  // TestJobDetailDoGenerateCoverLetter.
  it("generates on click and renders the returned letter", async () => {
    saved = null;
    const { container } = await loadedPanel(7);

    fireEvent.click(generateButton(container));

    await waitFor(() => {
      expect(
        screen.getByText("Dear Northwind team, I would be excited to contribute."),
      ).toBeInTheDocument();
    });
    expect(generates).toEqual(["7"]);
    // The response is the new letter, so it is cached directly rather than re-read.
    expect(reads).toEqual(["7"]);
    expect(generateButton(container)).toHaveTextContent("Regenerate cover letter");
  });

  // TestJobDetailCoverLetterUnavailableError: 503 is "no key configured", not "try again".
  it("reports an unconfigured generator separately from a failed one", async () => {
    failGenerateWith = 503;
    const { container } = await loadedPanel();

    fireEvent.click(generateButton(container));

    await waitFor(() => {
      expect(container.querySelector(".job-cover-letter-error")?.textContent).toBe(
        "Cover-letter generation is unavailable. Please try again later.",
      );
    });
    // The saved letter is untouched: a failed generate replaces nothing.
    expect(container.querySelector(".job-cover-letter-body")).not.toBeNull();
  });

  it("reports a generator that ran and failed", async () => {
    failGenerateWith = 502;
    const { container } = await loadedPanel();

    fireEvent.click(generateButton(container));

    await waitFor(() => {
      expect(container.querySelector(".job-cover-letter-error")?.textContent).toBe(
        "Could not generate the cover letter. Please try again.",
      );
    });
  });

  it("reports an expired session as one", async () => {
    failGenerateWith = 401;
    const { container } = await loadedPanel();

    fireEvent.click(generateButton(container));

    await waitFor(() => {
      expect(container.querySelector(".job-cover-letter-error")?.textContent).toBe(SESSION_EXPIRED);
    });
  });

  // The guard against a double spend is the disabled button, which React flushes before the
  // browser can deliver a second click: a discrete event's state update is applied synchronously.
  it("disables itself while a generation is in flight", async () => {
    generateDelayMs = 200;
    const { container } = await loadedPanel();

    fireEvent.click(generateButton(container));

    await waitFor(() => {
      expect(generateButton(container)).toBeDisabled();
    });
    expect(generateButton(container)).toHaveTextContent("Generating…");
    fireEvent.click(generateButton(container));

    await waitFor(() => {
      expect(generateButton(container)).toBeEnabled();
    });
    expect(generates).toEqual(["101"]);
  });
});

/* -------------------------------------------------------------------------- */
/* Copy control                                                                */
/* -------------------------------------------------------------------------- */

describe("copy control", () => {
  // jsdom exposes no `navigator.clipboard`, so this is the unsupported browser for free.
  it("is inert and instructive when the browser has no clipboard", async () => {
    const { container } = await loadedPanel();
    expect(navigator.clipboard).toBeUndefined();

    fireEvent.click(screen.getByRole("button", { name: "Copy cover letter" }));

    expect(container.querySelector(".copy-status")?.textContent).toBe(
      "Select the text and copy it manually.",
    );
    // Nothing was thrown and the button is still usable.
    expect(screen.getByRole("button", { name: "Copy cover letter" })).toBeEnabled();
  });

  it("writes the letter to the clipboard when there is one", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const { container } = await loadedPanel();

    fireEvent.click(screen.getByRole("button", { name: "Copy cover letter" }));

    await waitFor(() => {
      expect(container.querySelector(".copy-status")?.textContent).toBe("Copied.");
    });
    expect(writeText).toHaveBeenCalledExactlyOnceWith(fixtures.coverLetterDraft.body);
  });

  it("tells the owner to copy by hand when the clipboard refuses", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const { container } = await loadedPanel();

    fireEvent.click(screen.getByRole("button", { name: "Copy cover letter" }));

    await waitFor(() => {
      expect(container.querySelector(".copy-status")?.textContent).toBe(
        "Copy was blocked. Select the text and copy it manually.",
      );
    });
  });
});
