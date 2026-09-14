/**
 * Profile screen parity (`FE-25`).
 *
 * Transcribed from `TestProfileRendersFieldsAndPresenceFlags`, `TestResumeStatusClass`,
 * `TestProfileNoResume`, `TestProfileLoadError`, `TestEditFromProfileSeedsEditableFields`,
 * `TestProfileSaveWritesViaAPI`, `TestProfileSaveError`, `TestProfileSaveUnauthorized`,
 * `TestPresenceLabel`, and `TestSaveButtonLabel` in `web/components/profile_test.go`. Go could not
 * submit a form from a test, so it hand-set `p.edit` and called `doSave` directly; here the owner
 * types, presses Save, and the body asserted is the one Rails received.
 *
 * The fake Rails records every request, which is how "nothing writes on render" and "no sensitive
 * value is ever requested or sent" are asserted about the network rather than about the markup.
 * Nothing here can prompt for notification permission or send a push: the browser side is a mocked
 * `PushSubscriber`.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import type { MutationStatus } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { delay } from "msw";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { queryKeys } from "../../api/keys";
import { createQueryClient } from "../../api/query-client";
import type { Profile, PushSubscription, ResumeSummary } from "../../api/schemas";
import { SIGN_OUT_ERROR } from "../../lib/auth";
import { SESSION_EXPIRED } from "../../lib/messages";
import type { PlatformSignals, PushGate } from "../../lib/platform";
import {
  PROFILE_FIELDS,
  editFromProfile,
  presenceLabel,
  resumeFileLabel,
  resumeStatusClass,
  saveButtonLabel,
  showInstallGuide,
} from "../../lib/profile";
import type { PushSubscriber } from "../../lib/push";
import { HttpResponse, http, installMockApi } from "../../test/msw";
import { ProfileScreen } from "./profile";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const ADA_RESUME: ResumeSummary = {
  title: "Ada Lovelace — Resume",
  parse_status: "parsed",
  file_attached: true,
  filename: "cv.pdf",
};

/** Go's `sampleProfile()`. */
const ADA: Profile = {
  full_name: "Ada Lovelace",
  headline: "Platform Engineer",
  summary: "Builds reliable systems.",
  location: "London",
  linkedin_url: "https://linkedin.com/in/ada",
  github_url: "https://github.com/ada",
  portfolio_url: "https://ada.dev",
  contact: { email_present: true, phone_present: false, street_address_present: true },
  resume: ADA_RESUME,
};

/** Raw encrypted values a leaky serializer might send. None may ever reach the screen. */
const RAW_EMAIL = "ada@example.com";
const RAW_PHONE = "+44 20 7946 0018";
const RAW_ADDRESS = "12 St James Square";

const LOAD_FAILED = "Could not load data. Please try again.";
const SAVE_FAILED = "Could not save your profile. Please try again.";

const VAPID_KEY = "BFakePublicVapidKeyForTestsOnly";
const SUBSCRIPTION: PushSubscription = {
  endpoint: "https://push.example/abc",
  keys: { p256dh: "p256dh-key", auth: "auth-key" },
};

const DESKTOP_PUSH: PlatformSignals = {
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0",
  maxTouchPoints: 0,
  navigatorStandalone: false,
  displayModeStandalone: false,
  pushApiAvailable: true,
};
const DESKTOP_NO_PUSH: PlatformSignals = { ...DESKTOP_PUSH, pushApiAvailable: false };
/** Safari on an iPhone running iOS 17, opened as a tab: the Push API is hidden until install. */
const IOS_TAB: PlatformSignals = {
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15",
  maxTouchPoints: 5,
  navigatorStandalone: false,
  displayModeStandalone: false,
  pushApiAvailable: false,
};
const IOS_INSTALLED: PlatformSignals = {
  ...IOS_TAB,
  navigatorStandalone: true,
  pushApiAvailable: true,
};
const IOS_TOO_OLD: PlatformSignals = {
  ...IOS_TAB,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15",
};

/* -------------------------------------------------------------------------- */
/* Fake Rails                                                                  */
/* -------------------------------------------------------------------------- */

