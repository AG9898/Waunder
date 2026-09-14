/**
 * The tracker table's columns (`UI-04`): ids, header labels (which every cell's `data-label` must
 * equal), header classes, whether the owner may hide them, and the value a header click sorts by.
 * The Job column is not hideable: its cell leads every row and paints the group tint.
 */
import type { JobSummary } from "../api/schemas";
import { trackerStatusValue } from "./tracker";

export type TrackerColumnId = "job" | "company" | "status" | "intaked" | "updated";

export interface TrackerColumn {
  id: TrackerColumnId;
  label: string;
  className: string;
  hideable: boolean;
  value: (job: JobSummary) => string;
}

export const TRACKER_COLUMNS: readonly TrackerColumn[] = [
  { id: "job", label: "Job", className: "tracker-col-job", hideable: false, value: (j) => j.title },
  {
    id: "company",
    label: "Company",
    className: "tracker-col-company",
    hideable: true,
    value: (j) => j.company,
  },
  {
    id: "status",
    label: "Status",
    className: "tracker-col-status",
    hideable: true,
    value: (j) => trackerStatusValue(j.application),
  },
  {
    id: "intaked",
    label: "Intaked",
    className: "tracker-col-date",
    hideable: true,
    value: (j) => j.created_at,
  },
  {
    id: "updated",
    label: "Updated",
    className: "tracker-col-date",
    hideable: true,
    value: (j) => j.application?.last_status_change_at ?? "",
  },
];

export const HIDEABLE_TRACKER_COLUMNS = TRACKER_COLUMNS.filter((column) => column.hideable);

/** Rows beyond which the table body is virtualized; a normal page renders every row. */
export const VIRTUALIZE_AFTER = 60;
