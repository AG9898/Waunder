/**
 * App chrome and layout-preference parity (`FE-08`).
 *
 * Three kinds of assertion live here, because the chrome's behavior is split across three
 * places:
 *
 * - **Markup and navigation** — transcribed from `TestChromeNavigationAndLayout` in
 *   `web/components/chrome_test.go`, plus the active-tab mapping that the Go build encoded
 *   as eight hand-written `renderAppTabs("…")` call sites and this port derives from the
 *   route.
 * - **The stored value** — `waunder.layout` is a preserved contract (docs/GO_MIGRATION.md).
 *   go-app JSON-encoded what it wrote, so the owner's browsers hold `"desktop"` *with*
 *   quotes; the tests below pin both directions against that exact byte value. Until the
 *   `FE-30` cutover the Go build is still production and reads the same key on the same
 *   devices, so a "tidier" unquoted value would silently reset the preference.
 * - **`public/app.css`** — the parts of this feature that are pure CSS are asserted against
 *   the stylesheet itself: Auto's 960px breakpoint must declare *identical* overrides to
 *   explicit Desktop, and the bottom bar must reserve the iPhone safe area. Neither is
 *   observable from the DOM in jsdom, and both fail invisibly (Auto and Desktop drifting
 *   apart on a resize; the last feed row sitting under the nav bar on a notched phone).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LAYOUT_STORAGE_KEY,
  applyLayout,
  normalizeLayout,
  readLayout,
  writeLayout,
} from "../lib/layout";
import { AppChrome } from "./app-chrome";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppChrome />
    </MemoryRouter>,
  );
}

/** Picks the layout preference the way the owner does. */
function chooseLayout(value: string) {
  fireEvent.change(screen.getByLabelText("Layout"), { target: { value } });
}

/** A `Storage` that holds exactly one raw value for the layout key. */
function storedRaw(raw: string): Storage {
  return { getItem: () => raw } as unknown as Storage;
}

/** The tab expected to be current, keyed by path. `null` means no tab is current. */
const ACTIVE_TAB: ReadonlyArray<{ path: string; label: string | null }> = [
  { path: "/", label: "Intake" },
  { path: "/jobs", label: "Jobs" },
  // The Go build passed "jobs" from ManualEntry, JobDetailView, and ContactsView too.
  { path: "/jobs/new", label: "Jobs" },
  { path: "/jobs/42", label: "Jobs" },
  { path: "/jobs/42/contacts", label: "Jobs" },
  { path: "/applications", label: "Applications" },
  // DraftReview passed "applications".
  { path: "/applications/7", label: "Applications" },
  { path: "/profile", label: "Profile" },
  // No screen ever passed "login", and go-app's login screen rendered no chrome at all.
  { path: "/login", label: null },
  { path: "/nope", label: null },
];

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-layout");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("navigation", () => {
  it("renders the toolbar and the four sections", () => {
    renderAt("/jobs");

    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    expect(
      Array.from(nav.querySelectorAll("a")).map((a) => [a.textContent, a.getAttribute("href")]),
    ).toEqual([
      ["Intake", "/"],
      ["Jobs", "/jobs"],
      ["Applications", "/applications"],
      ["Profile", "/profile"],
    ]);
    expect(screen.getByRole("link", { name: "Waunder" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Import job" })).toHaveAttribute("href", "/jobs/new");
  });

  it.each(ACTIVE_TAB)("marks $label current at $path", ({ path, label }) => {
    const { container } = renderAt(path);
    const expected = label ? [label] : [];

    expect(
      Array.from(container.querySelectorAll('[aria-current="page"]')).map((el) => el.textContent),
    ).toEqual(expected);
    expect(
      Array.from(container.querySelectorAll(".app-tab-active")).map((el) => el.textContent),
    ).toEqual(expected);
  });

  it("gives every tab the class app.css styles, active or not", () => {
    const { container } = renderAt("/profile");

    expect(container.querySelectorAll(".app-tabs .app-tab")).toHaveLength(4);
    expect(container.querySelector("header")).toHaveClass("app-chrome");
  });
});

describe("normalizeLayout", () => {
  // Transcribed from TestNormalizeLayout in web/components/chrome_test.go, extended with
  // the non-string inputs a JSON-decoded storage value can produce.
  it.each(["", "auto", "broken", "Desktop", null, undefined, 42])("%s → auto", (value) => {
    expect(normalizeLayout(value)).toBe("auto");
  });

  it.each(["desktop", "mobile"] as const)("%s is kept", (value) => {
    expect(normalizeLayout(value)).toBe(value);
  });
});

describe("stored preference", () => {
  it("loads the value go-app wrote, which is JSON-quoted", () => {
    // Exactly what jsStorage.Set(json.Marshal("desktop")) left in the owner's browser.
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, '"desktop"');

    renderAt("/jobs");

    expect(screen.getByLabelText("Layout")).toHaveValue("desktop");
    expect(document.documentElement).toHaveAttribute("data-layout", "desktop");
  });

  it("writes the same JSON-quoted form back", () => {
    renderAt("/jobs");

    chooseLayout("mobile");

    expect(window.localStorage.getItem(LAYOUT_STORAGE_KEY)).toBe('"mobile"');
    expect(document.documentElement).toHaveAttribute("data-layout", "mobile");
    expect(screen.queryByText(/could not save/i)).not.toBeInTheDocument();
  });

  it("tolerates an unquoted or unrecognised stored value", () => {
    expect(readLayout(storedRaw('"mobile"'))).toBe("mobile");
    expect(readLayout(storedRaw("mobile"))).toBe("mobile");
    expect(readLayout(storedRaw("Desktop"))).toBe("auto");
    expect(readLayout(storedRaw("{not json"))).toBe("auto");
    expect(readLayout(storedRaw("42"))).toBe("auto");
  });

  it("defaults to Auto with nothing stored, and still renders", () => {
    renderAt("/");

    expect(screen.getByLabelText("Layout")).toHaveValue("auto");
    expect(document.documentElement).toHaveAttribute("data-layout", "auto");
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeInTheDocument();
  });
});

