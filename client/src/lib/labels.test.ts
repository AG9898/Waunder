/**
 * Display-helper parity (`FE-06`).
 *
 * Every case table below is the corresponding Go test's table, transcribed rather than
 * rewritten: `TestMatchScoreLabel`, `TestMatchScoreBand`, `TestSourceLabel`,
 * `TestSourceIconPath`, and `TestSourceEmoji` from `web/components/jobs_test.go`, and
 * `TestTrackerGroupMapsPipelineStatus` from `web/components/applications_test.go`. A
 * transcription is the point: these strings are consumed by `app.css` and by the `FE-28`
 * screenshot gate, so the test's job is to reject a rewording, not to describe one.
 *
 * `lifecycleLabel` had no Go test — its table is derived from `client.go`'s implementation
 * and from the pill states `app.css` styles.
 *
 * Two assertions go beyond the Go tables, each covering a failure that a transcribed table
 * cannot see:
 *
 * - The brand logos are checked to **exist on disk** under `public/icons/`. The `/web/`
 *   prefix drop is a migration-wide edit (docs/GO_MIGRATION.md), and a stale or misspelled
 *   path 404s silently, removing only the logo from an origin pill.
 * - `trackerGroup` is checked against the **Rails source**, parsed out of
 *   `Api::JobPostsController::APPLICATION_GROUPS`. Rails owns group membership; this copy
 *   only tints a row, so it has to follow rather than merely have been correct once.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { ApplicationTracker } from "../api/schemas";
import {
  lifecycleLabel,
  matchScoreBand,
  matchScoreLabel,
  sourceEmoji,
  sourceIconPath,
  sourceLabel,
  trackerGroup,
} from "./labels";

/** Repository root, reached from `client/src/lib/`. */
const repoRoot = join(import.meta.dirname, "..", "..", "..");

describe("matchScoreLabel", () => {
  it.each([
    { name: "scored zero", score: 0, status: "scored", want: "0%" },
    { name: "scored value", score: 82, status: "scored", want: "82%" },
    { name: "pending", score: null, status: "pending", want: "Scoring…" },
    { name: "empty status", score: null, status: "", want: "Scoring…" },
    { name: "filtered", score: null, status: "filtered", want: "Filtered" },
    { name: "deferred", score: null, status: "deferred", want: "Queued later" },
    { name: "skipped", score: null, status: "skipped", want: "Not scored" },
    { name: "failed", score: null, status: "failed", want: "Scoring failed" },
    { name: "unknown nil", score: null, status: "weird", want: "Not scored" },
  ])("$name → $want", ({ score, status, want }) => {
    expect(matchScoreLabel(score, status)).toBe(want);
  });

  it("keeps a real 0% distinct from an unscored posting", () => {
    expect(matchScoreLabel(0, "scored")).toBe("0%");
    expect(matchScoreLabel(null, "scored")).not.toContain("0");
  });

  it("renders a percentage for any numeric score regardless of status", () => {
    for (const status of ["scored", "pending", "failed", ""]) {
      expect(matchScoreLabel(64, status)).toBe("64%");
    }
  });
});

describe("matchScoreBand", () => {
  // The Go signature took a status it ignored; the column is kept to show the result
  // never depended on it (see labels.ts).
  it.each([
    { score: null, status: "pending", want: "pending" },
    { score: null, status: "skipped", want: "pending" },
    { score: 90, status: "scored", want: "high" },
    { score: 75, status: "scored", want: "high" },
    { score: 74, status: "scored", want: "mid" },
    { score: 50, status: "scored", want: "mid" },
    { score: 49, status: "scored", want: "low" },
    { score: 0, status: "scored", want: "low" },
  ])("score $score ($status) → $want", ({ score, want }) => {
    expect(matchScoreBand(score)).toBe(want);
  });

  it("bands are exclusive and cover 0–100", () => {
    for (let score = 0; score <= 100; score += 1) {
      const band = matchScoreBand(score);
      expect(band).toBe(score >= 75 ? "high" : score >= 50 ? "mid" : "low");
    }
  });

  it("never colours an unscored posting as a real score", () => {
    for (const status of ["pending", "deferred", "filtered", "skipped", "failed", ""]) {
      expect(matchScoreLabel(null, status)).not.toContain("%");
      expect(matchScoreBand(null)).toBe("pending");
    }
  });
});

describe("sourceLabel", () => {
  it.each([
    { source: "linkedin", want: "LinkedIn" },
    { source: "glassdoor", want: "Glassdoor" },
    { source: "indeed", want: "Indeed" },
    { source: "manual", want: "Manual entry" },
    { source: "inbound_llm", want: "Email alert" },
    { source: "inbound", want: "Email alert" },
    { source: "", want: "" },
    { source: "weird", want: "weird" },
  ])("$source → $want", ({ source, want }) => {
    expect(sourceLabel(source)).toBe(want);
  });
});

