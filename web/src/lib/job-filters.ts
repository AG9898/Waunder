/**
 * The jobs feed's filter selection: its shape, its defaults, its option tables, its
 * `localStorage` contract, and the pure transitions a control applies to it. Ported from the
 * selection fields, `jobFilterState`, `restoreFilters`, `persistFilters`, `normalizeDefaults`,
 * `activeFilterCount`, `applyResetFilters`, and `resetFeed` in `web/components/jobs.go`
 * (see docs/GO_MIGRATION.md). Turning a selection into a request is `job-feed.ts`'s
 * `feedParams`, which is where the rest of the feed's pure helpers already live.
 *
 * Everything here is pure and synchronous — no React, no transport, no DOM beyond an injected
 * `Storage` — for the same reason `labels.ts` and `job-feed.ts` are: these are the functions
 * that can be asserted directly against the Go originals, and the screen is then only wiring.
 *
 * ## The stored shape is a preserved contract
 *
 * go-app's `BrowserStorage` JSON-encodes what it writes, so `waunder.jobFilters` already holds a
 * plain JSON object — `json.Marshal` of `jobFilterState` and `JSON.stringify` of the same object
 * agree byte for byte, which is why this key needs none of the unquoting `waunder.layout` does
 * (docs/GO_MIGRATION.md). The **key names are the contract**: `score_band`, `date_from`,
 * `date_to`, and `page_num` are `jobFilterState`'s json tags, so `encodeSelection` /
 * `decodeSelection` are the only place the in-memory camelCase names and the stored snake_case
 * names meet. Until the `FE-30` cutover the Go build is still production on the same devices and
 * reads the same key, so a renamed field silently resets the owner's filters in both directions.
 *
 * ## Every stored field round-trips, including ones this task has no control for
 *
 * `bin` (the lifecycle tab) and `page_num` are part of the saved struct but their UI is `FE-17`
 * and `FE-15` respectively. They are still decoded, carried in the selection, and re-encoded, so
 * a selection saved by the Go build survives a round trip through the React build unchanged
 * rather than being quietly truncated to the fields this screen happens to render.
 *
 * ## Reading is total
 *
 * `localStorage` can be absent, can throw on *access* in a browser configured to block site
 * data, and can hold anything — an older build's struct, a hand edit, or a truncated write.
 * Every one of those resolves to the defaults through `normalizeSelection`, because a feed that
 * renders the default working set is always correct and a thrown read is a blank screen.
 */

/** The `localStorage` key. Same key as `jobs.go`'s `jobFiltersStorageKey`. */
export const JOB_FILTERS_STORAGE_KEY = "waunder.jobFilters";

/** The scored/unscored status toggle. `jobs.go`'s `jobListScored` / `jobListUnscored`. */
export type FeedView = "scored" | "unscored";

/** The lifecycle bin. Selected by `FE-17`'s tabs; restored and persisted here. */
export type FeedBin = "active" | "backlog" | "removed";

/** The sort mode. `jobs.go`'s `jobSortOldest` / `jobSortScore`. */
export type FeedSort = "oldest" | "score";

/** A score-band filter, or `""` for no filter. */
export type ScoreBandFilter = "" | "high" | "mid" | "low" | "unscored";

/**
 * The whole feed selection, one field per `JobList` selection field in Go.
 *
 * The five string filters use `""` for "not filtering", exactly as the Go zero value did, and
 * that emptiness is what `feedParams` (`job-feed.ts`) turns into an **omitted** query
 * parameter rather than a literal `""` Rails would try to match.
 */
export interface JobFilterSelection {
  view: FeedView;
  bin: FeedBin;
  sort: FeedSort;
  scoreBand: ScoreBandFilter;
  /** Exact ingestion source, e.g. `"linkedin"`. */
  source: string;
  /** Case-insensitive substring match. */
  location: string;
  /** `YYYY-MM-DD` lower bound on `created_at`. */
  dateFrom: string;
  /** `YYYY-MM-DD` upper bound on `created_at`. */
  dateTo: string;
  /** 1-based page number. */
  pageNum: number;
}

/**
 * `normalizeDefaults`: the scored, active working set, oldest first, page 1, no filters.
 *
 * `status=scored` and `state=active` are the feed's whole point — deterministic triage leaves
 * most inbound postings `deferred` or `filtered`, so an unfiltered feed is mostly noise. (The
 * *tracker* is the screen that asks for `status=all`; conflating the two is what left the
 * all-jobs table empty in production, AGENTS.md 2026-09-08.) They are sent explicitly rather
 * than left to Rails' own defaults, which happen to agree today and would stop agreeing
 * silently.
 */
