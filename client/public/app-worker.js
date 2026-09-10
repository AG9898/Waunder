/* global caches, self */

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheKeys = await caches.keys();
      await Promise.all(cacheKeys.map((cacheKey) => caches.delete(cacheKey)));

      await self.registration.unregister();
      await self.clients.claim();

      const windowClients = await self.clients.matchAll({ type: "window" });
      await Promise.all(windowClients.map((client) => client.navigate(client.url)));
    })(),
  );
});
