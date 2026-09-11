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
import { isUnauthorized } from "../api/errors";

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