export const DEFAULT_SELECTION: JobFilterSelection = {
  view: "scored",
  bin: "active",
  sort: "oldest",
  scoreBand: "",
  source: "",
  location: "",
  dateFrom: "",
  dateTo: "",
  pageNum: 1,
};

/** The filter fields Reset clears and the summary badge counts. Sort and view are not filters. */
const FILTER_FIELDS = ["scoreBand", "source", "location", "dateFrom", "dateTo"] as const;

/**
 * The score-band options, in `renderFilterControls`' order with its labels.
 *
 * The empty value is a real `value=""`, not go-app's `"all"` sentinel. That sentinel existed
 * because go-app omitted an empty `value` attribute entirely and the browser then reports such
 * an option's *text* as its value, so picking "All" sent `source=All` and matched nothing
 * (AGENTS.md 2026-06-24). React renders `value=""`, so the workaround would only add a mapping
 * layer that can drift; `job-filters.test.tsx` asserts the rendered attribute is present and
 * empty, which rules the original bug out directly rather than routing around it.
 */
export const SCORE_BAND_OPTIONS: ReadonlyArray<{ value: ScoreBandFilter; label: string }> = [
  { value: "", label: "All" },
  { value: "high", label: "High (75+)" },
  { value: "mid", label: "Mid (50–74)" },
  { value: "low", label: "Low (<50)" },
  { value: "unscored", label: "Unscored" },
];

/** The source options, in `renderFilterControls`' order with its labels. */
export const SOURCE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "All" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "glassdoor", label: "Glassdoor" },
  { value: "indeed", label: "Indeed" },
  { value: "manual", label: "Manual entry" },
  { value: "inbound_llm", label: "Email alert" },
];

/** The sort options, in `renderFilterControls`' order with its labels. */
export const SORT_OPTIONS: ReadonlyArray<{ value: FeedSort; label: string }> = [
  { value: "oldest", label: "Oldest first" },
  { value: "score", label: "Highest score" },
];

/** Narrows to one of `options`' values, falling back to the default for anything else. */
function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** A stored free-text filter: any non-string (missing, null, a number) is "not filtering". */
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * `normalizeDefaults`, widened to also sanitize what came out of storage.
 *
 * Go could restore garbage into its string fields and send it to Rails; here an unrecognized
 * `view`, `bin`, `sort`, or `score_band` falls back to its default instead, because those four
 * are closed enums on the wire (`JobFeedParamsSchema`) and Rails answers an unknown value with
 * an empty feed. Free-text `source` / `location` / dates pass through — they are open-ended by
 * design and Rails matching nothing is the honest answer for a stale one.
 */
export function normalizeSelection(saved: Partial<Record<keyof JobFilterSelection, unknown>>) {
  const page = typeof saved.pageNum === "number" ? Math.trunc(saved.pageNum) : 0;
  return {
    view: oneOf<FeedView>(saved.view, ["scored", "unscored"], DEFAULT_SELECTION.view),
    bin: oneOf<FeedBin>(saved.bin, ["active", "backlog", "removed"], DEFAULT_SELECTION.bin),
    sort: oneOf<FeedSort>(saved.sort, ["oldest", "score"], DEFAULT_SELECTION.sort),
    scoreBand: oneOf<ScoreBandFilter>(
      saved.scoreBand,
      SCORE_BAND_OPTIONS.map((option) => option.value),
      DEFAULT_SELECTION.scoreBand,
    ),
    source: text(saved.source),
    location: text(saved.location),
    dateFrom: text(saved.dateFrom),
    dateTo: text(saved.dateTo),
    pageNum: page < 1 ? 1 : page,
  } satisfies JobFilterSelection;
}

/** The persisted JSON object: `jobFilterState`'s json tags, in its field order. */
interface StoredSelection {
  view: string;
  bin: string;
  sort: string;
  score_band: string;
  source: string;
  location: string;
  date_from: string;
  date_to: string;
  page_num: number;
}

