/**
 * The tracker grid's columns (`UI-04`/`UI-14`): ids, labels, header icons, sizing, header classes,
 * visibility, and the value a header click sorts by. Job is not hideable: it is the pinned leading
 * column on every row.
 */
import { BriefcaseBusiness, Building2, CalendarDays, CircleDot, Clock } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { JobSummary } from "../api/schemas";
import { trackerStageLabel, trackerStatusValue } from "./tracker";

export type TrackerColumnId =
  | "job"
  | "company"
  | "score"
  | "status"
  | "stage"
  | "applied"
  | "intaked"
  | "updated"
  | "follow_up"
  | "note";

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
    id: "score",
    label: "Score",
    icon: CircleDot,
    className: "tracker-col-score",
    hideable: true,
    size: 105,
    minSize: 95,
    value: (j) => (j.match_score === null ? "" : String(j.match_score).padStart(3, "0")),
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
    id: "stage",
    label: "Stage",
    icon: CircleDot,
    className: "tracker-col-stage",
    hideable: true,
    size: 150,
    minSize: 120,
    value: (j) => trackerStageLabel(j.application),
  },
  {
    id: "applied",
    label: "Applied",
    icon: CalendarDays,
    className: "tracker-col-date",
    hideable: true,
    size: 130,
    minSize: 120,
    value: (j) => j.application?.applied_at ?? "",
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
  {
    id: "follow_up",
    label: "Follow-up",
    icon: CalendarDays,
    className: "tracker-col-date",
    hideable: true,
    size: 150,
    minSize: 130,
    value: (j) => j.application?.next_follow_up_on ?? "",
  },
  {
    id: "note",
    label: "Note",
    icon: Clock,
    className: "tracker-col-note",
    hideable: true,
    size: 240,
    minSize: 160,
    value: (j) => j.application?.pipeline_note ?? "",
  },
];

export const HIDEABLE_TRACKER_COLUMNS = TRACKER_COLUMNS.filter((column) => column.hideable);

/** Rows beyond which the table body is virtualized; a normal page renders every row. */
export const VIRTUALIZE_AFTER = 60;