/** Every request the screen sent, as `METHOD /path?query`, in order. */
let requests: string[] = [];
/** The profile Rails holds. */
let stored: Profile = ADA;
/** Every `PATCH /api/profile` body. */
let patchBodies: unknown[] = [];
/** Every `POST /api/push_subscription` body. */
let pushPosts: unknown[] = [];
/** What Rails stores differently from what it was sent, applied after the edit. */
let storeAs: Partial<Profile> = {};
/** Adds raw encrypted values to every profile Rails answers with. */
let leakRawPii = false;
/** Set to a status to fail the profile read. */
let failReadWith: number | null = null;
/** Set to fail the save with Rails' envelope. */
let failSaveWith: { status: number; code: string; message: string } | null = null;
/** Held open so an in-flight save lasts long enough for `waitFor` to observe it. */
let saveDelayMs = 0;
/** Set to a status to fail `DELETE /api/session`. */
let failSignOutWith: number | null = null;

/** `profile_payload`, including the keys Rails sends that no screen reads. */
function serialized(profile: Profile) {
  return {
    ...profile,
    work_history: [],
    education: [],
    skills: [],
    resume:
      profile.resume === null ? null : { ...profile.resume, parsed_at: "2026-09-01T10:00:00Z" },
    ...(leakRawPii ? { email: RAW_EMAIL, phone: RAW_PHONE, street_address: RAW_ADDRESS } : {}),
  };
}

const server = installMockApi(
  http.get("/api/profile", () => {
    if (failReadWith !== null) {
      return HttpResponse.json(
        { error: { code: "not_found", message: "Profile not found" } },
        { status: failReadWith },
      );
    }
    return HttpResponse.json({ profile: serialized(stored) });
  }),
  http.patch("/api/profile", async ({ request }) => {
    const body = (await request.json()) as { profile: Partial<Profile> };
    patchBodies.push(body);
    if (saveDelayMs > 0) await delay(saveDelayMs);
    if (failSaveWith !== null) {
      return HttpResponse.json(
        { error: { code: failSaveWith.code, message: failSaveWith.message } },
        { status: failSaveWith.status },
      );
    }
    stored = { ...stored, ...body.profile, ...storeAs };
    return HttpResponse.json({ profile: serialized(stored) });
  }),
  http.get("/api/push/vapid_public_key", () => HttpResponse.json({ vapid_public_key: VAPID_KEY })),
  http.post("/api/push_subscription", async ({ request }) => {
    pushPosts.push(await request.json());
    return new HttpResponse(null, { status: 204 });
  }),
  http.delete("/api/push_subscription", () => new HttpResponse(null, { status: 204 })),
  http.delete("/api/session", () =>
    failSignOutWith === null
      ? new HttpResponse(null, { status: 204 })
      : HttpResponse.json(
          { error: { code: "internal_error", message: "boom" } },
          { status: failSignOutWith },
        ),
  ),
);

beforeEach(() => {
  requests = [];
  stored = ADA;
  patchBodies = [];
  pushPosts = [];
  storeAs = {};
  leakRawPii = false;
  failReadWith = null;
  failSaveWith = null;
  saveDelayMs = 0;
  failSignOutWith = null;
  server.events.on("request:start", ({ request }) => {
    const url = new URL(request.url);
    requests.push(`${request.method} ${url.pathname}${url.search}`);
  });
});

afterEach(() => {
  server.events.removeAllListeners();
});

/* -------------------------------------------------------------------------- */
/* Harness                                                                     */
/* -------------------------------------------------------------------------- */

/** A `PushSubscriber` over a fake PushManager, counting what the browser was asked to do. */
interface MockPusher extends PushSubscriber {
  subscribeCalls: number;
  unsubscribeCalls: number;
}

function mockPusher(supported = true): MockPusher {
  const pusher: MockPusher = {
    subscribeCalls: 0,
    unsubscribeCalls: 0,
    supported: () => supported,
    currentEndpoint: () => Promise.resolve(""),
    subscribe: () => {
      pusher.subscribeCalls += 1;
      return Promise.resolve(SUBSCRIPTION);
    },
    unsubscribe: () => {
      pusher.unsubscribeCalls += 1;
      return Promise.resolve();
    },
  };
  return pusher;
}

/** Where a navigation away from the profile landed. */
function Landed() {
  return <p data-testid="landed">{useLocation().pathname}</p>;
}

