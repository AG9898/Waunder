/**
 * The pure half of the ingestion landing: how a batch's date, time, count, and source read,
 * and what the intake toggle says after it answers. Ported from `formatBatchDate`,
 * `formatBatchTime`, `batchCountLabel`, `batchSourceLabel`, and `applyIntakeResult` in
 * `web/components/jobs.go` (see docs/GO_MIGRATION.md).
 *
 * These live in `lib/` for the reason every ported helper does: a module that exports both
 * components and plain functions trips `eslint-plugin-react-refresh`, and the chain's bar is
 * zero warnings with no disable comments (`FE-07`).
 *
 * ## The two formatters never consult the local clock
 *
 * This is the one place `labels.ts`' rule — "a helper that formats a date against the local
 * clock is not a label" — has to be stated as behaviour rather than avoided, and both
 * functions are deliberately timezone-blind:
 *
 * - A batch's `date` is the calendar day Rails grouped by (`IngestionBatchBuilder`), not an
 *   instant. Go parsed it with `time.Parse("2006-01-02", …)`, which yields UTC midnight, and
 *   formatted it straight back out, so `2026-09-08` always read `Tue, Sep 8`. Handing the
 *   same string to `new Date(...)` and `toLocaleDateString()` would render `Mon, Sep 7` for
 *   every owner west of UTC — the date header would disagree with the day Rails grouped on.
 * - A batch's `ingested_at` is an RFC 3339 instant, and Go's `time.Parse(time.RFC3339, …)`
 *   keeps the **offset written in the string** rather than converting to the browser's zone.
 *   `…T15:04:05Z` and `…T15:04:05-07:00` both rendered `3:04 PM` in the Go build (verified
 *   against the real `time` package, AGENTS.md). `toLocaleTimeString` would convert, so the
 *   chip would differ per device and per test machine. Rails serializes UTC, so in practice
 *   this chip has always shown UTC — changing that is a design decision, not a port.
 *
 * The month and weekday names are fixed English abbreviations for the same reason: Go's
 * `Mon`/`Jan` reference layout is not locale-aware, and `toLocaleDateString` under a
 * different `LANG` would quietly produce different text than the build being replaced.
 */
import type { IntakeStatus } from "../api/schemas";
import { sourceLabel } from "./labels";

/** Go's `Mon` layout element. Indexed by `Date.prototype.getUTCDay()`. */
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Go's `Jan` layout element. Indexed by `Date.prototype.getUTCMonth()`. */
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

/** `YYYY-MM-DD`, zero-padded — exactly what Go's `2006-01-02` layout accepts, and nothing else. */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * RFC 3339, with the offset Go's `time.RFC3339` layout requires. The offset is matched but
 * unused: the time of day is read from the literal, exactly as Go's formatter did.
 */
const RFC3339 = /^\d{4}-\d{2}-\d{2}[Tt](\d{2}):(\d{2}):\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$/;

/**
 * `formatBatchDate`: the date header over a day's batches — `2026-09-08` → `Tue, Sep 8`.
 *
 * An unparseable value is returned **as-is** rather than dropped, matching Go: a header that
 * shows the raw string is a visible bug report, while an empty one silently merges two days'
 * batches into one apparent group.
 */
export function formatBatchDate(iso: string): string {
  const match = ISO_DATE.exec(iso);
  if (match === null) return iso;
  // `noUncheckedIndexedAccess` types a matched group as possibly absent; the guard is for the
  // compiler rather than for a case the regexp can produce.
  const [, year, month, day] = match;
  if (year === undefined || month === undefined || day === undefined) return iso;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  // Go's parser rejects an out-of-range component (`2026-02-30`, `2026-13-01`); `Date.UTC`
  // rolls it over instead, so the round-trip check is what reproduces the rejection.
  if (
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() !== Number(month) - 1 ||
    parsed.getUTCDate() !== Number(day)
  ) {
    return iso;
  }
  const weekday = WEEKDAYS[parsed.getUTCDay()];
  const monthName = MONTHS[parsed.getUTCMonth()];
  if (weekday === undefined || monthName === undefined) return iso;
  return `${weekday}, ${monthName} ${parsed.getUTCDate()}`;
}

/**
 * `formatBatchTime`: the time chip on a batch summary — `2026-09-08T15:04:05Z` → `3:04 PM`.
 *
 * Returns `""` for an empty or unparseable timestamp so the caller omits the chip entirely,
 * which is what Go's `app.If(formatBatchTime(...) != "")` did. A blank chip would read as an
 * ingestion with no recorded time rather than as a value this screen could not render.
 */
export function formatBatchTime(ts: string): string {
  const match = RFC3339.exec(ts);
  if (match === null) return "";
  const [, hours, minutes] = match;
  if (hours === undefined || minutes === undefined) return "";
  const hour = Number(hours);
  const suffix = hour < 12 ? "AM" : "PM";
  // Go's `3` layout element: 12-hour, no leading zero, with midnight and noon both at 12.
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${minutes} ${suffix}`;
}

/** `batchCountLabel`: how many postings arrived in one batch. */
export function batchCountLabel(count: number): string {
  return count === 1 ? "1 job" : `${count} jobs`;
}

/**
 * `batchSourceLabel`: the source on a batch summary, falling back to a neutral word.
 *
 * `sourceLabel` returns `""` for an unrecorded source, and a feed row suppresses its pill in
 * that case — but a batch summary is the row the owner clicks, so a blank one is unclickable
 * looking. `Other` keeps it labelled.
 */
export function batchSourceLabel(source: string): string {
  const label = sourceLabel(source);
  return label === "" ? "Other" : label;
}

/**
 * `applyIntakeResult`'s success copy: what the toggle reports after Rails answers.
 *
 * `queued_count` is populated only by a resume, and reports how many held webhook references
 * were requeued — so it is worth saying out loud. A pause says what happens to alerts that
 * arrive while intake is off, because "paused" alone reads as "alerts are dropped".
 */
export function intakeResultMessage(status: IntakeStatus): string {
  if (!status.enabled) return "Intake paused. New alerts will be held for later.";
  if (status.queued_count > 0) {
    return `Intake resumed. Processing ${status.queued_count} held alerts.`;
  }
  return "Intake resumed.";
}

/**
 * The query string a posting link carries out of the landing: where the owner came from, and
 * which batch to re-expand when they come back.
 *
 * `URLSearchParams` matches Go's `url.QueryEscape` for every character a synthetic batch id
 * (`<source>-<epoch>`, built by `IngestionBatchBuilder`) can contain, including the `+` for a
 * space. The job detail reads `from` to decide whether its back link returns here (`FE-19`).
 */
export function batchLinkQuery(batchId: string): string {
  return new URLSearchParams({ from: "digest", batch: batchId }).toString();
}
