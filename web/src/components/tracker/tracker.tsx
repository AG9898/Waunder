/**
 * The application tracker at `/applications`, ported from `ApplicationsView` in
 * `web/components/applications.go` (see docs/GO_MIGRATION.md): one row per intaked job post,
 * group tabs with their totals, the lifecycle-bin and sort selects, Prev/Next, and an inline
 * status control per row (`tracker-row.tsx`).
 *
 * ## It reads the job feed, and it must say `status=all` out loud
 *
 * The question this screen answers — what have I applied to, and what haven't I — needs the jobs
 * with no application too, so it reads `GET /api/job_posts` rather than the tracked-applications
 * list. Rails attaches each job's latest Application with a lateral join, so one row per job post
 * and exact group counts come back from one query (AGENTS.md 2026-09-08).
 *
 * `status=all` is sent explicitly on every request (`trackerParams`). The feed's server default is
 * scored-only, and deterministic triage leaves most intaked postings `deferred` or `filtered`, so
 * a tracker that left `status` unset and trusted the default to mean "everything" rendered "No jobs
 * yet." in production while Rails answered 200. `state=open` (active + backlog) is the other
 * load-bearing default: a backlogged posting the owner still means to apply to stays visible, while
 * removed ones stay behind their own bin.
 *
 * ## Rails owns the groups and their totals
 *
 * The tabs' counts are `application_counts`, which Rails computes over every filter *except* the
 * group itself — nothing here tallies rows, and nothing could: the current page holds 30 rows of a
 * total the client never sees. Switching tab, bin, sort, or page is a new request.
 *
 * While a new selection loads, the previous page is kept as placeholder data so the header stats
 * and tab counts do not flash to zero, but the rows themselves show "Loading…": Go's `load()` set
 * the rows to loading and left `counts` alone until the answer arrived, and showing the previous
 * tab's rows under the newly selected tab would describe a group the owner did not pick.
 *
 * ## A status write invalidates; it never patches the row
 *
 * A status change can move a row out of the active tab (marking a job applied under "Not applied")
 * and changes the counts on every tab, so the write invalidates `jobs.root()` and re-asks Rails —
 * which is exactly what Go's `setStatus` did by calling `Jobs` again after the `PATCH`. The
 * invalidation is **awaited**, so every status select stays disabled until the refetched page has
 * landed and the next edit cannot race the previous answer. Mutations never retry
 * (`query-client.ts`), so a failure is reported and left alone.
 *
 * `useTrackerWrite` in `lib/pipeline.ts` is not reused: it binds one job id when the hook is
 * created, which suits the job detail's single posting, while this screen needs one write shared by
 * every row — the single in-flight flag is what disables all thirty selects at once.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SortingState, VisibilityState } from "@tanstack/react-table";
import { type ChangeEvent, useCallback, useState } from "react";

import { fetchJobs, updateJobApplicationStatus } from "../../api/endpoints";
import { queryKeys } from "../../api/keys";
import type { ApplicationCounts, PageMeta } from "../../api/schemas";
import { pageIndicatorLabel } from "../../lib/job-feed";
import { trackerErrorMessage } from "../../lib/messages";
import {
  DEFAULT_TRACKER_SELECTION,
  TRACKER_BIN_OPTIONS,
  TRACKER_GROUP_TABS,
  TRACKER_SORT_OPTIONS,
  appliedToCount,
  isStatusWrite,
  nextTrackerPage,
  parseTrackerBin,
  parseTrackerSort,
  previousTrackerPage,
  selectTrackerBin,
  selectTrackerGroup,
  selectTrackerSort,
  trackerEmptyMessage,
  trackerParams,
  type TrackerGroupTab,
  type TrackerSelection,
} from "../../lib/tracker";
import { AppChrome } from "../app-chrome";
import { LoadError, Loading } from "../load-state";
import { HIDEABLE_TRACKER_COLUMNS } from "../../lib/tracker-columns";
import { TrackerTable } from "./tracker-table";

export function TrackerScreen() {
  const [selection, setSelection] = useState<TrackerSelection>(DEFAULT_TRACKER_SELECTION);
  const params = trackerParams(selection);
  const { data, isPending, isPlaceholderData, isError, error } = useQuery({
    queryKey: queryKeys.jobs.list(params),
    queryFn: () => fetchJobs(params),
    placeholderData: keepPreviousData,
  });
  const write = useStatusWrite();
  // Held here, not in the table, so a header sort and hidden columns survive the refetch that
  // unmounts the table behind "Loading…".
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  const counts = data?.application_counts ?? ZERO_COUNTS;

  const onSelectGroup = useCallback((group: TrackerGroupTab) => {
    setSelection((current) => selectTrackerGroup(current, group));
  }, []);

  return (
    <div className="applications">
      <AppChrome />
      <TrackerHeader counts={counts} />
      <TrackerGroupTabs group={selection.group} counts={counts} onSelect={onSelectGroup} />
      <TrackerControls selection={selection} onChange={setSelection} />
      <TrackerColumns visibility={columnVisibility} onChange={setColumnVisibility} />
      {write.error === "" ? null : (
        <p className="tracker-status-error" role="alert">
          {write.error}
        </p>
      )}
      {isPending || isPlaceholderData ? (
        <Loading />
      ) : isError ? (
        <LoadError error={error} />
      ) : data.job_posts.length === 0 ? (
        <p className="tracker-empty">{trackerEmptyMessage(selection.group)}</p>
      ) : (
        <div className="tracker-wrap">
          <TrackerTable
            jobs={data.job_posts}
            sorting={sorting}
            onSortingChange={setSorting}
            columnVisibility={columnVisibility}
            savingId={write.savingId}
            saving={write.saving}
            onStatusChange={write.onStatusChange}
          />
          <TrackerPagination
            page={data.page}
            onPrevious={() => {
              setSelection((current) => previousTrackerPage(current, data.page));
            }}
            onNext={() => {
              setSelection((current) => nextTrackerPage(current, data.page));
            }}
          />
        </div>
      )}
    </div>
  );
}

/** Every tally at zero, for the frame before the first page arrives. */
const ZERO_COUNTS: ApplicationCounts = {
  all: 0,
  not_applied: 0,
  applied: 0,
  in_progress: 0,
  closed: 0,
};

