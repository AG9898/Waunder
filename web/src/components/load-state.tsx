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
 * The copy itself lives in `src/lib/messages.ts`, alongside the write-path messages
 * (`FE-17`), because Go shared one `sessionExpiredMessage` const across reads and writes and
 * this panel keys its Sign in link off that exact string — a second copy of the sentence would
 * drift into a silently missing link.
 *
 * The sign-in link is kept for parity even though `src/lib/auth.ts` now redirects to
 * `/login` on any 401 — the redirect is what the owner will actually see, and this panel is
 * the fallback for the frame before it lands, or if a 401 ever arrives outside the two
 * caches that boundary subscribes to.
 */
import { Link } from "react-router";

import { SESSION_EXPIRED, loadErrorMessage } from "../lib/messages";

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
