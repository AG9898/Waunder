/**
 * Pure helpers for the draft review screen, ported from the non-render half of
 * `web/components/draft.go` (see docs/GO_MIGRATION.md): `appIDFromPath`, `draftHeading`,
 * `draftReady`, `autofillReady`, `autofillPresent`, `canSubmit`, `submitButtonLabel`,
 * `previewSaveButtonLabel`, `submitNote`, `submitResultLabel`, `warningFor`, and the condition
 * `renderWorkerReport` rendered under. The failure copy (`submitErrorStatus`,
 * `previewSaveErrorStatus`, `blockedSubmitMessage`) is in `messages.ts` with the other mappers.
 *
 * They live in `lib/` for the reason `FE-15` recorded: `eslint-plugin-react-refresh` warns when a
 * component module also exports a plain function. `canSubmit` is worth testing directly anyway —
 * it is the client half of the trusted-submit gate.
 *
 * ## The client gate is a courtesy; Rails' dispatcher is the gate
 *
 * `canSubmit` decides only whether the button is enabled. Rails re-checks everything it covers —
 * a draft exists, the ATS is supported, every answer has a field and a value, nothing is
 * unresolved or sensitive — in `ApplicationSubmitDispatcher` before anything reaches the worker,
 * and the screen renders that refusal (`submitErrorMessage`). Nothing here may grow a way to
 * submit past a `false`.
 */
import type {
  ApplicationDraft,
  AutofillPreview,
  AutofillWarning,
  StructuredAnswer,
  SubmitResult,
} from "../api/schemas";
import { parseJobId } from "./job-detail";

/**
 * The application id from the `:id` route param. go-app matched `^/applications/\d+$`; React
 * Router accepts any segment, so a non-numeric one asks Rails for application 0 and renders its
 * 404, exactly as `parseJobId` does for the job detail.
 */
export function parseApplicationId(raw: string | undefined): number {
  return parseJobId(raw);
}

/**
 * Go's `strings.TrimSpace(s) == ""`. `String.prototype.trim` is not a drop-in: it also strips
 * U+FEFF, which Go keeps, and it keeps U+0085, which Go strips (`unicode.IsSpace`).
 */
const GO_BLANK = /^[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/;

function isBlank(value: string): boolean {
  return GO_BLANK.test(value);
}

/** `draftHeading`: job title and company, the title alone, or the application id. */
export function draftHeading(draft: ApplicationDraft): string {
  if (draft.job_title !== "" && draft.company !== "") {
    return `${draft.job_title} — ${draft.company}`;
  }
  if (draft.job_title !== "") return draft.job_title;
  return `Application #${String(draft.application_id)}`;
}

/** `autofillReady`: an ATS, an apply URL, and at least one answer. */
export function autofillReady(autofill: AutofillPreview): boolean {
  return !isBlank(autofill.ats) && !isBlank(autofill.apply_url) && autofill.answers.length > 0;
}

/** `autofillPresent`: any part of the preview exists, so "Preparing draft..." is no longer true. */
export function autofillPresent(autofill: AutofillPreview): boolean {
  return !isBlank(autofill.ats) || !isBlank(autofill.apply_url) || autofill.answers.length > 0;
}

/**
 * `draftReady`: Rails says the draft is ready, the preview is complete, and no answer has a blank
 * field or value. The answers checked are the ones on the draft passed in — the screen passes the
 * owner's unsaved edits, so clearing a value disables submit before any request is made.
 */
export function draftReady(draft: ApplicationDraft): boolean {
  if (!draft.draft_ready) return false;
  if (!autofillReady(draft.autofill_payload)) return false;
  return draft.autofill_payload.answers.every(
    (answer) => !isBlank(answer.field) && !isBlank(answer.value),
  );
}

/** `canSubmit`: ready, and Rails reported no manual-review warnings. */
export function canSubmit(draft: ApplicationDraft): boolean {
  return draftReady(draft) && draft.autofill_warnings.length === 0;
}

/** The draft as the owner currently sees it: Rails' draft with the edited answers laid over it. */
export function withAnswers(
  draft: ApplicationDraft,
  answers: StructuredAnswer[],
): ApplicationDraft {
  return { ...draft, autofill_payload: { ...draft.autofill_payload, answers } };
}

/** Go's `submitState`, which TanStack's per-mutation status cannot express: it spans a save and a submit. */
export type SubmitPhase = "idle" | "sending" | "done" | "error";

/** `submitButtonLabel`. Go spelled "Preparing draft..." with three dots and "Submitting…" with one glyph. */
export function submitButtonLabel(
  phase: SubmitPhase,
  draft: ApplicationDraft,
  dirty: boolean,
): string {
  switch (phase) {
    case "sending":
      return "Submitting…";
    case "done":
      return "Submitted";
    default:
      if (!draftReady(draft)) return "Preparing draft...";
      if (draft.autofill_warnings.length > 0) return "Manual review required";
      return dirty ? "Save and submit" : "Approve and submit";
  }
}

/** `previewSaveButtonLabel`, keyed on whether the last save is in flight or succeeded. */
export function previewSaveButtonLabel(
  saveState: "idle" | "pending" | "success" | "error",
  dirty: boolean,
): string {
  if (saveState === "pending") return "Saving...";
  if (saveState === "success" && !dirty) return "Saved";
  return dirty ? "Save preview" : "Preview saved";
}

/** `submitNote`: what pressing the button would do, or why it cannot be pressed. */
export function submitNote(draft: ApplicationDraft): string {
  if (!draftReady(draft)) return "The draft is still being prepared.";
  if (draft.autofill_warnings.length > 0) {
    return "This application has fields that need manual review before trusted auto-submit.";
  }
  return "Submitting dispatches a trusted automated submission. This is your explicit approval.";
}

/**
 * `submitResultLabel`, reading the status Rails returned. Rails answers `dispatched`, for which
 * this is Go's sentence byte for byte; Go hardcoded that word, so any other status Rails might
 * send would have been misreported as a dispatch.
 */
export function submitResultLabel(result: SubmitResult): string {
  const status = result.status !== "" ? result.status : "dispatched";
  if (result.ats !== "") return `Submitted: ${status} to ${result.ats}.`;
  return `Submitted: application ${status}.`;
}

/** `warningFor`: the first warning Rails attached to an answer's field. */
export function warningFor(
  warnings: readonly AutofillWarning[],
  field: string,
): AutofillWarning | undefined {
  return warnings.find((warning) => warning.field === field);
}

/**
 * `renderWorkerReport`'s condition: the worker's last report is shown only for an application it
 * paused or failed, and only when there is a reason or a report to show.
 */
export function showWorkerReport(draft: ApplicationDraft): boolean {
  const stopped = draft.status === "paused" || draft.status === "failed";
  return stopped && (draft.failure_reason !== "" || draft.worker_report !== null);
}
