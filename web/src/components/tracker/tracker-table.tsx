/**
 * The tracker's rows on TanStack Table (`UI-04`): column sorting, column visibility, and window
 * virtualization for long pages, over the one responsive `<table>` markup `app.css` lays out as
 * cards below the 800px container query and as a real table above it (see `tracker-row.tsx`).
 *
 * - **Sorting is a view over the page Rails served.** The Sort select still orders the feed on the
 *   server; a header click reorders only the loaded rows, and clicking through to "unsorted" puts
 *   Rails' order back. The header text stays the bare column name (the direction lives in
 *   `aria-sort` and the button's `data-sort`), because every cell's `data-label` must equal it.
 * - **Visibility never hides the Job column.** Its cell leads each row and paints the group tint
 *   as an inset box-shadow in table mode, so it is not offered as a toggle.
 * - **Virtualization only engages past `VIRTUALIZE_AFTER` rows**, so a normal 30-row page renders
 *   every row. Above it, rows are measured (cards have variable height) and the gap is held by
 *   `.tracker-spacer` rows, which `app.css` gives explicit block/table display in both layouts.
 */
import {
  type ColumnDef,
  type OnChangeFn,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useState } from "react";

import type { JobSummary } from "../../api/schemas";
import { TRACKER_COLUMNS, type TrackerColumnId, VIRTUALIZE_AFTER } from "../../lib/tracker-columns";
import { TrackerRow } from "./tracker-row";

/** Estimated px per row before measurement; cards and table rows differ, so rows are measured. */
const ROW_ESTIMATE = 72;

const COLUMNS: ColumnDef<JobSummary, string>[] = TRACKER_COLUMNS.map((column) => ({
  id: column.id,
  accessorFn: column.value,
  header: column.label,
  enableHiding: column.hideable,
  sortingFn: "alphanumeric",
  sortDescFirst: false,
}));

export interface TrackerTableProps {
  jobs: readonly JobSummary[];
  sorting: SortingState;
  onSortingChange: OnChangeFn<SortingState>;
  columnVisibility: VisibilityState;
  savingId: number;
  saving: boolean;
  onStatusChange: (jobId: number, value: string) => void;
}

export function TrackerTable({
  jobs,
  sorting,
  onSortingChange,
  columnVisibility,
  savingId,
  saving,
  onStatusChange,
}: TrackerTableProps) {
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table returns fresh functions each render by design.
  const table = useReactTable({
    data: jobs as JobSummary[],
    columns: COLUMNS,
    state: { sorting, columnVisibility },
    onSortingChange,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (job) => String(job.id),
  });

  const visible = table.getVisibleLeafColumns().map((column) => column.id as TrackerColumnId);
  const rows = table.getRowModel().rows;
  const virtualized = rows.length > VIRTUALIZE_AFTER;

  const [scrollMargin, setScrollMargin] = useState(0);
  const tbodyRef = useCallback((element: HTMLTableSectionElement | null) => {
    if (element !== null) setScrollMargin(element.getBoundingClientRect().top + window.scrollY);
  }, []);
  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => ROW_ESTIMATE,
    // An unlaid-out row (jsdom, or a row mid-mount) measures 0; keep the estimate instead of
    // collapsing the spacer that holds the page's scroll height.
    measureElement: (element) => element.getBoundingClientRect().height || ROW_ESTIMATE,
    overscan: 8,
    scrollMargin,
    enabled: virtualized,
  });

  const items = virtualized ? virtualizer.getVirtualItems() : [];
  const first = items[0];
  const last = items.at(-1);
  const padTop = first === undefined ? 0 : Math.max(0, first.start - scrollMargin);
  const padBottom =
    last === undefined ? 0 : Math.max(0, virtualizer.getTotalSize() - last.end + scrollMargin);
  const shown = virtualized
    ? items.flatMap((item) => {
        const row = rows[item.index];
        return row === undefined ? [] : [{ row, index: item.index }];
      })
    : rows.map((row, index) => ({ row, index }));

  return (
    <table className="tracker-table">
      <thead>
        {table.getHeaderGroups().map((group) => (
          <tr key={group.id}>
            {group.headers.map((header) => {
              const meta = TRACKER_COLUMNS.find((column) => column.id === header.column.id);
              const direction = header.column.getIsSorted();
              return (
                <th
                  key={header.id}
                  className={meta?.className}
                  aria-sort={
                    direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"
                  }
                >
                  <button
                    type="button"
                    className="tracker-sort"
                    data-sort={direction === false ? "none" : direction}
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </button>
                </th>
              );
            })}
          </tr>
        ))}
      </thead>
      <tbody ref={tbodyRef}>
        {padTop > 0 ? <Spacer height={padTop} span={visible.length} /> : null}
        {shown.map(({ row, index }) => (
          <TrackerRow
            key={row.id}
            ref={virtualized ? virtualizer.measureElement : undefined}
            index={index}
            columns={visible}
            job={row.original}
            saving={savingId === row.original.id}
            disabled={saving}
            onStatusChange={onStatusChange}
          />
        ))}
        {padBottom > 0 ? <Spacer height={padBottom} span={visible.length} /> : null}
      </tbody>
    </table>
  );
}

function Spacer({ height, span }: { height: number; span: number }) {
  return (
    <tr className="tracker-spacer" aria-hidden="true">
      <td colSpan={span} style={{ height }} />
    </tr>
  );
}
