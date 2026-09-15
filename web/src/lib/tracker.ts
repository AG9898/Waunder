/**
 * The pure half of the application tracker: what a selection asks Rails for, how the tabs, bin,
 * and sort choices read, how a row's status, stage, and dates render, and what an empty tab says.
 * Ported from `params`, `applyGroup` / `applyBin` / `applySort` / `applyPrevPage` / `applyNextPage`,
 * `trackerEmptyMessage`, `trackerRowClass`, `trackerStatusOptions`, `trackerDate`, and
 * `trackerUpdatedLabel` in `web/components/applications.go` (see docs/GO_MIGRATION.md).
 *
 * These live in `lib/` for the reason every ported helper does: a component module that also
 * exports plain functions trips `eslint-plugin-react-refresh`, and the chain's bar is zero lint
 * warnings with no disable comments (`FE-07`).
 */
import type {
  ApplicationCounts,
  ApplicationTracker,
  JobFeedParams,
  JobSummary,
  PageMeta,
} from "../api/schemas";
import { trackerGroup, type TrackerGroupName } from "./labels";
import { PIPELINE_STAGE_OPTIONS } from "./pipeline";

/** A group tab: one of Rails' `APPLICATION_GROUPS`, or `""` for the All tab (no filter sent). */
export type TrackerGroupTab = "" | TrackerGroupName;

/** The lifecycle bin the rows come from. `open` is active + backlog. */
export type TrackerBin = NonNullable<JobFeedParams["state"]>;

/** The row order. The tracker offers three of the feed's four sorts. */
export type TrackerSort = Extract<
  NonNullable<JobFeedParams["sort"]>,
  "newest" | "activity" | "score"
>;

/** What the tracker is currently asking for. Local to the screen: Go never persisted it. */
export interface TrackerSelection {
  group: TrackerGroupTab;
  bin: TrackerBin;
  sort: TrackerSort;
  /** 1-based, exactly as Rails and the page envelope count. */
  pageNum: number;
}

/**
 * The opening selection. `open` keeps a backlogged posting the owner still means to apply to on
 * screen while removed ones stay behind their own bin; `newest` puts the latest intake first.
 */
export const DEFAULT_TRACKER_SELECTION: TrackerSelection = {
  group: "",
  bin: "open",
  sort: "newest",
  pageNum: 1,
};

/** The group tabs, in `renderGroupTabs`' order, each naming the `application_counts` key it shows. */
export const TRACKER_GROUP_TABS: ReadonlyArray<{
  value: TrackerGroupTab;
  label: string;
  count: keyof ApplicationCounts;
}> = [
  { value: "", label: "All", count: "all" },
  { value: "not_applied", label: "Not applied", count: "not_applied" },
  { value: "applied", label: "Applied", count: "applied" },
  { value: "in_progress", label: "In progress", count: "in_progress" },
  { value: "closed", label: "Closed", count: "closed" },
];

/** The "Show" select, in `renderControls`' order with its labels. */
export const TRACKER_BIN_OPTIONS: ReadonlyArray<{ value: TrackerBin; label: string }> = [
  { value: "open", label: "Active + backlog" },
  { value: "active", label: "Active only" },
  { value: "backlog", label: "Backlog only" },
  { value: "removed", label: "Removed" },
];

/** The "Sort" select, in `renderControls`' order with its labels. */
export const TRACKER_SORT_OPTIONS: ReadonlyArray<{ value: TrackerSort; label: string }> = [
  { value: "newest", label: "Newest intake" },
  { value: "activity", label: "Recent activity" },
  { value: "score", label: "Highest match" },
];

/**
 * `params`: the server query for a selection.
 *
 * **`status` is always `all`, and always sent.** The feed's server default is scored-only, and
 * triage leaves most intaked postings `deferred` or `filtered`; the Go tracker once relied on an
 * unset `status` meaning "every job" and rendered an empty table in production while Rails
 * answered 200 (AGENTS.md 2026-09-08). The All tab sends no `application` param at all — Rails
 * reads a blank or unknown group as "every group" — rather than an "all" sentinel.
 */
export function trackerParams(selection: TrackerSelection): JobFeedParams {
  const params: JobFeedParams = {
    status: "all",
    state: selection.bin,
    sort: selection.sort,
    page: selection.pageNum < 1 ? 1 : selection.pageNum,
  };
  if (selection.group !== "") params.application = selection.group;
  return params;
}

/**
 * `applyGroup`: a tab change returns to page 1. Re-selecting the current tab returns the
 * **same object**, so React skips the render and no request is made.
 */
export function selectTrackerGroup(
  selection: TrackerSelection,
  group: TrackerGroupTab,
): TrackerSelection {
  return selection.group === group ? selection : { ...selection, group, pageNum: 1 };
}

