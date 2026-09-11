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
import { isServiceUnavailable, isUnauthorized } from "../api/errors";

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
