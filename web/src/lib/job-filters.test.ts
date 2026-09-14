/**
 * Filter selection parity (`FE-16`) — the pure half.
 *
 * The assertions that matter most here are not about behaviour at all: they are about the
 * **stored JSON**. `waunder.jobFilters` is written by the Go build on the owner's real devices
 * and will be read by this one, in both directions until the `FE-30` cutover, so the key names
 * and the key set are a contract with `jobFilterState` in `web/components/jobs.go`. Those
 * expectations are transcribed from that struct's json tags rather than from the code under
 * test, which is the only way they are evidence instead of a mirror.
 *
 * The rest transcribes `jobs_test.go`'s filter cases: `normalizeDefaults`, `activeFilterCount`,
 * `applyResetFilters`, `resetFeed`, and the round trip its fake `app.BrowserStorage` exercised.
 */
import { describe, expect, it } from "vitest";

import { feedParams } from "./job-feed";
import {
  DEFAULT_SELECTION,
  JOB_FILTERS_STORAGE_KEY,
  type JobFilterSelection,
  activeFilterCount,
  changeSelection,
  clearFilters,
  normalizeSelection,
  readSelection,
  writeSelection,
} from "./job-filters";

/** `jobFilterState`'s json tags, transcribed from `web/components/jobs.go`. */
const GO_JSON_KEYS = [
  "view",
  "bin",
  "sort",
  "score_band",
  "source",
  "location",
  "date_from",
  "date_to",
  "page_num",
];

/** A fully-populated selection, so every field is visibly distinct in a round trip. */
const FILTERED: JobFilterSelection = {
  view: "unscored",
  bin: "backlog",
  sort: "score",
  scoreBand: "high",
  source: "linkedin",
  location: "Vancouver",
  dateFrom: "2026-06-01",
  dateTo: "2026-06-23",
  pageNum: 4,
};

/** An in-memory `Storage`, standing in for the Go build's fake `app.BrowserStorage`. */
function fakeStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

/** Storage that exists but refuses every operation, as a blocked-site-data browser does. */
function throwingStorage(): Storage {
  const boom = () => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  return {
    get length(): number {
      return boom();
    },
    clear: boom,
    getItem: boom,
    key: boom,
    removeItem: boom,
    setItem: boom,
  };
}

/* -------------------------------------------------------------------------- */
/* The stored shape is a contract with the Go build                            */
/* -------------------------------------------------------------------------- */

