/**
 * The jobs feed's write controls: the per-row manage bar (select + score-on-demand +
 * lifecycle) and the bulk bar above the list. Ported from `renderJobRow`'s
 * `.job-list-actions` block, `renderLifecycleActions`, `renderBulkActions`, and
 * `renderScoreAction` in `web/components/jobs.go` (see docs/GO_MIGRATION.md).
 *
 * ## Nothing here holds state or talks to Rails
 *
 * Every control reports upward; `JobList` owns the selection, runs the mutations, and hands
 * back the flags below. That is not ceremony — the feed is the only thing that knows whether
 * a *different* row's write is in flight, and `lifecycleBusy` has to disable every lifecycle
 * control at once, because the bulk request and a per-row request both `PATCH` the same rows
 * and a second click mid-flight is how a row lands in a bin the owner did not choose.
 *
 * ## No control acts on render
 *
 * Backlog, Remove, Restore, and Score are all explicit clicks. This is the intake half of
 * "never auto-submit" — nothing on this screen submits an application, but Remove is a soft
 * delete and Score spends OpenRouter budget, and neither may happen because a row scrolled
 * into view. `job-actions.test.tsx` pins it by asserting zero writes after a full render.
 *
 * ## The bins decide which buttons exist
 *
 * In the Active bin a row offers Backlog and Remove; in Backlog or Removed it offers
 * Restore. The alternative — always showing all three — would put a Backlog button on a row
 * that is already in the backlog. The `<div>` wrapping the two-button case is load-bearing:
 * `.job-lifecycle-actions > div` and `.job-bulk-actions > div` are what give the pair its
 * own flex row, so flattening it changes the layout.
 */
import type { JobSummary } from "../../api/schemas";
import { bulkSelectionLabel, scoreButtonLabel } from "../../lib/job-actions";
import type { FeedBin } from "../../lib/job-filters";

/**
 * What the feed hands every row's manage bar — identical for all of them, so it is passed as
 * one object rather than six repeated props.
 */
export interface JobManageContext {
  /** The bin being shown. Decides Restore vs Backlog + Remove. */
  bin: FeedBin;
  /** True while any lifecycle write is in flight, including its refetch. */
  lifecycleBusy: boolean;
  /** Whether the score control is shown at all — the unscored view only, as in Go. */
  showScore: boolean;
  onToggleSelect: (id: number) => void;
  onLifecycle: (ids: readonly number[], state: FeedBin) => void;
  onScore: (id: number) => void;
}

export interface JobManageBarProps {
  job: JobSummary;
  selected: boolean;
  /** True while this row's own score request is in flight. */
  scoring: boolean;
  /** This row's last score failure, or `""`. */
  scoreError: string;
  manage: JobManageContext;
}

/**
 * The manage bar under one row card.
 *
 * The checkbox lives **here**, grouped with the lifecycle buttons, rather than as a bare grid
 * child floating above the card — that regrouping was the point of the 2026-06-24 feed
 * refinement (AGENTS.md), and `.job-list-actions` is styled as the row that holds all three.
 *
 * The checkbox's accessible name is "Select <title>", not "Select": a screen reader reading a
 * page of thirty checkboxes all named "Select" cannot say which row is being checked.
 */
export function JobManageBar({ job, selected, scoring, scoreError, manage }: JobManageBarProps) {
  return (
    <div className="job-list-actions">
      <label className="job-select-label">
        <input
          className="job-select"
          type="checkbox"
          checked={selected}
          aria-label={`Select ${job.title}`}
          onChange={() => manage.onToggleSelect(job.id)}
        />
        <span>Select</span>
      </label>
      {manage.showScore ? (
        <ScoreAction
          job={job}
          scoring={scoring}
          error={scoreError}
          onScore={() => manage.onScore(job.id)}
        />
      ) : null}
      <div className="job-lifecycle-actions">
        <LifecycleButtons
          bin={manage.bin}
          busy={manage.lifecycleBusy}
          classPrefix="job-lifecycle"
          labels={ROW_LABELS}
          onLifecycle={(state) => manage.onLifecycle([job.id], state)}
        />
      </div>
    </div>
  );
}