function renderProfile({
  subscriber = mockPusher(),
  signals = DESKTOP_PUSH,
}: { subscriber?: MockPusher; signals?: PlatformSignals } = {}) {
  const client = createQueryClient();
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/profile"]}>
        <Routes>
          <Route
            path="/profile"
            element={<ProfileScreen subscriber={subscriber} signals={signals} />}
          />
          <Route path="*" element={<Landed />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, client, subscriber };
}

/** Renders and waits for the loaded body. */
async function loadedProfile(options?: { subscriber?: MockPusher; signals?: PlatformSignals }) {
  const view = renderProfile(options);
  await waitFor(() => {
    expect(view.container.querySelector(".profile-body")).not.toBeNull();
  });
  return view;
}

function requireElement<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (found === null) throw new Error(`no ${selector} rendered`);
  return found;
}

function input(container: HTMLElement, selector: string): HTMLInputElement {
  return requireElement<HTMLInputElement>(container, `.profile-form ${selector}`);
}

function fill(container: HTMLElement, selector: string, value: string) {
  fireEvent.change(input(container, selector), { target: { value } });
}

function saveButton(container: HTMLElement): HTMLButtonElement {
  return requireElement<HTMLButtonElement>(container, ".profile-save");
}

function childClasses(container: HTMLElement, selector: string): string[] {
  return Array.from(requireElement(container, selector).children).map((child) => child.className);
}

