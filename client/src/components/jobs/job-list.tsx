/**
 * The jobs feed, ported from `JobList` in `web/components/jobs.go` (see
 * docs/GO_MIGRATION.md): one page of `GET /api/job_posts`, its rows and Prev/Next
 * (`FE-15`), its filters and persisted selection (`FE-16`), and its lifecycle bins,
 * selection, bulk actions, and score-on-demand (`FE-17`).
 *
 * ## Rails owns the feed; this screen owns only what it is asking for
 *
 * Filtering, sorting, binning, and paging are entirely server-side
 * (`Api::JobPostsController#index`, AGENTS.md 2026-06-23), and nothing here re-does any of
 * it: a filter or bin change is a new request, the rows are rendered in the order they
 * arrive, and the Prev/Next buttons read the response's own `page` envelope rather than
 * counting rows. That is not a style preference — a client-side sort would reorder only the
 * 30 rows of the current page, and a client-side bin split would show a "backlog" of
 * whatever happened to be on this page.
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
 * ## A write invalidates the feed; it never patches rows
 *
 * Go's `applyLifecycleResult` spliced the transitioned rows out of its local slice and
 * `applyScoreResult` swapped one row in place. Neither is right here, and not only because
 * TanStack owns the cache: a lifecycle write **changes which rows belong on this page**.
 * Backlogging the 3rd of 30 rows on page 2 of the Active bin does not leave 29 rows — it
 * pulls a row forward from page 3, and every later page shifts. A local splice renders a
 * page that no longer exists on the server, with a `page.total` that disagrees with it.
 * Invalidating `jobs.root()` (plus the digest and the ingestion batches, which render the
 * same postings) re-asks Rails the question the screen is currently showing.
 *
 * Mutations never retry (`query-client.ts`), so a failed lifecycle write is reported and
 * left alone rather than replayed.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";

import { fetchJobs, scoreJobPost, setJobLifecycle } from "../../api/endpoints";
import { queryKeys } from "../../api/keys";
import type { PageMeta } from "../../api/schemas";
import { clearSelection, toggleSelection, visibleSelection } from "../../lib/job-actions";
import { emptyFeedText, feedParams, pageIndicatorLabel } from "../../lib/job-feed";
import { readSelection, writeSelection, type FeedBin } from "../../lib/job-filters";
import { lifecycleErrorMessage, scoreErrorMessage } from "../../lib/messages";
import { AppChrome } from "../app-chrome";
import { LoadError, Loading } from "../load-state";
import { JobBulkActions, JobManageBar, type JobManageContext } from "./job-actions";
import { JobBinTabs } from "./job-bins";
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

  const jobs = data?.job_posts ?? EMPTY_ROWS;
  const { selected, manage, lifecycle, scoreErrors, scoringIds } = useJobWrites();

  const bulkIds = visibleSelection(jobs, selected);
  const manageContext: JobManageContext = {
    ...manage,
    bin: selection.bin,
    showScore: selection.view === "unscored",
  };

  return (
    <div className="job-list">
      <AppChrome />
      <h1>Jobs</h1>
      <Link className="job-list-import" to="/jobs/new">
        Import job
      </Link>
      <div className="job-feed-workspace">
        <div className="job-feed-controls">
          <JobFilters selection={selection} onChange={setSelection} />
          <JobBinTabs
            bin={selection.bin}
            onSelect={(bin) => {
              setSelection((current) => ({ ...current, bin, pageNum: 1 }));
            }}
          />
        </div>
        {isPending ? (
          <Loading />
        ) : isError ? (
          <LoadError error={error} />
        ) : jobs.length === 0 ? (
          <EmptyFeed text={emptyFeedText(selection)} />
        ) : (
          <div className="job-list-results">
            <JobBulkActions
              count={bulkIds.length}
              bin={selection.bin}
              busy={lifecycle.busy}
              error={lifecycle.message}
              onLifecycle={(state) => manage.onLifecycle(bulkIds, state)}
            />
            <ul className="job-list-items">
              {jobs.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  actions={
                    <JobManageBar
                      job={job}
                      selected={selected.has(job.id)}
                      scoring={scoringIds.has(job.id)}
                      scoreError={scoreErrors.get(job.id) ?? ""}
                      manage={manageContext}
                    />
                  }
                />
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
 * The feed's write half: the row selection, the two mutations, and the per-row score state.
 *
 * Extracted from the component body so the read half above stays readable, and because this
 * is the part with a policy in it rather than markup. Kept in this module (not `lib/`)
 * because it is a hook over this screen's two endpoints, not a reusable helper.
 *
 * **Lifecycle is one mutation, score is many.** A lifecycle write is exclusive — Go had a
 * single `lifecycleBusy` flag and a single `lifecycleErr`, and TanStack's `isPending` /
 * `error` are exactly that — because the bulk button and every row button `PATCH` the same
 * rows, so overlapping writes are a race the owner cannot reason about. Scoring is the
 * opposite: several postings can legitimately be queued at once, so the in-flight ids and
 * the failures are tracked per row, mirroring Go's `scoreStates` / `scoreErrs` maps. One
 * shared score error could not say which posting failed.
 */
