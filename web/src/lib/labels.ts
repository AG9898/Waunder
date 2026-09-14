/**
 * Pure display helpers, ported from `web/components/client.go` and `applications.go`
 * (see docs/GO_MIGRATION.md).
 *
 * Every function here is total, synchronous, and free of any dependency on React, the
 * transport, or the DOM: given a field off an API payload it returns the string a screen
 * renders, or the exact CSS class suffix `app.css` styles. Nothing else belongs in this
 * module — a helper that fetches, formats a date against the local clock, or reads storage
 * is not a label.
 *
 * The returned strings are a **contract with `client/public/app.css`**, not free text:
 * `matchScoreBand` and `lifecycleLabel` feed `.job-score--<band>` and
 * `.job-status--<state>`, `trackerGroup` feeds `.tracker-row--<group>`, and
 * `sourceIconPath` resolves a file that must exist under `public/icons/`. The screenshot
 * parity gate (`FE-28`) compares the ported screens against the go-app build, so a
 * "tidier" label or a renamed band reads as a regression there rather than as a choice.
 *
 * Two spellings that look interchangeable and are not:
 *
 * - The unscored **band** is `"pending"` (`.job-score--pending`), but the unscored **feed
 *   filter** is `score_band=unscored` (`JobFeedParams`). They are different vocabularies —
 *   one is a CSS state, the other a Rails query value — and swapping them yields either an
 *   unstyled pill or an empty feed.
 * - `lifecycleLabel` renders the lifecycle *bin* (Active / Backlog / Removed);
 *   `trackerGroup` classifies the *application* pipeline. A job can be `active` and
 *   `closed` at once.
 */
import type { ApplicationTracker, JobFeedParams } from "../api/schemas";

/* -------------------------------------------------------------------------- */
/* Match score                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Renders a job's match score for display.
 *
 * `match_score` is `*int` on the wire: `null` means the posting carries no numeric score
 * yet and the reason lives in `scoring_status`, while `0` is a real 0% match. Collapsing
 * the two would tell the owner a posting scored zero when it was never scored, so the null
 * branch never produces a percentage.
 *
 * The status strings are Rails' own (`JobPostTriage` / `ScoreJobPostJob`): `pending` at
 * ingest, `deferred` when eligible but held by the daily scoring budget, `filtered` when
 * deterministic triage rejected it, `skipped` when no LLM key is configured, and `failed`
 * on a client error. An unrecognised status degrades to "Not scored" rather than leaking
 * the raw value, because this string sits inside a pill with no room to explain itself.
 */
export function matchScoreLabel(score: number | null, scoringStatus: string): string {
  if (score === null) {
    switch (scoringStatus) {
      case "pending":
      case "":
        return "Scoring…";
      case "filtered":
        return "Filtered";
      case "deferred":
        return "Queued later";
      case "skipped":
        return "Not scored";
      case "failed":
        return "Scoring failed";
      default:
        return "Not scored";
    }
  }
  return `${score}%`;
}

/**
 * Coarse band used to colour-code the score pill: `.job-score--high|mid|low|pending`.
 *
 * Thresholds are inclusive lower bounds — high at 75 and above, mid from 50 to 74, low
 * below 50 — and a `null` score is `"pending"`, never `"low"`, so an unscored posting is
 * never painted as a weak match. The band class owns the pill colour everywhere it is
 * rendered (feed row, ingestion batch row, job detail); the base `.job-score` rule defines
 * only shape, which is why every pill must carry a band.
 *
 * Go's `MatchScoreBand` took `scoringStatus` as a second argument and ignored it, since
 * `score === null` already covers every unscored status. `noUnusedParameters` forbids
 * carrying that dead parameter across, so it is dropped; `labels.test.ts` still runs the
 * Go case table, statuses included, to show the result never depended on it.
 */
export function matchScoreBand(score: number | null): MatchScoreBandName {
  if (score === null) {
    return "pending";
  }
  if (score >= 75) {
    return "high";
  }
  if (score >= 50) {
    return "mid";
  }
  return "low";
}

/**
 * Score-pill band names. Deliberately **not** `JobFeedParams["score_band"]`, which spells
 * the unscored case `"unscored"` — see the module header.
 */
export type MatchScoreBandName = "high" | "mid" | "low" | "pending";