function contactRows(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll(".profile-contact ul > li.profile-contact-row")).map(
    (row) => row.textContent,
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

describe("profile helpers", () => {
  it("lists the seven editable fields in Render's order, with Go's labels and input classes", () => {
    // Transcribed from the seven `textField` calls in `ProfileView.Render`.
    expect(PROFILE_FIELDS.map(({ label, className, field }) => [label, className, field])).toEqual([
      ["Full name", "profile-full-name", "full_name"],
      ["Headline", "profile-headline", "headline"],
      ["Summary", "profile-summary", "summary"],
      ["Location", "profile-location", "location"],
      ["LinkedIn URL", "profile-linkedin", "linkedin_url"],
      ["GitHub URL", "profile-github", "github_url"],
      ["Portfolio URL", "profile-portfolio", "portfolio_url"],
    ]);
  });

  it("seeds exactly the seven editable fields, so nothing else a read carries can be sent", () => {
    // TestEditFromProfileSeedsEditableFields, plus the half Go could not state: a raw value on
    // the read does not ride along into the edit.
    const leaky = {
      ...ADA,
      email: RAW_EMAIL,
      phone: RAW_PHONE,
      street_address: RAW_ADDRESS,
    } as Profile;

    expect(editFromProfile(leaky)).toEqual({
      full_name: "Ada Lovelace",
      headline: "Platform Engineer",
      summary: "Builds reliable systems.",
      location: "London",
      linkedin_url: "https://linkedin.com/in/ada",
      github_url: "https://github.com/ada",
      portfolio_url: "https://ada.dev",
    });
  });

  // TestPresenceLabel.
  it.each([
    [true, "set"],
    [false, "not set"],
  ])("presenceLabel(%s) is %j", (present, expected) => {
    expect(presenceLabel(present)).toBe(expected);
  });

  // TestResumeStatusClass, plus the neutral fallback for values Go's comment promised.
  it.each([
    ["parsed", "profile-resume-status-parsed"],
    ["pending", "profile-resume-status-pending"],
    ["", "profile-resume-status-pending"],
    ["failed", "profile-resume-status-pending"],
  ])("resumeStatusClass(%j) is %j", (status, expected) => {
    expect(resumeStatusClass(status)).toBe(expected);
  });

  it.each([
    [true, "cv.pdf", "cv.pdf"],
    [true, "", "attached"],
    [false, "cv.pdf", "not attached"],
    [false, "", "not attached"],
  ])("resumeFileLabel(attached=%s, filename=%j) is %j", (attached, filename, expected) => {
    expect(resumeFileLabel({ file_attached: attached, filename })).toBe(expected);
  });

  // TestSaveButtonLabel, with Go's four saveState values as the mutation's four statuses.
  it.each<[MutationStatus, string]>([
    ["idle", "Save profile"],
    ["pending", "Saving…"],
    ["success", "Saved"],
    ["error", "Save profile"],
  ])("saveButtonLabel(%j) is %j", (status, expected) => {
    expect(saveButtonLabel(status)).toBe(expected);
  });

  it.each<[PushGate, boolean]>([
    ["needs-install", true],
    ["upgrade-ios", true],
    ["ready-to-request", false],
    ["unsupported", false],
  ])("showInstallGuide(%j) is %s", (gate, expected) => {
    expect(showInstallGuide(gate)).toBe(expected);
  });
});

/* -------------------------------------------------------------------------- */
/* Render                                                                      */
/* -------------------------------------------------------------------------- */

describe("profile screen", () => {
  it("renders the chrome first, then the heading, with Loading… until the profile arrives", async () => {
    const { container } = renderProfile();
    const root = requireElement(container, ".profile");

    // The chrome renders inside the page container and before its content (`FE-08`).
    expect(root.firstElementChild).toHaveClass("app-chrome");
    expect(root.children[1]?.tagName).toBe("H1");
    expect(root.children[1]).toHaveTextContent("Profile");
    expect(root.querySelector(".loading")).not.toBeNull();

    await waitFor(() => {
      expect(root.querySelector(".profile-body")).not.toBeNull();
    });
    expect(root.querySelector(".loading")).toBeNull();
  });

  it("renders a profile with a resume: the fields, the presence flags, and the resume list", async () => {
    // TestProfileRendersFieldsAndPresenceFlags.
    const { container } = await loadedProfile();

    // Go's `.profile-body` children in order, then the sign-out it never had.
    expect(childClasses(container, ".profile-body")).toEqual([
      "profile-form",
      "profile-contact",
      "profile-resume",
      "push-toggle",
      "profile-session",
    ]);

    const fields = Array.from(container.querySelectorAll(".profile-form > label.profile-field"));
    expect(
      fields.map((field) => {
        const control = field.querySelector("input");
        return [
          field.querySelector(".profile-field-label")?.textContent,
          control?.className,
          control?.getAttribute("type"),
          control?.value,
        ];
      }),
    ).toEqual([
      ["Full name", "profile-full-name", "text", "Ada Lovelace"],
      ["Headline", "profile-headline", "text", "Platform Engineer"],
      ["Summary", "profile-summary", "text", "Builds reliable systems."],
      ["Location", "profile-location", "text", "London"],
      ["LinkedIn URL", "profile-linkedin", "text", "https://linkedin.com/in/ada"],
      ["GitHub URL", "profile-github", "text", "https://github.com/ada"],
      ["Portfolio URL", "profile-portfolio", "text", "https://ada.dev"],
    ]);

    const save = saveButton(container);
    expect(save.parentElement).toHaveClass("profile-form");
    expect(save).toHaveAttribute("type", "submit");
    expect(save).toHaveTextContent("Save profile");
    expect(save).toBeEnabled();
    expect(container.querySelector(".profile-save-error")).toBeNull();
    expect(container.querySelector(".profile-save-ok")).toBeNull();

    const contact = requireElement(container, ".profile-contact");
    expect(contact.querySelector("h2")).toHaveTextContent("Contact details");
    expect(contact.querySelector(".profile-contact-note")?.textContent).toBe(
      "Contact details are encrypted at rest and shown only as set/not set.",
    );
    expect(contactRows(container)).toEqual(["Email: set", "Phone: not set", "Street address: set"]);

    const resume = requireElement(container, ".profile-resume");
    expect(resume.querySelector("h2")).toHaveTextContent("Resume");
    expect(resume.querySelector(".profile-resume-empty")).toBeNull();
    const items = Array.from(resume.querySelectorAll("ul.profile-resume-meta > li"));
    expect(items.map((item) => item.className)).toEqual([
      "profile-resume-title",
      "profile-resume-status-row",
      "profile-resume-file",
    ]);
    expect(items[0]?.textContent).toBe("Title: Ada Lovelace — Resume");
    expect(
      Array.from(items[1]?.children ?? []).map((span) => [
        span.tagName,
        span.className,
        span.textContent,
      ]),
    ).toEqual([
      ["SPAN", "", "Parse status: "],
      ["SPAN", "profile-resume-status profile-resume-status-parsed", "parsed"],
    ]);
    expect(items[2]?.textContent).toBe("File: cv.pdf");
  });

  it("renders a profile without a resume as the empty state", async () => {
    // TestProfileNoResume.
    stored = { ...ADA, resume: null };
    const { container } = await loadedProfile();

    const resume = requireElement(container, ".profile-resume");
    expect(resume.querySelector("h2")).toHaveTextContent("Resume");
    expect(resume.querySelector(".profile-resume-empty")?.textContent).toBe(
      "No resume ingested yet. It syncs from the portfolio export pipeline.",
    );
    expect(resume.querySelector(".profile-resume-meta")).toBeNull();
    // The rest of the screen is unaffected.
    expect(input(container, ".profile-full-name").value).toBe("Ada Lovelace");
    expect(contactRows(container)).toHaveLength(3);
  });

  it.each([
    [
      "a pending resume with an unnamed file",
      { parse_status: "pending", file_attached: true, filename: "" },
      "profile-resume-status-pending",
      "File: attached",
    ],
    [
      "a parsed resume with no file attached",
      { parse_status: "parsed", file_attached: false, filename: "cv.pdf" },
      "profile-resume-status-parsed",
      "File: not attached",
    ],
  ])("renders %s", async (_, overrides, statusClass, fileLabel) => {
    stored = { ...ADA, resume: { ...ADA_RESUME, ...overrides } };
    const { container } = await loadedProfile();

    expect(requireElement(container, ".profile-resume-status")).toHaveClass(statusClass);
    expect(requireElement(container, ".profile-resume-status")).toHaveTextContent(
      overrides.parse_status,
    );
    expect(requireElement(container, ".profile-resume-file").textContent).toBe(fileLabel);
  });

  it("shows the encrypted contact details only as presence flags, and never asks for a value", async () => {
    leakRawPii = true;
    const { container } = await loadedProfile();

    const text = container.textContent;
    for (const raw of [RAW_EMAIL, RAW_PHONE, RAW_ADDRESS]) {
      expect(text).not.toContain(raw);
      for (const control of Array.from(container.querySelectorAll("input"))) {
        expect(control.value).not.toContain(raw);
      }
    }
    // Go's own guard: nothing email-shaped anywhere on the screen.
    expect(text).not.toContain("@");
    // There is no control for any sensitive field at all.
    expect(container.querySelectorAll(".profile-form input")).toHaveLength(7);
    expect(container.querySelector('input[type="email"], input[type="tel"]')).toBeNull();
    expect(contactRows(container)).toEqual(["Email: set", "Phone: not set", "Street address: set"]);
  });

  it("makes only the profile read on render — no save, no subscription, no sign-out", async () => {
    const { container, subscriber } = await loadedProfile();
    await within(requireElement(container, ".push-toggle")).findByRole("button", {
      name: "Turn on notifications",
    });

    expect(requests).toEqual(["GET /api/profile"]);
    expect(patchBodies).toHaveLength(0);
    expect(subscriber.subscribeCalls).toBe(0);
  });

  it.each([
    [404, LOAD_FAILED, false],
    [401, SESSION_EXPIRED, true],
  ])("renders a %i read as the load error, with no form", async (status, message, signIn) => {
    // TestProfileLoadError. 4xx answers are not retried, so the panel lands at once.
    failReadWith = status;
    const { container } = renderProfile();

    await waitFor(() => {
      expect(container.querySelector(".load-error")).not.toBeNull();
    });
    expect(requireElement(container, ".load-error p").textContent).toBe(message);
    expect(container.querySelector(".sign-in-link") !== null).toBe(signIn);
    expect(container.querySelector(".profile-body")).toBeNull();
    expect(container.querySelector(".profile-form")).toBeNull();
  });

  it("keeps what the owner is typing through a background refetch, and through a failed one", async () => {
    const { container, client } = await loadedProfile();
    fill(container, ".profile-summary", "Half-typed summary");

    // A focus refetch that brings new server data updates the read-only sections only.
    stored = { ...ADA, resume: { ...ADA_RESUME, parse_status: "pending" } };
    await act(async () => {
      await client.invalidateQueries({ queryKey: queryKeys.profile() });
    });
    // TanStack v5 notifies observers on a `setTimeout(0)` scheduler, so the re-render lands after
    // the invalidation's promise resolves; wait for it rather than asserting in the same tick.
    await waitFor(() => {
      expect(requireElement(container, ".profile-resume-status")).toHaveClass(
        "profile-resume-status-pending",
      );
    });
    expect(input(container, ".profile-summary").value).toBe("Half-typed summary");

    // A refetch that fails leaves the form, and the typing, on screen.
    failReadWith = 404;
    await act(async () => {
      await client.invalidateQueries({ queryKey: queryKeys.profile() });
    });
    expect(client.getQueryState(queryKeys.profile())?.status).toBe("error");
    // Nothing visible changes by design, so flush the notification tick explicitly before
    // asserting the error re-render kept the body.
    await act(async () => {
      await delay(20);
    });
    expect(container.querySelector(".load-error")).toBeNull();
    expect(input(container, ".profile-summary").value).toBe("Half-typed summary");
  });
});

/* -------------------------------------------------------------------------- */
/* Save                                                                        */
/* -------------------------------------------------------------------------- */

describe("profile save", () => {
  it("writes the seven editable fields through PATCH /api/profile and reseeds from the answer", async () => {
    // TestProfileSaveWritesViaAPI. The read carries raw values here, which proves the write still
    // sends exactly the editable keys — Rails permits `email`, `phone`, and `street_address`.
    leakRawPii = true;
    saveDelayMs = 200;
    // Rails stores its own form of the headline, and reports the phone as set.
    storeAs = {
      headline: "Staff Engineer",
      contact: { ...ADA.contact, phone_present: true },
    };
    const { container, client } = await loadedProfile();

    fill(container, ".profile-headline", "  Staff Engineer  ");
    fireEvent.click(saveButton(container));

    await waitFor(() => {
      expect(saveButton(container)).toHaveTextContent("Saving…");
    });
    expect(saveButton(container)).toBeDisabled();

    await waitFor(() => {
      expect(container.querySelector(".profile-save-ok")?.textContent).toBe("Profile saved.");
    });
    expect(saveButton(container)).toHaveTextContent("Saved");
    expect(saveButton(container)).toBeEnabled();
    expect(container.querySelector(".profile-save-error")).toBeNull();

    // Sent as typed, untrimmed — Rails owns normalization, as it did for the Go client.
    expect(patchBodies).toEqual([
      {
        profile: {
          full_name: "Ada Lovelace",
          headline: "  Staff Engineer  ",
          summary: "Builds reliable systems.",
          location: "London",
          linkedin_url: "https://linkedin.com/in/ada",
          github_url: "https://github.com/ada",
          portfolio_url: "https://ada.dev",
        },
      },
    ]);

    // The form and the read-only sections show what Rails answered.
    expect(input(container, ".profile-headline").value).toBe("Staff Engineer");
    expect(contactRows(container)).toEqual(["Email: set", "Phone: set", "Street address: set"]);
    expect(client.getQueryData(queryKeys.profile())).toMatchObject({ headline: "Staff Engineer" });

    // The answer was written into the cache, not re-read.
    expect(requests).toEqual(["GET /api/profile", "PATCH /api/profile"]);
    expect(container.textContent).not.toContain(RAW_EMAIL);
  });

  it("reports a failed save once, keeps the typed values, and leaves the profile as Rails held it", async () => {
    // TestProfileSaveError.
    failSaveWith = { status: 500, code: "internal_error", message: "boom" };
    const { container, client } = await loadedProfile();

    fill(container, ".profile-full-name", "Augusta Ada King");
    fireEvent.click(saveButton(container));

    await waitFor(() => {
      expect(container.querySelector(".profile-save-error")?.textContent).toBe(SAVE_FAILED);
    });
    expect(container.querySelector(".profile-save-error")?.parentElement).toHaveClass(
      "profile-form",
    );
    expect(saveButton(container)).toHaveTextContent("Save profile");
    expect(saveButton(container)).toBeEnabled();
    expect(container.querySelector(".profile-save-ok")).toBeNull();
    expect(input(container, ".profile-full-name").value).toBe("Augusta Ada King");
    expect(client.getQueryData(queryKeys.profile())).toMatchObject({ full_name: "Ada Lovelace" });
    // A write is never retried.
    expect(patchBodies).toHaveLength(1);
  });

  it.each([
    [
      "a 422 with Rails' sentence",
      422,
      "unprocessable",
      "Full name can't be blank",
      "Full name can't be blank",
    ],
    ["a 422 without a sentence", 422, "unprocessable", "", SAVE_FAILED],
    ["a 500 carrying a raw message", 500, "internal_error", "boom", SAVE_FAILED],
    ["a 403", 403, "forbidden", "Forbidden", SAVE_FAILED],
    ["a 401", 401, "unauthorized", "Unauthorized", SESSION_EXPIRED],
  ])("reports %s", async (_, status, code, message, expected) => {
    // TestProfileSaveUnauthorized is the 401 row.
    failSaveWith = { status, code, message };
    const { container } = await loadedProfile();

    fill(container, ".profile-full-name", "");
    fireEvent.click(saveButton(container));

    await waitFor(() => {
      expect(container.querySelector(".profile-save-error")?.textContent).toBe(expected);
    });
    expect(patchBodies).toEqual([{ profile: expect.objectContaining({ full_name: "" }) }]);
  });
});

/* -------------------------------------------------------------------------- */
/* Push, install guide, sign-out                                               */
/* -------------------------------------------------------------------------- */

describe("profile notifications and session", () => {
  it("embeds a working push toggle that never submits the profile form", async () => {
    const { container, subscriber } = await loadedProfile();
    const toggle = requireElement(container, ".profile-body > .push-toggle");

    fireEvent.click(within(toggle).getByRole("button", { name: "Turn on notifications" }));
    expect(await within(toggle).findByText("On")).toHaveClass("push-toggle-status-on");
    expect(subscriber.subscribeCalls).toBe(1);
    expect(pushPosts).toEqual([{ subscription: SUBSCRIPTION }]);

    fireEvent.click(within(toggle).getByRole("button", { name: "Turn off notifications" }));
    await within(toggle).findByRole("button", { name: "Turn on notifications" });
    expect(subscriber.unsubscribeCalls).toBe(1);

    expect(requests).toEqual([
      "GET /api/profile",
      "GET /api/push/vapid_public_key",
      "POST /api/push_subscription",
      "DELETE /api/push_subscription",
    ]);
    expect(patchBodies).toHaveLength(0);
  });

  it.each([
    ["an iPhone Safari tab", IOS_TAB, "Add Waunder to your Home Screen to enable notifications:"],
    [
      "an iPhone too old for Web Push",
      IOS_TOO_OLD,
      "Update to iOS 16.4 or later to receive notifications.",
    ],
  ])("mounts the install guide after the toggle on %s", async (_, signals, sentence) => {
    const { container } = await loadedProfile({ signals, subscriber: mockPusher(false) });

    expect(childClasses(container, ".profile-body")).toEqual([
      "profile-form",
      "profile-contact",
      "profile-resume",
      "push-toggle",
      "install-guide",
      "profile-session",
    ]);
    expect(requireElement(container, ".install-guide p").textContent).toBe(sentence);
    // The guide's steps are reading only: nothing is requested for them.
    expect(requests).toEqual(["GET /api/profile"]);
  });

  it.each([
    ["an installed iPhone", IOS_INSTALLED],
    ["a desktop browser with push", DESKTOP_PUSH],
    ["a browser without push", DESKTOP_NO_PUSH],
  ])("leaves the install guide out on %s, where the toggle already answers", async (_, signals) => {
    const { container } = await loadedProfile({ signals });

    expect(container.querySelector(".install-guide")).toBeNull();
    expect(container.querySelector(".push-toggle")).not.toBeNull();
  });

  it("signs out through DELETE /api/session and lands on the login screen", async () => {
    const { container } = await loadedProfile();
    const button = within(requireElement(container, ".profile-session")).getByRole("button", {
      name: "Sign out",
    });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveClass("profile-sign-out");

    fireEvent.click(button);

    expect(await screen.findByTestId("landed")).toHaveTextContent("/login");
    expect(requests).toEqual(["GET /api/profile", "DELETE /api/session"]);
    expect(patchBodies).toHaveLength(0);
  });

  it("reports a failed sign-out and stays on the profile", async () => {
    failSignOutWith = 500;
    const { container } = await loadedProfile();

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => {
      expect(container.querySelector(".profile-sign-out-error")?.textContent).toBe(SIGN_OUT_ERROR);
    });
    expect(screen.queryByTestId("landed")).toBeNull();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled();
  });
});
