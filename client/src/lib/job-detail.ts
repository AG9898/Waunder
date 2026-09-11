/**
 * Pure helpers for the job detail screen, ported from `JobDetailView`'s non-render methods
 * and the two package-level functions it used in `web/components/jobs.go`:
 * `jobIDFromPath`, `resolveBack`/`backFallback`/`backFallbackLabel`, `RouteLabel`,
 * `externalApplicationURL`, and `applyButtonLabel` (see docs/GO_MIGRATION.md).
 *
 * They live in `lib/` rather than beside the components for the reason `FE-15` recorded:
 * `eslint-plugin-react-refresh` warns when a component module also exports a plain function,
 * and these are worth testing directly anyway — `externalApplicationURL` is a safety filter,
 * not formatting.
 */
import type { JobRoute } from "../api/schemas";

/**
 * The job id from the `:id` route param.
 *
 * go-app matched `^/jobs/\d+$`, so a non-numeric path never reached this screen at all;
 * React Router ranks `/jobs/:id` by specificity and accepts anything (docs/GO_MIGRATION.md),
 * so `/jobs/abc` lands here. Returning `0` reproduces exactly what the Go build did when its
 * `jobIDFromPath` failed — `JobID` stayed at its zero value and the screen asked Rails for
 * job 0, which answers 404 and paints the load error. Rails stays the authority on whether an
 * id exists, and no invalid value is ever fabricated into a path segment.
 */
export function parseJobId(raw: string | undefined): number {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
}

/** Where the screen's back link points, and what it says. */
export interface BackLink {
  href: string;
  label: string;
}

/**
 * `resolveBack`: the back link returns to wherever the owner came from.
 *
 * The ingestion landing links each posting with `?from=digest&batch=<id>` so that returning
 * re-expands the batch that was open (`FE-18`). Anything else — the jobs feed, a bookmark, a
 * push notification — goes back to the feed. Only `from=digest` switches the target, so an
 * unrelated query string cannot send the owner somewhere they have never been.
 */
export function backLink(search: string): BackLink {
  const params = new URLSearchParams(search);
  if (params.get("from") !== "digest") {
    return { href: "/jobs", label: "← Jobs" };
  }
  const batch = params.get("batch") ?? "";
  if (batch === "") {
    return { href: "/", label: "← Ingestions" };
  }
  return { href: `/?${new URLSearchParams({ batch }).toString()}`, label: "← Ingestions" };
}

/**
 * `RouteLabel`: how Rails says to apply, preferring the recommended route over the raw ATS
 * type. Both are Rails' words, rendered as sent — `ApplicationRouteResolver` owns route
 * resolution and the screen never re-derives or prettifies it.
 */
export function routeLabel(route: JobRoute): string {
  if (route.recommended_route !== "") return route.recommended_route;
  if (route.route_type !== "") return route.route_type;
  return "unknown";
}

/**
 * The first candidate that is a real external `http(s)` link, or `""`.
 *
 * This is a **safety filter**, not a formatter: it is what stands between an
 * `application_url` Rails resolved from an email and an `href` the owner clicks. A
 * `javascript:` URL is rejected because rendering one as a link is a script-injection
 * vector, and a relative path is rejected because "Open application" must leave the app —
 * a relative href would navigate the PWA to a route that does not exist.
 *
 * The job detail calls it with the resolved route URL first and the posting URL second, so a
 * posting with no resolved application link still offers the original listing.
 */
export function externalApplicationURL(...candidates: readonly string[]): string {
  for (const candidate of candidates) {
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      continue;
    }
    if ((parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.host !== "") {
      return candidate;
    }
  }
  return "";
}

/**
 * `applyButtonLabel`. The idle label says "draft" on purpose: this button prepares materials
 * for review on the next screen and approves nothing, so it must not read as "apply now".
 */
export function applyButtonLabel(pending: boolean): string {
  return pending ? "Preparing…" : "Prepare application draft";
}
