import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The PWA is always served same-origin: in production Caddy proxies /api/* and the Resend
// inbound webhook path to Rails over Railway's private network, and in local dev this proxy
// does the same against a local Rails. The browser never talks to Rails cross-origin, so there
// is no CORS anywhere and no backend URL is ever exposed to the client bundle.
// API_INTERNAL_URL is the same variable name the deployed web service uses (docs/ENV_VARS.md);
// it is read here by the Node-side dev server only, never inlined into client code.
const railsBaseUrl = process.env["API_INTERNAL_URL"] ?? "http://localhost:3000";

// Rails receives the browser's original Host header. Caddy's reverse_proxy preserves Host by
// default, so the dev proxy must not rewrite it either (Vite's default, set explicitly).
const proxyToRails = { target: railsBaseUrl, changeOrigin: false } as const;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 8000,
    proxy: {
      "/api": proxyToRails,
      "/webhooks/resend/inbound": proxyToRails,
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