function useJobWrites() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set());
  const [scoringIds, setScoringIds] = useState<ReadonlySet<number>>(() => new Set());
  const [scoreErrors, setScoreErrors] = useState<ReadonlyMap<number, string>>(() => new Map());

  /**
   * Every screen that renders these postings, re-asked. The digest landing and the ingestion
   * batches show the same rows with the same lifecycle pill, so a backlog here that left them
   * stale would read as the write having silently failed.
   */
  const invalidateFeeds = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.jobs.root() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.digest() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.ingestionBatches.root() }),
      ]),
    [queryClient],
  );

  const lifecycleMutation = useMutation({
    mutationFn: ({ ids, state }: { ids: readonly number[]; state: FeedBin }) =>
      setJobLifecycle(ids, state),
    // Awaiting the refetch keeps `isPending` true until fresh rows land, so the controls stay
    // disabled through the whole transition rather than re-enabling over stale rows.
    onSuccess: async (_rows, { ids }) => {
      setSelected((current) => clearSelection(current, ids));
      await invalidateFeeds();
    },
  });

  const scoreMutation = useMutation({
    mutationFn: (id: number) => scoreJobPost(id),
    onMutate: (id) => {
      setScoringIds((current) => new Set(current).add(id));
      setScoreErrors((current) => withoutKey(current, id));
    },
    onError: (failure, id) => {
      setScoreErrors((current) => new Map(current).set(id, scoreErrorMessage(failure)));
    },
    onSuccess: () => invalidateFeeds(),
    onSettled: (_job, _failure, id) => {
      setScoringIds((current) => withoutValue(current, id));
    },
  });

  const onLifecycle = useCallback(
    (ids: readonly number[], state: FeedBin) => {
      // An empty bulk selection is swallowed rather than sent: Rails would answer a
      // no-op PATCH 200, and the refetch would look like the click did something.
      if (ids.length === 0 || lifecycleMutation.isPending) return;
      lifecycleMutation.mutate({ ids, state });
    },
    [lifecycleMutation],
  );

  const onScore = useCallback(
    (id: number) => {
      if (scoringIds.has(id)) return;
      scoreMutation.mutate(id);
    },
    [scoreMutation, scoringIds],
  );

  const onToggleSelect = useCallback((id: number) => {
    setSelected((current) => toggleSelection(current, id));
  }, []);

  return {
    selected,
    scoringIds,
    scoreErrors,
    lifecycle: {
      busy: lifecycleMutation.isPending,
      message: lifecycleMutation.isError ? lifecycleErrorMessage(lifecycleMutation.error) : "",
    },
    manage: {
      lifecycleBusy: lifecycleMutation.isPending,
      onToggleSelect,
      onLifecycle,
      onScore,
    },
  };
}

/** A stable empty array, so `jobs` keeps one identity while the feed is pending. */
const EMPTY_ROWS: readonly never[] = [];

/** Copy-on-write map delete, so React sees a new identity. */
function withoutKey(map: ReadonlyMap<number, string>, id: number): ReadonlyMap<number, string> {
  if (!map.has(id)) return map;
  const next = new Map(map);
  next.delete(id);
  return next;
}

/** Copy-on-write set delete, same reason. */
function withoutValue(set: ReadonlySet<number>, id: number): ReadonlySet<number> {
  if (!set.has(id)) return set;
  const next = new Set(set);
  next.delete(id);
  return next;
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
