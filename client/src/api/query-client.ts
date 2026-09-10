/**
 * The configured TanStack Query client.
 *
 * This app is entirely server state — Rails owns every fact, and the client's whole job is
 * fetch / cache / invalidate / refetch. Three defaults are set deliberately, and each one exists
 * because the alternative is wrong for *this* app rather than because it is a nicer number.
 *
 * **Retries are error-aware.** TanStack retries three times with backoff by default, which is
 * actively harmful here: a 401 would be retried three times before the owner is sent to the login
 * screen, and a `ResponseFormatError` (a contract break — Rails answered, with a body no schema
 * accepts) is perfectly deterministic and will fail identically forever. So only a transport
 * failure or a Rails 5xx is retried; every 4xx and every format error fails immediately.
 *
 * **Mutations never retry.** `submitApplication` dispatches a trusted submit to the Playwright
 * worker, and `createJobPost` / `createApplication` create rows. A retry of a request that
 * actually reached Rails but whose response was lost would re-dispatch, and CLAUDE.md's
 * "never auto-submit without explicit per-application approval" is not satisfied by a retry the
 * owner never asked for. Retrying is therefore off for *all* mutations, not just submit —
 * an allowlist would put the burden on whoever adds the next one.
 *
 * **Refetch on focus and reconnect stay on.** This is an installed mobile PWA that is usually
 * resumed from memory rather than reloaded, which already stranded the owner on a stale build
 * once (AGENTS.md 2026-09-08). A 30-second `staleTime` keeps that from being chatty: a
 * tab-switch inside a single session reuses the cache, while resuming the app later refetches.
 */
import { QueryClient } from "@tanstack/react-query";

import { ResponseFormatError, asAPIError } from "./errors";

/** Total attempts for a retryable read: the first plus two retries. */
export const MAX_QUERY_ATTEMPTS = 3;

/** How long a read stays fresh. Short: the owner acts on this data and expects it to move. */
export const QUERY_STALE_TIME_MS = 30_000;

/** How long an unused read is kept before garbage collection. */
export const QUERY_GC_TIME_MS = 5 * 60_000;

/**
 * Whether a failed read should be retried, given how many times it has already failed.
 *
 * - A `ResponseFormatError` never retries: the same body will be rejected the same way.
 * - An `APIError` retries only on 5xx. A 4xx is Rails' considered answer — 401 sends the owner
 *   to login, 403/404/422 are decisions, not hiccups.
 * - Anything else is a transport failure (offline, DNS, a dropped connection) and is retried.
 *
 * Exported so the policy is testable without driving a real query through a retry loop.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_QUERY_ATTEMPTS) return false;
  if (error instanceof ResponseFormatError) return false;
  const apiError = asAPIError(error);
  return apiError === undefined || apiError.status >= 500;
}

/** Builds the app's QueryClient. One per app instance; tests build their own. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetryQuery,
        staleTime: QUERY_STALE_TIME_MS,
        gcTime: QUERY_GC_TIME_MS,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
      },
      mutations: {
        // Never. See the module comment: a replayed write can re-dispatch a trusted submit.
        retry: false,
      },
    },
  });
}