describe("sourceIconPath", () => {
  it.each([
    { source: "linkedin", want: "/icons/linkedin.svg" },
    { source: "glassdoor", want: "/icons/glassdoor.svg" },
    { source: "indeed", want: "/icons/indeed.svg" },
    { source: "manual", want: "" },
    { source: "inbound_llm", want: "" },
    { source: "inbound", want: "" },
    { source: "", want: "" },
    { source: "weird", want: "" },
  ])("$source → $want", ({ source, want }) => {
    expect(sourceIconPath(source)).toBe(want);
  });

  it("resolves the /web prefix drop onto assets that exist in public/", () => {
    for (const source of ["linkedin", "glassdoor", "indeed"]) {
      const path = sourceIconPath(source);
      expect(path.startsWith("/icons/")).toBe(true);
      expect(existsSync(join(repoRoot, "client", "public", path))).toBe(true);
    }
  });

  it("hands non-branded sources to the emoji marker, never to both", () => {
    for (const source of ["linkedin", "glassdoor", "indeed", "manual", "inbound", ""]) {
      const hasLogo = sourceIconPath(source) !== "";
      const hasEmoji = sourceEmoji(source) !== "";
      expect(hasLogo && hasEmoji).toBe(false);
    }
  });
});

describe("sourceEmoji", () => {
  it.each([
    { source: "manual", want: "✍️" },
    { source: "inbound_llm", want: "📧" },
    { source: "inbound", want: "📧" },
    // Branded sources render a logo, not an emoji.
    { source: "linkedin", want: "" },
    { source: "glassdoor", want: "" },
    { source: "indeed", want: "" },
    { source: "", want: "" },
    { source: "weird", want: "" },
  ])("$source → $want", ({ source, want }) => {
    expect(sourceEmoji(source)).toBe(want);
  });
});

describe("lifecycleLabel", () => {
  it.each([
    { state: "active", want: "Active" },
    { state: "backlog", want: "Backlog" },
    { state: "removed", want: "Removed" },
    // The column defaults to active, and an older serializer omits the field entirely.
    { state: "", want: "Active" },
    { state: "weird", want: "weird" },
  ])("$state → $want", ({ state, want }) => {
    expect(lifecycleLabel(state)).toBe(want);
  });
});

describe("trackerGroup", () => {
  it.each([
    { status: "", want: "not_applied" },
    { status: "interested", want: "not_applied" },
    { status: "drafting", want: "not_applied" },
    { status: "needs_review", want: "not_applied" },
    { status: "applied", want: "applied" },
    { status: "interviewing", want: "in_progress" },
    { status: "offer", want: "in_progress" },
    { status: "rejected", want: "closed" },
    { status: "withdrawn", want: "closed" },
    { status: "archived", want: "closed" },
  ])("$status → $want", ({ status, want }) => {
    expect(trackerGroup(tracker(status))).toBe(want);
  });

  it("treats an untracked job as not applied", () => {
    expect(trackerGroup(null)).toBe("not_applied");
  });

  it("mirrors the Rails APPLICATION_GROUPS constant", () => {
    const groups = railsApplicationGroups();

    // Guards the parse itself: a refactor that moves or renames the constant must fail
    // here rather than silently assert nothing.
    expect(Object.keys(groups).sort()).toEqual(["applied", "closed", "in_progress", "not_applied"]);

    for (const [group, statuses] of Object.entries(groups)) {
      expect(statuses.length).toBeGreaterThan(0);
      for (const status of statuses) {
        expect(trackerGroup(tracker(status))).toBe(group);
      }
    }
  });
});

/** A tracker carrying only the pipeline status; every other field is its zero value. */
function tracker(pipelineStatus: string): ApplicationTracker {
  return {
    application_id: 1,
    job_post_id: 2,
    job_title: "",
    company: "",
    status: "",
    automation_status: "",
    pipeline_status: pipelineStatus,
    pipeline_stage: "",
    pipeline_note: "",
    last_status_change_at: "",
    next_follow_up_on: "",
    approved_at: "",
    submitted_at: "",
    failure_reason: "",
    draft_ready: false,
    worker_report: null,
  };
}

/**
 * Parses `Api::JobPostsController::APPLICATION_GROUPS` out of the Rails source, so the
 * mirror above is checked against the constant rather than against a second hand-written
 * copy of it. `UNTRACKED_GROUP` is resolved from its own assignment in the same file.
 */
function railsApplicationGroups(): Record<string, string[]> {
  const source = readFileSync(
    join(repoRoot, "api", "app", "controllers", "api", "job_posts_controller.rb"),
    "utf8",
  );

  const untracked = /UNTRACKED_GROUP\s*=\s*"([^"]+)"/.exec(source)?.[1];
  const body = /APPLICATION_GROUPS\s*=\s*\{([\s\S]*?)\}\.freeze/.exec(source)?.[1];
  if (untracked === undefined || body === undefined) {
    throw new Error("could not locate APPLICATION_GROUPS in the Rails controller");
  }

  const groups: Record<string, string[]> = {};
  for (const line of body.split("\n")) {
    const entry = /^\s*(UNTRACKED_GROUP|"[^"]+")\s*=>\s*%w\[([^\]]*)\]/.exec(line);
    if (entry === null) continue;
    const [, rawKey = "", rawStatuses = ""] = entry;
    const key = rawKey === "UNTRACKED_GROUP" ? untracked : rawKey.slice(1, -1);
    groups[key] = rawStatuses.trim().split(/\s+/);
  }
  return groups;
}
