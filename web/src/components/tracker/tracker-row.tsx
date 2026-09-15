/**
 * One application-tracker row, ported from `renderRow`, `renderStatusControl`, and
 * `trackerStatusOptions` in `web/components/applications.go` (see docs/GO_MIGRATION.md).
 *
 * ## One markup, one grid
 *
 * This row is a real `<tr>` of `<td>`s, and `public/app.css` lays it out as one horizontally
 * scrolling Surface v2 grid at every width. The row-number rail and Job cell are sticky; the
 * company is repeated as a quiet second line inside the pinned Job cell on mobile while its
 * existing column remains available to TanStack visibility controls.
 *
 * ## The status chip writes the tracker and nothing else
 *
 * A row with no tracked application shows a selected "Not applied" placeholder. Choosing it is a
 * no-op, not a reset: clearing a tracked application would destroy its draft and audit history, so
 * untracking is deliberately not a row action, and the option disappears once the job is tracked.
 * Every other choice goes up to the screen, which writes `PATCH
 * /api/job_posts/:id/application_status` — never a draft, never a submit.
 */
import { type CSSProperties, type Ref, useCallback, useState } from "react";
import { Link } from "react-router";

import type { JobSummary } from "../../api/schemas";
import type { TrackerColumnId } from "../../lib/tracker-columns";
import {
  trackerDate,
  trackerRowClass,
  trackerStageLabel,
  trackerStatusValue,
  trackerUpdatedLabel,
} from "../../lib/tracker";
import { StatusCell } from "./status-cell";

export interface TrackerRowProps {
  job: JobSummary;
  /** The visible columns, in order; the Job column is always first. */
  columns: readonly TrackerColumnId[];
  /** TanStack's current width and pin offset for each visible data column. */
  columnStyle: (id: TrackerColumnId) => CSSProperties;
  /** The row's position, for the virtualizer's measurement. */
  index?: number;
  ref?: Ref<HTMLTableRowElement>;
  /** True while *this* row's write is in flight, so only it says "Saving…". */
  saving: boolean;
  /** True while *any* row's write is in flight: one write at a time, as Go's `savingID` was. */
  disabled: boolean;
  /** Receives the selected status; the screen decides whether it is a write. */
  onStatusChange: (jobId: number, value: string) => void;
}

export function TrackerRow({
  job,
  columns,
  columnStyle,
  index,
  ref,
  saving,
  disabled,
  onStatusChange,
}: TrackerRowProps) {
  const status = trackerStatusValue(job.application);
  const stage = trackerStageLabel(job.application);
  const [editingCell, setEditingCell] = useState<"status" | null>(null);

  const onChange = useCallback(
    (value: string) => onStatusChange(job.id, value),
    [job.id, onStatusChange],
  );

  const onStatusOpenChange = useCallback((open: boolean) => {
    setEditingCell(open ? "status" : null);
  }, []);

  const rowNumber = (index ?? 0) + 1;

  return (
    <tr
      ref={ref}
      data-index={index}
      className={`${trackerRowClass(job.application)}${editingCell === "status" || saving ? " tracker-row--editing" : ""}`}
    >
      <td
        className="tracker-cell tracker-cell-number"
        data-column="row-number"
        aria-label={`Row ${rowNumber}`}
        style={{ width: "var(--tracker-row-number-width)" }}
      >
        {rowNumber}
      </td>
      <td
        className="tracker-cell tracker-cell-job"
        data-column="job"
        data-pinned="left"
        style={columnStyle("job")}
      >
        <Link className="tracker-job-link" to={`/jobs/${job.id}`} aria-label={job.title}>
          <span className="tracker-job-title">{job.title}</span>
          {columns.includes("company") ? (
            <span className="tracker-job-company-mobile" aria-hidden="true">
              {job.company}
            </span>
          ) : null}
        </Link>
      </td>
      {!columns.includes("company") ? null : (
        <td
          className="tracker-cell tracker-cell-company"
          data-column="company"
          style={columnStyle("company")}
        >
          {job.company}
        </td>
      )}
      {!columns.includes("status") ? null : (
        <td
          className="tracker-cell tracker-cell-status"
          data-column="status"
          style={columnStyle("status")}
        >
          <div className="tracker-status">
            <StatusCell
              status={status}
              jobTitle={job.title}
              tracked={job.application !== null}
              open={editingCell === "status"}
              disabled={disabled}
              onOpenChange={onStatusOpenChange}
              onStatusChange={onChange}
            />
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
        <td
          className="tracker-cell tracker-cell-date"
          data-column="intaked"
          style={columnStyle("intaked")}
        >
          {trackerDate(job.created_at)}
        </td>
      )}
      {!columns.includes("updated") ? null : (
        <td
          className="tracker-cell tracker-cell-date"
          data-column="updated"
          style={columnStyle("updated")}
        >
          {trackerUpdatedLabel(job)}
        </td>
      )}
    </tr>
  );
}
