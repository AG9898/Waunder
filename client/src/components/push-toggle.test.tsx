/**
 * Push toggle parity (`FE-13`).
 *
 * Transcribed from the render cases in `web/components/push_test.go`, with the flow cases the Go
 * build had to drive through `doSubscribe` / `doUnsubscribe` directly — go-app offered no way to
 * invoke an `OnClick` from a test — now driven the way the owner drives them: by clicking.
 *
 * **Nothing here can send a push or show a permission prompt.** The browser side is a mocked
 * `PushSubscriber` over a fake PushManager (`lib/push.test.ts` covers the real one against the
 * same kind of fake), and Rails is MSW. The counters on both mocks are what prove the control is
 * inert until the owner acts.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { APIError } from "../api/errors";
import type { PushSubscription } from "../api/schemas";
import { PushDeniedError } from "../lib/push";
import type { PushSubscriber } from "../lib/push";
import { HttpResponse, http, installMockApi } from "../test/msw";
import { PushToggle } from "./push-toggle";

const ENDPOINT = "https://push.example/abc";
const VAPID_KEY = "BFakePublicVapidKeyForTestsOnly";

const SUBSCRIPTION: PushSubscription = {
  endpoint: ENDPOINT,
  keys: { p256dh: "p256dh-key", auth: "auth-key" },
};

/* -------------------------------------------------------------------------- */
/* Mocks                                                                       */
/* -------------------------------------------------------------------------- */

/** What Rails was asked to do. Reset before every test. */
const rails = {
  vapidFetches: 0,
  persists: 0,
  removals: 0,
  /** The endpoint `DELETE /api/push_subscription` was called with. */
  removedEndpoint: "",
  /** The subscription `POST /api/push_subscription` was called with. */
  persisted: null as unknown,
  /** Overridable per test. */
  vapidKey: VAPID_KEY,
  vapidStatus: 200,
  persistStatus: 204,
};

const server = installMockApi(
  http.get("/api/push/vapid_public_key", () => {
    rails.vapidFetches += 1;
    if (rails.vapidStatus !== 200) {
      return HttpResponse.json(
        { error: { code: "unauthorized", message: "Unauthorized" } },
        { status: rails.vapidStatus },
      );
    }
    return HttpResponse.json({ vapid_public_key: rails.vapidKey });
  }),
  http.post("/api/push_subscription", async ({ request }) => {
    rails.persists += 1;
    rails.persisted = await request.json();
    return new HttpResponse(null, { status: rails.persistStatus });
  }),
  http.delete("/api/push_subscription", async ({ request }) => {
    rails.removals += 1;
    const body = (await request.json()) as { subscription?: { endpoint?: string } };
    rails.removedEndpoint = body.subscription?.endpoint ?? "";
    return new HttpResponse(null, { status: 204 });
  }),
);

/** A `PushSubscriber` over a fake PushManager, counting everything the browser was asked to do. */
interface MockPusher extends PushSubscriber {
  subscribeCalls: number;
  unsubscribeCalls: number;
  gotVapidKey: string;
}

function mockPusher(
  options: {
    supported?: boolean;
    currentEndpoint?: string;
    currentError?: unknown;
    subscribeError?: unknown;
    unsubscribeError?: unknown;
  } = {},
): MockPusher {
  const pusher: MockPusher = {
    subscribeCalls: 0,
    unsubscribeCalls: 0,
    gotVapidKey: "",
    supported: () => options.supported ?? true,
    currentEndpoint: () =>
      options.currentError
        ? Promise.reject(options.currentError)
        : Promise.resolve(options.currentEndpoint ?? ""),
    subscribe: (key) => {
      pusher.subscribeCalls += 1;
      pusher.gotVapidKey = key;
      return options.subscribeError
        ? Promise.reject(options.subscribeError)
        : Promise.resolve(SUBSCRIPTION);
    },
    unsubscribe: () => {
      pusher.unsubscribeCalls += 1;
      return options.unsubscribeError
        ? Promise.reject(options.unsubscribeError)
        : Promise.resolve();
    },
  };
  return pusher;
}

beforeEach(() => {
  rails.vapidFetches = 0;
  rails.persists = 0;
  rails.removals = 0;
  rails.removedEndpoint = "";
  rails.persisted = null;
  rails.vapidKey = VAPID_KEY;
  rails.vapidStatus = 200;
  rails.persistStatus = 204;
});

const enableButton = () => screen.getByRole("button", { name: "Turn on notifications" });
const disableButton = () => screen.getByRole("button", { name: "Turn off notifications" });

/* -------------------------------------------------------------------------- */
/* Never subscribes on its own                                                 */
/* -------------------------------------------------------------------------- */

