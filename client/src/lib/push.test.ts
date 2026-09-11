/**
 * Browser push flow parity (`FE-13`).
 *
 * Transcribed from `TestInitialPushState`, `TestPushErrorMessage`, and the subscribe/unsubscribe
 * halves of `web/components/push_test.go`, plus the cases the Go build could not reach: its
 * `browserPusher` was pure go-app JS interop with no test at all, so `push_browser.go` was
 * verified only by using the app. Here the PushManager is a plain object, so the ordering rules
 * that actually matter — permission before subscribing, browser before Rails — are asserted.
 *
 * **No real push is ever sent and no permission prompt is ever shown.** Every test drives a fake
 * `PushEnvironment`; jsdom exposes no Push API at all, so the production environment can only
 * report "unsupported" here, which is itself one of the assertions below.
 */
import { describe, expect, it } from "vitest";

import { APIError } from "../api/errors";
import {
  PushDeniedError,
  PushUnsupportedError,
  browserPushEnvironment,
  createPushSubscriber,
  hasPushError,
  initialPushState,
  pushErrorMessage,
  pushErrorState,
  readSubscription,
} from "./push";
import type { BrowserPushSubscription, PushEnvironment, PushManagerLike } from "./push";

/* -------------------------------------------------------------------------- */
/* A mocked PushManager                                                        */
/* -------------------------------------------------------------------------- */

const ENDPOINT = "https://push.example/abc";

function fakeSubscription(
  overrides: { endpoint?: string; keys?: Record<string, string> } = {},
): BrowserPushSubscription & { unsubscribed: boolean } {
  const endpoint = overrides.endpoint ?? ENDPOINT;
  const keys = overrides.keys ?? { p256dh: "p256dh-key", auth: "auth-key" };
  const subscription = {
    endpoint,
    unsubscribed: false,
    toJSON: () => ({ endpoint, expirationTime: null, keys }),
    unsubscribe: () => {
      subscription.unsubscribed = true;
      return Promise.resolve(true);
    },
  };
  return subscription;
}

interface FakeEnvironment extends PushEnvironment {
  /** What `pushManager.subscribe` was called with. */
  subscribeOptions: { userVisibleOnly: boolean; applicationServerKey: string } | null;
  permissionRequests: number;
  existing: (BrowserPushSubscription & { unsubscribed: boolean }) | null;
}

function fakeEnvironment(
  options: {
    supported?: boolean;
    permission?: NotificationPermission;
    existing?: (BrowserPushSubscription & { unsubscribed: boolean }) | null;
    created?: BrowserPushSubscription;
    subscribeError?: unknown;
    readyError?: unknown;
  } = {},
): FakeEnvironment {
  const env: FakeEnvironment = {
    subscribeOptions: null,
    permissionRequests: 0,
    existing: options.existing ?? null,
    supported: () => options.supported ?? true,
    requestPermission: () => {
      env.permissionRequests += 1;
      return Promise.resolve(options.permission ?? "granted");
    },
    ready: () => {
      if (options.readyError) return Promise.reject(options.readyError);
      const pushManager: PushManagerLike = {
        subscribe: (subscribeOptions) => {
          env.subscribeOptions = subscribeOptions;
          if (options.subscribeError) return Promise.reject(options.subscribeError);
          return Promise.resolve(options.created ?? fakeSubscription());
        },
        getSubscription: () => Promise.resolve(env.existing),
      };
      return Promise.resolve({ pushManager });
    },
  };
  return env;
}

/* -------------------------------------------------------------------------- */
/* Pure state mapping                                                          */
/* -------------------------------------------------------------------------- */

describe("initialPushState", () => {
  // TestInitialPushState, case for case.
  const cases = [
    { name: "unsupported", supported: false, endpoint: "", want: "unsupported" },
    {
      name: "unsupported with endpoint",
      supported: false,
      endpoint: ENDPOINT,
      want: "unsupported",
    },
    { name: "supported, no endpoint", supported: true, endpoint: "", want: "off" },
    { name: "supported with endpoint", supported: true, endpoint: ENDPOINT, want: "on" },
  ] as const;

  it.each(cases)("$name", ({ supported, endpoint, want }) => {
    expect(initialPushState(supported, endpoint)).toBe(want);
  });
});

describe("pushErrorState", () => {
  it("keeps unsupported, denied, and a generic failure distinct", () => {
    // The four states the owner can land in must not collapse into one another: unsupported and
    // denied are permanent and need different guidance, and neither is a retryable failure.
    expect(pushErrorState(new PushUnsupportedError())).toBe("unsupported");
    expect(pushErrorState(new PushDeniedError())).toBe("denied");
    expect(pushErrorState(new Error("boom"))).toBe("failed");
    expect(new Set(["unsupported", "denied", "failed", "on", "off"]).size).toBe(5);
  });

  it("shows the error paragraph only for the two error states", () => {
    expect(hasPushError("denied")).toBe(true);
    expect(hasPushError("failed")).toBe(true);
    for (const state of ["unknown", "unsupported", "off", "on", "busy"] as const) {
      expect(hasPushError(state)).toBe(false);
    }
  });
});