/**
 * The status write shared by every row: the in-flight flag, which row it is for, the failure copy,
 * and the change handler.
 *
 * A status change sends a **blank** stage, as Go's `ApplicationStatusUpdate{PipelineStatus: status}`
 * did: `Application#assign_pipeline_status` reads that as "this status's default stage", which is
 * how Applied lands on Waiting. `pipeline_note` and `next_follow_up_on` stay absent so Rails keeps
 * the values it holds (`lib/pipeline.ts`).
 */
function useStatusWrite() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ jobId, status }: { jobId: number; status: string }) =>
      updateJobApplicationStatus(jobId, { pipeline_status: status, pipeline_stage: "" }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.jobs.root() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.applications.root() }),
      ]);
    },
  });

  const { isPending, mutate } = mutation;
  const onStatusChange = useCallback(
    (jobId: number, value: string) => {
      // The "Not applied" placeholder is inert, and a second write while one is in flight is
      // refused: two edits racing decide the final status by response order, not click order.
      if (isPending || !isStatusWrite(value)) return;
      mutate({ jobId, status: value });
    },
    [isPending, mutate],
  );

  return {
    saving: isPending,
    savingId: isPending ? (mutation.variables?.jobId ?? 0) : 0,
    error: mutation.isError ? trackerErrorMessage(mutation.error) : "",
    onStatusChange,
  };
}

/**
 * The title and the tracked/total split, so "how much have I actually applied to" is legible
 * before reading a row. Applied, in progress, and closed all count as applied to.
 */
function TrackerHeader({ counts }: { counts: ApplicationCounts }) {
  return (
    <div className="applications-header">
      <h1>Applications</h1>
      <div className="applications-stats">
        <TrackerStat value={appliedToCount(counts)} caption="Applied to" />
        <TrackerStat value={counts.all} caption="Jobs tracked" />
      </div>
    </div>
  );
}

