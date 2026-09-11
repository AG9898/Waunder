/**
 * The app's service worker: precache, SPA navigation fallback, and Web Push.
 *
 * `vite-plugin-pwa` builds this file with its `injectManifest` strategy and replaces
 * `self.__WB_MANIFEST` with the content-revisioned precache manifest, so the precache contract
 * `FE-10` set up is unchanged — what a generated worker would have written is written here
 * instead, because the push and notification-click handlers cannot be expressed in generated
 * config (docs/GO_MIGRATION.md, "Web Push payload").
 *
 * Three of the four blocks below are the generated worker's defaults, restated:
 * `precacheAndRoute`, `cleanupOutdatedCaches`, the `index.html` navigation fallback, and the
 * `SKIP_WAITING` message. The last one is load-bearing for `UpdateBanner`: with
 * `registerType: "prompt"`, Workbox's `updateServiceWorker()` posts that message and nothing
 * happens until a worker acts on it.
 *
 * All logic lives in `lib/sw-nav.ts` so it can be tested with a fake scope; this file is wiring.
 */
import type { PrecacheEntry } from "workbox-precaching";
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

import type { SwNotificationClickEvent, SwPushEvent, SwScope } from "./lib/sw-nav";
import { handleNotificationClick, handlePush } from "./lib/sw-nav";

interface SwExtendableEvent {
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * The worker's global scope. Declared rather than imported from the WebWorker lib, which cannot
 * be added to this TypeScript program without conflicting with the DOM lib the app needs.
 */
declare let self: SwScope & {
  readonly __WB_MANIFEST: (string | PrecacheEntry)[];
  addEventListener(type: "push", listener: (event: SwPushEvent & SwExtendableEvent) => void): void;
  addEventListener(
    type: "notificationclick",
    listener: (event: SwNotificationClickEvent & SwExtendableEvent) => void,
  ): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  skipWaiting(): Promise<void>;
};

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Every route is served by the one shell document; the router resolves the path in the page.
registerRoute(new NavigationRoute(createHandlerBoundToURL("index.html")));

// Sent by `updateServiceWorker()` when the owner accepts the update banner, never on its own.
self.addEventListener("message", (event) => {
  if (isSkipWaiting(event.data)) void self.skipWaiting();
});

self.addEventListener("push", (event) => {
  event.waitUntil(handlePush(self, event));
});

self.addEventListener("notificationclick", (event) => {
  event.waitUntil(handleNotificationClick(self, event));
});

function isSkipWaiting(data: unknown): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "SKIP_WAITING"
  );
}
