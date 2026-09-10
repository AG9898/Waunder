import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Missing #root container in index.html");
}

// Placeholder shell only. Routing, screens, and the API client arrive in later FE tasks.
createRoot(container).render(
  <StrictMode>
    <p>Waunder</p>
  </StrictMode>,
);
