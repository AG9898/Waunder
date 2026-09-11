/**
 * The jobs feed, ported from the list half of `JobList` in `web/components/jobs.go`
 * (see docs/GO_MIGRATION.md): one page of `GET /api/job_posts`, its rows, and Prev/Next.
 *
 * ## Rails owns the feed; this screen owns only which page it is looking at
 *
 * Filtering, sorting, and paging are entirely server-side (`Api::JobPostsController#index`,
 * AGENTS.md 2026-06-23), and nothing here re-does any of it: the rows are rendered in the
 * order they arrive, and the Prev/Next buttons read the response's own `page` envelope
 * rather than counting rows. That is not a style preference — a client-side sort would
 * reorder only the 30 rows of the current page, and a client-side `has_next` guess would
 * either hide the last page or offer an empty one.
 *
 * Two defaults are load-bearing and come straight from `feedParams`: `status=scored` and
 * `state=active`. The feed deliberately shows the scored, active working set, because
 * deterministic triage leaves most inbound postings `deferred` or `filtered`. (The
 * *tracker* is the screen that asks for `status=all` — conflating the two is what left the
 * all-jobs table empty in production, AGENTS.md 2026-09-08.)
 *
 * ## What is deliberately not here
 *
 * - The filter panel, the sort control, the scored/unscored view toggle, and the
 *   `waunder.jobFilters` persistence: `FE-16`. The `.job-feed-controls` column they fill is
 *   rendered here because `.job-feed-workspace` is a two-column grid on desktop.
 * - The lifecycle bin tabs, the per-row manage bar, bulk actions, and score-on-demand:
 *   `FE-17`.
 *
 * Both extend this component rather than replacing it, so the page state below is kept
 * separate from the query itself: adding a filter means widening `feedParams`
 * (`src/lib/job-feed.ts`) and resetting `page` to 1, which is exactly what `resetFeed` did
 * in Go.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";

import { fetchJobs } from "../../api/endpoints";
import { queryKeys } from "../../api/keys";
import type { PageMeta } from "../../api/schemas";
import { feedParams, pageIndicatorLabel } from "../../lib/job-feed";
import { AppChrome } from "../app-chrome";
import { LoadError, Loading } from "../load-state";
import { JobRow } from "./job-row";

/**
 * `emptyText` for the only selection this task can reach. `FE-16` and `FE-17` make it
 * conditional on the view and the bin ("No unscored jobs.", "No jobs in the backlog.",
 * "No removed jobs.").
 */
const EMPTY_FEED = "No scored jobs yet.";

export function JobList() {
  // 1-based, exactly as Rails and the page envelope count. Page 1 sends no `page` param at
  // all, so it shares a cache entry with an unparameterized read.
  const [page, setPage] = useState(1);
  const params = feedParams(page);
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
        {/* The controls column: filled by FE-16 (filters, sort, view) and FE-17 (bins). */}
        <div className="job-feed-controls" />
        {isPending ? (
          <Loading />
        ) : isError ? (
          <LoadError error={error} />
        ) : data.job_posts.length === 0 ? (
          <EmptyFeed />
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
                setPage((current) => (current <= 1 ? current : current - 1));
              }}
              onNext={() => {
                setPage((current) => (data.page.has_next ? Math.max(current, 1) + 1 : current));
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
function EmptyFeed() {
  return (
    <div className="job-list-empty">
      <p>{EMPTY_FEED}</p>
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
