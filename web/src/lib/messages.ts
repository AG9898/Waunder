/**
 * Owner-facing failure copy, and the mapping from a thrown error to it.
 *
 * In Go these were a package-level `sessionExpiredMessage` const plus one literal per call
 * site — `applyResult`'s "Could not load data. Please try again.",
 * `applyLifecycleResult`'s "Could not update the job. Please try again.", and
 * `applyScoreResult`'s "Could not request scoring." (`web/components/jobs.go`; see
 * docs/GO_MIGRATION.md). They live together here for the same reason they shared a const
 * there: the expired-session sentence is rendered by every screen, and a second copy of it
 * drifts silently — the string is what `load-state.tsx` compares against to decide whether
 * to offer the Sign in link, so a stray full stop there is a missing link, not a typo.
 *
 * **Only a 401 is an auth failure.** A 403 is a decision Rails made about an authenticated
 * owner and must never read as a dead session — signing the owner out over an authorization
 * answer loses the session they still have.
 *
 * Reads and writes are mapped by *different* functions on purpose. "Could not load data"
 * after pressing Remove would be wrong in the way that matters: it describes the screen
 * rather than the action that failed, and the owner cannot tell whether the row moved.
 */
import {
  apiErrorCode,
  apiErrorMessage,
  asAPIError,
  isServiceUnavailable,
  isUnauthorized,
} from "../api/errors";

/** The expired-session sentence. `load-state.tsx` keys its Sign in link off this exact string. */
export const SESSION_EXPIRED = "Your session expired. Please sign in again.";

/** `applyResult`'s message for any non-401 read failure. */
const LOAD_FAILED = "Could not load data. Please try again.";

/** `applyLifecycleResult`'s message for a failed backlog / remove / restore. */
const LIFECYCLE_FAILED = "Could not update the job. Please try again.";

/**
 * `applyScoreResult`'s message. Deliberately has no "please try again": scoring spends real
 * OpenRouter budget, and an invitation to retry is the wrong nudge when the likely cause is
 * a rate-limited free-tier model (AGENTS.md 2026-06-22).
 */
const SCORE_FAILED = "Could not request scoring.";

/**
 * `applyCreateResult`'s message for a failed `POST /api/applications`. "Start" rather than
 * "apply": the request prepares a draft for review and submits nothing, so copy that implied an
 * application had been sent would be a lie about a trusted-submit boundary.
 */
const APPLICATION_FAILED = "Could not start the application. Please try again.";

/** `applyIntakeResult`'s message for a failed pause or resume of inbound email processing. */
const INTAKE_FAILED = "Could not update intake. Please try again.";

/** A failed read: the screen could not be filled. */
export function loadErrorMessage(error: unknown): string {
  return isUnauthorized(error) ? SESSION_EXPIRED : LOAD_FAILED;
}

/** A failed lifecycle write: the rows the owner acted on did not move. */
export function lifecycleErrorMessage(error: unknown): string {
  return isUnauthorized(error) ? SESSION_EXPIRED : LIFECYCLE_FAILED;
}

/** A failed score-on-demand request: no scoring was queued for that posting. */
export function scoreErrorMessage(error: unknown): string {
  return isUnauthorized(error) ? SESSION_EXPIRED : SCORE_FAILED;
}

/**
 * A failed intake pause/resume: inbound processing is still in whatever state it was in.
 *
 * `applyIntakeResult` in `jobs.go` had no 401 branch — it reported this sentence for every
 * failure. The branch is added here for the same reason every other write mapper has one:
 * a dead session is not "try again", and the owner clicking Resume twice against an expired
 * cookie learns nothing from a sentence that invites a third click.
 */
export function intakeErrorMessage(error: unknown): string {
  return isUnauthorized(error) ? SESSION_EXPIRED : INTAKE_FAILED;
}

/** A failed `POST /api/applications`: no draft was started and nothing was submitted. */
export function applicationErrorMessage(error: unknown): string {
  return isUnauthorized(error) ? SESSION_EXPIRED : APPLICATION_FAILED;
}

/** `applyJobStatusResult`'s message for a failed manual tracker edit (`FE-20`). */
const TRACKER_FAILED = "Could not update application status.";

