import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router";

import { createQueryClient } from "./api/query-client";
import { routes } from "./routes";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Missing #root container in index.html");
}

// The app root, in the order the layers depend on each other: React, then the server-state
// cache, then routing. The route table lives in ./routes so the route test can drive the
// same array through a memory router; the screens themselves are placeholders until
// FE-08 … FE-26 land (see docs/GO_MIGRATION.md).
//
// One QueryClient per app instance, built here rather than at module scope in
// api/query-client.ts so tests never share a cache with the app or with each other.
createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={createBrowserRouter(routes)} />
    </QueryClientProvider>
  </StrictMode>,
);