describe("unavailable storage", () => {
  it("reads through a throwing or absent store as Auto", () => {
    expect(readLayout(null)).toBe("auto");
    expect(
      readLayout({
        getItem() {
          throw new Error("site data blocked");
        },
      } as unknown as Storage),
    ).toBe("auto");
  });

  it("reports a failed write instead of pretending it saved", () => {
    expect(writeLayout("desktop", null)).toBe(false);
    expect(
      writeLayout("desktop", {
        setItem() {
          throw new Error("quota exceeded");
        },
      } as unknown as Storage),
    ).toBe(false);
    expect(writeLayout("desktop", window.localStorage)).toBe(true);
  });

  it("still applies the choice and renders the chrome when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("site data blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("site data blocked");
    });

    renderAt("/jobs");
    // The read threw, so the chrome renders at the Auto default rather than not at all.
    expect(screen.getByLabelText("Layout")).toHaveValue("auto");

    chooseLayout("desktop");

    expect(screen.getByLabelText("Layout")).toHaveValue("desktop");
    expect(document.documentElement).toHaveAttribute("data-layout", "desktop");
    expect(
      screen.getByText("Layout changed. This browser could not save the preference."),
    ).toHaveClass("layout-error");
  });

  it("applies nothing, and throws nothing, without a root element", () => {
    expect(() => {
      applyLayout("desktop", null);
    }).not.toThrow();
  });
});

describe("Auto is resolved by CSS, not by JavaScript", () => {
  it("registers no viewport listener and never queries matchMedia", () => {
    // jsdom implements no `matchMedia` at all, so it has to be stubbed in for this to be
    // an observation rather than a crash — which is itself the point: a component that
    // reached for the viewport in JS would fail loudly here.
    const matchMedia = vi.fn(() => ({ matches: false, addEventListener: vi.fn() }));
    vi.stubGlobal("matchMedia", matchMedia);
    const addEventListener = vi.spyOn(window, "addEventListener");

    renderAt("/jobs");
    chooseLayout("desktop");

    expect(matchMedia).not.toHaveBeenCalled();
    const listened = addEventListener.mock.calls.map(([type]) => type);
    expect(listened).not.toContain("resize");
    expect(listened).not.toContain("orientationchange");
  });
});

/* -------------------------------------------------------------------------- */
/* public/app.css: the half of this feature that is pure CSS                   */
/* -------------------------------------------------------------------------- */

const css = readFileSync(join(import.meta.dirname, "..", "..", "public", "app.css"), "utf8");

/** The declarations of the first rule for `selector` at or after `from`. */
function declarations(selector: string, from = 0): Record<string, string> {
  const start = css.indexOf(`${selector} {`, from);
  expect(start, `${selector} is missing from app.css`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  return Object.fromEntries(
    css
      .slice(open + 1, css.indexOf("}", open))
      .split(";")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const colon = line.indexOf(":");
        return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
      }),
  );
}

describe("app.css layout contract", () => {
  it("gives Auto's wide screen exactly the explicit Desktop overrides", () => {
    const wideScreen = css.indexOf("@media (min-width: 960px)");
    expect(wideScreen, "Auto's 960px breakpoint is missing").toBeGreaterThanOrEqual(0);

    const explicit = declarations(':root[data-layout="desktop"]');
    const auto = declarations(':root:not([data-layout="mobile"])', wideScreen);

    expect(Object.keys(explicit).length).toBeGreaterThan(0);
    expect(auto).toEqual(explicit);
  });

  it("reserves the bottom bar and the iPhone safe area", () => {
    const root = declarations(":root", css.lastIndexOf(":root {", css.indexOf("--nav-position")));
    expect(root["--nav-safe-bottom"]).toBe("env(safe-area-inset-bottom, 0px)");
    expect(root["--screen-bottom"]).toBe("calc(88px + env(safe-area-inset-bottom, 0px))");
    expect(root["--nav-position"]).toBe("fixed");

    // The bar pads itself past the home indicator...
    expect(declarations(".app-chrome .app-tabs")["padding"]).toContain("var(--nav-safe-bottom)");
    // ...and each screen container reserves the space the fixed bar occupies.
    const screens = declarations(
      ":is(.digest, .job-list, .applications, .job-detail, .draft-review, .profile, .manual-entry, .contacts-view)",
    );
    expect(screens["padding-bottom"]).toBe("var(--screen-bottom)");
  });
});
