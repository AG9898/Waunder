/**
 * The jobs feed's controls column: the scored/unscored view selector and the collapsible
 * filter + sort panel. Ported from `renderViewSelector`, `renderFilters`,
 * `renderFilterControls`, and `renderResetFilters` in `web/components/jobs.go`
 * (see docs/GO_MIGRATION.md).
 *
 * ## This component owns no state
 *
 * Every control is driven by the `selection` prop and reports through `onChange`; the feed owns
 * the selection because it is also the query key, and a control that kept its own copy would
 * drift from the request actually in flight. That split is what the Go build reached for its
 * `apply*` helpers to approximate — the state transitions there had to be extracted from the
 * `OnClick` handlers to be testable at all (AGENTS.md 2026-06-13). Here they are `lib/`
 * functions (`changeSelection`, `clearFilters`), so the handlers below are one line each.
 *
 * ## The panel is collapsed by default, and that is a mobile decision
 *
 * Six controls expanded above the feed push every row off a phone screen, so they live in a
 * native `<details>` with an active-filter count on the summary — no JavaScript, no open/closed
 * state to keep, and the browser's own disclosure semantics for a screen reader. `<details>`
 * keeps its children mounted while closed, so the rendered markup is the same either way and a
 * test does not have to open the panel to assert on a control.
 *
 * ## The bin tabs are not here
 *
 * `FE-17` adds the active/backlog/removed tabs next to the view selector. The selection already
 * carries `bin` (it is part of the saved `waunder.jobFilters` struct and is round-tripped
 * faithfully), so that task adds a control over state that already exists rather than widening
 * this contract.
 */
import {
  SCORE_BAND_OPTIONS,
  SORT_OPTIONS,
  SOURCE_OPTIONS,
  activeFilterCount,
  changeSelection,
  clearFilters,
  type FeedSort,
  type FeedView,
  type JobFilterSelection,
  type ScoreBandFilter,
} from "../../lib/job-filters";

export interface JobFiltersProps {
  selection: JobFilterSelection;
  onChange: (next: JobFilterSelection) => void;
}

export function JobFilters({ selection, onChange }: JobFiltersProps) {
  /** Every control goes through here, so no control can forget to reset to page 1. */
  const change = (patch: Partial<JobFilterSelection>) => {
    onChange(changeSelection(selection, patch));
  };
  const active = activeFilterCount(selection);

  return (
    <>
      <ViewSelector view={selection.view} onSelect={(view) => change({ view })} />
      <details className="job-filters-panel">
        <summary className="job-filters-summary">
          <span className="job-filters-summary-label">Filters &amp; sort</span>
          {active > 0 ? <span className="job-filters-summary-count">{active}</span> : null}
        </summary>
        <div className="job-filters">
          <label className="job-filter">
            <span>Score</span>
            <select
              className="job-filter-score-band"
              value={selection.scoreBand}
              onChange={(event) => change({ scoreBand: event.target.value as ScoreBandFilter })}
            >
              {SCORE_BAND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="job-filter">
            <span>Source</span>
            <select
              className="job-filter-source"
              value={selection.source}
              onChange={(event) => change({ source: event.target.value })}
            >
              {SOURCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="job-filter">
            <span>Location</span>
            <input
              className="job-filter-location"
              type="search"
              placeholder="e.g. Vancouver"
              value={selection.location}
              onChange={(event) => change({ location: event.target.value })}
            />
          </label>
          <label className="job-filter">
            <span>From</span>
            <input
              className="job-filter-date-from"
              type="date"
              value={selection.dateFrom}
              onChange={(event) => change({ dateFrom: event.target.value })}
            />
          </label>
          <label className="job-filter">
            <span>To</span>
            <input
              className="job-filter-date-to"
              type="date"
              value={selection.dateTo}
              onChange={(event) => change({ dateTo: event.target.value })}
            />
          </label>
          <label className="job-filter">
            <span>Sort</span>
            <select
              className="job-filter-sort"
              value={selection.sort}
              onChange={(event) => change({ sort: event.target.value as FeedSort })}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          className="job-filters-reset"
          type="button"
          disabled={active === 0}
          onClick={() => {
            onChange(clearFilters(selection));
          }}
        >
          Reset filters
        </button>
      </details>
    </>
  );
}

/**
 * The scored/unscored toggle.
 *
 * A no-op click is swallowed rather than re-sending the same selection: in Go that guard
 * (`if j.view == view { return }`) stopped a redundant fetch, and here it stops a redundant
 * write to `localStorage` and a needless render.
 *
 * The classes are `jobs.go`'s verbatim, including `applications-view-selector`, which nothing
 * in `app.css` styles on its own — the shared selector chrome is keyed off `.tracker-tab` and
 * `.job-bin-tab`. It is carried over anyway because the `FE-28` gate compares the two builds'
 * markup, and dropping a class here would be a silent divergence for no benefit.
 *
 * The one deliberate addition is `aria-selected`. `role="tab"` without it tells a screen reader
 * there is a tab and refuses to say which one is current; go-app set the role and not the state.
 * It changes no pixel, so the parity gate is unaffected.
 */
function ViewSelector({ view, onSelect }: { view: FeedView; onSelect: (view: FeedView) => void }) {
  const tab = (value: FeedView, label: string) => (
    <button
      className={`view-selector-option${view === value ? " view-selector-option-active" : ""}`}
      role="tab"
      aria-selected={view === value}
      onClick={() => {
        if (view !== value) onSelect(value);
      }}
    >
      {label}
    </button>
  );

  return (
    <nav className="applications-view-selector job-list-view-selector" role="tablist">
      {tab("scored", "Scored")}
      {tab("unscored", "Unscored")}
    </nav>
  );
}