/* -------------------------------------------------------------------------- */
/* Ingestion source                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Renders a job's ingestion source as a short human-readable origin tag.
 *
 * `inbound_llm` and `inbound` both mean "an email alert we could not attribute to a known
 * sender", so they share one label. An unknown source passes through verbatim — unlike a
 * score status, a new source value is readable on its own and showing it is better than
 * hiding a posting's provenance. An empty source renders nothing at all, which is what
 * suppresses the pill entirely.
 */
export function sourceLabel(source: string): string {
  switch (source) {
    case "linkedin":
      return "LinkedIn";
    case "glassdoor":
      return "Glassdoor";
    case "indeed":
      return "Indeed";
    case "manual":
      return "Manual entry";
    case "inbound_llm":
    case "inbound":
      return "Email alert";
    case "":
      return "";
    default:
      return source;
  }
}

/**
 * Same-origin path to a source's official brand logo, or `""` for a source that has none.
 *
 * The SVGs are vendored from Simple Icons with the brand colour baked into the fill and
 * self-hosted under `client/public/icons/` — no live CDN, matching the self-hosted-WOFF2
 * policy. Vite serves `public/` at the **site root**, so these paths drop go-app's `/web/`
 * prefix (`/web/icons/linkedin.svg` → `/icons/linkedin.svg`). A stale prefix 404s silently
 * and takes only the logo out of the pill, which is exactly the kind of miss that survives
 * a test suite, so the paths are asserted rather than eyeballed.
 *
 * Returning `""` is the hand-off to {@link sourceEmoji}: a source has a logo or an emoji
 * marker, never both.
 */
export function sourceIconPath(source: string): string {
  switch (source) {
    case "linkedin":
      return "/icons/linkedin.svg";
    case "glassdoor":
      return "/icons/glassdoor.svg";
    case "indeed":
      return "/icons/indeed.svg";
    default:
      return "";
  }
}

/**
 * Emoji marker for the sources with no brand logo (manual entry, unattributed email
 * alerts). Branded sources return `""` because they render {@link sourceIconPath} instead.
 */
export function sourceEmoji(source: string): string {
  switch (source) {
    case "manual":
      return "✍️";
    case "inbound_llm":
    case "inbound":
      return "📧";
    default:
      return "";
  }
}

/* -------------------------------------------------------------------------- */
/* Lifecycle bin                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Renders a job's lifecycle bin (`lifecycle_state`) as the short label on the status pill
 * beside the match score.
 *
 * An empty state reads as "Active", matching the `job_posts.lifecycle_state` column
 * default, so a row is never blank — the ingestion-batch serializer only started sending
 * this field for that pill, and an older payload without it must still render.
 */
export function lifecycleLabel(state: string): string {
  switch (state) {
    case "backlog":
      return "Backlog";
    case "removed":
      return "Removed";
    case "active":
    case "":
      return "Active";
    default:
      return state;
  }
}

/* -------------------------------------------------------------------------- */
/* Tracker group                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Tracker groups, derived from the feed's `application` filter so the two cannot drift:
 * the same four values name a tab, a Rails filter value, and a row tint.
 */
export type TrackerGroupName = NonNullable<JobFeedParams["application"]>;

/**
 * Classifies a job's tracked application into its tracker group, mirroring the Rails
 * `Api::JobPostsController::APPLICATION_GROUPS` constant:
 *
 * | Group | `pipeline_status` |
 * |---|---|
 * | `not_applied` | `interested`, `drafting`, `needs_review` (and no application at all) |
 * | `applied` | `applied` |
 * | `in_progress` | `interviewing`, `offer` |
 * | `closed` | `rejected`, `withdrawn`, `archived` |
 *
 * Rails owns group membership: it is what `application=` filtering and the
 * `application_counts` tally are computed from server-side, over the whole result set
 * rather than the current page. This copy exists **only to tint a row**
 * (`.tracker-row--<group>`) so applied and closed rows are separable at a glance. Never
 * count with it, never filter with it, and never let a screen recompute a tab total from
 * the rows it happens to be holding — that total would silently be per-page.
 *
 * An untracked job, or one still merely being considered or drafted, is `not_applied`:
 * nothing has been sent, which is the question the tab answers.
 */
export function trackerGroup(application: ApplicationTracker | null): TrackerGroupName {
  if (application === null) {
    return "not_applied";
  }
  switch (application.pipeline_status) {
    case "applied":
      return "applied";
    case "interviewing":
    case "offer":
      return "in_progress";
    case "rejected":
    case "withdrawn":
    case "archived":
      return "closed";
    default:
      return "not_applied";
  }
}
