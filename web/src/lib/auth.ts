/**
 * The auth boundary: how this client learns it is signed out, and how it signs out on purpose.
 *
 * There is no client-side notion of "signed in" to read. The session is a signed, **httponly**
 * cookie Rails sets on `POST /api/session`, which by design JavaScript cannot see, so signed-in
 * state can only be *derived from responses*: a 401 from any request means the cookie is missing,
 * expired, or invalid, and the owner belongs on the login screen. That is exactly what
 * `IsUnauthorized` drove in the Go build — every screen there checked it per call site and showed
 * a "Your session expired" panel with a `/login` link (`renderLoadError` in `jobs.go`). This
 * module replaces those twenty-odd hand-written checks with one subscription, so a screen ported
 * later cannot forget to handle it.
 *
 * ## Why it hangs off the router object rather than a React component
 *
 * `installUnauthorizedRedirect` takes the `QueryClient` and the router object and subscribes to
 * both TanStack caches. The alternative — a layout route rendering `<Outlet />` — would need the
 * route tree restructured, would re-render every screen on each navigation, and would still be
 * driven by the same two subscriptions. Navigating through the router object is the framework's
 * own escape hatch for code outside the tree, and it makes the whole boundary testable by driving
 * a `createMemoryRouter` through the *same* function `main.tsx` calls.
 *
 * Only the terminal `error` action is read. A retried read also dispatches `failed` per attempt,
 * but the retry policy in `api/query-client.ts` refuses to retry a 4xx at all, so a 401 reaches
 * `error` immediately; reading `failed` too would only fire the same redirect twice.
 *
 * A 403 deliberately does *not* redirect (`isUnauthorized` is 401-only): that is an authorization
 * decision Rails made about an authenticated owner, and signing them out would hide it.
 *
 * The login request itself is not routed through TanStack (see `components/login.tsx`), so a
 * wrong passphrase never reaches this boundary — it stays on the login screen as a status
 * message. The pathname guard below is belt-and-braces for anything else that might 401 while
 * the login screen is already showing.
 */
import { useQueryClient } from "@tanstack/react-query";
import type {
  MutationCacheNotifyEvent,
  QueryCacheNotifyEvent,
  QueryClient,
} from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useNavigate } from "react-router";
import type { DataRouter } from "react-router";

import { logout } from "../api/endpoints";
import { isUnauthorized } from "../api/errors";

/** The login route, unchanged from `main.go` and a preserved contract (docs/GO_MIGRATION.md). */
export const LOGIN_PATH = "/login";

/** Shown when `DELETE /api/session` fails for a reason other than an already-dead session. */
export const SIGN_OUT_ERROR = "Could not sign out. Please try again.";

/**
 * Redirects to the login screen whenever any query or mutation fails with a 401.
 *
 * Returns the unsubscribe function. `replace: true` is deliberate: the screen the owner was on
 * cannot be re-rendered without a session, so leaving it one Back press away would bounce them
 * straight here again.
 */
export function installUnauthorizedRedirect(client: QueryClient, router: DataRouter): () => void {
  function redirect() {
    if (router.state.location.pathname === LOGIN_PATH) return;
    void router.navigate(LOGIN_PATH, { replace: true });
  }

  function onCacheEvent(event: QueryCacheNotifyEvent | MutationCacheNotifyEvent) {
    if (isUnauthorized(terminalError(event))) redirect();
  }

  const stopQueries = client.getQueryCache().subscribe(onCacheEvent);
  const stopMutations = client.getMutationCache().subscribe(onCacheEvent);
  return () => {
    stopQueries();
    stopMutations();
  };
}

/** The error a cache event carries when a read or write has finally failed, else `undefined`. */
function terminalError(event: QueryCacheNotifyEvent | MutationCacheNotifyEvent): unknown {
  if (event.type !== "updated") return undefined;
  return event.action.type === "error" ? event.action.error : undefined;
}

/** What `useSignOut` hands a screen: the action, whether it is in flight, and a failure message. */
export interface SignOut {
  signOut: () => void;
  pending: boolean;
  error: string;
}

/**
 * Signs the owner out: `DELETE /api/session`, then drop every cached read and return to the
 * login screen.
 *
 * Two details are decisions rather than plumbing:
 *
 * - **A 401 counts as success.** `destroy` is session-guarded, so signing out with a cookie that
 *   has already expired answers 401. The owner is signed out either way, and reporting a failure
 *   would leave them staring at an error on a session that no longer exists.
 * - **The cache is cleared, after the redirect.** Everything in it — the feed, the tracker, the
 *   profile — was fetched with the session that just ended, and leaving it in memory would let a
 *   Back press paint those screens from cache with no request to 401 on. Clearing *after* the
 *   navigation matters: clearing first notifies the observers still mounted on the screen being
 *   left, which would fire a round of refetches against a session that no longer exists.
 *
 * The Go build had no sign-out control at all; `FE-25` renders this one on the profile screen.
 */
export function useSignOut(): SignOut {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const signOut = useCallback(() => {
    setPending(true);
    setError("");
    void (async () => {
      try {
        await logout();
      } catch (cause) {
        if (!isUnauthorized(cause)) {
          setPending(false);
          setError(SIGN_OUT_ERROR);
          return;
        }
      }
      setPending(false);
      await navigate(LOGIN_PATH, { replace: true });
      client.clear();
    })();
  }, [client, navigate]);

  return { signOut, pending, error };
}
