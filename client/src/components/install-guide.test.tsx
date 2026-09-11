/**
 * Install guide parity (`FE-14`).
 *
 * `web/components/install_guide.go` had no test at all — go-app offered no way to reach an
 * `OnClick` from a test, and the component read the browser directly in `OnMount`, so there was
 * nothing to drive. Injecting the platform signals turns each of the four gates into a plain
 * render, and the counters on the mocks are what prove the guide is inert until the owner acts.
 *
 * **Nothing here can show a permission prompt or send a push.** The browser side is a mocked
 * `PushSubscriber` (`lib/push.test.ts` covers the real one) and Rails is MSW.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { PushSubscription } from "../api/schemas";
import { PushDeniedError } from "../lib/push";
import type { PushSubscriber } from "../lib/push";
import type { PlatformSignals } from "../lib/platform";
import { HttpResponse, http, installMockApi } from "../test/msw";
import { InstallGuide } from "./install-guide";

const VAPID_KEY = "BFakePublicVapidKeyForTestsOnly";

const SUBSCRIPTION: PushSubscription = {
  endpoint: "https://push.example/abc",
  keys: { p256dh: "p256dh-key", auth: "auth-key" },
};

/* -------------------------------------------------------------------------- */
/* Devices                                                                     */
/* -------------------------------------------------------------------------- */

const IPHONE_17_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15";
const IPHONE_16_3_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15";
const DESKTOP_CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0";

function device(overrides: Partial<PlatformSignals>): PlatformSignals {
  return {
    userAgent: DESKTOP_CHROME_UA,
    maxTouchPoints: 0,
    navigatorStandalone: false,
    displayModeStandalone: false,
    pushApiAvailable: false,
    ...overrides,
  };
}

/** Safari on an iPhone running iOS 17, opened as a tab rather than from the home screen. */
const IOS_TAB = device({ userAgent: IPHONE_17_UA, maxTouchPoints: 5 });
/** The same phone, opened from its home-screen icon — where iOS exposes the Push API. */
const IOS_INSTALLED = device({
  userAgent: IPHONE_17_UA,
  maxTouchPoints: 5,
  navigatorStandalone: true,
  pushApiAvailable: true,
});
/** An iPhone too old for Web Push at all. */
const IOS_TOO_OLD = device({ userAgent: IPHONE_16_3_UA, maxTouchPoints: 5 });
/** A desktop browser with the full push stack. */
const DESKTOP_WITH_PUSH = device({ pushApiAvailable: true });
/** A desktop browser without it. */
const DESKTOP_WITHOUT_PUSH = device({});

/* -------------------------------------------------------------------------- */
/* Mocks                                                                       */
/* -------------------------------------------------------------------------- */

/** What Rails was asked to do. Reset before every test. */
const rails = {
  vapidFetches: 0,
  persists: 0,
  persisted: null as unknown,
  vapidKey: VAPID_KEY,
  persistStatus: 204,
};

installMockApi(
  http.get("/api/push/vapid_public_key", () => {
    rails.vapidFetches += 1;
    return HttpResponse.json({ vapid_public_key: rails.vapidKey });
  }),
  http.post("/api/push_subscription", async ({ request }) => {
    rails.persists += 1;
    rails.persisted = await request.json();
    if (rails.persistStatus !== 204) {
      return HttpResponse.json(
        { error: { code: "server_error", message: "boom" } },
        { status: rails.persistStatus },
      );
    }
    return new HttpResponse(null, { status: 204 });
  }),
);

/** A `PushSubscriber` that records what it was asked to do and never touches a browser. */
function mockSubscriber(overrides: Partial<PushSubscriber> = {}) {
  const calls = { supported: 0, subscribe: 0, currentEndpoint: 0, unsubscribe: 0 };
  const subscriber: PushSubscriber & { calls: typeof calls } = {
    calls,
    supported: () => {
      calls.supported += 1;
      return true;
    },
    subscribe: async (key: string) => {
      calls.subscribe += 1;
      expect(key).toBe(VAPID_KEY);
      return SUBSCRIPTION;
    },
    currentEndpoint: async () => {
      calls.currentEndpoint += 1;
      return "";
    },
    unsubscribe: async () => {
      calls.unsubscribe += 1;
    },
    ...overrides,
  };
  return subscriber;
}

