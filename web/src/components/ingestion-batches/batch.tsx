/**
 * One ingestion batch — the postings that arrived in a single alert or digest email — as a
 * collapsible block. Ported from `renderBatch` in `web/components/jobs.go` (see
 * docs/GO_MIGRATION.md).
 *
 * ## Native `<details>`, no click handler, no state
 *
 * The block is a real `<details>`/`<summary>`, exactly as the Go build rendered it, and that
 * is a deliberate choice rather than a shortcut. The browser owns the open/closed state, so
 * there is no handler to wire, nothing to keep in React state, and — the part that matters
 * for testing — **every posting is in the DOM whether or not the block is expanded**. A
 * hand-rolled disclosure would have to be clicked open before its rows could be asserted on,
 * and jsdom does not implement `<details>` activation behaviour, so the rows would be
 * unreachable from a test that renders the screen the way an owner sees it.
 *
 * `app.css` styles the summary's own marker (`.digest-batch-summary::after`, rotated by
 * `.digest-batch[open]`) and hides the native one, so the chevron follows the element's real
 * state with no JavaScript at all.
 *
 * ## `open` is set, then left alone
 *
 * `open` is applied only when this batch is the one the owner is returning to (`?batch=…`).
 * React writes the attribute on mount and does not touch it again while the prop holds its
 * value, so a manual expand or collapse sticks — `<details>` is not one of React's controlled
 * elements. Go made the same trade by hand, and for a sharper reason: go-app rendered
 * `.Open(false)` as `open="false"`, which a browser treats as **open**, so the attribute had
 * to be omitted rather than set to false. Rendering `open={false}` here is safe (React omits
 * a false boolean attribute), but the behaviour is identical and worth keeping recognisable.
 *
 * The postings reuse the feed's shared pills (`job-row.tsx`) rather than restating them, as
 * `sourceIcon` / `lifecycleStatusPill` were shared in Go. Note what a `.digest-link` does
 * *not* carry: no origin pill on the posting itself, because the batch summary above it
 * already names the source for every row it contains.
 */
import { Link } from "react-router";

import type { IngestionBatch } from "../../api/schemas";
import {
  batchCountLabel,
  batchLinkQuery,
  batchSourceLabel,
  formatBatchTime,
} from "../../lib/ingestion-batches";
import { sourceEmoji, sourceIconPath, sourceLabel } from "../../lib/labels";
import { JobPills } from "../jobs/job-row";

export function Batch({ batch, open }: { batch: IngestionBatch; open: boolean }) {
  const time = formatBatchTime(batch.ingested_at);
  return (
    <details className="digest-batch" open={open}>
      <summary className="digest-batch-summary">
        <span className="job-source">
          <BatchSourceMarker source={batch.source} />
          {batchSourceLabel(batch.source)}
        </span>
        <span className="digest-batch-count">{batchCountLabel(batch.count)}</span>
        {time === "" ? null : <span className="digest-batch-time">{time}</span>}
      </summary>
      <ul className="digest-items">
        {batch.jobs.map((job) => (
          <li className="digest-item" key={job.id}>
            <Link className="digest-link" to={`/jobs/${job.id}?${batchLinkQuery(batch.id)}`}>
              <span className="job-title">{job.title}</span>
              <span className="job-company">{job.company}</span>
              <JobPills job={job} />
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * `sourceIcon` for a batch summary: the self-hosted brand SVG, an emoji for the sources with
 * no logo, or nothing.
 *
 * Identical to `job-row.tsx`'s `SourceMarker`, and deliberately not exported from there: that
 * one belongs to `SourcePill`, which suppresses the whole pill for an unrecorded source. A
 * batch summary cannot do that — it is the row the owner clicks — so it pairs this marker
 * with `batchSourceLabel`'s `Other` fallback instead. Only the branded sources reach the
 * image branch, so the `alt` is never the empty label.
 */
function BatchSourceMarker({ source }: { source: string }) {
  const icon = sourceIconPath(source);
  if (icon !== "") {
    return <img className="job-source-logo" src={icon} alt={sourceLabel(source)} loading="lazy" />;
  }
  const emoji = sourceEmoji(source);
  return emoji === "" ? null : <span className="job-source-emoji">{emoji}</span>;
}
