/**
 * The pure half of the jobs feed's *write* controls: the bin tab table, the two button
 * labels, and the selection transitions. Ported from `renderBinTabs`' tab table,
 * `scoreButtonLabel`, `bulkSelectionLabel`, `applyToggleSelect`, and `selectedIDs` in
 * `web/components/jobs.go` (see docs/GO_MIGRATION.md).
 *
 * Same split as `job-feed.ts` and `job-filters.ts`: total, synchronous functions with no
 * React, transport, or DOM dependency, so they can be asserted directly against the Go
 * originals and the components above them are only wiring. It is also what keeps
 * `eslint-plugin-react-refresh` quiet — a `.tsx` module that exports a helper alongside its
 * components is a warning, and the chain's bar is zero warnings with no disable comments.
 *
 * ## The selection is a `Set`, and every transition returns a new one
 *
 * Go used a `map[int]bool` it mutated in place and a `ctx.Update()` to redraw. React needs a
 * fresh identity for `useState` to see a change, so `toggleSelection` and `clearSelection`
 * copy. The sets are small by construction — at most one page of rows, 30 by default.
 */
import type { FeedBin } from "./job-filters";

/** The lifecycle bin tabs, in `renderBinTabs`' order with its labels. */
export const BIN_OPTIONS: ReadonlyArray<{ value: FeedBin; label: string }> = [
  { value: "active", label: "Active" },
  { value: "backlog", label: "Backlog" },
  { value: "removed", label: "Removed" },
];

/**
 * `scoreButtonLabel`: what the per-row score control says.
 *
 * "Queued" is Rails' state, not this screen's: `scoring_status == "pending"` means a
 * `ScoreJobPostJob` is already enqueued for that posting, so a second request would spend
 * OpenRouter budget on work that is already about to happen. It reads as a label but it is
 * really the reason the button next to it is disabled.
 */
export function scoreButtonLabel(scoring: boolean, scoringStatus: string): string {
  if (scoring) return "Scoring...";
  if (scoringStatus === "pending") return "Queued";
  return "Score";
}

/** `bulkSelectionLabel`: "1 selected" / "N selected", for the bulk bar's count. */
export function bulkSelectionLabel(count: number): string {
  return count === 1 ? "1 selected" : `${count} selected`;
}

/** `applyToggleSelect`: flips one row's checkbox, returning a new set. */
export function toggleSelection(selected: ReadonlySet<number>, id: number): Set<number> {
  const next = new Set(selected);
  if (!next.delete(id)) {
    next.add(id);
  }
  return next;
}

/** Drops the ids a completed lifecycle write acted on, as `applyLifecycleResult` did. */
export function clearSelection(selected: ReadonlySet<number>, ids: readonly number[]): Set<number> {
  const next = new Set(selected);
  for (const id of ids) {
    next.delete(id);
  }
  return next;
}

/**
 * `selectedIDs`: the checked ids that are still among the loaded rows, **in row order**.
 *
 * The filter is the point. A bulk action must target exactly what the owner can see: ids
 * checked on a previous page or in a different bin are still in the set (nothing prunes it,
 * as nothing did in Go), and sending them would move rows the owner is not looking at. Row
 * order rather than set order keeps the request deterministic, so a failing bulk write is
 * reproducible from the screen.
 */
export function visibleSelection(
  jobs: readonly { id: number }[],
  selected: ReadonlySet<number>,
): number[] {
  return jobs.filter((job) => selected.has(job.id)).map((job) => job.id);
}
