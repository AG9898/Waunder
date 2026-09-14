/**
 * Contacts and outreach parity (`FE-21`).
 *
 * Transcribed from `TestContactsRendersCandidates`, `TestContactsFetchesByJobID`,
 * `TestContactsEmpty`, `TestContactsLoadError`, `TestContactsLoadUnauthorized`,
 * `TestContactsDoesNotGenerateOnMount`, `TestContactsNoSendAffordance`,
 * `TestContactsGenerateDraft`, `TestContactsGenerateRendersDraft`,
 * `TestContactsGenerateServiceUnavailable`, `TestContactsGenerateUnauthorized`,
 * `TestContactsGenerateGenericError`, `TestContactRole`, and `TestGenerateButtonLabel` in
 * `web/components/contacts_test.go`, with what the port makes possible. Go could not invoke an
 * `OnClick`, so it drove `doGenerate` directly and then hand-set `genFor(11).draft` to get a
 * message on screen — its "renders the draft" test rendered text the mock never returned. Here
 * the button is pressed and the draft on screen is the one Rails answered with.
 *
 * The fake Rails records every request the screen sends, which is how "this screen never
 * messages anyone" is asserted about the network, not only about the markup.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { delay } from "msw";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createQueryClient } from "../../api/query-client";
import type { ContactCandidate } from "../../api/schemas";
import {
  EMPTY_CONTACT_FIELDS,
  canSaveContact,
  contactInput,
  contactRole,
  contactsBackHref,
  outreachButtonLabel,
} from "../../lib/contacts";
import { SESSION_EXPIRED } from "../../lib/messages";
import { HttpResponse, http, installMockApi } from "../../test/msw";
import { ContactsScreen } from "./contacts";

const ADA: ContactCandidate = {
  id: 11,
  job_post_id: 7,
  name: "Ada Lovelace",
  title: "Engineering Manager",
  company_name: "Acme",
  linkedin_url: "https://www.linkedin.com/in/ada",
  relevance_reason: "Owns the platform team this role joins.",
};

const GRACE: ContactCandidate = {
  id: 12,
  job_post_id: 7,
  name: "Grace Hopper",
  title: "",
  company_name: "",
  linkedin_url: "",
  relevance_reason: "Referred by a former colleague.",
};

const ADA_DRAFT = "Hi Ada, I admire your platform work.";
const OUTREACH_UNAVAILABLE = "Outreach drafting is not configured right now.";
const OUTREACH_FAILED = "Could not generate a draft. Please try again.";

/** Every request the screen sent, as `METHOD /path`, in order. */
let requests: string[] = [];
/** What `GET .../contact_candidates` answers with. Rails orders newest first. */
let stored: ContactCandidate[] = [];
/** Every outreach `POST`, with the candidate id from its path. */
let outreachBodies: { candidateId: string; body: unknown }[] = [];
/** Every contact-create `POST` body. */
let createBodies: unknown[] = [];

/** Set to a status to fail the list read. */
let failReadWith: number | null = null;
/** Set to fail outreach generation with Rails' envelope. */
let failGenerateWith: { status: number; code: string } | null = null;
/** Set to fail the contact save with Rails' envelope. */
let failCreateWith: { status: number; code: string; message: string } | null = null;
/** Held open so an in-flight generation lasts long enough for `waitFor` to observe it. */
let generateDelayMs = 0;
/** Overrides the drafted message for every candidate. */
let draftOverride: string | null = null;