describe("waunder.jobFilters storage contract", () => {
  it("writes jobFilterState's json tags, and nothing else", () => {
    const storage = fakeStorage();

    writeSelection(FILTERED, storage);

    const raw = storage.getItem(JOB_FILTERS_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const stored: unknown = JSON.parse(raw ?? "");
    expect(Object.keys(stored as object).sort()).toEqual([...GO_JSON_KEYS].sort());
    expect(stored).toEqual({
      view: "unscored",
      bin: "backlog",
      sort: "score",
      score_band: "high",
      source: "linkedin",
      location: "Vancouver",
      date_from: "2026-06-01",
      date_to: "2026-06-23",
      page_num: 4,
    });
  });

  it("uses the same key jobs.go does", () => {
    expect(JOB_FILTERS_STORAGE_KEY).toBe("waunder.jobFilters");
  });

  it("stores a bare JSON object, not a JSON-encoded string", () => {
    // Unlike `waunder.layout`, which go-app wrote as a quoted string, this value was already a
    // struct — `json.Marshal` of it and `JSON.stringify` of the object agree, so there is no
    // unquoting step and there must not be one.
    const storage = fakeStorage();

    writeSelection(DEFAULT_SELECTION, storage);

    expect(storage.getItem(JOB_FILTERS_STORAGE_KEY)?.startsWith("{")).toBe(true);
  });

  it("restores a selection the Go build wrote, field for field", () => {
    // Byte-for-byte what `persistFilters` produces for FILTERED, keys in struct order.
    const goWrote =
      '{"view":"unscored","bin":"backlog","sort":"score","score_band":"high",' +
      '"source":"linkedin","location":"Vancouver","date_from":"2026-06-01",' +
      '"date_to":"2026-06-23","page_num":4}';
    const storage = fakeStorage({ [JOB_FILTERS_STORAGE_KEY]: goWrote });

    expect(readSelection(storage)).toEqual(FILTERED);
  });

  it("round-trips every field, including ones no control on this screen changes", () => {
    // `bin` is FE-17's tab and `page_num` is pagination's: both must survive untouched rather
    // than being truncated to the fields this task renders.
    const storage = fakeStorage();

    writeSelection(FILTERED, storage);

    expect(readSelection(storage)).toEqual(FILTERED);
  });
});

/* -------------------------------------------------------------------------- */
/* Reading is total                                                            */
/* -------------------------------------------------------------------------- */

describe("reading a selection that is missing, unusable, or wrong", () => {
  it("defaults when nothing is stored", () => {
    expect(readSelection(fakeStorage())).toEqual(DEFAULT_SELECTION);
  });

  it("defaults when there is no storage at all", () => {
    expect(readSelection(null)).toEqual(DEFAULT_SELECTION);
  });

  it("defaults when storage throws on access", () => {
    expect(() => readSelection(throwingStorage())).not.toThrow();
    expect(readSelection(throwingStorage())).toEqual(DEFAULT_SELECTION);
  });

  it("defaults on malformed JSON", () => {
    const storage = fakeStorage({ [JOB_FILTERS_STORAGE_KEY]: "{not json" });

    expect(readSelection(storage)).toEqual(DEFAULT_SELECTION);
  });

  it("defaults on a JSON value that is not a selection object", () => {
    // An array reaches `decodeSelection` as an object (it is one), so it is the case that
    // proves the fallback is per-field and not just a typeof guard.
    for (const raw of ['"scored"', "42", "null", "true", "[]", "[1,2]"]) {
      expect(readSelection(fakeStorage({ [JOB_FILTERS_STORAGE_KEY]: raw }))).toEqual(
        DEFAULT_SELECTION,
      );
    }
  });

  it("fills a partial object with defaults instead of leaving fields undefined", () => {
    const storage = fakeStorage({
      [JOB_FILTERS_STORAGE_KEY]: '{"source":"glassdoor","page_num":3}',
    });

    expect(readSelection(storage)).toEqual({
      ...DEFAULT_SELECTION,
      source: "glassdoor",
      pageNum: 3,
    });
  });

  it("falls back for an enum value Rails would not recognize", () => {
    // The four closed enums are answered with an empty feed by Rails if they are wrong, which
    // reads as "no jobs" rather than "stale storage" — so a bad one resolves to its default.
    const storage = fakeStorage({
      [JOB_FILTERS_STORAGE_KEY]:
        '{"view":"everything","bin":"trash","sort":"random","score_band":"great"}',
    });

    expect(readSelection(storage)).toEqual(DEFAULT_SELECTION);
  });

  it("normalizes a page number below 1 to page 1", () => {
    expect(normalizeSelection({ pageNum: 0 }).pageNum).toBe(1);
    expect(normalizeSelection({ pageNum: -7 }).pageNum).toBe(1);
    expect(normalizeSelection({ pageNum: "4" }).pageNum).toBe(1);
  });

  it("reports a failed write instead of throwing", () => {
    expect(writeSelection(DEFAULT_SELECTION, null)).toBe(false);
    expect(writeSelection(DEFAULT_SELECTION, throwingStorage())).toBe(false);
    expect(writeSelection(DEFAULT_SELECTION, fakeStorage())).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Counting, clearing, changing                                                */
/* -------------------------------------------------------------------------- */

describe("activeFilterCount", () => {
  it("counts nothing for the default selection", () => {
    expect(activeFilterCount(DEFAULT_SELECTION)).toBe(0);
  });

  it("counts the five filters and no more", () => {
    expect(activeFilterCount(FILTERED)).toBe(5);
  });

  it("does not count the sort, the view, or the bin", () => {
    const selection: JobFilterSelection = {
      ...DEFAULT_SELECTION,
      sort: "score",
      view: "unscored",
      bin: "removed",
    };

    expect(activeFilterCount(selection)).toBe(0);
  });
});

describe("clearFilters", () => {
  it("clears every filter and returns the sort to its default", () => {
    const cleared = clearFilters(FILTERED);

    expect(cleared.scoreBand).toBe("");
    expect(cleared.source).toBe("");
    expect(cleared.location).toBe("");
    expect(cleared.dateFrom).toBe("");
    expect(cleared.dateTo).toBe("");
    expect(cleared.sort).toBe("oldest");
    expect(activeFilterCount(cleared)).toBe(0);
  });

  it("leaves the scored/unscored view and the lifecycle bin alone", () => {
    // They are tabs, not filters: a Reset that also moved the owner back to the scored, active
    // feed would be a navigation.
    const cleared = clearFilters(FILTERED);

    expect(cleared.view).toBe("unscored");
    expect(cleared.bin).toBe("backlog");
  });

  it("returns to page 1, because the cleared result set is a different one", () => {
    expect(clearFilters(FILTERED).pageNum).toBe(1);
  });

  it("does not mutate the selection it was given", () => {
    const before = { ...FILTERED };

    clearFilters(FILTERED);

    expect(FILTERED).toEqual(before);
  });
});

describe("changeSelection", () => {
  it("applies the change and returns to page 1", () => {
    const next = changeSelection(FILTERED, { source: "manual" });

    expect(next.source).toBe("manual");
    expect(next.pageNum).toBe(1);
  });

  it("leaves every other field untouched", () => {
    expect(changeSelection(FILTERED, { scoreBand: "low" })).toEqual({
      ...FILTERED,
      scoreBand: "low",
      pageNum: 1,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* The query a selection produces                                              */
/* -------------------------------------------------------------------------- */

describe("feedParams", () => {
  it("sends the status, state, sort, and page for a default selection", () => {
    expect(feedParams(DEFAULT_SELECTION)).toEqual({
      status: "scored",
      state: "active",
      sort: "oldest",
      page: 1,
    });
  });

  it("omits an unset filter entirely rather than sending an empty value", () => {
    const params = feedParams(DEFAULT_SELECTION);

    for (const key of ["score_band", "source", "location", "date_from", "date_to"]) {
      expect(params).not.toHaveProperty(key);
    }
  });

  it("sends every set filter under its Rails parameter name", () => {
    expect(feedParams(FILTERED)).toEqual({
      status: "unscored",
      state: "backlog",
      sort: "score",
      score_band: "high",
      source: "linkedin",
      location: "Vancouver",
      date_from: "2026-06-01",
      date_to: "2026-06-23",
      page: 4,
    });
  });

  it("normalizes a page below 1 to page 1", () => {
    expect(feedParams({ ...DEFAULT_SELECTION, pageNum: 0 }).page).toBe(1);
  });
});