function TrackerStat({ value, caption }: { value: number; caption: string }) {
  return (
    <div className="applications-stat">
      <span className="applications-stat-value">{value}</span>
      <span className="applications-stat-label">{caption}</span>
    </div>
  );
}

/**
 * The primary filter: the tracker states a job can be in, each carrying Rails' count. A click on
 * the current tab is swallowed by `selectTrackerGroup`, as Go's `applyGroup` guard was.
 */
function TrackerGroupTabs({
  group,
  counts,
  onSelect,
}: {
  group: TrackerGroupTab;
  counts: ApplicationCounts;
  onSelect: (group: TrackerGroupTab) => void;
}) {
  return (
    <nav className="tracker-tabs" role="tablist" aria-label="Application status">
      {TRACKER_GROUP_TABS.map((tab) => (
        <button
          key={tab.count}
          className={`tracker-tab${group === tab.value ? " view-selector-option-active" : ""}`}
          type="button"
          role="tab"
          aria-selected={group === tab.value}
          onClick={() => {
            onSelect(tab.value);
          }}
        >
          <span className="tracker-tab-label">{tab.label}</span>
          <span className="tracker-tab-count">{counts[tab.count]}</span>
        </button>
      ))}
    </nav>
  );
}

/**
 * The secondary selections: which lifecycle bin the rows come from, and their order. Neither has
 * an empty-valued choice, so no "all" sentinel is involved (unlike the feed's filters).
 */
function TrackerControls({
  selection,
  onChange,
}: {
  selection: TrackerSelection;
  onChange: (update: (current: TrackerSelection) => TrackerSelection) => void;
}) {
  const onBin = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const bin = parseTrackerBin(event.target.value);
      if (bin !== null) onChange((current) => selectTrackerBin(current, bin));
    },
    [onChange],
  );
  const onSort = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const sort = parseTrackerSort(event.target.value);
      if (sort !== null) onChange((current) => selectTrackerSort(current, sort));
    },
    [onChange],
  );

  return (
    <div className="tracker-controls">
      <label className="tracker-control">
        <span>Show</span>
        <select className="tracker-bin-select" value={selection.bin} onChange={onBin}>
          {TRACKER_BIN_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="tracker-control">
        <span>Sort</span>
        <select className="tracker-sort-select" value={selection.sort} onChange={onSort}>
          {TRACKER_SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/**
 * Which optional columns show. Job is not offered: it leads every row and paints the group tint.
 * A hidden column drops both its header and its cells, so card labels stay paired with headers.
 */
function TrackerColumns({
  visibility,
  onChange,
}: {
  visibility: VisibilityState;
  onChange: (update: (current: VisibilityState) => VisibilityState) => void;
}) {
  return (
    <details className="tracker-columns">
      <summary>Columns</summary>
      <div className="tracker-columns-list">
        {HIDEABLE_TRACKER_COLUMNS.map((column) => (
          <label key={column.id} className="tracker-column-toggle">
            <input
              type="checkbox"
              checked={visibility[column.id] !== false}
              onChange={(event) => {
                const checked = event.target.checked;
                onChange((current) => ({ ...current, [column.id]: checked }));
              }}
            />
            {column.label}
          </label>
        ))}
      </div>
    </details>
  );
}

/**
 * Prev/Next plus the position indicator, driven by the response envelope. It carries both the
 * tracker's own button classes and the feed's `.job-pagination` layout class, as Go's did.
 */
function TrackerPagination({
  page,
  onPrevious,
  onNext,
}: {
  page: PageMeta;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className="tracker-pagination job-pagination">
      <button
        className="tracker-page-prev"
        type="button"
        disabled={page.number <= 1}
        onClick={onPrevious}
      >
        Previous
      </button>
      <span className="tracker-page-indicator">{pageIndicatorLabel(page)}</span>
      <button
        className="tracker-page-next"
        type="button"
        disabled={!page.has_next}
        onClick={onNext}
      >
        Next
      </button>
    </div>
  );
}
