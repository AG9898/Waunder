import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router";

import { createQueryClient } from "./api/query-client";
import { installUnauthorizedRedirect } from "./lib/auth";
import { installSwNavigation } from "./lib/sw-nav";
import { routes } from "./routes";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Missing #root container in index.html");
}

// The app root, in the order the layers depend on each other: React, then the server-state
// cache, then routing. The route table lives in ./routes so the route test can drive the
// same array through a memory router; the screens themselves are placeholders until
// FE-15 … FE-26 land (see docs/GO_MIGRATION.md).
//
// One QueryClient per app instance, built here rather than at module scope in
// api/query-client.ts so tests never share a cache with the app or with each other.
const queryClient = createQueryClient();
const router = createBrowserRouter(routes);

// The auth boundary. The session cookie is httponly, so being signed out is only ever learned
// from a 401 — one subscription over both caches sends the owner to /login, instead of every
// screen checking per call site as the Go build did. Never unsubscribed: it lives as long as
// the app does. See src/lib/auth.ts.
installUnauthorizedRedirect(queryClient, router);

// The other half of the notification click. The service worker focuses this window and posts the
// target path instead of navigating it, so a digest notification routes in place rather than
// reloading the app and refetching everything. See src/lib/sw-nav.ts and src/sw.ts.
installSwNavigation((path) => void router.navigate(path));

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
