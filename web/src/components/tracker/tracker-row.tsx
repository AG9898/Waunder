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
  trackerAppliedLabel,
  trackerDate,
  trackerRowClass,
  trackerStatusValue,
  trackerUpdatedLabel,
} from "../../lib/tracker";
import { ScorePill, SourceMarker } from "../jobs/job-row";
import { FollowUpCell } from "./follow-up-cell";
import { StageCell } from "./stage-cell";
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
  /** Receives the row's current status and selected stage; the screen performs the write. */
  onStageChange: (jobId: number, status: string, stage: string) => void;
  /** Receives the row's current status and selected follow-up date; the screen performs the write. */
  onFollowUpChange: (jobId: number, status: string, value: string) => void;
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
  onStageChange,
  onFollowUpChange,
}: TrackerRowProps) {
  const status = trackerStatusValue(job.application);
  const stage = job.application?.pipeline_stage ?? "";
  const applied = trackerAppliedLabel(job);
  const note = job.application?.pipeline_note ?? "";
  const [editingCell, setEditingCell] = useState<"status" | "stage" | "follow_up" | null>(null);

  const onChange = useCallback(
    (value: string) => onStatusChange(job.id, value),
    [job.id, onStatusChange],
  );

  const onStatusOpenChange = useCallback((open: boolean) => {
    setEditingCell(open ? "status" : null);
  }, []);

  const onStage = useCallback(
    (value: string) => onStageChange(job.id, job.application?.pipeline_status ?? "", value),
    [job.application?.pipeline_status, job.id, onStageChange],
  );

  const onStageOpenChange = useCallback((open: boolean) => {
    setEditingCell(open ? "stage" : null);
  }, []);

  const onFollowUp = useCallback(
    (value: string) => onFollowUpChange(job.id, job.application?.pipeline_status ?? "", value),
    [job.application?.pipeline_status, job.id, onFollowUpChange],
  );

  const onFollowUpOpenChange = useCallback((open: boolean) => {
    setEditingCell(open ? "follow_up" : null);
  }, []);

  const rowNumber = (index ?? 0) + 1;

  return (
    <tr
      ref={ref}
      data-index={index}
      className={`${trackerRowClass(job.application)}${editingCell !== null || saving ? " tracker-row--editing" : ""}`}
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
          <span className="tracker-job-heading">
            <SourceMarker source={job.source} />
            <span className="tracker-job-title">{job.title}</span>
          </span>
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
      {!columns.includes("score") ? null : (
        <td
          className="tracker-cell tracker-cell-score"
          data-column="score"
          style={columnStyle("score")}
        >
          <ScorePill score={job.match_score} scoringStatus={job.scoring_status} />
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
            {saving ? (
              <span className="tracker-saving" role="status">
                Saving…
              </span>
            ) : null}
          </div>
        </td>
      )}
      {!columns.includes("stage") ? null : (
        <td
          className="tracker-cell tracker-cell-stage"
          data-column="stage"
          style={columnStyle("stage")}
        >
          <StageCell
            stage={stage}
            jobTitle={job.title}
            tracked={job.application !== null}
            open={editingCell === "stage"}
            disabled={disabled}
            onOpenChange={onStageOpenChange}
            onStageChange={onStage}
          />
        </td>
      )}
      {!columns.includes("applied") ? null : (
        <td
          className="tracker-cell tracker-cell-date tracker-cell-applied"
          data-column="applied"
          style={columnStyle("applied")}
        >
          {applied === "—" ? <span className="tracker-cell-empty">—</span> : applied}
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
      {!columns.includes("follow_up") ? null : (
        <td
          className="tracker-cell tracker-cell-follow-up"
          data-column="follow_up"
          style={columnStyle("follow_up")}
        >
          <FollowUpCell
            application={job.application}
            jobTitle={job.title}
            open={editingCell === "follow_up"}
            disabled={disabled}
            onOpenChange={onFollowUpOpenChange}
            onFollowUpChange={onFollowUp}
          />
        </td>
      )}
      {!columns.includes("note") ? null : (
        <td
          className="tracker-cell tracker-cell-note"
          data-column="note"
          style={columnStyle("note")}
        >
          <span className={`tracker-note${note === "" ? " tracker-cell-empty" : ""}`} title={note}>
            {note === "" ? "—" : note}
          </span>
        </td>
      )}
    </tr>
  );
}