beforeEach(() => {
  rails.vapidFetches = 0;
  rails.persists = 0;
  rails.persisted = null;
  rails.vapidKey = VAPID_KEY;
  rails.persistStatus = 204;
});

/* -------------------------------------------------------------------------- */
/* Rendered gates                                                              */
/* -------------------------------------------------------------------------- */

describe("InstallGuide rendering", () => {
  it("tells an old iPhone to update", () => {
    const { container } = render(
      <InstallGuide signals={IOS_TOO_OLD} permission="default" subscriber={mockSubscriber()} />,
    );
    expect(container.querySelector(".install-guide")).not.toBeNull();
    expect(screen.getByText("Update to iOS 16.4 or later to receive notifications.")).toBeTruthy();
    expect(container.querySelector(".enable-notifications")).toBeNull();
  });

  it("gives an uninstalled iPhone the Add to Home Screen steps instead of a dead button", () => {
    const { container } = render(
      <InstallGuide signals={IOS_TAB} permission="default" subscriber={mockSubscriber()} />,
    );
    expect(
      screen.getByText("Add Waunder to your Home Screen to enable notifications:"),
    ).toBeTruthy();
    expect(container.querySelectorAll(".install-guide ol li")).toHaveLength(3);
    expect(screen.getByText('Choose "Add to Home Screen".')).toBeTruthy();
    // The gate exists precisely so this button is withheld: iOS hides the Push API until the
    // app is installed, so offering it here produces a prompt that never appears.
    expect(container.querySelector(".enable-notifications")).toBeNull();
  });

  it("offers the button on an installed iPhone", () => {
    const { container } = render(
      <InstallGuide signals={IOS_INSTALLED} permission="default" subscriber={mockSubscriber()} />,
    );
    expect(container.querySelector(".enable-notifications")?.textContent).toBe(
      "Enable notifications",
    );
  });

  it("offers the button on a desktop browser with push", () => {
    const { container } = render(
      <InstallGuide
        signals={DESKTOP_WITH_PUSH}
        permission="default"
        subscriber={mockSubscriber()}
      />,
    );
    expect(container.querySelector(".enable-notifications")).not.toBeNull();
  });

  it("reports an unsupported desktop browser", () => {
    const { container } = render(
      <InstallGuide
        signals={DESKTOP_WITHOUT_PUSH}
        permission="default"
        subscriber={mockSubscriber()}
      />,
    );
    expect(screen.getByText("This browser does not support push notifications.")).toBeTruthy();
    expect(container.querySelector(".enable-notifications")).toBeNull();
  });

  it("shows the granted state ahead of any platform guidance", () => {
    // Permission is checked before the gate, as `install_guide.go` did: once notifications are
    // on, install instructions are noise.
    const { container } = render(
      <InstallGuide signals={IOS_TAB} permission="granted" subscriber={mockSubscriber()} />,
    );
    expect(screen.getByText("Notifications are on. You'll get the daily job digest.")).toBeTruthy();
    expect(container.querySelector(".install-guide ol")).toBeNull();
  });

  it("renders the button with type=button so it cannot submit a surrounding form", () => {
    const { container } = render(
      <form>
        <InstallGuide
          signals={DESKTOP_WITH_PUSH}
          permission="default"
          subscriber={mockSubscriber()}
        />
      </form>,
    );
    expect(container.querySelector(".enable-notifications")?.getAttribute("type")).toBe("button");
  });
});

/* -------------------------------------------------------------------------- */
/* Nothing happens without a click                                             */
/* -------------------------------------------------------------------------- */

