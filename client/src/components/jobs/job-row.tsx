/**
 * One job-feed row card, ported from `renderJobRow` and the shared pill helpers in
 * `web/components/jobs.go` (see docs/GO_MIGRATION.md).
 *
 * A row is a link to the posting carrying four things: the title, the company, an origin
 * pill saying where the posting was ingested from, and a `.job-pills` column holding the
 * colour-banded match score beside the lifecycle bin. Every class name is unchanged from
 * the Go build, because `public/app.css` styles the row as a grid keyed on exactly these
 * classes and the `FE-28` parity gate compares the rendered result.
 *
 * **The row renders no location.** `Api::JobPostsController#serialize_summary` does not
 * emit one, `JobSummary` has no such field, and `app.css` styles no `.job-location` in a
 * feed row — the posting's location reaches the owner through the triage reasons and the
 * detail screen instead. Adding an element here would be a new design, not a port, and
 * would fail the parity gate.
 *
 * The manage bar the Go row rendered after the card (`.job-list-actions`: the selection
 * checkbox, the lifecycle buttons, and the score-on-demand control) is `job-actions.tsx`,
 * passed in as `actions`. It is a prop rather than something this row builds, because the
 * row is a pure function of one `JobSummary` while the manage bar needs the feed's selection,
 * its in-flight writes, and the bin being shown — and because the ingestion landing renders
 * rows with no manage bar at all.
 *
 * `SourcePill` and `LifecycleStatusPill` were shared helpers in the Go file too
 * (`sourceIcon`, `lifecycleStatusPill`), rendered identically by the ingestion batches
 * (`FE-18`) and the job detail (`FE-19`); they are exported here for those screens rather
 * than transcribed a second time.
 */
import type { ReactNode } from "react";
import { Link } from "react-router";

import type { JobSummary } from "../../api/schemas";
import {
  lifecycleLabel,
  matchScoreBand,
  matchScoreLabel,
  sourceEmoji,
  sourceIconPath,
  sourceLabel,
} from "../../lib/labels";

export function JobRow({ job, actions }: { job: JobSummary; actions?: ReactNode }) {
  return (
    <li className="job-list-item">
      <Link className="job-list-link" to={`/jobs/${job.id}`}>
        <span className="job-title">{job.title}</span>
        <span className="job-company">{job.company}</span>
        <SourcePill source={job.source} />
        <JobPills job={job} />
      </Link>
      {actions}
    </li>
  );
}

/**
 * The `.job-pills` column: the score pill and the lifecycle pill, stacked top-right of the
 * card.
 */
export function JobPills({ job }: { job: JobSummary }) {
  return (
    <div className="job-pills">
      <ScorePill score={job.match_score} scoringStatus={job.scoring_status} />
      <LifecycleStatusPill state={job.lifecycle_state} />
    </div>
  );
}

/**
 * The match score, colour-coded by band.
 *
 * The band class is not decoration: `.job-score` defines only shape, and the base rule
 * deliberately sets no colour, so a pill rendered without a band comes out unstyled. That
 * is why `matchScoreBand` is called unconditionally rather than only for a scored posting —
 * an unscored one gets the neutral `--pending` pill, never a "low" red one.
 */
export function ScorePill({
  score,
  scoringStatus,
}: {
  score: number | null;
  scoringStatus: string;
}) {
  return (
    <span className={`job-score job-score--${matchScoreBand(score)}`}>
      {matchScoreLabel(score, scoringStatus)}
    </span>
  );
}

/**
 * The Active / Backlog / Removed pill beside the score, so a card's intake bin is visible
 * at a glance — most useful on the mixed ingestion landing, where rows are not filtered by
 * bin.
 *
 * An empty state takes the `active` class, matching the `job_posts.lifecycle_state` column
 * default: an older payload that omits the field must still paint a pill rather than
 * `job-status--`.
 */
export function LifecycleStatusPill({ state }: { state: string }) {
  return (
    <span className={`job-status job-status--${state === "" ? "active" : state}`}>
      {lifecycleLabel(state)}
    </span>
  );
}

/**
 * The origin pill: where the posting came from, led by its brand logo or emoji marker.
 *
 * An unrecognised-but-present source still renders (`sourceLabel` passes it through), while
 * an empty source suppresses the pill entirely — a blank pill would read as a missing
 * value rather than as "no source recorded".
 */
export function SourcePill({ source }: { source: string }) {
  const label = sourceLabel(source);
  if (label === "") {
    return null;
  }
  return (
    <span className="job-source">
      <SourceMarker source={source} />
      {label}
    </span>
  );
}

/**
 * `sourceIcon`: the self-hosted brand SVG for a branded source, an emoji for the ones with
 * no logo (manual entry, unattributed email alerts), or nothing when neither applies.
 *
 * The logo paths are same-origin files under `public/icons/`, resolved by
 * `sourceIconPath` — they carry no `/web/` prefix any more (docs/GO_MIGRATION.md), and a
 * stale one would 404 silently and drop only the logo.
 *
 * Exported for the job detail (`FE-19`), which renders the same marker before a
 * `Source: <label>` sentence rather than inside the feed's pill.
 */
export function SourceMarker({ source }: { source: string }) {
  const icon = sourceIconPath(source);
  if (icon !== "") {
    return <img className="job-source-logo" src={icon} alt={sourceLabel(source)} loading="lazy" />;
  }
  const emoji = sourceEmoji(source);
  return emoji === "" ? null : <span className="job-source-emoji">{emoji}</span>;
}
