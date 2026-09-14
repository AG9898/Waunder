/**
 * The 401 auth boundary and sign-out (`FE-09`).
 *
 * There is no Go counterpart to transcribe: the Go build checked `IsUnauthorized` at each of its
 * twenty-odd call sites and rendered a "Your session expired" panel with a `/login` link, and it
 * had no sign-out at all. What is pinned here is the replacement contract:
 *
 * - a 401 from **either** cache — a read or a write — puts the owner on the login screen;
 * - a 403 does not, because that is a decision about an authenticated owner;
 * - sign-out issues `DELETE /api/session`, and an already-dead session still signs out.
 *
 * The boundary is driven through the *same* function `main.tsx` calls, over a real
 * `createMemoryRouter` built from the app's own route table, so nothing here can pass against a
 * wiring the app does not use.
 */
import { QueryClientProvider, useMutation } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { RouterProvider, createMemoryRouter } from "react-router";
import type { DataRouter, RouteObject } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { fetchIntake, setIntake } from "../api/endpoints";
import { queryKeys } from "../api/keys";
import { createQueryClient } from "../api/query-client";
import { routes } from "../routes";
import { HttpResponse, errorResponse, http, installMockApi } from "../test/msw";
import { LOGIN_PATH, SIGN_OUT_ERROR, installUnauthorizedRedirect, useSignOut } from "./auth";

const server = installMockApi();

/**
 * The app's own wiring: a QueryClient, a route table in a memory router, and the redirect
 * installed over both — the same three calls `main.tsx` makes.
 */
function mountApp(path: string, table: RouteObject[] = routes) {
  const client = createQueryClient();
  const router = createMemoryRouter(table, { initialEntries: [path] });
  const stop = installUnauthorizedRedirect(client, router);
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...view, client, router, stop };
}

/**
 * The app's route table with one screen's element replaced by a test control, so a control that
 * uses router hooks is mounted where the real screen will be rather than beside the router. The
 * other eight routes — `/login` above all — stay exactly as the app declares them.
 */
function tableWith(path: string, element: ReactNode): RouteObject[] {
  return routes.map((route) => (route.path === path ? { ...route, element } : route));
}

/**
 * Runs a read through the QueryClient, the way a screen's `useQuery` would. Wrapped in `act`
 * because the failure drives a router navigation from outside React's own event plumbing.
 */
async function runRead(client: ReturnType<typeof createQueryClient>) {
  await act(async () => {
    await client
      .fetchQuery({ queryKey: queryKeys.intake(), queryFn: () => fetchIntake() })
      .catch(() => undefined);
  });
}

/** A write, done the way a ported screen will do it. `mutate` reports failure, never throws. */
function IntakeToggle() {
  const { mutate } = useMutation({ mutationFn: () => setIntake(false) });
  return (
    <button
      onClick={() => {
        mutate();
      }}
    >
      pause intake
    </button>
  );
}

/** A button wired to the real hook, standing in for the control `FE-25` will render. */
function SignOutControl() {
  const { signOut, pending, error } = useSignOut();
  return (
    <>
      <button onClick={signOut} disabled={pending}>
        Sign out
      </button>
      {error === "" ? null : <p data-testid="sign-out-error">{error}</p>}
    </>
  );
}

function onLoginScreen(router: DataRouter) {
  expect(router.state.location.pathname).toBe(LOGIN_PATH);
}

describe("401 auth boundary", () => {
  it("sends a 401 from a read to the login screen", async () => {
    server.use(errorResponse("get", "/api/intake", 401, "unauthorized", "Unauthorized"));
    const { client, router } = mountApp("/jobs");

    await runRead(client);

    await waitFor(() => {
      onLoginScreen(router);
    });
    // Not just the URL: the login screen is actually rendered.
    expect(screen.getByRole("heading", { name: "Waunder" })).toBeInTheDocument();
    // replace, so Back cannot return to a screen that has no session to render with.
    expect(router.state.historyAction).toBe("REPLACE");
  });

  it("sends a 401 from a write to the login screen", async () => {
    server.use(errorResponse("patch", "/api/intake", 401, "unauthorized", "Unauthorized"));
    const { router } = mountApp("/jobs", tableWith("/jobs", <IntakeToggle />));

    fireEvent.click(screen.getByRole("button", { name: "pause intake" }));

    await waitFor(() => {
      onLoginScreen(router);
    });
  });

  it("does not sign the owner out on a 403", async () => {
    server.use(errorResponse("get", "/api/intake", 403, "forbidden", "Forbidden"));
    const { client, router } = mountApp("/jobs");

    await runRead(client);

    expect(router.state.location.pathname).toBe("/jobs");
  });

  it("does not retry a 401 before redirecting", async () => {
    let calls = 0;
    server.use(
      http.get("/api/intake", () => {
        calls += 1;
        return HttpResponse.json({ error: { code: "unauthorized", message: "" } }, { status: 401 });
      }),
    );
    const { client, router } = mountApp("/jobs");

    await runRead(client);

    await waitFor(() => {
      onLoginScreen(router);
    });
    expect(calls).toBe(1);
  });

  it("does not navigate when the login screen is already showing", async () => {
    server.use(errorResponse("get", "/api/intake", 401, "unauthorized", "Unauthorized"));
    const { client, router } = mountApp(LOGIN_PATH);
    const navigate = vi.spyOn(router, "navigate");

    await runRead(client);

    expect(navigate).not.toHaveBeenCalled();
    onLoginScreen(router);
  });

  it("stops redirecting once unsubscribed", async () => {
    server.use(errorResponse("get", "/api/intake", 401, "unauthorized", "Unauthorized"));
    const { client, router, stop } = mountApp("/jobs");
    stop();

    await runRead(client);

    expect(router.state.location.pathname).toBe("/jobs");
  });
});

describe("sign-out", () => {
  it("issues DELETE /api/session and returns to the login screen", async () => {
    const received: { method?: string; body?: string } = {};
    server.use(
      http.delete("/api/session", async ({ request }) => {
        received.method = request.method;
        received.body = await request.text();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { client, router } = mountApp("/profile", tableWith("/profile", <SignOutControl />));
    // Something cached from the session that is about to end.
    client.setQueryData(queryKeys.profile(), { full_name: "Owner" });

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => {
      onLoginScreen(router);
    });
    expect(received.method).toBe("DELETE");
    expect(received.body).toBe("");
    // Nothing fetched with the old session is left to paint a screen from.
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });

  it("still signs out when the session had already expired", async () => {
    server.use(errorResponse("delete", "/api/session", 401, "unauthorized", "Unauthorized"));
    const { router } = mountApp("/profile", tableWith("/profile", <SignOutControl />));

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => {
      onLoginScreen(router);
    });
    expect(screen.queryByTestId("sign-out-error")).toBeNull();
  });

  it("reports a failure and stays put on any other error", async () => {
    server.use(errorResponse("delete", "/api/session", 500, "server_error", "boom"));
    const { router } = mountApp("/profile", tableWith("/profile", <SignOutControl />));

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect(await screen.findByTestId("sign-out-error")).toHaveTextContent(SIGN_OUT_ERROR);
    expect(router.state.location.pathname).toBe("/profile");
  });
});