/**
 * `applyCoverLetterResult`'s 503 branch. "Later" rather than "again" on purpose: Rails answers
 * 503 when no `OPENROUTER_API_KEY` is configured, so a second click now changes nothing.
 */
const COVER_LETTER_UNAVAILABLE = "Cover-letter generation is unavailable. Please try again later.";

/** `applyCoverLetterResult`'s message for any other generation failure (Rails answers 502). */
const COVER_LETTER_FAILED = "Could not generate the cover letter. Please try again.";

/**
 * A failed tracker write: the posting's pipeline status is still whatever Rails held before
 * the click. Deliberately has no "please try again" — Go's copy had none, and the owner can
 * see from the unchanged status line that nothing moved.
 */
export function trackerErrorMessage(error: unknown): string {
  return isUnauthorized(error) ? SESSION_EXPIRED : TRACKER_FAILED;
}

/**
 * A failed cover-letter generation, with the three-way split `applyCoverLetterResult` made:
 * an expired session, a generator that is not configured (503), and one that ran and failed
 * (502 or anything else). Nothing was written either way — the previous letter, if there was
 * one, is untouched.
 */
export function coverLetterErrorMessage(error: unknown): string {
  if (isUnauthorized(error)) return SESSION_EXPIRED;
  return isServiceUnavailable(error) ? COVER_LETTER_UNAVAILABLE : COVER_LETTER_FAILED;
}

/**
 * `applyGenerateResult`'s 503 branch in `contacts.go`, verbatim. Rails answers 503
 * `llm_unavailable` when `OutreachDraftGenerator` was skipped because no `OPENROUTER_API_KEY` is
 * configured, so this deliberately does not invite another click.
 */
const OUTREACH_UNAVAILABLE = "Outreach drafting is not configured right now.";

/** `applyGenerateResult`'s message for a generator that ran and failed (Rails answers 502). */
const OUTREACH_FAILED = "Could not generate a draft. Please try again.";

/** A failed contact save that Rails did not explain with a validation sentence. */
const CONTACT_SAVE_FAILED = "Could not save the contact. Please try again.";

/**
 * A failed outreach generation, with `applyGenerateResult`'s three-way split: an expired session,
 * a generator that is not configured (503 `llm_unavailable`), and one that ran and failed (502
 * `generation_failed`, or anything else). Nothing was sent either way — nothing ever is.
 */
export function outreachErrorMessage(error: unknown): string {
  if (isUnauthorized(error)) return SESSION_EXPIRED;
  return isServiceUnavailable(error) ? OUTREACH_UNAVAILABLE : OUTREACH_FAILED;
}

/**
 * A failed `POST /api/job_posts/:id/contact_candidates`. A 422 `invalid_input` carries Rails' own
 * validation sentence ("Relevance reason can't be blank"), which is rendered as sent: Rails owns
 * what a valid contact is, and a paraphrase here would drift from it.
 */
export function contactSaveErrorMessage(error: unknown): string {
  if (isUnauthorized(error)) return SESSION_EXPIRED;
  const railsSentence = apiErrorMessage(error);
  if (apiErrorCode(error) === "invalid_input" && railsSentence !== "") return railsSentence;
  return CONTACT_SAVE_FAILED;
}

/**
 * `createErrorStatus`'s 422 sentence in `manual_entry.go`, kept for a 422 that arrives without a
 * validation sentence of Rails' own.
 */
const IMPORT_INVALID = "Could not add that job. Provide a valid URL or paste the posting text.";

/** `createErrorStatus`'s message for any other failed import. */
const IMPORT_FAILED = "Could not add the job. Please try again.";

/**
 * `lookupErrorNote`'s sentence for a posting that could not be read. Exported because it has two
 * sources that read the same: a lookup request that failed, and a lookup Rails answered 200 with
 * `status` `unsupported` or `unavailable` — which is not an error, so it never reaches a mapper.
 */
export const POSTING_UNREADABLE =
  "Could not read that posting. Add the title and company yourself.";

/**
 * A failed `POST /api/job_posts`. A 422 `invalid_input` renders Rails' own sentence as sent
 * ("URL must be an HTTP or HTTPS URL", or several rules joined with ", ") instead of Go's
 * paraphrase: Rails says *which* field it rejected, and the paraphrase could only guess. Nothing
 * was imported in any branch.
 */