/** `jobFilterState`'s json tags — the half of the contract a rename would break. */
function encodeSelection(selection: JobFilterSelection): StoredSelection {
  return {
    view: selection.view,
    bin: selection.bin,
    sort: selection.sort,
    score_band: selection.scoreBand,
    source: selection.source,
    location: selection.location,
    date_from: selection.dateFrom,
    date_to: selection.dateTo,
    page_num: selection.pageNum,
  };
}

/** The inverse, tolerant of a partial or foreign object; `normalizeSelection` does the rest. */
function decodeSelection(raw: unknown): JobFilterSelection {
  if (typeof raw !== "object" || raw === null) {
    return { ...DEFAULT_SELECTION };
  }
  const stored = raw as Partial<StoredSelection>;
  return normalizeSelection({
    view: stored.view,
    bin: stored.bin,
    sort: stored.sort,
    scoreBand: stored.score_band,
    source: stored.source,
    location: stored.location,
    dateFrom: stored.date_from,
    dateTo: stored.date_to,
    pageNum: stored.page_num,
  });
}

/**
 * The browser's `localStorage`, or `null` where it cannot be used.
 *
 * The DOM types declare it as always present, but the property *getter* itself throws when a
 * browser is configured to block site data, and the global is absent outside a document. Both
 * are the same answer here: no storage. (Same shape as `layout.ts`'s `browserStorage`; kept
 * local to each module so neither grows a dependency on the other's key.)
 */
function browserStorage(): Storage | null {
  try {
    const storage: Storage | undefined = globalThis.localStorage;
    return storage ?? null;
  } catch {
    return null;
  }
}

/**
 * `restoreFilters`: the last-saved selection, or the defaults when nothing is stored.
 *
 * The screen calls this **before its first fetch**, which is the whole point: the router
 * recreates the feed component on every navigation to `/jobs`, so without this a trip into a job
 * and back would silently drop the owner's filters (AGENTS.md 2026-07-06).
 *
 * `storage` is injectable so a test can drive a stub that throws, mirroring the
 * `restoreFilters(app.BrowserStorage)` seam the Go build used for the same reason.
 */
export function readSelection(storage: Storage | null = browserStorage()): JobFilterSelection {
  try {
    const raw = storage?.getItem(JOB_FILTERS_STORAGE_KEY);
    if (raw === null || raw === undefined) {
      return { ...DEFAULT_SELECTION };
    }
    return decodeSelection(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SELECTION };
  }
}

/**
 * `persistFilters`: saves the selection, returning whether it was actually stored.
 *
 * Called on every change (and on mount), as `load()` was in Go, so storage always matches what
 * is on screen. The boolean exists because a browser that cannot persist this must still honor
 * the selection for the session — unlike the layout preference, nothing surfaces the failure to
 * the owner, because a filter that does not survive a reload is a far smaller surprise than a
 * layout that does not.
 */
export function writeSelection(
  selection: JobFilterSelection,
  storage: Storage | null = browserStorage(),
): boolean {
  if (!storage) {
    return false;
  }
  try {
    storage.setItem(JOB_FILTERS_STORAGE_KEY, JSON.stringify(encodeSelection(selection)));
    return true;
  } catch {
    return false;
  }
}

/**
 * `activeFilterCount`: how many filters differ from their default, for the collapsed panel's
 * badge. Sort is excluded because it always has a value, and the view and bin are excluded
 * because they are tabs, not filters.
 */
export function activeFilterCount(selection: JobFilterSelection): number {
  return FILTER_FIELDS.filter((field) => selection[field] !== "").length;
}

/**
 * `applyResetFilters` + `resetFeed`: clears the five filters and the sort, back to page 1.
 *
 * The view and the bin are deliberately left alone. They are separate tabs — a Reset that also
 * threw the owner back to the scored/active feed would be a navigation, not a filter clear.
 */
export function clearFilters(selection: JobFilterSelection): JobFilterSelection {
  return {
    ...selection,
    scoreBand: "",
    source: "",
    location: "",
    dateFrom: "",
    dateTo: "",
    sort: DEFAULT_SELECTION.sort,
    pageNum: 1,
  };
}

/**
 * `resetFeed`: any selection change returns to page 1.
 *
 * Page 4 of "scored, active" is not page 4 of "high score in Vancouver", so keeping the page
 * across a filter change either shows a page that no longer exists or an arbitrary slice of a
 * different result set.
 */
export function changeSelection(
  selection: JobFilterSelection,
  change: Partial<JobFilterSelection>,
): JobFilterSelection {
  return { ...selection, ...change, pageNum: 1 };
}
