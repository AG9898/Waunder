/**
 * The tracker grid's columns (`UI-04`/`UI-14`): ids, labels, header icons, sizing, header classes,
 * visibility, and the value a header click sorts by. Job is not hideable: it is the pinned leading
 * column on every row.
 */
import { BriefcaseBusiness, Building2, CalendarDays, CircleDot, Clock } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { JobSummary } from "../api/schemas";
import { trackerStatusValue } from "./tracker";

export type TrackerColumnId = "job" | "company" | "status" | "intaked" | "updated";

export interface TrackerColumn {
  id: TrackerColumnId;
  label: string;
  icon: LucideIcon;
  className: string;
  hideable: boolean;
  size: number;
  minSize: number;
  value: (job: JobSummary) => string;
}

export const TRACKER_COLUMNS: readonly TrackerColumn[] = [
  {
    id: "job",
    label: "Job",
    icon: BriefcaseBusiness,
    className: "tracker-col-job",
    hideable: false,
    size: 240,
    minSize: 200,
    value: (j) => j.title,
  },
  {
    id: "company",
    label: "Company",
    icon: Building2,
    className: "tracker-col-company",
    hideable: true,
    size: 180,
    minSize: 140,
    value: (j) => j.company,
  },
  {
    id: "status",
    label: "Status",
    icon: CircleDot,
    className: "tracker-col-status",
    hideable: true,
    size: 220,
    minSize: 190,
    value: (j) => trackerStatusValue(j.application),
  },
  {
    id: "intaked",
    label: "Intaked",
    icon: CalendarDays,
    className: "tracker-col-date",
    hideable: true,
    size: 130,
    minSize: 120,
    value: (j) => j.created_at,
  },
  {
    id: "updated",
    label: "Updated",
    icon: Clock,
    className: "tracker-col-date",
    hideable: true,
    size: 130,
    minSize: 120,
    value: (j) => j.application?.last_status_change_at ?? "",
  },
];

export const HIDEABLE_TRACKER_COLUMNS = TRACKER_COLUMNS.filter((column) => column.hideable);

/** Rows beyond which the table body is virtualized; a normal page renders every row. */
export const VIRTUALIZE_AFTER = 60;
