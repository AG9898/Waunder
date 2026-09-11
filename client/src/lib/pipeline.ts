/**
 * The manual application tracker: its two option tables, the label they render, the rule that
 * decides whether the quick action is offered, and the mutation that writes a change.
 *
 * Ported from `pipelineStatusDefs`, `pipelineStageDefs`, `optionNodes`, `pipelineStageValue`,
 * `PipelineStatusLabel` (`web/components/applications.go`) and `canMarkApplied` /
 * `saveJobPipelineStatus` / `applyJobStatusResult` (`web/components/jobs.go`); see
 * docs/GO_MIGRATION.md. The job detail (`FE-20`) and the tracker table (`FE-22`) render the
 * same two selects, so they live here rather than in either screen.
 *
 * ## This is the tracker lifecycle, never the worker one
 *
 * `PATCH /api/job_posts/:id/application_status` is the owner saying what *they* did by hand.
 * Rails creates the Application row on first use, so an untouched posting can be marked
 * applied, and the endpoint enqueues no job: it never generates a draft, never approves, and
 * never dispatches the Playwright submit worker (AGENTS.md 2026-06-22, 2026-09-08). Nothing in
 * this module may grow a call to `createApplication` or `submitApplication`.
 *
 * ## Two values Rails reads in a way that looks like a bug and is not
 *
 * - **An empty `pipeline_stage` is not "no stage".** `Application#assign_pipeline_status` does
 *   `stage.presence || DEFAULT_PIPELINE_STAGE_BY_STATUS[status]`, so sending `""` asks Rails for
 *   that status's default stage (`applied` → `waiting`, everything else → none). Go's status
 *   select relied on exactly that: changing the status sends a blank stage and lets Rails pick.
 * - **`pipeline_note` and `next_follow_up_on` must stay absent.** They carried `,omitempty` in
 *   Go, and `update_pipeline_status` assigns each one only when it is non-nil. Sending `""`
 *   would erase a note the owner wrote on another screen, so `ApplicationStatusUpdate` leaves
 *   them optional and nothing here ever fills them in.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { updateJobApplicationStatus } from "../api/endpoints";
import { queryKeys } from "../api/keys";
import type { ApplicationStatusUpdate, ApplicationTracker } from "../api/schemas";
import { trackerErrorMessage } from "./messages";

/** One `<option>`: the value Rails stores, and what the owner reads. */
export interface PipelineOption {
  value: string;
  label: string;
}

/** `pipelineStatusDefs`. The values are `Application::PIPELINE_STATUSES`, in Rails' order. */
export const PIPELINE_STATUS_OPTIONS: readonly PipelineOption[] = [
  { value: "interested", label: "Interested" },
  { value: "drafting", label: "Drafting" },
  { value: "applied", label: "Applied" },
  { value: "interviewing", label: "Interviewing" },
  { value: "offer", label: "Offer" },
  { value: "rejected", label: "Rejected" },
  { value: "withdrawn", label: "Withdrawn" },
  { value: "archived", label: "Archived" },
  { value: "needs_review", label: "Needs review" },
];

/**
 * The DOM value of the "No stage" choice.
 *
 * go-app dropped an empty `value` attribute, so an `<option>` with no stage reported its *text*
 * as its value — the bug that made the feed's Source filter query `source=All`
 * (AGENTS.md 2026-06-24). `optionNodes` avoided it by rendering `"none"` and mapping it back on
 * read, and that round trip is kept here: React would render `value=""` correctly, but this
 * sentinel is the value the production build puts in the DOM today, and `FE-16` only dropped
 * the feed's `allOption` because *that* sentinel leaked into the request. This one cannot —
 * `stageOptionValue` is the only way a change reaches an update, and it normalizes first.
 *
 * Rails must never receive the literal string: `pipeline_stage` is validated against
 * `/\A[a-z0-9_]+\z/`, so `"none"` would be *accepted* and stored as a real stage named "none".
 */
export const STAGE_NONE = "none";

/** `pipelineStageDefs`. The first entry is the empty stage, rendered as the sentinel. */
export const PIPELINE_STAGE_OPTIONS: readonly PipelineOption[] = [
  { value: "", label: "No stage" },
  { value: "waiting", label: "Waiting" },
  { value: "recruiter_screen", label: "Recruiter screen" },
  { value: "phone_screen", label: "Phone screen" },
  { value: "technical", label: "Technical" },
  { value: "take_home", label: "Take-home" },
  { value: "onsite", label: "Onsite" },
  { value: "final", label: "Final" },
  { value: "reference_check", label: "Reference check" },
  { value: "offer_negotiation", label: "Offer negotiation" },
];