const server = installMockApi(
  http.get("/api/job_posts/:id/contact_candidates", ({ params }) => {
    if (failReadWith !== null) {
      return HttpResponse.json(
        { error: { code: "not_found", message: "JobPost not found" } },
        { status: failReadWith },
      );
    }
    return HttpResponse.json({
      contact_candidates: stored.map((contact) => ({ ...contact, job_post_id: Number(params.id) })),
    });
  }),
  http.post("/api/job_posts/:id/contact_candidates", async ({ params, request }) => {
    const body = (await request.json()) as { contact_candidate?: Partial<ContactCandidate> };
    createBodies.push(body);
    if (failCreateWith !== null) {
      return HttpResponse.json(
        { error: { code: failCreateWith.code, message: failCreateWith.message } },
        { status: failCreateWith.status },
      );
    }
    const created: ContactCandidate = {
      name: "",
      title: "",
      company_name: "",
      linkedin_url: "",
      relevance_reason: "",
      ...body.contact_candidate,
      id: 13,
      job_post_id: Number(params.id),
    };
    // Newest first, as `ContactCandidatesController#index` orders: every existing contact moves
    // down one slot, which is what tests the per-candidate state is keyed by id, not by index.
    stored = [created, ...stored];
    return HttpResponse.json({ contact_candidate: created }, { status: 201 });
  }),
  http.post("/api/contact_candidates/:id/outreach_drafts", async ({ params, request }) => {
    const candidateId = String(params.id);
    outreachBodies.push({ candidateId, body: await request.json() });
    if (generateDelayMs > 0) await delay(generateDelayMs);
    if (failGenerateWith !== null) {
      return HttpResponse.json(
        { error: { code: failGenerateWith.code, message: "Outreach generation failed" } },
        { status: failGenerateWith.status },
      );
    }
    const message = draftOverride ?? (candidateId === "11" ? ADA_DRAFT : "Hi, a quick note.");
    return HttpResponse.json(
      {
        outreach_draft: {
          id: 5,
          contact_candidate_id: Number(candidateId),
          message,
          loose_template: "",
        },
      },
      { status: 201 },
    );
  }),
);