/** `applyBin`: same shape as `selectTrackerGroup`. */
export function selectTrackerBin(selection: TrackerSelection, bin: TrackerBin): TrackerSelection {
  return selection.bin === bin ? selection : { ...selection, bin, pageNum: 1 };
}

/** `applySort`: same shape as `selectTrackerGroup`. */
export function selectTrackerSort(
  selection: TrackerSelection,
  sort: TrackerSort,
): TrackerSelection {
  return selection.sort === sort ? selection : { ...selection, sort, pageNum: 1 };
}

/**
 * `applyPrevPage`: steps back from the page Rails said it served, never below page 1. Reading the
 * envelope rather than the local page number means a stale render cannot step past either end.
 */
export function previousTrackerPage(selection: TrackerSelection, page: PageMeta): TrackerSelection {
  return page.number <= 1 ? selection : { ...selection, pageNum: page.number - 1 };
}

/** `applyNextPage`: steps forward only while Rails reports `has_next`. */
export function nextTrackerPage(selection: TrackerSelection, page: PageMeta): TrackerSelection {
  return page.has_next ? { ...selection, pageNum: Math.max(page.number, 1) + 1 } : selection;
}

/** A select value read back from the DOM, accepted only if it is one of the bin options. */
export function parseTrackerBin(value: string): TrackerBin | null {
  return TRACKER_BIN_OPTIONS.find((option) => option.value === value)?.value ?? null;
}

/** A select value read back from the DOM, accepted only if it is one of the sort options. */
export function parseTrackerSort(value: string): TrackerSort | null {
  return TRACKER_SORT_OPTIONS.find((option) => option.value === value)?.value ?? null;
}

/**
 * The header's "Applied to" figure: everything past applying. Applied, in progress, and closed all
 * mean an application went out; only `not_applied` did not.
 */
export function appliedToCount(counts: ApplicationCounts): number {
  return counts.applied + counts.in_progress + counts.closed;
}

/**
 * `trackerEmptyMessage`: an empty result explained in the terms of the active tab, so "nothing
 * here" never reads as "the tracker is broken".
 */
export function trackerEmptyMessage(group: TrackerGroupTab): string {
  switch (group) {
    case "not_applied":
      return "Nothing left to apply to in this view.";
    case "applied":
      return "No applications submitted yet.";
    case "in_progress":
      return "Nothing in progress yet.";
    case "closed":
      return "No closed applications yet.";
    default:
      return "No jobs intaked yet.";
  }
}

/**
 * `notAppliedOption`: the DOM value of the placeholder `<option>` an untracked row shows. It is
 * not a pipeline status and must never reach Rails — see `isStatusWrite`.
 */
export const NOT_APPLIED_OPTION = "not_applied";

/**
 * Whether a status select value is a write. The placeholder is inert (untracking would destroy an
 * application's draft and audit history, so it is not a row action), and an empty value — which a
 * browser reports when the chosen value matches no option — is not a status either.
 */
export function isStatusWrite(value: string): boolean {
  return value !== "" && value !== NOT_APPLIED_OPTION;
}

/**
 * The status select's current value: the placeholder while the job has no tracked status, the
 * pipeline status otherwise. Mirrors `renderStatusControl`, which showed the placeholder whenever
 * the status was empty — including an Application row with a blank status.
 */
export function trackerStatusValue(application: ApplicationTracker | null): string {
  const status = application?.pipeline_status ?? "";
  return status === "" ? NOT_APPLIED_OPTION : status;
}

/**
 * The stage pill beside the select, or `""` for none.
 *
 * Shown only for a tracked status with a stage, as Go's `app.If(stage != "" && status != "")` did.
 * One deliberate difference: Go rendered the pill even when the stage was not one it had a label
 * for, which painted an empty green blob (Rails validates the stage's *format*, not membership), so
 * an unlabelled stage renders no pill here.
 */
export function trackerStageLabel(application: ApplicationTracker | null): string {
  if (application === null) return "";
  const { pipeline_status: status, pipeline_stage: stage } = application;
  if (status === "" || stage === "") return "";
  return PIPELINE_STAGE_OPTIONS.find((option) => option.value === stage)?.label ?? "";
}

/**
 * `trackerRowClass`: the row's full class. The `tracker-row--<group>` suffix is what `app.css`
 * tints — the card's left border on mobile, the leading cell's inset shadow in table mode — so it
 * comes from `trackerGroup`, which mirrors Rails' `APPLICATION_GROUPS` and is tested against it.
 */
export function trackerRowClass(application: ApplicationTracker | null): string {
  return `tracker-row tracker-row--${trackerGroup(application)}`;
}

/** What a date cell shows when there is no date to render. */
const NO_DATE = "—";

