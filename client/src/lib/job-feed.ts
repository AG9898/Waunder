/**
 * The pure half of the jobs feed's *presentation*: what a selection asks the server for, what
 * the page indicator says, and what an empty feed says. Ported from `feedParams`,
 * `pageIndicatorLabel`, and `emptyText` in `web/components/jobs.go` (see docs/GO_MIGRATION.md).
 *
 * These live in `lib/` rather than beside the screen for the same reason `labels.ts` does: they
 * are total, synchronous functions with no React, transport, or DOM dependency, so they can be
 * asserted directly against the Go originals. The selection they read — its shape, defaults,
 * option tables, `localStorage` contract, and transitions — is `job-filters.ts` (`FE-16`).
 */
import type { JobFeedParams, PageMeta } from "../api/schemas";
import type { JobFilterSelection } from "./job-filters";

/**
 * `feedParams`: the server query for a selection.
 *
 * An unset filter is **omitted from the object**, never sent as `""` or an "all" sentinel:
 * Rails matches `source=All` literally and returns nothing, which is exactly the go-app select
 * bug (AGENTS.md 2026-06-24). `jobFeedQuery` drops empty values too, so this is belt and
 * braces — but it is also what makes the params object readable as "what this feed is actually
 * asking for" in a cache key and in a test assertion.
 *
 * `status` and `state` are always sent, even at their defaults. They are the feed's whole
 * point — deterministic triage leaves most inbound postings `deferred` or `filtered`, so an
 * unfiltered feed is mostly noise — and naming them explicitly means Rails' own defaults
 * drifting from the client's would be a visible change rather than a silent one.
 */
export function feedParams(selection: JobFilterSelection): JobFeedParams {
  const params: JobFeedParams = {
    status: selection.view,
    state: selection.bin,
    sort: selection.sort,
    page: selection.pageNum < 1 ? 1 : selection.pageNum,
  };
  if (selection.scoreBand !== "") params.score_band = selection.scoreBand;
  if (selection.source !== "") params.source = selection.source;
  if (selection.location !== "") params.location = selection.location;
  if (selection.dateFrom !== "") params.date_from = selection.dateFrom;
  if (selection.dateTo !== "") params.date_to = selection.dateTo;
  return params;
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

/**
 * `emptyText`: the empty-feed sentence for the current selection.
 *
 * The bin wins over the view, as it did in Go: an empty backlog is an empty backlog whether the
 * owner is looking at scored or unscored postings.
 */
export function emptyFeedText(selection: JobFilterSelection): string {
  if (selection.bin === "backlog") return "No jobs in the backlog.";
  if (selection.bin === "removed") return "No removed jobs.";
  if (selection.view === "unscored") return "No unscored jobs.";
  return "No scored jobs yet.";
}
