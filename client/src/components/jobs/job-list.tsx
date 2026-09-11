/**
 * The jobs feed, ported from the list half of `JobList` in `web/components/jobs.go`
 * (see docs/GO_MIGRATION.md): one page of `GET /api/job_posts`, its rows, and Prev/Next.
 *
 * ## Rails owns the feed; this screen owns only what it is asking for
 *
 * Filtering, sorting, and paging are entirely server-side (`Api::JobPostsController#index`,
 * AGENTS.md 2026-06-23), and nothing here re-does any of it: a filter change is a new request,
 * the rows are rendered in the order they arrive, and the Prev/Next buttons read the response's
 * own `page` envelope rather than counting rows. That is not a style preference — a client-side sort would
 * reorder only the 30 rows of the current page, and a client-side `has_next` guess would
 * either hide the last page or offer an empty one.
 *
 * Two defaults are load-bearing and come straight from `feedParams`: `status=scored` and
 * `state=active`. The feed deliberately shows the scored, active working set, because
 * deterministic triage leaves most inbound postings `deferred` or `filtered`. (The
 * *tracker* is the screen that asks for `status=all` — conflating the two is what left the
 * all-jobs table empty in production, AGENTS.md 2026-09-08.)
 *
 * ## The selection is restored before the first fetch, and saved after every change
 *
 * The router recreates this component on every navigation to `/jobs`, so its state alone cannot
 * survive a trip into a job and back — `localStorage` is what does (AGENTS.md 2026-07-06).
 * `useState(readSelection)`'s lazy initializer runs during the first render, *before* the
 * `useQuery` below reads it, so the very first request already carries the restored filters
 * rather than fetching the defaults and correcting itself.
 *
 * Saving runs from an effect on every selection change, which is where `jobs.go` did it too
 * (inside `load()`, so every fetch re-persisted). A failed write is deliberately not surfaced:
 * filters that do not survive a reload are a much smaller surprise than a layout preference
 * that does not, and the selection still governs this session either way.
 *
 * ## What is deliberately not here
 *
 * The lifecycle bin tabs, the per-row manage bar, bulk actions, and score-on-demand are
 * `FE-17`. The selection already carries `bin` — it is part of the saved `waunder.jobFilters`
 * struct and is restored, sent, and re-saved faithfully — so that task adds tabs over state
 * that already exists rather than widening the query again.
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router";

import { fetchJobs } from "../../api/endpoints";
import { queryKeys } from "../../api/keys";
import type { PageMeta } from "../../api/schemas";
import { emptyFeedText, feedParams, pageIndicatorLabel } from "../../lib/job-feed";
import { readSelection, writeSelection } from "../../lib/job-filters";
import { AppChrome } from "../app-chrome";
import { LoadError, Loading } from "../load-state";
import { JobFilters } from "./job-filters";
import { JobRow } from "./job-row";

export function JobList() {
  // Restored from `waunder.jobFilters` during this first render, so the query below opens on
  // the owner's last selection. `pageNum` is 1-based, exactly as Rails and the page envelope
  // count; page 1 sends no `page` param at all, so it shares a cache entry with an
  // unparameterized read.
  const [selection, setSelection] = useState(readSelection);
  useEffect(() => {
    writeSelection(selection);
  }, [selection]);

  const params = feedParams(selection);
  const { data, isPending, isError, error } = useQuery({
    queryKey: queryKeys.jobs.list(params),
    queryFn: () => fetchJobs(params),
  });

  return (
    <div className="job-list">
      <AppChrome />
      <h1>Jobs</h1>
      <Link className="job-list-import" to="/jobs/new">
        Import job
      </Link>
      <div className="job-feed-workspace">
        {/* FE-17 adds the lifecycle bin tabs to this column, between the two. */}
        <div className="job-feed-controls">
          <JobFilters selection={selection} onChange={setSelection} />
        </div>
        {isPending ? (
          <Loading />
        ) : isError ? (
          <LoadError error={error} />
        ) : data.job_posts.length === 0 ? (
          <EmptyFeed text={emptyFeedText(selection)} />
        ) : (
          <div className="job-list-results">
            <ul className="job-list-items">
              {data.job_posts.map((job) => (
                <JobRow key={job.id} job={job} />
              ))}
            </ul>
            <Pagination
              page={data.page}
              onPrevious={() => {
                setSelection((current) =>
                  current.pageNum <= 1 ? current : { ...current, pageNum: current.pageNum - 1 },
                );
              }}
              onNext={() => {
                setSelection((current) =>
                  data.page.has_next
                    ? { ...current, pageNum: Math.max(current.pageNum, 1) + 1 }
                    : current,
                );
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The empty feed. The import link matters more than the sentence: an owner who filtered
 * everything away or has not ingested anything yet needs a way forward from here.
 */
function EmptyFeed({ text }: { text: string }) {
  return (
    <div className="job-list-empty">
      <p>{text}</p>
      <Link className="job-list-empty-action" to="/jobs/new">
        Import a job
      </Link>
    </div>
  );
}

/**
 * Prev/Next plus the position indicator, driven entirely by the response envelope.
 *
 * Both buttons are disabled from Rails' own answer — `number <= 1` and `has_next` — rather
 * than from any local count, and the handlers re-check the same conditions so a stale
 * render cannot step past either end.
 */
function Pagination({
  page,
  onPrevious,
  onNext,
}: {
  page: PageMeta;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className="job-pagination">
      <button className="job-page-prev" disabled={page.number <= 1} onClick={onPrevious}>
        Previous
      </button>
      <span className="job-page-indicator">{pageIndicatorLabel(page)}</span>
      <button className="job-page-next" disabled={!page.has_next} onClick={onNext}>
        Next
      </button>
    </div>
  );
}
