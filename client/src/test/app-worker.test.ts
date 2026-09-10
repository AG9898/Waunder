import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

type LifecycleHandler = (event: { waitUntil: (promise: Promise<unknown>) => void }) => void;

type WindowClient = {
  navigate: ReturnType<typeof vi.fn<(url: string) => Promise<WindowClient | null>>>;
  url: string;
};

type KillSwitchScope = {
  addEventListener: (type: string, handler: LifecycleHandler) => void;
  clients: {
    claim: ReturnType<typeof vi.fn<() => Promise<void>>>;
    matchAll: ReturnType<typeof vi.fn<(options: { type: string }) => Promise<WindowClient[]>>>;
  };
  registration: {
    unregister: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
  };
  skipWaiting: ReturnType<typeof vi.fn<() => Promise<void>>>;
};

type CacheStorage = {
  delete: ReturnType<typeof vi.fn<(key: string) => Promise<boolean>>>;
  keys: ReturnType<typeof vi.fn<() => Promise<string[]>>>;
};

const workerSource = readFileSync(resolve(process.cwd(), "public/app-worker.js"), "utf8");

function loadWorker(scope: KillSwitchScope, cacheStorage: CacheStorage) {
  const handlers = new Map<string, LifecycleHandler>();
  scope.addEventListener = (type, handler) => handlers.set(type, handler);

  new Function("self", "caches", workerSource)(scope, cacheStorage);

  return handlers;
}

async function runLifecycle(handler: LifecycleHandler | undefined) {
  const pending: Promise<unknown>[] = [];
  handler?.({ waitUntil: (promise) => pending.push(promise) });
  await Promise.all(pending);
}

describe("go-app service worker retirement", () => {
  it("skips waiting during install", async () => {
    const scope = fakeScope([]);
    const handlers = loadWorker(scope, fakeCaches([]));

    await runLifecycle(handlers.get("install"));

    expect(scope.skipWaiting).toHaveBeenCalledOnce();
  });

  it("clears caches, retires itself, and best-effort reloads every window", async () => {
    const windows = [fakeWindow("https://waunder.test/jobs"), fakeWindow("https://waunder.test/")];
    const scope = fakeScope(windows);
    const cacheStorage = fakeCaches(["app-old", "workbox-precache"]);
    const handlers = loadWorker(scope, cacheStorage);

    await runLifecycle(handlers.get("activate"));

    expect(cacheStorage.delete).toHaveBeenCalledTimes(2);
    expect(cacheStorage.delete).toHaveBeenCalledWith("app-old");
    expect(cacheStorage.delete).toHaveBeenCalledWith("workbox-precache");
    expect(scope.registration.unregister).toHaveBeenCalledOnce();
    expect(scope.clients.claim).toHaveBeenCalledOnce();
    expect(scope.clients.matchAll).toHaveBeenCalledWith({ type: "window" });
    expect(windows[0]?.navigate).toHaveBeenCalledWith("https://waunder.test/jobs");
    expect(windows[1]?.navigate).toHaveBeenCalledWith("https://waunder.test/");
    expect(handlers.has("fetch")).toBe(false);
  });
});

function fakeScope(windows: WindowClient[]): KillSwitchScope {
  return {
    addEventListener: vi.fn(),
    clients: {
      claim: vi.fn<() => Promise<void>>().mockResolvedValue(),
      matchAll: vi.fn<(options: { type: string }) => Promise<WindowClient[]>>().mockResolvedValue(windows),
    },
    registration: {
      unregister: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
    },
    skipWaiting: vi.fn<() => Promise<void>>().mockResolvedValue(),
  };
}

function fakeCaches(keys: string[]): CacheStorage {
  return {
    delete: vi.fn<(key: string) => Promise<boolean>>().mockResolvedValue(true),
    keys: vi.fn<() => Promise<string[]>>().mockResolvedValue(keys),
  };
}

function fakeWindow(url: string): WindowClient {
  const windowClient: WindowClient = {
    navigate: vi.fn<(nextUrl: string) => Promise<WindowClient | null>>(),
    url,
  };
  windowClient.navigate.mockResolvedValue(windowClient);
  return windowClient;
}