export interface JobBulkActionsProps {
  /** How many of the **loaded** rows are checked; see `visibleSelection`. */
  count: number;
  bin: FeedBin;
  busy: boolean;
  /** The shared lifecycle failure message, or `""`. */
  error: string;
  onLifecycle: (state: FeedBin) => void;
}

/**
 * The bulk bar above the list: the selection count, the bin-appropriate bulk buttons, and the
 * one lifecycle error shared by every lifecycle write on the screen.
 *
 * The count is the **visible** selection, which is a deliberate correction to the Go build.
 * There, `selectedCount()` counted every id ever checked, so switching bins could leave
 * "3 selected" on screen with an enabled button whose handler returned immediately because
 * `selectedIDs()` (rows-only) was empty — an enabled control that does nothing. Counting what
 * a click would actually send makes the disabled state honest.
 */
export function JobBulkActions({ count, bin, busy, error, onLifecycle }: JobBulkActionsProps) {
  return (
    <div className="job-bulk-actions">
      <span className="job-bulk-count">{bulkSelectionLabel(count)}</span>
      <LifecycleButtons
        bin={bin}
        busy={busy || count === 0}
        classPrefix="job-bulk"
        labels={BULK_LABELS}
        onLifecycle={onLifecycle}
      />
      {error === "" ? null : <p className="job-lifecycle-error">{error}</p>}
    </div>
  );
}

/** Button copy, which is the only thing that differs between the row bar and the bulk bar. */
const ROW_LABELS = { restore: "Restore", backlog: "Backlog", remove: "Remove" } as const;
const BULK_LABELS = {
  restore: "Restore selected",
  backlog: "Backlog selected",
  remove: "Remove selected",
} as const;

/**
 * The shared Restore / Backlog + Remove pair. `renderLifecycleActions` and
 * `renderBulkActions` were two near-identical Go functions differing only in class prefix,
 * button copy, and disabled condition; folding them means the bin rule — which buttons a bin
 * offers — is stated once and cannot drift between the row and the bulk bar.
 */
function LifecycleButtons({
  bin,
  busy,
  classPrefix,
  labels,
  onLifecycle,
}: {
  bin: FeedBin;
  busy: boolean;
  classPrefix: "job-lifecycle" | "job-bulk";
  labels: { restore: string; backlog: string; remove: string };
  onLifecycle: (state: FeedBin) => void;
}) {
  if (bin !== "active") {
    return (
      <button
        className={`${classPrefix}-restore`}
        type="button"
        disabled={busy}
        onClick={() => onLifecycle("active")}
      >
        {labels.restore}
      </button>
    );
  }
  return (
    <div>
      <button
        className={`${classPrefix}-backlog`}
        type="button"
        disabled={busy}
        onClick={() => onLifecycle("backlog")}
      >
        {labels.backlog}
      </button>
      <button
        className={`${classPrefix}-remove`}
        type="button"
        disabled={busy}
        onClick={() => onLifecycle("removed")}
      >
        {labels.remove}
      </button>
    </div>
  );
}

/**
 * The score-on-demand control, shown only in the Unscored view.
 *
 * It is disabled while this row's request is in flight **and** while Rails already reports
 * `scoring_status == "pending"`, because a `ScoreJobPostJob` is then already enqueued and a
 * second request would spend OpenRouter budget on work about to happen anyway. The error is
 * per row rather than shared: several rows can be scoring at once, and a single shared
 * message could not say which posting failed.
 */
function ScoreAction({
  job,
  scoring,
  error,
  onScore,
}: {
  job: JobSummary;
  scoring: boolean;
  error: string;
  onScore: () => void;
}) {
  return (
    <div className="job-list-score-action">
      <button
        className="job-list-score-button"
        type="button"
        disabled={scoring || job.scoring_status === "pending"}
        onClick={onScore}
      >
        {scoreButtonLabel(scoring, job.scoring_status)}
      </button>
      {error === "" ? null : <p className="job-list-score-error">{error}</p>}
    </div>
  );
}
