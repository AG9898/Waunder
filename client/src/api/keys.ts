/**
 * Query key factory for every read endpoint.
 *
 * Go had no cache: each screen fetched on entry and re-fetched after its own mutation. TanStack
 * Query needs a stable identity per read instead, and every key must come from here — a key
 * spelled out inline at a call site is how a mutation silently stops invalidating a screen.
 *
 * Keys are **hierarchical**, so a mutation can invalidate as narrowly as it should:
 *
 * ```
 * ["waunder"]
 *   ├ ["waunder","intake"]
 *   ├ ["waunder","jobs"]
 *   │   ├ ["waunder","jobs","list",<query string>]
 *   │   └ ["waunder","jobs","detail",<id>]
 *   │        ├ ["waunder","jobs","detail",<id>,"cover_letter_draft"]
 *   │        └ ["waunder","jobs","detail",<id>,"contact_candidates"]
 *   ├ ["waunder","digest"]
 *   ├ ["waunder","ingestion_batches"] → [...,<page>]
 *   ├ ["waunder","applications"] → [...,<id>,"draft"]
 *   ├ ["waunder","profile"]
 *   └ ["waunder","push"] → [...,"vapid_public_key"]
 * ```
 *
 * TanStack matches by key *prefix*, so `invalidateQueries({queryKey: queryKeys.jobs.detail(7)})`
 * also refreshes that job's cover letter and contacts, while
 * `queryKeys.jobs.root()` refreshes every feed page and detail without touching the profile.
 *
 * Which prefixes each mutation should invalidate (the screen tasks wire these up):
 *
 * | Mutation | Invalidate |
 * |---|---|
 * | `setIntake` | `intake()` |
 * | `scoreJobPost` | `jobs.root()`, `digest()`, `ingestionBatches.root()` |
 * | `setJobLifecycle` | `jobs.root()`, `digest()`, `ingestionBatches.root()` |
 * | `generateCoverLetter` | `jobs.coverLetter(id)` |
 * | `createApplication` | `applications.root()`, `jobs.detail(id)`, `jobs.list()` prefix via `jobs.root()` |
 * | `updateApplicationDraft`, `submitApplication` | `applications.draft(id)`, `jobs.root()` |
 * | `updateJobApplicationStatus` | `jobs.root()`, `applications.root()` |
 * | `updateProfile` | `profile()` |
 * | `generateOutreach` | `jobs.contacts(jobId)` |
 * | `createJobPost` | `jobs.root()`, `ingestionBatches.root()` |
 *
 * `login`, `subscribePush`, `unsubscribePush`, and `lookupPosting` cache nothing: the first two
 * change no read payload, and a lookup persists nothing in Rails, so it is a mutation by shape
 * (a `POST` that must not be replayed from cache) despite reading.
 */
import { jobFeedQuery } from "./endpoints";
import type { JobFeedParams } from "./schemas";

/** Namespaces every key so a future non-API cache entry cannot collide with one. */
const ROOT = "waunder";

export const queryKeys = {
  /** Every cached read. `invalidateQueries()` with this is the "reload everything" hammer. */
  root: () => [ROOT] as const,

  intake: () => [ROOT, "intake"] as const,

  jobs: {
    /** Every feed page and every job detail (plus their cover letters and contacts). */
    root: () => [ROOT, "jobs"] as const,
    /**
     * One feed page, identified by the exact query string sent to Rails. Params that serialize
     * identically — `{}` and `{page: 1}`, say — therefore share one cache entry, and an unset
     * filter cannot fork the cache the way an `""`-vs-absent distinction would.
     */
    list: (params: JobFeedParams = {}) => [ROOT, "jobs", "list", jobFeedQuery(params)] as const,
    detail: (id: number) => [ROOT, "jobs", "detail", id] as const,
    coverLetter: (id: number) => [ROOT, "jobs", "detail", id, "cover_letter_draft"] as const,
    contacts: (id: number) => [ROOT, "jobs", "detail", id, "contact_candidates"] as const,
  },

  digest: () => [ROOT, "digest"] as const,

  ingestionBatches: {
    root: () => [ROOT, "ingestion_batches"] as const,
    page: (page = 1) => [ROOT, "ingestion_batches", page] as const,
  },

  applications: {
    root: () => [ROOT, "applications"] as const,
    draft: (id: number) => [ROOT, "applications", id, "draft"] as const,
  },

  profile: () => [ROOT, "profile"] as const,

  push: {
    root: () => [ROOT, "push"] as const,
    vapidPublicKey: () => [ROOT, "push", "vapid_public_key"] as const,
  },
} as const;

/** Any key this factory produces, as TanStack Query wants it (`readonly unknown[]`). */
export type QueryKey = readonly unknown[];
