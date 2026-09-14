/**
 * One application-tracker row, ported from `renderRow`, `renderStatusControl`, and
 * `trackerStatusOptions` in `web/components/applications.go` (see docs/GO_MIGRATION.md).
 *
 * ## One markup, two layouts, and every class below is load-bearing
 *
 * This row is a real `<tr>` of `<td>`s, and `public/app.css` decides what it looks like. Below the
 * 800px container query each row is a card: `.tracker-row` and `.tracker-cell` are
 * `display: block`, the header row is visually hidden, and each cell paints its own label through
 * `.tracker-cell::before { content: attr(data-label) }`. Inside the query the same markup becomes
 * a table again with explicit `table-row` / `table-cell` values. Because the query is a
 * **container** query against the screen root, it follows the Auto/Desktop/Mobile layout the owner
 * picked rather than the viewport width.
 *
 * So the `data-label` on each cell is not decoration: it is the only label a phone shows, and it
 * has to say what the matching `<th>` says. `tracker.test.tsx` asserts that pairing cell by cell.
 *
 * ## The group tint lives on the row class and is painted by the leading cell
 *
 * `trackerRowClass` yields `tracker-row tracker-row--<group>`. On a card that suffix colours the
 * left border; in table mode a collapsed-border `<tr>` cannot paint one, so `app.css` paints an
 * inset `box-shadow` on `.tracker-cell-job` instead. That is why the title cell must stay first
 * and keep that class — moving it would put the tint in the middle of the row.
 *
 * ## The status select writes the tracker and nothing else
 *
 * A row with no tracked application shows a selected "Not applied" placeholder. Choosing it is a
 * no-op, not a reset: clearing a tracked application would destroy its draft and audit history, so
 * untracking is deliberately not a row action, and the option disappears once the job is tracked.
 * Every other choice goes up to the screen, which writes `PATCH
 * /api/job_posts/:id/application_status` — never a draft, never a submit.
 */
import { type ChangeEvent, type Ref, useCallback } from "react";
import { Link } from "react-router";

import type { JobSummary } from "../../api/schemas";
import { PIPELINE_STATUS_OPTIONS } from "../../lib/pipeline";
import type { TrackerColumnId } from "../../lib/tracker-columns";
import {
  NOT_APPLIED_OPTION,
  trackerDate,
  trackerRowClass,
  trackerStageLabel,
  trackerStatusValue,
  trackerUpdatedLabel,
} from "../../lib/tracker";

export interface TrackerRowProps {
  job: JobSummary;
  /** The visible columns, in order; the Job column is always first. */
  columns: readonly TrackerColumnId[];
  /** The row's position, for the virtualizer's measurement. */
  index?: number;
  ref?: Ref<HTMLTableRowElement>;
  /** True while *this* row's write is in flight, so only it says "Saving…". */
  saving: boolean;
  /** True while *any* row's write is in flight: one write at a time, as Go's `savingID` was. */
  disabled: boolean;
  /** Receives the raw select value; the screen decides whether it is a write. */
  onStatusChange: (jobId: number, value: string) => void;
}

export function TrackerRow({
  job,
  columns,
  index,
  ref,
  saving,
  disabled,
  onStatusChange,
}: TrackerRowProps) {
  const status = trackerStatusValue(job.application);
  const stage = trackerStageLabel(job.application);

  const onChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      onStatusChange(job.id, event.target.value);
    },
    [job.id, onStatusChange],
  );

  return (
    <tr ref={ref} data-index={index} className={trackerRowClass(job.application)}>
      <td className="tracker-cell tracker-cell-job" data-label="Job">
        <Link className="tracker-job-link" to={`/jobs/${job.id}`}>
          {job.title}
        </Link>
      </td>
      {!columns.includes("company") ? null : (
        <td className="tracker-cell tracker-cell-company" data-label="Company">
          {job.company}
        </td>
      )}
      {!columns.includes("status") ? null : (
        <td className="tracker-cell tracker-cell-status" data-label="Status">
          <div className="tracker-status">
            <select
              className="tracker-status-select"
              aria-label={`Application status for ${job.title}`}
              disabled={disabled}
              value={status}
              onChange={onChange}
            >
              {status === NOT_APPLIED_OPTION ? (
                <option value={NOT_APPLIED_OPTION}>Not applied</option>
              ) : null}
              {PIPELINE_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {stage === "" ? null : <span className="tracker-stage">{stage}</span>}
            {saving ? (
              <span className="tracker-saving" role="status">
                Saving…
              </span>
            ) : null}
          </div>
        </td>
      )}
      {!columns.includes("intaked") ? null : (
        <td className="tracker-cell tracker-cell-date" data-label="Intaked">
          {trackerDate(job.created_at)}
        </td>
      )}
      {!columns.includes("updated") ? null : (
        <td className="tracker-cell tracker-cell-date" data-label="Updated">
          {trackerUpdatedLabel(job)}
        </td>
      )}
    </tr>
  );
}