/** Go's `Jan` layout element. */
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * Exactly what Go's `time.Parse(time.RFC3339, …)` accepts: uppercase `T` and `Z` only, an optional
 * fraction of at least one digit after `.` or `,`, and a `±hh:mm` offset. Verified by running the
 * Go original over the case table in `tracker.test.tsx`.
 */
const RFC3339 =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:[.,]\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;

/**
 * `strings.TrimSpace`'s set — Unicode `White_Space`. Not `String.prototype.trim`, which also
 * strips U+FEFF (Go keeps it, so the value fails to parse) and keeps U+0085 (Go strips it).
 */
const GO_SPACE =
  "[\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";
const GO_TRIM = new RegExp(`^${GO_SPACE}+|${GO_SPACE}+$`, "g");

/**
 * `trackerDate`: an RFC 3339 timestamp as a short calendar date — `2026-09-05T09:30:00Z` →
 * `5 Sep 2026`. Anything Go would refuse renders as an em dash rather than raw text.
 *
 * The date is read **from the literal**, never converted to the browser's zone: Go's parser keeps
 * the offset written in the string, so `2026-09-08T23:30:00-07:00` is `8 Sep 2026` on every device
 * (AGENTS.md 2026-09-11). `Date.UTC` is not used for the range check because it maps years 0–99
 * onto 1900–1999, and Go accepts year `0000`.
 */
export function trackerDate(value: string): string {
  const match = RFC3339.exec(value.replace(GO_TRIM, ""));
  if (match === null) return NO_DATE;
  const [, year, month, day, hour, minute, second, offsetHour, offsetMinute] = match.map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined
  ) {
    return NO_DATE;
  }
  const monthName = MONTHS[month - 1];
  if (monthName === undefined || day < 1 || day > daysIn(year, month)) return NO_DATE;
  if (hour > 23 || minute > 59 || second > 59) return NO_DATE;
  // Go range-checks the offset loosely (an hour of 24 and a minute of 60 both parse).
  if (offsetHour !== undefined && !Number.isNaN(offsetHour) && offsetHour > 24) return NO_DATE;
  if (offsetMinute !== undefined && !Number.isNaN(offsetMinute) && offsetMinute > 60) {
    return NO_DATE;
  }
  // Go's `2006` layout element pads the year to four digits.
  return `${day} ${monthName} ${String(year).padStart(4, "0")}`;
}

interface ParsedDateOnly {
  key: string;
  label: string;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A Rails `date` value formatted from its literal calendar components. */
function parseDateOnly(value: string): ParsedDateOnly | null {
  const match = DATE_ONLY.exec(value.replace(GO_TRIM, ""));
  if (match === null) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const monthName = MONTHS[month - 1];
  if (monthName === undefined || day < 1 || day > daysIn(year, month)) return null;

  return {
    key: `${match[1]}-${match[2]}-${match[3]}`,
    label: `${day} ${monthName} ${String(year).padStart(4, "0")}`,
  };
}

/** A Rails `date` value, or an em dash when the application has no value. */
export function trackerDateOnly(value: string): string {
  return parseDateOnly(value)?.label ?? NO_DATE;
}

export type TrackerFollowUpTone = "overdue" | "today" | "future";

export interface TrackerFollowUpState {
  label: string;
  tone: TrackerFollowUpTone | null;
}

/**
 * The follow-up display state. The stored date and today's date are compared as calendar strings,
 * never as timestamps, so a Rails date cannot move across a timezone boundary in the browser.
 */
export function trackerFollowUpState(
  application: ApplicationTracker | null,
  today = localDateKey(),
): TrackerFollowUpState {
  const parsed = parseDateOnly(application?.next_follow_up_on ?? "");
  if (parsed === null) return { label: NO_DATE, tone: null };

  const todayKey = parseDateOnly(today)?.key ?? localDateKey();
  const tone: TrackerFollowUpTone =
    parsed.key < todayKey ? "overdue" : parsed.key === todayKey ? "today" : "future";
  return { label: tone === "today" ? "Today" : parsed.label, tone };
}

/** The immutable applied timestamp, formatted from the offset written by Rails. */
export function trackerAppliedLabel(job: JobSummary): string {
  return trackerDate(job.application?.applied_at ?? "");
}

function localDateKey(date = new Date()): string {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part) => String(part).padStart(2, "0"))
    .join("-");
}

/**
 * `trackerUpdatedLabel`: when the tracker state last moved. A job with no tracked application has
 * never moved, so it renders as an em dash.
 */
export function trackerUpdatedLabel(job: JobSummary): string {
  return job.application === null ? NO_DATE : trackerDate(job.application.last_status_change_at);
}

/** Days in a proleptic Gregorian month, which is the calendar Go's `time` package validates against. */
function daysIn(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}
