/**
 * The shared load / error chrome, ported from `renderLoad`, `renderLoadError`, and the
 * message half of `applyResult` in `web/components/jobs.go` (see docs/GO_MIGRATION.md).
 *
 * Seven Go screens rendered these two states through those helpers — `JobList`,
 * `JobDetailView`, `DigestView`, the tracker, contacts, draft review, and profile — so
 * this is a shared module rather than something each ported screen restates. The classes
 * (`.loading`, `.load-error`, `.sign-in-link`) and both message strings are unchanged,
 * because they are what `public/app.css` styles and what the parity gate compares.
 *
 * `loadIdle` has no counterpart here: go-app's zero-valued state rendered the same
 * "Loading…" as `loadLoading`, and TanStack's `isPending` already covers both.
 *
 * The sign-in link is kept for parity even though `src/lib/auth.ts` now redirects to
 * `/login` on any 401 — the redirect is what the owner will actually see, and this panel is
 * the fallback for the frame before it lands, or if a 401 ever arrives outside the two
 * caches that boundary subscribes to.
 */
import { Link } from "react-router";

import { isUnauthorized } from "../api/errors";

/** `sessionExpiredMessage`. Rendered with a `/login` link. */
const SESSION_EXPIRED = "Your session expired. Please sign in again.";

/** `applyResult`'s message for any non-401 failure. */
const LOAD_FAILED = "Could not load data. Please try again.";

/**
 * Maps a failed read to the message the owner sees. Only a 401 is treated as an auth
 * failure; a 403 is a decision Rails made about an authenticated owner and must not read
 * as a dead session. Module-private: screens render `<LoadError>`, they do not restate its
 * copy.
 */
function loadErrorMessage(error: unknown): string {
  return isUnauthorized(error) ? SESSION_EXPIRED : LOAD_FAILED;
}

/** The in-flight state. `app.css` gives `.loading` a gentle opacity pulse. */
export function Loading() {
  return <p className="loading">Loading…</p>;
}

/** The failed state, with the sign-in link only on an expired session. */
export function LoadError({ error }: { error: unknown }) {
  const message = loadErrorMessage(error);
  return (
    <div className="load-error">
      <p>{message}</p>
      {message === SESSION_EXPIRED ? (
        <Link className="sign-in-link" to="/login">
          Sign in
        </Link>
      ) : null}
    </div>
  );
}
