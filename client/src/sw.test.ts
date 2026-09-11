import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type {
  SwNavigateMessage,
  SwNotificationClickEvent,
  SwNotificationOptions,
  SwPushEvent,
  SwScope,
  SwWindowClient,
} from "./lib/sw-nav";
import {
  NOTIFICATION_BADGE,
  NOTIFICATION_ICON,
  SW_NAVIGATE_MESSAGE,
  handleNotificationClick,
  handlePush,
  installSwNavigation,
} from "./lib/sw-nav";

const ORIGIN = "https://waunder.test";

describe("push notifications", () => {
  it("shows the digest Rails sent, with the app icon and badge", async () => {
    const scope = fakeScope();

    await handlePush(scope, pushEvent(railsDigest()));

    expect(scope.registration.showNotification).toHaveBeenCalledWith("3 new job matches", {
      body: "Staff Engineer — Acme (82)",
      icon: NOTIFICATION_ICON,
      badge: NOTIFICATION_BADGE,
      data: { url: `${ORIGIN}/`, count: 3 },
    });
  });

  it("keeps a path Rails sends in data.url, resolved against this origin", async () => {
    const scope = fakeScope();

    await handlePush(scope, pushEvent({ ...railsDigest(), data: { url: "/jobs/41", count: 1 } }));

    expect(shownData(scope).url).toBe(`${ORIGIN}/jobs/41`);
  });

  it("falls back to the app root for a push with no usable payload", async () => {
    const scope = fakeScope();

    await handlePush(scope, { data: { text: () => "not json" } });

    expect(scope.registration.showNotification).toHaveBeenCalledWith(
      "Waunder",
      expect.objectContaining({ body: "", data: { url: `${ORIGIN}/`, count: null } }),
    );
  });

  it("shows a notification even when the push carried no body at all", async () => {
    const scope = fakeScope();

    await handlePush(scope, { data: null });

    expect(scope.registration.showNotification).toHaveBeenCalledOnce();
    expect(shownData(scope).url).toBe(`${ORIGIN}/`);
  });

  it("refuses a target outside this origin", async () => {
    const scope = fakeScope();

    // The last one is protocol-relative: it looks like a path and is not one.
    for (const url of [
      "https://elsewhere.test/jobs/1",
      "javascript:alert(1)",
      "//elsewhere.test/x",
    ]) {
      await handlePush(scope, pushEvent({ ...railsDigest(), data: { url, count: 1 } }));
      expect(shownData(scope).url).toBe(`${ORIGIN}/`);
    }
  });
});

