/**
 * Posting lookup and prefill parity (`FE-24`).
 *
 * Transcribed from `TestManualEntryLookupPrefillsEmptyFields`,
 * `TestManualEntryLookupNeverOverwritesOwnerInput`, `TestManualEntryUnreadablePostingLeavesFormUsable`,
 * `TestManualEntryLookupSurfacesExpiredSession`, and `TestManualEntryLookupSkipsRepeatOfSameURL` in
 * `web/components/manual_entry_test.go`. Go called `doLookup` directly, so its tests never saw the
 * commit that starts a lookup (the skip-repeat guard lived in `startLookup`, out of their reach), and
 * "the form stays submittable" was an assertion that `state` was still `entryIdle`. Here the URL field
 * is really left, Import is really pressed after each kind of answer, and the fake Rails records what
 * both requests carried. `TestManualEntryNeverLooksUpOnRender` stays with the render case in
 * `manual-entry.test.tsx`.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { delay } from "msw";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createQueryClient } from "../../api/query-client";
import type { ManualJobInput, ManualJobResult, PostingLookup } from "../../api/schemas";
import {
  EMPTY_MANUAL_ENTRY_FORM,
  applyLookupResult,
  editField,
  joinFields,
  lookupButtonLabel,
  lookupTarget,
} from "../../lib/manual-entry";
import { POSTING_UNREADABLE, SESSION_EXPIRED } from "../../lib/messages";
import { HttpResponse, http, installMockApi } from "../../test/msw";
import { ManualEntryScreen } from "./manual-entry";

const LINKEDIN_URL = "https://www.linkedin.com/jobs/view/4435267449";

const LISTING: PostingLookup = {
  status: "ok",
  provider: "linked_in",
  error: "",
  title: "MCP/AI Developer",
  company: "Autodesk",
  location: "Canada",
  compensation: "",
  description: "Build the agentic platform.",
};

const IMPORTED: ManualJobResult = {
  job_post: {
    id: 42,
    title: "MCP/AI Developer",
    company: "Autodesk",
    posting_url: LINKEDIN_URL,
    source: "manual",
    scoring_status: "pending",
    route: {
      route_type: "linkedin_easy_apply",
      recommended_route: "job_board_apply",
      application_url: "",
    },
  },
  import: { status: "new", application_status: "" },
};

/** The import request for `fields`, every unlisted key sent blank as the form always sends it. */
function importBody(fields: Partial<ManualJobInput>) {
  return {
    job_post: { url: "", application_url: "", text: "", title: "", company: "", ...fields },
  };
}

/** Every request the screen sent, as `METHOD /path`, in order. */
let requests: string[] = [];
let lookupBodies: unknown[] = [];
let createBodies: unknown[] = [];
/** How Rails answers the lookup — a function, so a case can answer with a network failure. */
let lookupAnswer: () => Response = () => HttpResponse.json({ lookup: LISTING });
/** Held open so an in-flight lookup lasts long enough for `waitFor` to observe it. */
let lookupDelayMs = 0;

const server = installMockApi(
  http.post("/api/job_posts/lookup", async ({ request }) => {
    lookupBodies.push(await request.json());
    if (lookupDelayMs > 0) await delay(lookupDelayMs);
    return lookupAnswer();
  }),
  http.post("/api/job_posts", async ({ request }) => {
    createBodies.push(await request.json());
    return HttpResponse.json(IMPORTED, { status: 201 });
  }),
);