/**
 * `optionNodes`' outbound mapping: the DOM value for a stored value, which is the sentinel when
 * the stored value is empty. Applied to every option and to the stage select's current value.
 * Only `PIPELINE_STAGE_OPTIONS` has an empty entry, so it is a no-op for the status list — as
 * it was in Go, where one helper rendered both.
 */
export function selectValue(value: string): string {
  return value === "" ? STAGE_NONE : value;
}

/** `pipelineStageValue`: the stage a select change means, with the sentinel mapped back. */
export function stageFromSelectValue(value: string): string {
  return value === STAGE_NONE ? "" : value;
}

/**
 * `PipelineStatusLabel`: what the tracker line says.
 *
 * The stage is appended only when it adds something. `interested` and `drafting` are states the
 * owner has not acted from yet, so a stage on either would describe a conversation that has not
 * happened; an unknown status falls back to "Interested" rather than rendering a raw column
 * value at the owner.
 */
export function pipelineStatusLabel(status: string, stage: string): string {
  const statusLabel = optionLabel(status, PIPELINE_STATUS_OPTIONS) || "Interested";
  const stageLabel = optionLabel(stage, PIPELINE_STAGE_OPTIONS);
  if (stage === "" || stageLabel === "" || status === "interested" || status === "drafting") {
    return statusLabel;
  }
  return `${statusLabel} · ${stageLabel}`;
}

/**
 * `canMarkApplied`: whether the one-click "Mark as applied" is offered.
 *
 * Offered for an untracked posting and for the three states that precede applying; withheld for
 * `applied`, `interviewing`, `offer`, `rejected`, `withdrawn`, and `archived`. The point is not
 * tidiness — the button writes `applied` + `waiting` unconditionally, so offering it on an
 * interviewing posting would let one tap walk the tracker *backwards* and overwrite a stage the
 * owner set deliberately. Those states are edited through the selects instead.
 */
export function canMarkApplied(application: ApplicationTracker | null): boolean {
  if (application === null) return true;
  return (
    application.pipeline_status === "interested" ||
    application.pipeline_status === "drafting" ||
    application.pipeline_status === "needs_review"
  );
}

/** The update the quick action sends: applied, awaiting a response. */
export const MARK_APPLIED_UPDATE: ApplicationStatusUpdate = {
  pipeline_status: "applied",
  pipeline_stage: "waiting",
};

/** What a screen needs to render the tracker controls: the in-flight flag, copy, and the write. */
export interface TrackerWrite {
  /** True while a write and its refetch are in flight. Disables every tracker control. */
  saving: boolean;
  /** The last failure's owner-facing sentence, or `""`. */
  error: string;
  /** Sends one tracker edit. Ignored while another is in flight. */
  save: (update: ApplicationStatusUpdate) => void;
}

/**
 * The tracker mutation for one posting.
 *
 * Two decisions carried from the screens that use it. The invalidations are **awaited**, as the
 * job detail's lifecycle write is: the owner stays on the posting, so the controls must not
 * re-enable until the refetched tracker says what Rails now holds — that refetch is also what
 * makes the *next* click read current state rather than the answer to the last one. And it
 * refuses to start a second write while one is in flight, because two edits racing on one
 * Application decide the final status by response order rather than by click order.
 *
 * `jobs.root()` covers the feed, the detail, and the tracker table; `applications.root()` covers
 * the draft-review screen, which renders the same pipeline status.
 */
export function useTrackerWrite(jobId: number): TrackerWrite {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (update: ApplicationStatusUpdate) => updateJobApplicationStatus(jobId, update),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.jobs.root() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.applications.root() }),
      ]);
    },
  });

  const { isPending, mutate } = mutation;
  const save = useCallback(
    (update: ApplicationStatusUpdate) => {
      if (isPending) return;
      mutate(update);
    },
    [isPending, mutate],
  );

  return {
    saving: isPending,
    error: mutation.isError ? trackerErrorMessage(mutation.error) : "",
    save,
  };
}

/** The label for `value` in `options`, or `""` when it is not one of them. */
function optionLabel(value: string, options: readonly PipelineOption[]): string {
  return options.find((option) => option.value === value)?.label ?? "";
}
