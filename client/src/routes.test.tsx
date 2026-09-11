import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { createQueryClient } from "./api/query-client";
import { routes } from "./routes";
import { apiHandlers } from "./test/handlers";
import { installMockApi } from "./test/msw";

// A ported screen fetches on mount, so the route table can only be exercised with the two
// providers `main.tsx` wraps it in and with Rails mocked. Placeholder screens need neither,
// which is why this arrived with the first real screen (`FE-15`) rather than with `FE-07`.
installMockApi(...apiHandlers());

/**
 * Every path, and the page-container class the Go screen renders at its root — read off
 * `web/components/*.go`, not off `routes.tsx`, so this table is a parity fixture rather
 * than a restatement of the code under test. It stays valid across the screen ports: a
 * ported screen keeps its root class because `public/app.css` styles the page container
 * through it.
 */
const SCREENS: ReadonlyArray<{ path: string; rootClass: string; go: string }> = [
  { path: "/", rootClass: "digest", go: "DigestView" },
  { path: "/login", rootClass: "login-screen", go: "Login" },
  { path: "/jobs", rootClass: "job-list", go: "JobList" },
  { path: "/jobs/new", rootClass: "manual-entry", go: "ManualEntry" },
  { path: "/jobs/42", rootClass: "job-detail", go: "JobDetailView" },
  { path: "/jobs/42/contacts", rootClass: "contacts-view", go: "ContactsView" },
  { path: "/applications", rootClass: "applications", go: "ApplicationsView" },
  { path: "/applications/7", rootClass: "draft-review", go: "DraftReview" },
  { path: "/profile", rootClass: "profile", go: "ProfileView" },
];

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const { container } = render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, container };
}

describe("route table", () => {
  it("declares exactly the nine go-app paths plus a catch-all", () => {
    expect(routes.map((route) => route.path)).toEqual([
      "/",
      "/login",
      "/jobs",
      "/jobs/new",
      "/jobs/:id",
      "/jobs/:id/contacts",
      "/applications",
      "/applications/:id",
      "/profile",
      "*",
    ]);
  });

  it.each(SCREENS)("$path renders the $go screen", ({ path, rootClass }) => {
    const { container } = renderAt(path);

    expect(container.querySelector(`.${rootClass}`)).not.toBeNull();
  });

  it("resolves /jobs/new to manual entry, not to the job detail param route", () => {
    const { container, router } = renderAt("/jobs/new");

    expect(container.querySelector(".manual-entry")).not.toBeNull();
    expect(container.querySelector(".job-detail")).toBeNull();
    // The static segment matched as a segment, so nothing was captured as an id.
    expect(router.state.matches.at(-1)?.params).toEqual({});
  });

  it("exposes the id go-app matched with a regexp as a route param", () => {
    expect(renderAt("/jobs/42").router.state.matches.at(-1)?.params).toEqual({ id: "42" });
    expect(renderAt("/jobs/42/contacts").router.state.matches.at(-1)?.params).toEqual({
      id: "42",
    });
    expect(renderAt("/applications/7").router.state.matches.at(-1)?.params).toEqual({ id: "7" });
  });

  it("renders a not-found screen for an unknown path rather than a blank page", () => {
    const { container } = renderAt("/nope");

    expect(container.querySelector(".app-shell")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /recent ingestions/i })).toHaveAttribute("href", "/");
  });
});
