/**
 * The route table: the nine paths `web/main.go` registers, plus a not-found screen
 * (see docs/GO_MIGRATION.md).
 *
 * The paths are ported unchanged, because they are a preserved contract rather than a
 * design choice: the manifest's `start_url` is `/`, the service worker sends a
 * notification click to `data.url`, links to `/jobs/:id` are already in the owner's
 * history, and the screenshot parity gate (`FE-28`) walks all nine. A renamed path breaks
 * each of those silently.
 *
 * ## Translating go-app's three regexp routes
 *
 * `main.go` matched `^/jobs/\d+$`, `^/jobs/\d+/contacts$`, and `^/applications/\d+$`
 * with `RouteWithRegexp`; here they are ordinary params — `/jobs/:id`,
 * `/jobs/:id/contacts`, `/applications/:id`. Two consequences worth knowing:
 *
 * - **`/jobs/new` still wins over `/jobs/:id`.** go-app tested its exact routes before its
 *   regexps, so registration order was load-bearing. React Router instead *ranks* matches
 *   by specificity, and a static segment always outranks a dynamic one, so the outcome no
 *   longer depends on this array's order (verified: reversing the array still resolves
 *   `/jobs/new` to manual entry). The order below mirrors the intent anyway, and
 *   `routes.test.tsx` asserts the outcome rather than trusting either mechanism.
 * - **A non-numeric id now matches.** `\d+` rejected `/jobs/abc`; `:id` accepts it, so that
 *   path reaches the job-detail screen, which asks Rails for the posting and renders its
 *   own not-found state from the 404. Rails stays the authority on whether an id exists,
 *   which it already was for `/jobs/999999`.
 *
 * ## Root classes
 *
 * All nine screens are ported (`FE-15` … `FE-26`). Each renders the **real root class** the Go
 * screen rendered, because that class is what `public/app.css` styles the page container with
 * and what the parity gate compares; `routes.test.tsx` asserts it per path, so a screen that
 * drops its root class fails there rather than at the screenshot gate.
 *
 * The not-found helper below is deliberately a lowercase element factory, not a React
 * component: it is called once while this module initializes, so nothing here has state,
 * hooks, or a render of its own to keep this file pure route data.
 */
import { Link } from "react-router";
import type { RouteObject } from "react-router";

import { ContactsScreen } from "./components/contacts/contacts";
import { DraftReviewScreen } from "./components/draft-review/draft-review";
import { IngestionBatchesScreen } from "./components/ingestion-batches/ingestion-batches";
import { JobDetailScreen } from "./components/job-detail/job-detail";
import { JobList } from "./components/jobs/job-list";
import { LoginScreen } from "./components/login";
import { ManualEntryScreen } from "./components/manual-entry/manual-entry";
import { ProfileScreen } from "./components/profile/profile";
import { TrackerScreen } from "./components/tracker/tracker";

/**
 * Rendered for any path outside the nine. go-app had no equivalent: an unrouted path
 * 404'd server-side and an in-app navigation to one rendered nothing at all. An SPA behind
 * Caddy answers every path with the app shell (`FE-27`), so without this a typo or a stale
 * bookmark would show a blank page.
 */
function notFoundScreen() {
  return (
    <div className="app-shell">
      <h1>Page not found</h1>
      <p>That address is not part of Waunder.</p>
      <Link to="/">Back to recent ingestions</Link>
    </div>
  );
}

export const routes: RouteObject[] = [
  { path: "/", element: <IngestionBatchesScreen /> },
  { path: "/login", element: <LoginScreen /> },
  { path: "/jobs", element: <JobList /> },
  // Before /jobs/:id, mirroring main.go. React Router's ranking makes this redundant
  // rather than wrong — see the module comment.
  { path: "/jobs/new", element: <ManualEntryScreen /> },
  { path: "/jobs/:id", element: <JobDetailScreen /> },
  { path: "/jobs/:id/contacts", element: <ContactsScreen /> },
  { path: "/applications", element: <TrackerScreen /> },
  { path: "/applications/:id", element: <DraftReviewScreen /> },
  { path: "/profile", element: <ProfileScreen /> },
  { path: "*", element: notFoundScreen() },
];
