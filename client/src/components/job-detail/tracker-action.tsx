/**
 * The manual tracker controls on the job detail: the current-status line, the one-click
 * "Mark as applied", and the status/stage selects. Ported from `renderManualActions`'s tracker
 * half, `markApplied`, `renderPipelineStatus`, `jobStatusSetter`, and `jobStageSetter` in
 * `web/components/jobs.go` (see docs/GO_MIGRATION.md).
 *
 * ## These controls write to the tracker and to nothing else
 *
 * Every one of them calls `PATCH /api/job_posts/:id/application_status` through
 * `useTrackerWrite`. None of them creates a draft (`POST /api/applications`) or submits one
 * (`POST /api/applications/:id/submit`) — the owner is recording an application they made
 * themselves on the employer's site. `tracker-action.test.tsx` asserts both endpoints stay at
 * zero requests through a mark-applied and a status change, because "the tracker quick action
 * must never reach the trusted-submit path" is a safety property, not an implementation detail.
 *
 * ## The pieces are separate because `app.css` separates them
 *
 * Go rendered the tracker line and the Mark-as-applied button *inside* `.manual-application`,
 * next to the outbound link, and the selects in a sibling `.job-pipeline-status` block. Below
 * the 800px container query those two are ordered independently around the assessment column
 * (0 and 2), so they cannot be merged into one node without changing the phone layout. The
 * shared write is passed in from the screen instead, which is also what keeps one in-flight
 * request disabling *both* blocks — as Go's single `statusSaving` flag did.
 *
 * ## Every handler reads the tracker it was rendered with
 *
 * A stage change has to send the current status too (the request carries both fields), and the
 * Go build got this wrong in a way worth not repeating: `jobStageSetter(status)` took the status
 * as a *parameter captured when the handler was built*, and go-app compares handler function
 * pointers, so it could keep a closure — and its stale status — across renders
 * (AGENTS.md 2026-09-08). The fix there was to re-read `d.job.Application` at click time. Here
 * the tracker arrives as a prop from the screen's `useQuery`, the write awaits its own
 * invalidation before re-enabling the controls, and the handlers are rebuilt whenever that
 * tracker changes — so a stage change after a status change sends the *new* status. The test
 * pins exactly that sequence.
 */
import { type ChangeEvent, useCallback } from "react";

import type { ApplicationTracker } from "../../api/schemas";
import type { PipelineOption, TrackerWrite } from "../../lib/pipeline";
import {
  MARK_APPLIED_UPDATE,
  PIPELINE_STAGE_OPTIONS,
  PIPELINE_STATUS_OPTIONS,
  canMarkApplied,
  pipelineStatusLabel,
  selectValue,
  stageFromSelectValue,
} from "../../lib/pipeline";

export interface TrackerProps {
  /** The posting's latest Application, or `null` when it has never been tracked. */
  application: ApplicationTracker | null;
  write: TrackerWrite;
}

/**
 * Where the posting stands, as one sentence. Rendered only for a tracked posting: "Interested"
 * under an untracked one would claim a state Rails is not holding.
 *
 * The class is a parameter because the same line appears in two blocks that `app.css` styles
 * differently — `.manual-tracker-current` beside the outbound link, `.job-tracker-current`
 * above the selects.
 */
export function TrackerStatusLine({
  application,
  className,
}: {
  application: ApplicationTracker | null;
  className: string;
}) {
  if (application === null) {
    return null;
  }
  return (
    <p className={className} role="status">
      {pipelineStatusLabel(application.pipeline_status, application.pipeline_stage)}
    </p>
  );
}

/**
 * The quick action: one tap records "applied, waiting to hear back".
 *
 * It is offered only where it cannot walk the tracker backwards (`canMarkApplied`), but the
 * error line is independent of that — a failed write on a posting whose status the response
 * would have moved past still has to be reported, and Go rendered the two conditions
 * separately for the same reason.
 */
export function MarkAppliedControl({ application, write }: TrackerProps) {
  const onMarkApplied = useCallback(() => {
    write.save(MARK_APPLIED_UPDATE);
  }, [write]);

  return (
    <>
      {canMarkApplied(application) ? (
        <button
          className="job-mark-applied"
          type="button"
          disabled={write.saving}
          onClick={onMarkApplied}
        >
          {write.saving ? "Saving…" : "Mark as applied"}
        </button>
      ) : null}
      {write.error === "" ? null : (
        <p className="manual-status-error" role="alert">
          {write.error}
        </p>
      )}
    </>
  );
}

/**
 * The full status/stage editor: what the quick action cannot express.
 *
 * Changing the **status** deliberately sends a blank stage. `Application#assign_pipeline_status`
 * reads that as "use this status's default stage" (`applied` → `waiting`), which is the Go
 * behaviour and the reason moving to Applied from here lands in the same state the quick action
 * writes. Changing the **stage** sends the current status alongside it, because the endpoint
 * requires a status and omitting one would fail validation.
 */
export function PipelineStatusPanel({ application, write }: TrackerProps) {
  const status = application?.pipeline_status ?? "interested";
  const stage = application?.pipeline_stage ?? "";

  const onStatusChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      write.save({ pipeline_status: event.target.value, pipeline_stage: "" });
    },
    [write],
  );

  const onStageChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      write.save({
        pipeline_status: status,
        pipeline_stage: stageFromSelectValue(event.target.value),
      });
    },
    [status, write],
  );

  return (
    <div className="job-pipeline-status">
      <h2>Application status</h2>
      <TrackerStatusLine application={application} className="job-tracker-current" />
      <label className="pipeline-select-label">
        <span>Status</span>
        <select
          className="pipeline-status-select"
          disabled={write.saving}
          value={status}
          onChange={onStatusChange}
        >
          <PipelineOptions options={PIPELINE_STATUS_OPTIONS} />
        </select>
      </label>
      <label className="pipeline-select-label">
        <span>Stage</span>
        <select
          className="pipeline-stage-select"
          disabled={write.saving}
          value={selectValue(stage)}
          onChange={onStageChange}
        >
          <PipelineOptions options={PIPELINE_STAGE_OPTIONS} />
        </select>
      </label>
      {write.saving ? <p className="job-pipeline-saving">Saving…</p> : null}
      {write.error === "" ? null : <p className="job-pipeline-error">{write.error}</p>}
    </div>
  );
}

/** One option list, with the empty stage rendered as the `none` sentinel `optionNodes` used. */
function PipelineOptions({ options }: { options: readonly PipelineOption[] }) {
  return (
    <>
      {options.map((option) => (
        <option key={option.value} value={selectValue(option.value)}>
          {option.label}
        </option>
      ))}
    </>
  );
}