beforeEach(() => {
  requests = [];
  lookupBodies = [];
  createBodies = [];
  lookupAnswer = () => HttpResponse.json({ lookup: LISTING });
  lookupDelayMs = 0;
  server.events.on("request:start", ({ request }) => {
    requests.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});

afterEach(() => {
  server.events.removeAllListeners();
});

function renderEntry() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={["/jobs/new"]}>
        <ManualEntryScreen />
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

/** Leaves the URL field, which is what commits it and starts a lookup. */
function commitUrl(container: HTMLElement) {
  fireEvent.blur(requireElement(container, ".manual-entry-url"));
}

function lookupButton(container: HTMLElement): HTMLButtonElement {
  return requireElement<HTMLButtonElement>(container, ".manual-entry-lookup-button");
}

function submitButton(container: HTMLElement): HTMLButtonElement {
  return requireElement<HTMLButtonElement>(container, ".manual-entry-submit");
}

function pressImport(container: HTMLElement) {
  fireEvent.click(submitButton(container));
}

/** Waits for a lookup to settle into its note, and returns the note. */
async function lookupNote(container: HTMLElement): Promise<HTMLElement> {
  const selector = ".manual-entry-lookup-note, .manual-entry-lookup-warning";
  await waitFor(() => {
    expect(container.querySelector(selector)).not.toBeNull();
  });
  return requireElement<HTMLElement>(container, selector);
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

describe("posting lookup helpers", () => {
  it("looks up only a URL that is present and, unless forced, not the one already read", () => {
    const blank = EMPTY_MANUAL_ENTRY_FORM;
    const typed = editField(blank, "url", `  ${LINKEDIN_URL} `);
    expect(lookupTarget(blank, true)).toBe("");
    expect(lookupTarget(typed, false)).toBe(LINKEDIN_URL);

    const read = { ...typed, lookedUpUrl: LINKEDIN_URL };
    expect(lookupTarget(read, false)).toBe("");
    expect(lookupTarget(read, true)).toBe(LINKEDIN_URL);
  });

  it("marks only the three prefillable fields as touched", () => {
    let form = editField(EMPTY_MANUAL_ENTRY_FORM, "url", LINKEDIN_URL);
    form = editField(form, "application_url", "https://careers.acme.com");
    expect([form.titleTouched, form.companyTouched, form.textTouched]).toEqual([
      false,
      false,
      false,
    ]);
    form = editField(editField(editField(form, "title", "a"), "company", "b"), "text", "c");
    expect([form.titleTouched, form.companyTouched, form.textTouched]).toEqual([true, true, true]);
  });

  it("lets a second lookup replace a title the first filled, but never a description", () => {
    const first = applyLookupResult(EMPTY_MANUAL_ENTRY_FORM, LINKEDIN_URL, LISTING);
    const second = applyLookupResult(first, LINKEDIN_URL, {
      ...LISTING,
      title: "Senior MCP/AI Developer",
      description: "A different description.",
    });
    expect(second.fields.title).toBe("Senior MCP/AI Developer");
    expect(second.fields.text).toBe(LISTING.description);
    expect(second.lookup).toEqual({
      failed: false,
      note: "Filled in title and company from the listing.",
    });
  });

  // The status gates the prefill, not the presence of fields: these answers carry a full listing.
  it.each(["unavailable", "unsupported"])(
    "fills nothing from an %s answer, and still counts the URL as read",
    (status) => {
      const typed = editField(editField(EMPTY_MANUAL_ENTRY_FORM, "url", LINKEDIN_URL), "text", "x");
      const next = applyLookupResult(typed, LINKEDIN_URL, { ...LISTING, status });
      expect(next.fields).toEqual(typed.fields);
      expect(next.lookedUpUrl).toBe(LINKEDIN_URL);
      expect(next.lookup).toEqual({ failed: true, note: POSTING_UNREADABLE });
    },
  );

  it.each([
    [[], ""],
    [["title"], "title"],
    [["title", "company"], "title and company"],
    [["title", "company", "posting text"], "title, company, and posting text"],
  ])("joinFields(%j) is %j", (fields, expected) => {
    expect(joinFields(fields)).toBe(expected);
  });

  it("labels the lookup button for its in-flight state", () => {
    expect(lookupButtonLabel(true)).toBe("Reading posting…");
    expect(lookupButtonLabel(false)).toBe("Look up details");
  });
});

/* -------------------------------------------------------------------------- */
/* The lookup on the form                                                      */
/* -------------------------------------------------------------------------- */

describe("posting lookup", () => {
  it("does not look up while the URL is typed, only once the field is left", async () => {
    const { container } = renderEntry();
    for (let end = 8; end < LINKEDIN_URL.length; end += 8) {
      fill(container, ".manual-entry-url", LINKEDIN_URL.slice(0, end));
    }
    fill(container, ".manual-entry-url", LINKEDIN_URL);
    await delay(50);
    expect(requests).toEqual([]);

    commitUrl(container);
    await lookupNote(container);
    expect(lookupBodies).toEqual([{ url: LINKEDIN_URL }]);
    expect(requests).toEqual(["POST /api/job_posts/lookup"]);
  });

  // TestManualEntryLookupPrefillsEmptyFields, carried through to the import.
  it("fills the empty fields under the control, names them, and imports what it filled", async () => {
    const { container } = renderEntry();
    fill(container, ".manual-entry-url", LINKEDIN_URL);
    commitUrl(container);

    const note = await lookupNote(container);
    expect(lookupBodies).toEqual([{ url: LINKEDIN_URL }]);
    expect(note).toHaveClass("manual-entry-lookup-note");
    expect(note.textContent).toBe("Filled in title, company, and posting text from the listing.");
    expect(lookupButton(container)).toHaveTextContent("Look up details");

    // Go's layout: the note sits in the control beside its button, the URL field is directly above
    // it, and the filled title and company land in the two fields directly under it.
    const control = requireElement(container, ".manual-entry-lookup");
    expect(control.contains(note)).toBe(true);
    expect(control.querySelectorAll("p")).toHaveLength(1);
    expect(control.previousElementSibling?.querySelector(".manual-entry-url")).toHaveValue(
      LINKEDIN_URL,
    );
    const titleField = control.nextElementSibling;
    expect(titleField?.querySelector(".manual-entry-title")).toHaveValue("MCP/AI Developer");
    expect(titleField?.nextElementSibling?.querySelector(".manual-entry-company")).toHaveValue(
      "Autodesk",
    );
    expect(valueOf(container, ".manual-entry-text")).toBe("Build the agentic platform.");

    pressImport(container);
    await importedResult(container);
    expect(createBodies).toEqual([
      importBody({
        url: LINKEDIN_URL,
        title: "MCP/AI Developer",
        company: "Autodesk",
        text: "Build the agentic platform.",
      }),
    ]);
    // A lookup persists nothing: the import is still the only write that creates a posting.
    expect(requests).toEqual(["POST /api/job_posts/lookup", "POST /api/job_posts"]);
    expect(container.querySelector(".manual-entry-error")).toBeNull();
  });

  // TestManualEntryLookupNeverOverwritesOwnerInput.
  it("never overwrites a field the owner typed into", async () => {
    const { container } = renderEntry();
    fill(container, ".manual-entry-title", "My title");
    fill(container, ".manual-entry-company", "My company");
    fill(container, ".manual-entry-text", "My notes");
    fill(container, ".manual-entry-url", LINKEDIN_URL);
    commitUrl(container);

    const note = await lookupNote(container);
    expect(note.textContent).toBe("Read the listing; your entries were kept.");
    expect(valueOf(container, ".manual-entry-title")).toBe("My title");
    expect(valueOf(container, ".manual-entry-company")).toBe("My company");
    expect(valueOf(container, ".manual-entry-text")).toBe("My notes");
  });

  it("keeps a field the owner types into while the lookup is still in flight", async () => {
    lookupDelayMs = 200;
    const { container } = renderEntry();
    fill(container, ".manual-entry-url", LINKEDIN_URL);
    commitUrl(container);

    await waitFor(() => {
      expect(lookupButton(container)).toBeDisabled();
    });
    expect(lookupButton(container)).toHaveTextContent("Reading posting…");
    fill(container, ".manual-entry-title", "My own title");

    const note = await lookupNote(container);
    expect(valueOf(container, ".manual-entry-title")).toBe("My own title");
    expect(valueOf(container, ".manual-entry-company")).toBe("Autodesk");
    expect(note.textContent).toBe("Filled in company and posting text from the listing.");
  });

  // TestManualEntryUnreadablePostingLeavesFormUsable. Rails splats no field keys for these.
  it.each(["unavailable", "unsupported"])(
    "leaves the form empty and importable when Rails reports the posting %s",
    async (status) => {
      lookupAnswer = () =>
        HttpResponse.json({ lookup: { status, error: "Could not read the posting" } });
      const { container } = renderEntry();
      fill(container, ".manual-entry-url", "https://careers.example.com/roles/9");
      commitUrl(container);

      const note = await lookupNote(container);
      expect(note).toHaveClass("manual-entry-lookup-warning");
      expect(note.textContent).toBe(POSTING_UNREADABLE);
      expect(valueOf(container, ".manual-entry-title")).toBe("");
      expect(valueOf(container, ".manual-entry-company")).toBe("");
      expect(submitButton(container)).toBeEnabled();

      pressImport(container);
      await importedResult(container);
      expect(createBodies).toEqual([importBody({ url: "https://careers.example.com/roles/9" })]);
      expect(container.querySelector(".manual-entry-error")).toBeNull();
    },
  );

  it.each([
    [
      "a 500",
      () =>
        HttpResponse.json({ error: { code: "internal_error", message: "boom" } }, { status: 500 }),
    ],
    ["a network failure", () => HttpResponse.error()],
  ])("warns once after %s, and the import still goes through", async (_name, answer) => {
    lookupAnswer = answer;
    const { container } = renderEntry();
    fill(container, ".manual-entry-url", LINKEDIN_URL);
    commitUrl(container);

    const note = await lookupNote(container);
    expect(note).toHaveClass("manual-entry-lookup-warning");
    expect(note.textContent).toBe(POSTING_UNREADABLE);
    await delay(50);
    // Never retried: a lookup is a mutation (`query-client.ts`).
    expect(lookupBodies).toHaveLength(1);
    expect(container.querySelector(".manual-entry-error")).toBeNull();
    expect(submitButton(container)).toBeEnabled();

    pressImport(container);
    await importedResult(container);
    expect(createBodies).toEqual([importBody({ url: LINKEDIN_URL })]);
    expect(container.querySelector(".manual-entry-error")).toBeNull();
  });

  // TestManualEntryLookupSurfacesExpiredSession. In the app the `lib/auth.ts` redirect takes over;
  // the screen's own part is to name the one failure the owner has to act on, and block nothing.
  it("names an expired session on a 401 lookup, once, and leaves import enabled", async () => {
    lookupAnswer = () =>
      HttpResponse.json(
        { error: { code: "unauthorized", message: "Not signed in" } },
        { status: 401 },
      );
    const { container } = renderEntry();
    fill(container, ".manual-entry-url", LINKEDIN_URL);
    commitUrl(container);

    const note = await lookupNote(container);
    expect(note).toHaveClass("manual-entry-lookup-warning");
    expect(note.textContent).toBe(SESSION_EXPIRED);
    await delay(50);
    expect(lookupBodies).toHaveLength(1);
    expect(submitButton(container)).toBeEnabled();
    expect(container.querySelector(".manual-entry-error")).toBeNull();
  });

  it("never holds up an import: a lookup still in flight does not delay or disable it", async () => {
    lookupDelayMs = 400;
    const { container } = renderEntry();
    fill(container, ".manual-entry-url", LINKEDIN_URL);
    // A real tap on Import blurs the URL field first, so "paste a link, tap Import" starts both.
    commitUrl(container);
    await waitFor(() => {
      expect(lookupButton(container)).toBeDisabled();
    });
    expect(submitButton(container)).toBeEnabled();

    pressImport(container);
    await importedResult(container);
    // The import did not wait for the lookup, and sent the form as it stood when pressed.
    expect(lookupButton(container)).toBeDisabled();
    expect(createBodies).toEqual([importBody({ url: LINKEDIN_URL })]);
    expect(requests).toEqual(["POST /api/job_posts/lookup", "POST /api/job_posts"]);

    // Rails enriches a URL-only import in the background; the late answer only fills the form.
    await lookupNote(container);
    expect(valueOf(container, ".manual-entry-title")).toBe("MCP/AI Developer");
    expect(container.querySelector(".manual-entry-result")).not.toBeNull();
    expect(createBodies).toHaveLength(1);
  });

  // TestManualEntryLookupSkipsRepeatOfSameURL — Go could only check the recorded URL, because the
  // skip lived in `startLookup`, which its test could not reach.
  it("does not reread a URL it already read unless Look up details is pressed", async () => {
    const { container } = renderEntry();
    fill(container, ".manual-entry-url", LINKEDIN_URL);
    commitUrl(container);
    await lookupNote(container);

    commitUrl(container);
    await delay(50);
    expect(lookupBodies).toHaveLength(1);

    fireEvent.click(lookupButton(container));
    await waitFor(() => {
      expect(lookupBodies).toHaveLength(2);
    });
    await waitFor(() => {
      expect(lookupButton(container)).toBeEnabled();
    });

    fill(container, ".manual-entry-url", "https://www.linkedin.com/jobs/view/1");
    commitUrl(container);
    await waitFor(() => {
      expect(lookupBodies).toEqual([
        { url: LINKEDIN_URL },
        { url: LINKEDIN_URL },
        { url: "https://www.linkedin.com/jobs/view/1" },
      ]);
    });
  });

  it("never looks up without a URL", async () => {
    const { container } = renderEntry();
    expect(lookupButton(container)).toBeDisabled();
    commitUrl(container);
    await delay(50);
    expect(requests).toEqual([]);

    fill(container, ".manual-entry-url", LINKEDIN_URL);
    expect(lookupButton(container)).toBeEnabled();
  });
});
