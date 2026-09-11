/**
 * The pure half of the jobs feed, ported from `feedParams`, `normalizeDefaults`, and
 * `pageIndicatorLabel` in `web/components/jobs.go` (see docs/GO_MIGRATION.md).
 *
 * These live in `lib/` rather than beside the screen for the same reason `labels.ts` does:
 * they are total, synchronous functions with no React, transport, or DOM dependency, so
 * they can be asserted directly against the Go originals. `FE-16` widens `feedParams` with
 * the owner's saved filter selection and `FE-17` with the lifecycle bin; both keep the
 * normalization here rather than in a component.
 */
import type { JobFeedParams, PageMeta } from "../api/schemas";

/**
 * `feedParams`' normalized defaults: the scored, active working set, oldest first.
 *
 * These are named rather than left unset because `jobFeedQuery` omits an empty filter,
 * which would hand Rails' own defaults back instead. They happen to agree today, and would
 * stop agreeing silently the moment either side changed.
 *
 * `status=scored` and `state=active` are the feed's whole point: deterministic triage
 * leaves most inbound postings `deferred` or `filtered`, so an unfiltered feed is mostly
 * noise. The *tracker* is the screen that asks for `status=all` — conflating the two is
 * what left the all-jobs table empty in production (AGENTS.md 2026-09-08).
 */
export const FEED_DEFAULTS = {
  status: "scored",
  state: "active",
  sort: "oldest",
} as const satisfies JobFeedParams;

/** Builds the server query for a page number, normalizing anything below 1 to page 1. */
export function feedParams(page: number): JobFeedParams {
  return { ...FEED_DEFAULTS, page: page < 1 ? 1 : page };
}

/**
 * `pageIndicatorLabel`: "Page N of M" from the response envelope, falling back to "Page N"
 * when the total is unknown — a payload reporting `size` or `total` as 0 must still render
 * a position rather than "Page 1 of 0".
 */
export function pageIndicatorLabel(page: PageMeta): string {
  const number = page.number < 1 ? 1 : page.number;
  if (page.size > 0 && page.total > 0) {
    return `Page ${number} of ${Math.ceil(page.total / page.size)}`;
  }
  return `Page ${number}`;
}
