import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";
import type { ManifestOptions } from "vite-plugin-pwa";

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

// These fields preserve the installed Go PWA's identity. In particular, leave `id` absent so
// platforms that derive identity from start_url continue to recognize the existing home-screen app.
export const pwaManifest = {
  name: "Waunder",
  short_name: "Waunder",
  description: "Personal job application assistant",
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: "#2d2c2c",
  theme_color: "#2d2c2c",
  // go-app generated four icon records from these fields. Keep the same records and source icon.
  icons: [
    { src: "/icon.svg", type: "image/png", purpose: "maskable", sizes: "512x512" },
    { src: "/icon.svg", type: "image/svg+xml", sizes: "any" },
    { src: "/icon.svg", type: "image/png", sizes: "512x512" },
    { src: "/icon.svg", type: "image/png", sizes: "192x192" },
  ],
} satisfies Partial<ManifestOptions>;

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      manifestFilename: "manifest.webmanifest",
      manifest: pwaManifest,
      // The worker is written by hand (src/sw.ts) because Rails' Web Push payload needs push and
      // notificationclick handlers a generated worker cannot express — see docs/GO_MIGRATION.md.
      // It restates the generated defaults it replaces: precache, outdated-cache cleanup, the
      // index.html navigation fallback, and the SKIP_WAITING message the update banner sends.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      // Public files retain stable URLs, so they must be revisioned in the precache manifest.
      injectManifest: { globPatterns: ["**/*.{js,css,html,svg,woff2}"] },
    }),
  ],
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
