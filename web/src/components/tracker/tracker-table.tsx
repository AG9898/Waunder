/**
 * The tracker's rows on TanStack Table (`UI-04`/`UI-14`): column sorting, visibility, pinning,
 * sizing, and window virtualization. The same table is a Surface v2 grid at every width: the
 * row-number rail and Job column stay pinned while the remaining columns scroll in the panel.
 *
 * - Sorting is a view over the page Rails served. The Sort select still orders the feed on the
 *   server; a header click reorders only the loaded rows.
 * - Visibility never hides Job. It is the only TanStack-pinned data column and leads every row.
 * - Virtualization only engages past `VIRTUALIZE_AFTER` rows, so a normal 30-row page renders all
 *   rows. Above it, measured rows are held between explicit spacer rows.
 */
import {
  type Column,
  type ColumnDef,
  type ColumnPinningState,
  type ColumnSizingState,
  type OnChangeFn,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, Hash } from "lucide-react";
import { type CSSProperties, useCallback, useState } from "react";

import type { JobSummary } from "../../api/schemas";
import { TRACKER_COLUMNS, type TrackerColumnId, VIRTUALIZE_AFTER } from "../../lib/tracker-columns";
import { TrackerRow } from "./tracker-row";

/** The row-number rail is outside TanStack's data columns but remains pinned with the Job column. */
const FIXED_COLUMN_COUNT = 1;

/** Estimated px per row before measurement; the mobile row is the conservative height. */
const ROW_ESTIMATE = 56;

const PINNED_COLUMNS: ColumnPinningState = { left: ["job"], right: [] };

const COLUMNS: ColumnDef<JobSummary, string>[] = TRACKER_COLUMNS.map((column) => ({
  id: column.id,
  accessorFn: column.value,
  header: column.label,
  enableHiding: column.hideable,
  enablePinning: column.id === "job",
  enableResizing: true,
  size: column.size,
  minSize: column.minSize,
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
  onStageChange: (jobId: number, status: string, stage: string) => void;
}

export function TrackerTable({
  jobs,
  sorting,
  onSortingChange,
  columnVisibility,
  savingId,
  saving,
  onStatusChange,
  onStageChange,
}: TrackerTableProps) {
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table returns fresh functions each render by design.
  const table = useReactTable({
    data: jobs as JobSummary[],
    columns: COLUMNS,
    state: { sorting, columnVisibility, columnPinning: PINNED_COLUMNS, columnSizing },
    onSortingChange,
    onColumnSizingChange: setColumnSizing,
    enableColumnPinning: true,
    enableColumnResizing: true,
    columnResizeMode: "onChange",
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (job) => String(job.id),
  });

  const visible = table.getVisibleLeafColumns().map((column) => column.id as TrackerColumnId);
  const rows = table.getRowModel().rows;
  const virtualized = rows.length > VIRTUALIZE_AFTER;

  const columnStyle = (column: Column<JobSummary, unknown>): CSSProperties => {
    const size = column.getSize();
    const style: CSSProperties = { width: `${size}px`, minWidth: `${size}px` };
    if (column.getIsPinned() === "left") {
      style.left = `calc(var(--tracker-row-number-width) + ${column.getStart("left")}px)`;
    }
    return style;
  };

  const rowColumnStyle = (id: TrackerColumnId): CSSProperties => {
    const column = table.getColumn(id);
    return column === undefined ? {} : columnStyle(column);
  };

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
    <div className="tracker-grid-scroll">
      <table className="tracker-table">
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              <th
                className="tracker-row-number-header"
                aria-label="Row"
                scope="col"
                style={{ width: "var(--tracker-row-number-width)" }}
              >
                <Hash className="tracker-column-icon" aria-hidden="true" size={13} />
                <span className="tracker-row-number-label">#</span>
              </th>
              {group.headers.map((header) => {
                const meta = TRACKER_COLUMNS.find((column) => column.id === header.column.id);
                const direction = header.column.getIsSorted();
                const HeaderIcon = meta?.icon;
                const sorted = direction !== false;
                return (
                  <th
                    key={header.id}
                    className={[meta?.className, sorted ? "tracker-header-sorted" : ""]
                      .filter(Boolean)
                      .join(" ")}
                    data-column={header.column.id}
                    data-pinned={header.column.getIsPinned() || undefined}
                    aria-sort={
                      direction === "asc"
                        ? "ascending"
                        : direction === "desc"
                          ? "descending"
                          : "none"
                    }
                    scope="col"
                    style={columnStyle(header.column)}
                  >
                    <button
                      type="button"
                      className="tracker-sort"
                      data-sort={direction === false ? "none" : direction}
                      aria-label={meta?.label}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {HeaderIcon === undefined ? null : (
                        <HeaderIcon className="tracker-column-icon" aria-hidden="true" size={13} />
                      )}
                      <span className="tracker-header-label">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </span>
                      {direction === "asc" ? (
                        <ArrowUp className="tracker-sort-arrow" aria-hidden="true" size={13} />
                      ) : direction === "desc" ? (
                        <ArrowDown className="tracker-sort-arrow" aria-hidden="true" size={13} />
                      ) : null}
                    </button>
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody ref={tbodyRef}>
          {padTop > 0 ? (
            <Spacer height={padTop} span={visible.length + FIXED_COLUMN_COUNT} />
          ) : null}
          {shown.map(({ row, index }) => (
            <TrackerRow
              key={row.id}
              ref={virtualized ? virtualizer.measureElement : undefined}
              index={index}
              columns={visible}
              columnStyle={rowColumnStyle}
              job={row.original}
              saving={savingId === row.original.id}
              disabled={saving}
              onStatusChange={onStatusChange}
              onStageChange={onStageChange}
            />
          ))}
          {padBottom > 0 ? (
            <Spacer height={padBottom} span={visible.length + FIXED_COLUMN_COUNT} />
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function Spacer({ height, span }: { height: number; span: number }) {
  return (
    <tr className="tracker-spacer" aria-hidden="true">
      <td colSpan={span} style={{ height }} />
    </tr>
  );
}
