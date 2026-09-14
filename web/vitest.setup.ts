// Registers the jest-dom matchers (toBeInTheDocument, toHaveTextContent, ...) with Vitest's
// expect and augments its type declarations. Loaded via vite.config.ts `test.setupFiles`.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

import { clearToasts } from "./src/lib/toast";

// Toasts live in a module-level store (UI-05); never let one case's toast leak into the next.
afterEach(() => {
  clearToasts();
});