describe("PushToggle never auto-subscribes", () => {
  it("makes zero subscribe and zero persist calls after a plain render", async () => {
    // TestPushToggleSupportedRendersEnableAndDoesNotSubscribe. The whole point of the control:
    // mounting it must not prompt for notification permission and must not register anything
    // with Rails. Only an explicit click may do either.
    const pusher = mockPusher();
    render(<PushToggle subscriber={pusher} />);

    expect(
      await screen.findByRole("button", { name: "Turn on notifications" }),
    ).toBeInTheDocument();
    expect(pusher.subscribeCalls).toBe(0);
    expect(rails.persists).toBe(0);
    // The VAPID key is not even read until the owner asks for notifications.
    expect(rails.vapidFetches).toBe(0);
  });

  it("makes zero subscribe and zero persist calls when the browser has no Push API", async () => {
    // TestPushToggleRendersUnsupportedState.
    const pusher = mockPusher({ supported: false });
    render(<PushToggle subscriber={pusher} />);

    expect(await screen.findByText(/available in this browser/)).toHaveClass(
      "push-toggle-unsupported",
    );
    expect(pusher.subscribeCalls).toBe(0);
    expect(rails.persists).toBe(0);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* The four states                                                             */
/* -------------------------------------------------------------------------- */

describe("PushToggle states", () => {
  it("renders the on status pill and the disable control for an existing subscription", async () => {
    // TestPushToggleOnStateShowsStatusAndDisable, reached through the real mount path this time:
    // React re-renders on the resolved endpoint, where go-app's lifecycle overwrote a hand-set
    // state and forced the Go test to call the renderer directly.
    render(<PushToggle subscriber={mockPusher({ currentEndpoint: ENDPOINT })} />);

    const pill = await screen.findByText("On");
    expect(pill).toHaveClass("push-toggle-status", "push-toggle-status-on");
    expect(disableButton()).toBeInTheDocument();
  });

  it("keeps unsupported, denied, on, and off visually distinct", async () => {
    // Unsupported: guidance paragraph, no control at all.
    const unsupported = render(<PushToggle subscriber={mockPusher({ supported: false })} />);
    expect(await screen.findByText(/available in this browser/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    unsupported.unmount();

    // Off: the enable control, no status pill, no error.
    const off = render(<PushToggle subscriber={mockPusher()} />);
    expect(
      await screen.findByRole("button", { name: "Turn on notifications" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("On")).toBeNull();
    expect(document.querySelector(".push-toggle-error")).toBeNull();
    off.unmount();

    // On: the status pill and the disable control.
    const on = render(<PushToggle subscriber={mockPusher({ currentEndpoint: ENDPOINT })} />);
    expect(await screen.findByText("On")).toBeInTheDocument();
    expect(document.querySelector(".push-toggle-unsupported")).toBeNull();
    on.unmount();

    // Denied: the enable control is still offered, with the blocked guidance beside it. A
    // permanent refusal, not the retryable failure message.
    render(<PushToggle subscriber={mockPusher({ subscribeError: new PushDeniedError() })} />);
    fireEvent.click(await screen.findByRole("button", { name: "Turn on notifications" }));
    const blocked = await screen.findByText(/Notifications were blocked/);
    expect(blocked).toHaveClass("push-toggle-error");
    expect(enableButton()).toBeInTheDocument();
    expect(screen.queryByText(/Could not update/)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Subscribing                                                                 */
/* -------------------------------------------------------------------------- */

describe("turning notifications on", () => {
  it("reads the VAPID key from the API and posts the subscription to Rails", async () => {
    // TestDoSubscribeUsesPublicVAPIDKeyAndPersists. The key comes from
    // GET /api/push/vapid_public_key — never a build-time or injected environment variable, which
    // is what lets the web service drop VAPID_PUBLIC_KEY (docs/ENV_VARS.md).
    const pusher = mockPusher();
    render(<PushToggle subscriber={pusher} />);

    fireEvent.click(await screen.findByRole("button", { name: "Turn on notifications" }));

    expect(await screen.findByText("On")).toBeInTheDocument();
    expect(rails.vapidFetches).toBe(1);
    expect(pusher.gotVapidKey).toBe(VAPID_KEY);
    expect(rails.persists).toBe(1);
    expect(rails.persisted).toEqual({ subscription: SUBSCRIPTION });
    expect(disableButton()).toBeInTheDocument();
  });

  it("shows the working state while the subscribe is in flight", async () => {
    let release = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pusher = mockPusher();
    const slow: PushSubscriber = {
      ...pusher,
      subscribe: async (key) => {
        await pending;
        return pusher.subscribe(key);
      },
    };
    render(<PushToggle subscriber={slow} />);

    fireEvent.click(await screen.findByRole("button", { name: "Turn on notifications" }));

    const busy = await screen.findByRole("button", { name: "Working…" });
    expect(busy).toBeDisabled();
    release();
    expect(await screen.findByText("On")).toBeInTheDocument();
  });

  it("treats a browser that cannot subscribe as unsupported and tells Rails nothing", async () => {
    const pusher = mockPusher({ supported: false });
    render(<PushToggle subscriber={pusher} />);

    await screen.findByText(/available in this browser/);
    expect(pusher.subscribeCalls).toBe(0);
    expect(rails.persists).toBe(0);
  });

  it("treats an unconfigured server as unsupported without touching the browser", async () => {
    // TestDoSubscribeNoVAPIDKeyIsUnsupported: Rails answers with an empty key when web push is
    // not configured, so there is nothing to subscribe to.
    rails.vapidKey = "";
    const pusher = mockPusher();
    render(<PushToggle subscriber={pusher} />);

    fireEvent.click(await screen.findByRole("button", { name: "Turn on notifications" }));

    expect(await screen.findByText(/available in this browser/)).toBeInTheDocument();
    expect(pusher.subscribeCalls).toBe(0);
    expect(rails.persists).toBe(0);
  });

  it("does not persist anything when the browser subscribe fails", async () => {
    // TestDoSubscribeDoesNotPersistOnBrowserError.
    render(<PushToggle subscriber={mockPusher({ subscribeError: new PushDeniedError() })} />);

    fireEvent.click(await screen.findByRole("button", { name: "Turn on notifications" }));

    await screen.findByText(/Notifications were blocked/);
    expect(rails.persists).toBe(0);
  });

  it("routes an expired session to the sign-in message", async () => {
    rails.vapidStatus = 401;
    render(<PushToggle subscriber={mockPusher()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Turn on notifications" }));

    expect(await screen.findByText(/session expired/)).toHaveClass("push-toggle-error");
  });

  it("reports a Rails failure without claiming notifications are on", async () => {
    rails.persistStatus = 500;
    render(<PushToggle subscriber={mockPusher()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Turn on notifications" }));

    expect(await screen.findByText(/Could not update/)).toBeInTheDocument();
    expect(screen.queryByText("On")).toBeNull();
    expect(enableButton()).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/* Unsubscribing                                                               */
/* -------------------------------------------------------------------------- */

describe("turning notifications off", () => {
  it("cancels in the browser, then deletes the subscription in Rails", async () => {
    // TestDoUnsubscribeCancelsBrowserThenRails.
    const pusher = mockPusher({ currentEndpoint: ENDPOINT });
    render(<PushToggle subscriber={pusher} />);

    fireEvent.click(await screen.findByRole("button", { name: "Turn off notifications" }));

    await waitFor(() => {
      expect(enableButton()).toBeInTheDocument();
    });
    expect(pusher.unsubscribeCalls).toBe(1);
    expect(rails.removals).toBe(1);
    expect(rails.removedEndpoint).toBe(ENDPOINT);
    expect(screen.queryByText("On")).toBeNull();
  });

  it("leaves Rails alone when the browser unsubscribe fails", async () => {
    // TestDoUnsubscribeSkipsRailsOnBrowserError: Rails must keep the subscription it can still
    // deliver to rather than being told it is gone.
    const pusher = mockPusher({
      currentEndpoint: ENDPOINT,
      unsubscribeError: new Error("boom"),
    });
    render(<PushToggle subscriber={pusher} />);

    fireEvent.click(await screen.findByRole("button", { name: "Turn off notifications" }));

    expect(await screen.findByText(/Could not update/)).toBeInTheDocument();
    expect(rails.removals).toBe(0);
  });

  it("reports a failed removal without clearing the toggle", async () => {
    server.use(
      http.delete("/api/push_subscription", () =>
        HttpResponse.json({ error: { code: "server_error", message: "boom" } }, { status: 500 }),
      ),
    );
    render(<PushToggle subscriber={mockPusher({ currentEndpoint: ENDPOINT })} />);

    fireEvent.click(await screen.findByRole("button", { name: "Turn off notifications" }));

    expect(await screen.findByText(/Could not update/)).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/* Reading the current state                                                   */
/* -------------------------------------------------------------------------- */

describe("reading the existing subscription", () => {
  it("surfaces a failed read without offering a false on state", async () => {
    render(<PushToggle subscriber={mockPusher({ currentError: new APIError(401, "") })} />);

    expect(await screen.findByText(/session expired/)).toBeInTheDocument();
    expect(screen.queryByText("On")).toBeNull();
  });
});