export function importErrorMessage(error: unknown): string {
  if (isUnauthorized(error)) return SESSION_EXPIRED;
  if (asAPIError(error)?.status !== 422) return IMPORT_FAILED;
  const railsSentence = apiErrorMessage(error);
  return apiErrorCode(error) === "invalid_input" && railsSentence !== ""
    ? railsSentence
    : IMPORT_INVALID;
}

/** `applySaveResult`'s message for a failed `PATCH /api/profile` in `profile.go`. */
const PROFILE_SAVE_FAILED = "Could not save your profile. Please try again.";

/**
 * A failed profile save. A 422 renders Rails' own sentence ("Full name can't be blank") instead of
 * Go's generic copy: `Profile` validates `full_name` presence, so clearing that field was the one
 * failure the owner could cause, and Go told them to "try again" with the field still empty.
 * Rails answers that 422 with code `unprocessable` rather than `invalid_input`, so the branch keys
 * on the status, as `importErrorMessage` does. Nothing was written in any branch.
 */
export function profileSaveErrorMessage(error: unknown): string {
  if (isUnauthorized(error)) return SESSION_EXPIRED;
  if (asAPIError(error)?.status !== 422) return PROFILE_SAVE_FAILED;
  const railsSentence = apiErrorMessage(error);
  return railsSentence !== "" ? railsSentence : PROFILE_SAVE_FAILED;
}

/**
 * A failed `POST /api/job_posts/lookup`. Non-blocking by design — the fields stay editable and
 * the import still works — so the only case worth telling apart is the one the owner must act on.
 */
export function lookupErrorMessage(error: unknown): string {
  return isUnauthorized(error) ? SESSION_EXPIRED : POSTING_UNREADABLE;
}

/** `blockedSubmitMessage` / `submitErrorStatus`'s sentence for a draft Rails has not finished. */
const DRAFT_NOT_READY = "The draft is still being prepared. Try again in a moment.";
/** The sentence for a payload Rails' dispatcher refused as unresolved or sensitive. */
const MANUAL_REVIEW_REQUIRED = "Manual review is required before auto-submit.";
/** `submitErrorStatus`'s `unsupported_ats` sentence. */
const UNSUPPORTED_ATS = "Auto-submit is not supported for this application route.";
/** `submitErrorStatus`'s `invalid_payload` sentence. */
const INVALID_PAYLOAD = "The autofill preview needs review before submit.";
/** `submitErrorStatus`'s message for any other refusal or failure. */
const SUBMIT_FAILED = "Submit failed. Please try again.";
/** `previewSaveErrorStatus`'s message for a failed `PATCH /api/applications/:id/draft`. */
const DRAFT_SAVE_FAILED = "Could not save the autofill preview. Please try again.";

/**
 * A refused or failed `POST /api/applications/:id/submit`, keyed on the `error.code` Rails'
 * `ApplicationSubmitDispatcher` answered with. Nothing reached the worker in any branch.
 */
export function submitErrorMessage(error: unknown): string {
  if (isUnauthorized(error)) return SESSION_EXPIRED;
  switch (apiErrorCode(error)) {
    case "draft_required":
      return DRAFT_NOT_READY;
    case "unsafe_payload":
      return MANUAL_REVIEW_REQUIRED;
    case "unsupported_ats":
      return UNSUPPORTED_ATS;
    case "invalid_payload":
      return INVALID_PAYLOAD;
    default:
      return SUBMIT_FAILED;
  }
}

/** A failed save of the reviewed autofill answers: Rails still holds the previous answers. */
export function draftSaveErrorMessage(error: unknown): string {
  return isUnauthorized(error) ? SESSION_EXPIRED : DRAFT_SAVE_FAILED;
}

/**
 * `blockedSubmitMessage`: why a submit stopped *before* reaching Rails' submit endpoint, because
 * the answers Rails stored on the save that preceded it came back with warnings or incomplete.
 */
export function blockedSubmitMessage(hasWarnings: boolean): string {
  return hasWarnings ? MANUAL_REVIEW_REQUIRED : DRAFT_NOT_READY;
}
