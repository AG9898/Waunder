/**
 * The lifecycle bin tabs — Active / Backlog / Removed — ported from `renderBinTabs` in
 * `web/components/jobs.go` (see docs/GO_MIGRATION.md). They sit under the scored/unscored
 * view selector in the feed's controls column.
 *
 * ## A bin is a query, not a client-side split
 *
 * The tab writes `state` into the selection and the feed re-queries; nothing here partitions
 * the rows it already has. That matters because a bin holds far more than one page — the
 * backlog is where the daily active cap parks everything past
 * `JOB_INTAKE_DAILY_ACTIVE_LIMIT` (AGENTS.md 2026-06-23), so a client-side split of the
 * current 30 rows would show a backlog of whatever happened to be on this page.
 *
 * ## Bins are navigation, filters are refinement
 *
 * The bin deliberately survives Reset (`clearFilters` leaves it alone) and is not counted in
 * the filter badge: a Reset that also threw the owner back to the Active feed would be a
 * navigation wearing a filter control's label. This is the same reason the tabs are a
 * separate component from `JobFilters` rather than a sixth control inside its panel.
 *
 * Like the view selector, a click on the current tab is swallowed — in Go that guard
 * (`if j.bin == state { return }`) stopped a redundant fetch; here it stops a redundant
 * write to `localStorage` and a pointless reset to page 1.
 *
 * `aria-selected` is the one deliberate addition over the Go markup: `role="tab"` without it
 * tells a screen reader there is a tab and refuses to say which one is current. It changes no
 * pixel, so the `FE-28` parity gate is unaffected.
 */
import { BIN_OPTIONS } from "../../lib/job-actions";
import type { FeedBin } from "../../lib/job-filters";

export interface JobBinTabsProps {
  bin: FeedBin;
  onSelect: (bin: FeedBin) => void;
}

export function JobBinTabs({ bin, onSelect }: JobBinTabsProps) {
  return (
    <nav className="job-bin-tabs" role="tablist">
      {BIN_OPTIONS.map((option) => (
        <button
          key={option.value}
          className={`job-bin-tab${bin === option.value ? " view-selector-option-active" : ""}`}
          role="tab"
          aria-selected={bin === option.value}
          onClick={() => {
            if (bin !== option.value) onSelect(option.value);
          }}
        >
          {option.label}
        </button>
      ))}
    </nav>
  );
}