describe("pushErrorMessage", () => {
  // TestPushErrorMessage.
  it("explains a blocked permission", () => {
    expect(pushErrorMessage(new PushDeniedError())).toContain("blocked");
  });

  it("routes an expired session to the sign-in message", () => {
    expect(pushErrorMessage(new APIError(401, ""))).toContain("session expired");
  });

  it("falls back to the retryable message", () => {
    expect(pushErrorMessage(new Error("other"))).toContain("Could not update");
  });
});

/* -------------------------------------------------------------------------- */
/* readSubscription                                                            */
/* -------------------------------------------------------------------------- */

describe("readSubscription", () => {
  it("reads the endpoint and both encryption keys off toJSON()", () => {
    expect(readSubscription(fakeSubscription())).toEqual({
      endpoint: ENDPOINT,
      keys: { p256dh: "p256dh-key", auth: "auth-key" },
    });
  });

  it("rejects a subscription Rails could never encrypt to", () => {
    // Go's json.Unmarshal would have zero-valued the missing key and posted "" to Rails, which
    // stores a subscription that silently never delivers.
    expect(() => readSubscription(fakeSubscription({ keys: { p256dh: "only-one" } }))).toThrow(
      /encryption keys/,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* The subscriber                                                              */
/* -------------------------------------------------------------------------- */

describe("createPushSubscriber", () => {
  it("subscribes with the VAPID key it was handed and asks for permission first", async () => {
    // TestDoSubscribeUsesPublicVAPIDKeyAndPersists, minus the Rails half (the component's job).
    const env = fakeEnvironment();
    const subscription = await createPushSubscriber(env).subscribe("BPUBLICKEY");

    expect(env.permissionRequests).toBe(1);
    expect(env.subscribeOptions).toEqual({
      userVisibleOnly: true,
      applicationServerKey: "BPUBLICKEY",
    });
    expect(subscription.endpoint).toBe(ENDPOINT);
  });

  it("never subscribes when the owner declines the prompt", async () => {
    const env = fakeEnvironment({ permission: "denied" });

    await expect(createPushSubscriber(env).subscribe("BPUBLICKEY")).rejects.toBeInstanceOf(
      PushDeniedError,
    );
    expect(env.subscribeOptions).toBeNull();
  });

  it("treats a dismissed prompt as a decline", async () => {
    // "default" is what a dismissed prompt resolves to; it is not permission to subscribe.
    const env = fakeEnvironment({ permission: "default" });
    await expect(createPushSubscriber(env).subscribe("BPUBLICKEY")).rejects.toBeInstanceOf(
      PushDeniedError,
    );
    expect(env.subscribeOptions).toBeNull();
  });

  it("does not prompt at all in an unsupported browser", async () => {
    const env = fakeEnvironment({ supported: false });

    await expect(createPushSubscriber(env).subscribe("BPUBLICKEY")).rejects.toBeInstanceOf(
      PushUnsupportedError,
    );
    expect(env.permissionRequests).toBe(0);
  });

  it("reports the active endpoint without prompting", async () => {
    const env = fakeEnvironment({ existing: fakeSubscription() });

    await expect(createPushSubscriber(env).currentEndpoint()).resolves.toBe(ENDPOINT);
    expect(env.permissionRequests).toBe(0);
  });

  it("reports no endpoint when nothing is subscribed", async () => {
    await expect(createPushSubscriber(fakeEnvironment()).currentEndpoint()).resolves.toBe("");
  });

  it("reports no endpoint, rather than failing, in an unsupported browser", async () => {
    const env = fakeEnvironment({ supported: false, readyError: new Error("no service worker") });
    await expect(createPushSubscriber(env).currentEndpoint()).resolves.toBe("");
  });

  it("cancels the active browser subscription", async () => {
    // TestDoUnsubscribeCancelsBrowserThenRails, browser half.
    const existing = fakeSubscription();
    const env = fakeEnvironment({ existing });

    await createPushSubscriber(env).unsubscribe();
    expect(existing.unsubscribed).toBe(true);
  });

  it("is a no-op when there is nothing subscribed", async () => {
    await expect(createPushSubscriber(fakeEnvironment()).unsubscribe()).resolves.toBeUndefined();
  });

  it("propagates a browser failure so Rails is never told the subscription is gone", async () => {
    const existing = fakeSubscription();
    existing.unsubscribe = () => Promise.reject(new Error("boom"));
    const env = fakeEnvironment({ existing });

    await expect(createPushSubscriber(env).unsubscribe()).rejects.toThrow("boom");
  });
});

describe("browserPushEnvironment", () => {
  it("reports unsupported wherever there is no Push API", () => {
    // jsdom exposes no PushManager, which is the same answer a prerender and a browser without
    // the Push API give — the state the toggle renders as its install guidance.
    expect(browserPushEnvironment().supported()).toBe(false);
  });
});
