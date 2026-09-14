/**
 * The shared app chrome, ported from `web/components/chrome.go` (see docs/GO_MIGRATION.md):
 * the toolbar, the Auto/Desktop/Mobile layout selector, and the navigation that renders as
 * a bottom bar on mobile and in flow on desktop.
 *
 * ## Where this is rendered
 *
 * Inside each screen's page container, as the first child — `renderAppTabs()` in the Go
 * build, e.g. `<div className="digest"><AppChrome />…</div>`. That nesting is load-bearing,
 * not incidental: the screen roots carry `container-type: inline-size`, which makes them
 * the containing block for the `position: fixed` bottom bar, and they also own the
 * `padding-bottom: var(--screen-bottom)` that reserves room for it plus the iPhone safe
 * area. Hoisting the chrome into a route layout element above the screens would leave the
 * bar positioned against the viewport and the last row of every feed underneath it.
 *
 * The login screen and the not-found screen deliberately render no chrome, as in the Go
 * build — there is nothing to navigate to while signed out.
 *
 * ## Active tab
 *
 * `chrome.go` took the active tab as a field and every screen passed a literal
 * (`renderAppTabs("jobs")` from four different screens). Here it is derived from the
 * router's own location instead, so a ported screen cannot pass the wrong one: `/jobs/new`,
 * `/jobs/:id`, and `/jobs/:id/contacts` all light up Jobs because they are all under the
 * Jobs section, which is precisely the mapping those literals encoded by hand.
 *
 * `FE-10` adds the update-available banner here (`.app-update`), replacing `chrome.go`'s
 * hand-rolled `OnAppUpdate` with Workbox's `needRefresh`.
 */
import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import { Link, useLocation } from "react-router";

import {
  LAYOUT_OPTIONS,
  applyLayout,
  normalizeLayout,
  readLayout,
  writeLayout,
} from "../lib/layout";
import type { LayoutPreference } from "../lib/layout";
import { UpdateBanner } from "./update-banner";

/** Shown when the layout choice was applied but could not be persisted. */
const STORAGE_ERROR = "Layout changed. This browser could not save the preference.";

/** The four sections, in `chrome.go`'s order, with its labels and paths. */
const NAV_TABS = [
  { tab: "digest", href: "/", label: "Intake" },
  { tab: "jobs", href: "/jobs", label: "Jobs" },
  { tab: "applications", href: "/applications", label: "Applications" },
  { tab: "profile", href: "/profile", label: "Profile" },
] as const;

type NavTab = (typeof NAV_TABS)[number]["tab"];

/**
 * Maps a path to the section that owns it, or `null` for a path outside the navigation
 * (`/login`, an unrouted path).
 *
 * Matching is on the whole first segment rather than a prefix, so a hypothetical
 * `/jobsomething` does not light up Jobs.
 */
function activeTab(pathname: string): NavTab | null {
  const segment = pathname.replace(/^\/+/, "").split("/")[0] ?? "";
  switch (segment) {
    case "":
      return "digest";
    case "jobs":
      return "jobs";
    case "applications":
      return "applications";
    case "profile":
      return "profile";
    default:
      return null;
  }
}

export function AppChrome() {
  const active = activeTab(useLocation().pathname);
  // Read once per mount, exactly as chrome.go's OnMount did. Not in an effect: the first
  // paint should already carry the saved choice.
  const [layout, setLayout] = useState<LayoutPreference>(() => readLayout());
  const [storageFailed, setStorageFailed] = useState(false);

  // The one side effect: publish the preference where app.css can read it. Auto's 960px
  // breakpoint is resolved by the stylesheet, so there is nothing to listen to here.
  useEffect(() => {
    applyLayout(layout);
  }, [layout]);

  function selectLayout(event: ChangeEvent<HTMLSelectElement>) {
    const next = normalizeLayout(event.target.value);
    setLayout(next);
    // Applied regardless; the flag only reports whether it will survive a reload.
    setStorageFailed(!writeLayout(next));
  }

  return (
    <header className="app-chrome">
      <div className="app-toolbar">
        <Link className="app-brand" to="/">
          Waunder
        </Link>
        <Link className="app-add-job" to="/jobs/new">
          Import job
        </Link>
        <label className="layout-control">
          <span>Layout</span>
          <select className="layout-select" value={layout} onChange={selectLayout}>
            {LAYOUT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <nav className="app-tabs" aria-label="Main navigation">
        {NAV_TABS.map(({ tab, href, label }) => (
          <Link
            key={tab}
            className={tab === active ? "app-tab app-tab-active" : "app-tab"}
            to={href}
            aria-current={tab === active ? "page" : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
      <UpdateBanner />
      {storageFailed ? (
        <p className="layout-error" role="status">
          {STORAGE_ERROR}
        </p>
      ) : null}
    </header>
  );
}