describe("notification click", () => {
  it("routes an open window in place instead of reloading it", async () => {
    const open = fakeClient(`${ORIGIN}/jobs`);
    const scope = fakeScope([open]);

    await handleNotificationClick(scope, clickEvent({ url: `${ORIGIN}/jobs/41`, count: 1 }));

    expect(open.focus).toHaveBeenCalledOnce();
    expect(open.postMessage).toHaveBeenCalledWith({ type: SW_NAVIGATE_MESSAGE, url: "/jobs/41" });
    // A full document load would throw away the React tree and the whole query cache.
    expect(open.navigate).not.toHaveBeenCalled();
    expect(scope.clients.openWindow).not.toHaveBeenCalled();
  });

  it("closes the notification and prefers a window already on the target", async () => {
    const other = fakeClient(`${ORIGIN}/profile`);
    const onTarget = fakeClient(`${ORIGIN}/jobs/41`);
    const scope = fakeScope([other, onTarget]);
    const event = clickEvent({ url: `${ORIGIN}/jobs/41`, count: 1 });

    await handleNotificationClick(scope, event);

    expect(event.notification.close).toHaveBeenCalledOnce();
    expect(onTarget.focus).toHaveBeenCalledOnce();
    expect(other.focus).not.toHaveBeenCalled();
  });

  it("opens a new window when no app window is open", async () => {
    const scope = fakeScope([]);

    await handleNotificationClick(scope, clickEvent({ url: `${ORIGIN}/jobs/41`, count: 1 }));

    expect(scope.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/jobs/41`);
  });

  it("ignores windows belonging to another origin", async () => {
    const foreign = fakeClient("https://elsewhere.test/jobs");
    const scope = fakeScope([foreign]);

    await handleNotificationClick(scope, clickEvent({ url: `${ORIGIN}/`, count: 1 }));

    expect(foreign.focus).not.toHaveBeenCalled();
    expect(scope.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/`);
  });

  it("opens a window when focusing the open one is refused", async () => {
    const open = fakeClient(`${ORIGIN}/jobs`);
    open.focus.mockRejectedValue(new Error("not allowed"));
    const scope = fakeScope([open]);

    await handleNotificationClick(scope, clickEvent({ url: `${ORIGIN}/jobs/41`, count: 1 }));

    expect(open.postMessage).not.toHaveBeenCalled();
    expect(scope.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/jobs/41`);
  });

  it("re-resolves the stored target, so a notification from an older worker cannot escape", async () => {
    const scope = fakeScope([]);

    await handleNotificationClick(scope, clickEvent({ url: "https://elsewhere.test/", count: 1 }));
    await handleNotificationClick(scope, clickEvent(undefined));

    expect(scope.clients.openWindow).toHaveBeenNthCalledWith(1, `${ORIGIN}/`);
    expect(scope.clients.openWindow).toHaveBeenNthCalledWith(2, `${ORIGIN}/`);
  });
});

describe("page-side navigation", () => {
  it("routes on a navigate message and ignores every other worker message", () => {
    const source = fakeMessageSource();
    const navigate = vi.fn<(path: string) => void>();

    const stop = installSwNavigation(navigate, source);
    source.emit({ type: SW_NAVIGATE_MESSAGE, url: "/jobs/41" });
    source.emit({ type: "SKIP_WAITING" });
    source.emit("nonsense");

    expect(navigate).toHaveBeenCalledExactlyOnceWith("/jobs/41");

    stop();
    source.emit({ type: SW_NAVIGATE_MESSAGE, url: "/profile" });
    expect(navigate).toHaveBeenCalledOnce();
  });

  it("is inert where the browser has no service worker", () => {
    expect(() => installSwNavigation(vi.fn(), undefined)()).not.toThrow();
  });
});

describe("service worker wiring", () => {
  const source = readFileSync(resolve(process.cwd(), "src/sw.ts"), "utf8");

  it("hands both notification events to the handlers", () => {
    expect(source).toContain('self.addEventListener("push"');
    expect(source).toContain("handlePush(self, event)");
    expect(source).toContain('self.addEventListener("notificationclick"');
    expect(source).toContain("handleNotificationClick(self, event)");
  });

  it("keeps the generated worker's precache, fallback, and update-prompt behavior", () => {
    expect(source).toContain("precacheAndRoute(self.__WB_MANIFEST)");
    expect(source).toContain("cleanupOutdatedCaches()");
    expect(source).toContain('createHandlerBoundToURL("index.html")');
    // Without this the FE-10 update banner's Reload button would do nothing.
    expect(source).toContain('"SKIP_WAITING"');
  });
});

function railsDigest() {
  // api/app/services/daily_digest_builder.rb#call — unchanged for this client.
  return {
    title: "3 new job matches",
    body: "Staff Engineer — Acme (82)",
    data: { url: "/", count: 3 },
  };
}

function pushEvent(payload: unknown): SwPushEvent {
  return { data: { text: () => JSON.stringify(payload) } };
}

function clickEvent(data: unknown): SwNotificationClickEvent & {
  notification: { close: ReturnType<typeof vi.fn<() => void>> };
} {
  return { notification: { data, close: vi.fn<() => void>() } };
}

type FakeClient = SwWindowClient & {
  focus: ReturnType<typeof vi.fn<() => Promise<unknown>>>;
  postMessage: ReturnType<typeof vi.fn<(message: SwNavigateMessage) => void>>;
  /** The full-reload path this worker must never take. Present only so a test can prove that. */
  navigate: ReturnType<typeof vi.fn<(url: string) => Promise<unknown>>>;
};

function fakeClient(url: string): FakeClient {
  return {
    url,
    focus: vi.fn<() => Promise<unknown>>().mockResolvedValue(undefined),
    postMessage: vi.fn<(message: SwNavigateMessage) => void>(),
    navigate: vi.fn<(url: string) => Promise<unknown>>(),
  };
}

type FakeScope = SwScope & {
  registration: { showNotification: ReturnType<typeof vi.fn> };
  clients: { matchAll: ReturnType<typeof vi.fn>; openWindow: ReturnType<typeof vi.fn> };
};

function fakeScope(windows: readonly SwWindowClient[] = []): FakeScope {
  return {
    location: { origin: ORIGIN },
    registration: { showNotification: vi.fn().mockResolvedValue(undefined) },
    clients: {
      matchAll: vi.fn().mockResolvedValue(windows),
      openWindow: vi.fn().mockResolvedValue(null),
    },
  };
}

function shownData(scope: FakeScope): SwNotificationOptions["data"] {
  const calls = scope.registration.showNotification.mock.calls;
  const options = calls[calls.length - 1]?.[1] as SwNotificationOptions;
  return options.data;
}

function fakeMessageSource() {
  const listeners = new Set<(event: { data: unknown }) => void>();
  return {
    addEventListener(_type: "message", listener: (event: { data: unknown }) => void) {
      listeners.add(listener);
    },
    removeEventListener(_type: "message", listener: (event: { data: unknown }) => void) {
      listeners.delete(listener);
    },
    emit(data: unknown) {
      for (const listener of listeners) listener({ data });
    },
  };
}