describe("InstallGuide is inert until the owner acts", () => {
  it.each([
    ["ios-too-old", IOS_TOO_OLD],
    ["ios-tab", IOS_TAB],
    ["ios-installed", IOS_INSTALLED],
    ["desktop-with-push", DESKTOP_WITH_PUSH],
    ["desktop-without-push", DESKTOP_WITHOUT_PUSH],
  ])("requests nothing on a plain render: %s", (_name, signals) => {
    const subscriber = mockSubscriber();
    render(<InstallGuide signals={signals} permission="default" subscriber={subscriber} />);
    expect(subscriber.calls.subscribe).toBe(0);
    expect(rails.vapidFetches).toBe(0);
    expect(rails.persists).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* The enable flow                                                             */
/* -------------------------------------------------------------------------- */

describe("InstallGuide enable flow", () => {
  function clickEnable(container: HTMLElement) {
    const button = container.querySelector(".enable-notifications");
    expect(button).not.toBeNull();
    fireEvent.click(button as HTMLElement);
  }

  it("fetches the key, subscribes, stores the subscription in Rails, and reports success", async () => {
    const subscriber = mockSubscriber();
    const { container } = render(
      <InstallGuide signals={IOS_INSTALLED} permission="default" subscriber={subscriber} />,
    );
    clickEnable(container);

    await waitFor(() => {
      expect(
        screen.getByText("Notifications are on. You'll get the daily job digest."),
      ).toBeTruthy();
    });
    expect(rails.vapidFetches).toBe(1);
    expect(subscriber.calls.subscribe).toBe(1);
    // The Go original dropped the subscription on the floor; Rails must actually receive it or
    // the digest has nowhere to go.
    expect(rails.persists).toBe(1);
    expect(rails.persisted).toEqual({ subscription: SUBSCRIPTION });
  });

  it("reports a declined permission and keeps the button", async () => {
    const subscriber = mockSubscriber({
      subscribe: () => Promise.reject(new PushDeniedError()),
    });
    const { container } = render(
      <InstallGuide signals={DESKTOP_WITH_PUSH} permission="default" subscriber={subscriber} />,
    );
    clickEnable(container);

    await waitFor(() => {
      expect(container.querySelector(".install-status")?.textContent).toBe(
        "Notifications were not enabled.",
      );
    });
    expect(rails.persists).toBe(0);
    expect(container.querySelector(".enable-notifications")).not.toBeNull();
  });

  it("reports a server with no VAPID key configured without calling the browser", async () => {
    rails.vapidKey = "";
    const subscriber = mockSubscriber();
    const { container } = render(
      <InstallGuide signals={DESKTOP_WITH_PUSH} permission="default" subscriber={subscriber} />,
    );
    clickEnable(container);

    await waitFor(() => {
      expect(container.querySelector(".install-status")?.textContent).toBe(
        "Push key unavailable; notifications cannot be set up.",
      );
    });
    expect(subscriber.calls.subscribe).toBe(0);
  });

  it("reports a failed store and does not claim notifications are on", async () => {
    rails.persistStatus = 500;
    const subscriber = mockSubscriber();
    const { container } = render(
      <InstallGuide signals={DESKTOP_WITH_PUSH} permission="default" subscriber={subscriber} />,
    );
    clickEnable(container);

    await waitFor(() => {
      expect(container.querySelector(".install-status")?.textContent).toBe(
        "Could not subscribe to notifications.",
      );
    });
    expect(screen.queryByText("Notifications are on. You'll get the daily job digest.")).toBeNull();
  });

  it("disables the button while the request is in flight so a second click cannot double-post", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const subscriber = mockSubscriber({
      subscribe: async () => {
        await gate;
        return SUBSCRIPTION;
      },
    });
    const { container } = render(
      <InstallGuide signals={DESKTOP_WITH_PUSH} permission="default" subscriber={subscriber} />,
    );
    clickEnable(container);

    await waitFor(() => {
      expect(container.querySelector<HTMLButtonElement>(".enable-notifications")?.disabled).toBe(
        true,
      );
    });
    clickEnable(container);
    release();

    await waitFor(() => {
      expect(
        screen.getByText("Notifications are on. You'll get the daily job digest."),
      ).toBeTruthy();
    });
    expect(rails.persists).toBe(1);
  });

  it("never reaches Rails from a gate that shows no button", () => {
    render(<InstallGuide signals={IOS_TAB} permission="default" subscriber={mockSubscriber()} />);
    expect(rails.vapidFetches).toBe(0);
    expect(rails.persists).toBe(0);
  });
});