beforeEach(() => {
  requests = [];
  stored = [ADA, GRACE];
  outreachBodies = [];
  createBodies = [];
  failReadWith = null;
  failGenerateWith = null;
  failCreateWith = null;
  generateDelayMs = 0;
  draftOverride = null;
  server.events.on("request:start", ({ request }) => {
    requests.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});

afterEach(() => {
  server.events.removeAllListeners();
  vi.unstubAllGlobals();
});

function renderContacts(path = "/jobs/7/contacts") {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/jobs/:id/contacts" element={<ContactsScreen />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Renders and waits for the loaded body, which always ends in the create form. */
async function loadedContacts(path = "/jobs/7/contacts") {
  const view = renderContacts(path);
  await waitFor(() => {
    expect(view.container.querySelector(".contact-create")).not.toBeNull();
  });
  return view;
}

function requireElement<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (found === null) throw new Error(`no ${selector} rendered`);
  return found;
}

/** The `li.contact` whose name is `name`. Re-query after a refetch: the list can reorder. */
function contactItem(container: HTMLElement, name: string): HTMLElement {
  const item = Array.from(container.querySelectorAll<HTMLElement>("li.contact")).find(
    (node) => node.querySelector(".contact-name")?.textContent === name,
  );
  if (item === undefined) throw new Error(`no contact named ${name}`);
  return item;
}

function generateButton(item: HTMLElement): HTMLButtonElement {
  return requireElement<HTMLButtonElement>(item, ".contact-outreach-generate");
}

function fill(container: HTMLElement, selector: string, value: string) {
  fireEvent.change(requireElement(container, selector), { target: { value } });
}

/** Presses Generate for `name` and waits for the drafted message to land in that candidate. */
async function generateFor(container: HTMLElement, name: string) {
  fireEvent.click(generateButton(contactItem(container, name)));
  await waitFor(() => {
    expect(contactItem(container, name).querySelector(".contact-outreach-message")).not.toBeNull();
  });
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

describe("contacts helpers", () => {
  // TestContactRole.
  it.each([
    [{ title: "EM", company_name: "Acme" }, "EM at Acme"],
    [{ title: "EM", company_name: "" }, "EM"],
    [{ title: "", company_name: "Acme" }, "Acme"],
    [{ title: "", company_name: "" }, ""],
  ])("contactRole(%o) is %j", (contact, expected) => {
    expect(contactRole(contact)).toBe(expected);
  });

  // TestGenerateButtonLabel, plus the in-flight regenerate Go folded into `generateRunning`.
  it.each([
    [false, false, "Generate draft"],
    [true, false, "Generating…"],
    [true, true, "Generating…"],
    [false, true, "Regenerate draft"],
  ])("outreachButtonLabel(pending=%s, hasDraft=%s) is %j", (pending, hasDraft, expected) => {
    expect(outreachButtonLabel(pending, hasDraft)).toBe(expected);
  });

  it("points the back link at the posting, or at the feed when the path held no id", () => {
    expect(contactsBackHref(42)).toBe("/jobs/42");
    expect(contactsBackHref(0)).toBe("/jobs");
  });

  it("requires a name and a relevance reason, and a blank-looking value does not count", () => {
    expect(canSaveContact(EMPTY_CONTACT_FIELDS)).toBe(false);
    expect(canSaveContact({ ...EMPTY_CONTACT_FIELDS, name: "Dana" })).toBe(false);
    expect(canSaveContact({ ...EMPTY_CONTACT_FIELDS, name: "Dana", relevance_reason: "  " })).toBe(
      false,
    );
    expect(canSaveContact({ ...EMPTY_CONTACT_FIELDS, name: "Dana", relevance_reason: "HM" })).toBe(
      true,
    );
  });

  it("trims every value and omits the blank optional fields rather than sending them empty", () => {
    const input = contactInput({
      name: "  Dana Lee ",
      title: " Recruiter ",
      company_name: "   ",
      linkedin_url: "",
      relevance_reason: " Hiring manager ",
    });

    expect(input).toEqual({
      name: "Dana Lee",
      title: "Recruiter",
      relevance_reason: "Hiring manager",
    });
    expect(Object.keys(input)).not.toContain("company_name");
    expect(Object.keys(input)).not.toContain("linkedin_url");
  });
});

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

describe("contacts read", () => {
  // TestContactsRendersCandidates.
  it("renders the chrome, the manual-send note, and every saved candidate", async () => {
    const { container } = await loadedContacts();

    const view = requireElement(container, ".contacts-view");
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    const back = requireElement<HTMLAnchorElement>(view, ".contacts-back");
    expect(view.contains(nav)).toBe(true);
    // The chrome renders inside the page container and before its content (`FE-08`).
    expect(nav.compareDocumentPosition(back) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(back).toHaveTextContent("← Job");
    expect(back).toHaveAttribute("href", "/jobs/7");
    expect(requireElement(view, ".contacts-title")).toHaveTextContent("Contacts");
    expect(requireElement(view, ".contacts-note").textContent).toBe(
      "Outreach drafts are prefilled for manual sending only. Copy a draft and send it yourself — Waunder never sends messages for you.",
    );

    const ada = contactItem(container, "Ada Lovelace");
    expect(requireElement(ada, ".contact-role")).toHaveTextContent("Engineering Manager at Acme");
    expect(requireElement(ada, ".contact-relevance")).toHaveTextContent(ADA.relevance_reason);
    const linkedIn = within(ada).getByRole("link", { name: "LinkedIn profile" });
    expect(linkedIn).toHaveAttribute("href", ADA.linkedin_url);
    expect(linkedIn).toHaveAttribute("target", "_blank");
    expect(linkedIn).toHaveAttribute("rel", "noopener noreferrer");
    expect(generateButton(ada)).toHaveTextContent("Generate draft");

    // A candidate with no title, company, or profile renders none of those lines.
    const grace = contactItem(container, "Grace Hopper");
    expect(grace.querySelector(".contact-role")).toBeNull();
    expect(grace.querySelector(".contact-linkedin")).toBeNull();
    expect(requireElement(grace, ".contact-relevance")).toHaveTextContent(GRACE.relevance_reason);
  });

  // TestContactsFetchesByJobID.
  it("asks Rails for the posting in the path, and for 0 when the path is not an id", async () => {
    const first = await loadedContacts("/jobs/42/contacts");
    expect(requests).toEqual(["GET /api/job_posts/42/contact_candidates"]);
    expect(requireElement(first.container, ".contacts-back")).toHaveAttribute("href", "/jobs/42");
    first.unmount();

    requests = [];
    const { container } = await loadedContacts("/jobs/abc/contacts");
    expect(requests).toEqual(["GET /api/job_posts/0/contact_candidates"]);
    expect(requireElement(container, ".contacts-back")).toHaveAttribute("href", "/jobs");
  });

  it("renders no link for a LinkedIn URL that is not an external http(s) URL", async () => {
    stored = [{ ...ADA, linkedin_url: "javascript:alert(1)" }];
    const { container } = await loadedContacts();

    expect(contactItem(container, "Ada Lovelace").querySelector(".contact-linkedin")).toBeNull();
  });

  // TestContactsEmpty.
  it("renders the empty state and still offers to save a contact", async () => {
    stored = [];
    const { container } = await loadedContacts();

    expect(requireElement(container, ".contacts-empty")).toHaveTextContent("No contacts yet.");
    expect(container.querySelector(".contacts-list")).toBeNull();
    expect(requireElement(container, ".contact-create summary")).toHaveTextContent("Add a contact");
  });

  // TestContactsLoadError.
  it("renders the load error, and no create form, when the read fails", async () => {
    failReadWith = 404;
    const { container } = renderContacts();

    await waitFor(() => {
      expect(container.querySelector(".load-error")).not.toBeNull();
    });
    expect(screen.getByText("Could not load data. Please try again.")).toBeInTheDocument();
    expect(container.querySelector(".contact-create")).toBeNull();
  });

  // TestContactsLoadUnauthorized.
  it("renders the expired-session state with a sign-in link on a 401", async () => {
    failReadWith = 401;
    const { container } = renderContacts();

    await waitFor(() => {
      expect(screen.getByText(SESSION_EXPIRED)).toBeInTheDocument();
    });
    expect(requireElement(container, ".sign-in-link")).toHaveAttribute("href", "/login");
  });
});

/* -------------------------------------------------------------------------- */
/* Safety: manual sending only                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Asserts the rendered output offers nothing that sends or submits: no form, no submit-typed
 * control, no control or link whose text or class names sending or submitting, no `mailto:` /
 * `sms:` / `tel:` / messaging link, and the only words about sending are the two sentences saying
 * Waunder does not.
 */
function assertNoSendAffordance(container: HTMLElement) {
  expect(container.querySelector("form")).toBeNull();
  expect(container.querySelector('input[type="submit"], input[type="image"]')).toBeNull();

  const buttons = Array.from(container.querySelectorAll("button"));
  expect(buttons.length).toBeGreaterThan(0);
  for (const button of buttons) {
    // An untyped <button> defaults to `submit`, so each one must say otherwise.
    expect(button.type).toBe("button");
    const name = `${button.textContent ?? ""} ${button.getAttribute("aria-label") ?? ""}`;
    expect(name).not.toMatch(/send|submit/i);
  }

  for (const link of Array.from(container.querySelectorAll("a"))) {
    const href = link.getAttribute("href") ?? "";
    expect(href).not.toMatch(/^(mailto|sms|tel):/i);
    expect(href).not.toMatch(/messaging|compose|send/i);
    expect(link.textContent ?? "").not.toMatch(/send|submit/i);
  }

  // Go's test forbade a `contact-outreach-send` class; no class may name either action.
  for (const node of Array.from(container.querySelectorAll("[class]"))) {
    expect(node.getAttribute("class")).not.toMatch(/send|submit/i);
  }

  const mentions = Array.from(container.querySelectorAll("*")).filter(
    (node) => node.children.length === 0 && /send/i.test(node.textContent ?? ""),
  );
  expect(mentions.length).toBeGreaterThan(0);
  for (const node of mentions) {
    expect(["contacts-note", "contact-outreach-manual"]).toContain(node.getAttribute("class"));
  }
}

describe("manual sending only", () => {
  // TestContactsDoesNotGenerateOnMount: generating spends OpenRouter budget, and saving writes a
  // row. Opening the screen may do neither.
  it("makes no write at all after a plain render", async () => {
    await loadedContacts();

    expect(outreachBodies).toEqual([]);
    expect(createBodies).toEqual([]);
    expect(requests).toEqual(["GET /api/job_posts/7/contact_candidates"]);
  });

  // TestContactsNoSendAffordance, strengthened: the rendered output is checked both before and
  // after a draft exists, and the network is checked too.
  it("offers no send or submit affordance anywhere, before or after a draft is generated", async () => {
    const { container } = await loadedContacts();
    assertNoSendAffordance(container);

    await generateFor(container, "Ada Lovelace");
    assertNoSendAffordance(container);

    // Across the whole interaction nothing left the screen but the read and the one draft.
    expect(requests).toEqual([
      "GET /api/job_posts/7/contact_candidates",
      "POST /api/contact_candidates/11/outreach_drafts",
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* Outreach generation                                                         */
/* -------------------------------------------------------------------------- */

describe("outreach generation", () => {
  // TestContactsGenerateDraft + TestContactsGenerateRendersDraft.
  it("drafts for the candidate clicked, from the template typed, for manual copying", async () => {
    const { container } = await loadedContacts();
    fill(contactItem(container, "Ada Lovelace"), ".contact-outreach-template", "Keep it short.");

    await generateFor(container, "Ada Lovelace");

    expect(outreachBodies).toEqual([
      { candidateId: "11", body: { outreach_draft: { loose_template: "Keep it short." } } },
    ]);
    const ada = contactItem(container, "Ada Lovelace");
    const message = requireElement<HTMLTextAreaElement>(ada, ".contact-outreach-message");
    expect(message.value).toBe(ADA_DRAFT);
    expect(message.readOnly).toBe(true);
    expect(requireElement(ada, ".contact-outreach-manual").textContent).toBe(
      "Copy this draft and send it manually. Waunder does not send it.",
    );
    expect(generateButton(ada)).toHaveTextContent("Regenerate draft");
    expect(within(ada).getByRole("button", { name: "Copy draft" })).toHaveClass(
      "contact-outreach-copy",
    );

    // The other candidate's panel is its own: no draft, and it still offers to generate.
    const grace = contactItem(container, "Grace Hopper");
    expect(grace.querySelector(".contact-outreach-draft")).toBeNull();
    expect(generateButton(grace)).toHaveTextContent("Generate draft");
  });

  it("keeps each draft on its own candidate when a refetch reorders the list", async () => {
    const { container } = await loadedContacts();
    await generateFor(container, "Ada Lovelace");

    fill(container, ".contact-create-name", "Dana Lee");
    fill(container, ".contact-create-relevance-reason", "Recruiter for the team");
    fireEvent.click(requireElement(container, ".contact-create-save"));
    await waitFor(() => {
      expect(screen.getByText("Contact saved.")).toBeInTheDocument();
    });

    // Dana is listed first now, so Ada moved from slot one to slot two — and her draft with her.
    expect(
      Array.from(container.querySelectorAll(".contact-name")).map((node) => node.textContent),
    ).toEqual(["Dana Lee", "Ada Lovelace", "Grace Hopper"]);
    expect(
      requireElement<HTMLTextAreaElement>(
        contactItem(container, "Ada Lovelace"),
        ".contact-outreach-message",
      ).value,
    ).toBe(ADA_DRAFT);
    expect(contactItem(container, "Dana Lee").querySelector(".contact-outreach-draft")).toBeNull();
    expect(
      contactItem(container, "Grace Hopper").querySelector(".contact-outreach-draft"),
    ).toBeNull();
  });

  // TestContactsGenerateServiceUnavailable + TestContactsGenerateGenericError, on one candidate
  // so the two messages are observed replacing each other.
  it("reports an unconfigured generator and a failed generation as different messages", async () => {
    const { container } = await loadedContacts();

    failGenerateWith = { status: 503, code: "llm_unavailable" };
    fireEvent.click(generateButton(contactItem(container, "Ada Lovelace")));
    await waitFor(() => {
      expect(
        contactItem(container, "Ada Lovelace").querySelector(".contact-outreach-error")
          ?.textContent,
      ).toBe(OUTREACH_UNAVAILABLE);
    });

    failGenerateWith = { status: 502, code: "generation_failed" };
    fireEvent.click(generateButton(contactItem(container, "Ada Lovelace")));
    await waitFor(() => {
      expect(
        contactItem(container, "Ada Lovelace").querySelector(".contact-outreach-error")
          ?.textContent,
      ).toBe(OUTREACH_FAILED);
    });

    // One request per click — a failed write is never retried — and no draft on screen.
    expect(outreachBodies).toHaveLength(2);
    const ada = contactItem(container, "Ada Lovelace");
    expect(ada.querySelector(".contact-outreach-draft")).toBeNull();
    expect(generateButton(ada)).toHaveTextContent("Generate draft");
  });

  // TestContactsGenerateUnauthorized.
  it("reports an expired session as one", async () => {
    failGenerateWith = { status: 401, code: "unauthorized" };
    const { container } = await loadedContacts();

    fireEvent.click(generateButton(contactItem(container, "Ada Lovelace")));

    await waitFor(() => {
      expect(
        contactItem(container, "Ada Lovelace").querySelector(".contact-outreach-error")
          ?.textContent,
      ).toBe(SESSION_EXPIRED);
    });
  });

  it("disables its button while a draft is being generated", async () => {
    generateDelayMs = 200;
    const { container } = await loadedContacts();
    const button = generateButton(contactItem(container, "Ada Lovelace"));

    fireEvent.click(button);
    await waitFor(() => {
      expect(button).toBeDisabled();
    });
    expect(button).toHaveTextContent("Generating…");
    // Only Ada's panel is busy.
    expect(generateButton(contactItem(container, "Grace Hopper"))).toBeEnabled();
    fireEvent.click(button);

    await waitFor(() => {
      expect(button).toBeEnabled();
    });
    expect(outreachBodies).toHaveLength(1);
  });

  it("puts a long unbroken token in a textarea the app.css wrap rule names", async () => {
    // jsdom has no layout. The `p, li, h1, h2, span` reset does not reach a <textarea>, so
    // `app.css` names both outreach textareas in an `overflow-wrap: break-word` rule of their own
    // (AGENTS.md 2026-06-18). What can be pinned is that the rule names them, and that the
    // drafted text lands in an element carrying that class.
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
    expect(wrapSafe).toContain(".contact-outreach-message");
    expect(wrapSafe).toContain(".contact-outreach-template");

    draftOverride = `https://www.linkedin.com/in/${"x".repeat(160)}`;
    const { container } = await loadedContacts();
    await generateFor(container, "Ada Lovelace");

    const ada = contactItem(container, "Ada Lovelace");
    const message = requireElement<HTMLTextAreaElement>(ada, ".contact-outreach-message");
    expect(message.tagName).toBe("TEXTAREA");
    expect(message.value).toBe(draftOverride);
    expect(requireElement(ada, ".contact-outreach-template").tagName).toBe("TEXTAREA");
  });
});

/* -------------------------------------------------------------------------- */
/* Copying                                                                     */
/* -------------------------------------------------------------------------- */

describe("copying a draft", () => {
  it("writes the drafted message to the clipboard and sends nothing", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const { container } = await loadedContacts();
    await generateFor(container, "Ada Lovelace");
    const before = [...requests];

    const ada = contactItem(container, "Ada Lovelace");
    fireEvent.click(within(ada).getByRole("button", { name: "Copy draft" }));

    await waitFor(() => {
      expect(requireElement(ada, ".copy-status").textContent).toBe("Copied.");
    });
    expect(writeText).toHaveBeenCalledExactlyOnceWith(ADA_DRAFT);
    expect(requests).toEqual(before);
  });

  it("tells the owner to copy by hand when the browser has no clipboard", async () => {
    const { container } = await loadedContacts();
    expect(navigator.clipboard).toBeUndefined();
    await generateFor(container, "Ada Lovelace");

    const ada = contactItem(container, "Ada Lovelace");
    fireEvent.click(within(ada).getByRole("button", { name: "Copy draft" }));

    expect(requireElement(ada, ".copy-status").textContent).toBe(
      "Select the text and copy it manually.",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Saving a contact                                                            */
/* -------------------------------------------------------------------------- */

describe("saving a contact", () => {
  it("keeps Save disabled until a name and a relevance reason are given", async () => {
    const { container } = await loadedContacts();
    const save = requireElement<HTMLButtonElement>(container, ".contact-create-save");
    expect(save).toBeDisabled();

    fill(container, ".contact-create-name", "Dana Lee");
    expect(save).toBeDisabled();
    fill(container, ".contact-create-relevance-reason", "   ");
    expect(save).toBeDisabled();
    fill(container, ".contact-create-relevance-reason", "Hiring manager");
    expect(save).toBeEnabled();
  });

  it("posts the trimmed contact without its blank fields, then re-reads the list", async () => {
    const { container } = await loadedContacts();

    fill(container, ".contact-create-name", "  Dana Lee ");
    fill(container, ".contact-create-title", "Recruiter");
    fill(container, ".contact-create-company-name", "   ");
    fill(container, ".contact-create-relevance-reason", " Hiring manager for this team ");
    fireEvent.click(requireElement(container, ".contact-create-save"));

    await waitFor(() => {
      expect(screen.getByText("Contact saved.")).toBeInTheDocument();
    });
    expect(createBodies).toEqual([
      {
        contact_candidate: {
          name: "Dana Lee",
          title: "Recruiter",
          relevance_reason: "Hiring manager for this team",
        },
      },
    ]);
    // Re-read, not spliced in: the list shows what Rails stored, in Rails' order.
    expect(requests).toEqual([
      "GET /api/job_posts/7/contact_candidates",
      "POST /api/job_posts/7/contact_candidates",
      "GET /api/job_posts/7/contact_candidates",
    ]);
    expect(requireElement(contactItem(container, "Dana Lee"), ".contact-role")).toHaveTextContent(
      "Recruiter",
    );
    // The form is blank again, so Save is back to waiting for input.
    expect(requireElement<HTMLInputElement>(container, ".contact-create-name").value).toBe("");
    expect(requireElement(container, ".contact-create-save")).toBeDisabled();
  });

  it("renders Rails' own sentence when it refuses the contact, and keeps what was typed", async () => {
    failCreateWith = {
      status: 422,
      code: "invalid_input",
      message: "Relevance reason can't be blank",
    };
    const { container } = await loadedContacts();

    fill(container, ".contact-create-name", "Dana Lee");
    fill(container, ".contact-create-relevance-reason", "Hiring manager");
    fireEvent.click(requireElement(container, ".contact-create-save"));

    await waitFor(() => {
      expect(requireElement(container, ".contact-create-error").textContent).toBe(
        "Relevance reason can't be blank",
      );
    });
    expect(requireElement<HTMLInputElement>(container, ".contact-create-name").value).toBe(
      "Dana Lee",
    );
    expect(createBodies).toHaveLength(1);
  });

  it.each([
    [401, "unauthorized", SESSION_EXPIRED],
    [500, "server_error", "Could not save the contact. Please try again."],
  ])("reports a %i once, without retrying", async (status, code, expected) => {
    failCreateWith = { status, code, message: "nope" };
    const { container } = await loadedContacts();

    fill(container, ".contact-create-name", "Dana Lee");
    fill(container, ".contact-create-relevance-reason", "Hiring manager");
    fireEvent.click(requireElement(container, ".contact-create-save"));

    await waitFor(() => {
      expect(requireElement(container, ".contact-create-error").textContent).toBe(expected);
    });
    expect(createBodies).toHaveLength(1);
  });
});
