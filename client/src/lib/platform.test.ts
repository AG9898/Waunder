/**
 * Platform detection parity (`FE-14`).
 *
 * The three case tables below are transcribed from `web/components/pwa_test.go` — the whole
 * reason that file is worth porting rather than rewriting. Each row encodes a device the owner
 * or a future owner could actually be holding, and two of them encode facts that are not
 * derivable from first principles: that an iPad reports a Mac's user agent, and that Web Push
 * on iOS starts at 16.4 rather than 16.0.
 *
 * Nothing here touches a browser. The pure functions take their inputs as arguments, and the
 * three reader tests stub the globals they read, so the whole file runs in Node under jsdom.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  detectIOS,
  detectStandalone,
  evaluatePushGate,
  platformState,
  readNotificationPermission,
  readPlatformSignals,
  supportsIOSWebPush,
} from "./platform";
import type { PlatformSignals, PlatformState, PushGate } from "./platform";

/** A record with every signal off, so each test only names what it is actually about. */
const NO_SIGNALS: PlatformSignals = {
  userAgent: "",
  maxTouchPoints: 0,
  navigatorStandalone: false,
  displayModeStandalone: false,
  pushApiAvailable: false,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- */
/* detectIOS — transcribed from TestDetectIOS                                  */
/* -------------------------------------------------------------------------- */

describe("detectIOS", () => {
  const cases: ReadonlyArray<{
    name: string;
    ua: string;
    maxTouchPoints?: number;
    wantIOS: boolean;
    wantMajor: number;
    wantMinor: number;
  }> = [
    {
      name: "iPhone 16.4",
      ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15",
      wantIOS: true,
      wantMajor: 16,
      wantMinor: 4,
    },
    {
      name: "iPhone 15.6 (patch version in the user agent)",
      ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 15_6_1 like Mac OS X) AppleWebKit/605.1.15",
      wantIOS: true,
      wantMajor: 15,
      wantMinor: 6,
    },
    {
      name: "iPad classic user agent",
      ua: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      wantIOS: true,
      wantMajor: 17,
      wantMinor: 0,
    },
    {
      // The case the whole `maxTouchPoints` argument exists for.
      name: "iPadOS desktop user agent with touch",
      ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15",
      maxTouchPoints: 5,
      wantIOS: true,
      // The desktop user agent carries no iOS OS token, so the version stays zero. `Mac OS X
      // 10_15_7` must not be read as version 10.15.
      wantMajor: 0,
      wantMinor: 0,
    },
    {
      name: "real Mac desktop (no touch)",
      ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15",
      maxTouchPoints: 0,
      wantIOS: false,
      wantMajor: 0,
      wantMinor: 0,
    },
    {
      name: "Android Chrome",
      ua: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0",
      wantIOS: false,
      wantMajor: 0,
      wantMinor: 0,
    },
    {
      name: "Windows Chrome",
      ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0",
      wantIOS: false,
      wantMajor: 0,
      wantMinor: 0,
    },
  ];

  it.each(cases)("$name", ({ ua, maxTouchPoints, wantIOS, wantMajor, wantMinor }) => {
    expect(detectIOS(ua, maxTouchPoints ?? 0)).toEqual({
      isIOS: wantIOS,
      major: wantMajor,
      minor: wantMinor,
    });
  });

  it("treats a single touch point on a Mac as a Mac", () => {
    // `> 1`, not `> 0`: a Mac with a touch-capable peripheral reports one point.
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
    expect(detectIOS(ua, 1).isIOS).toBe(false);
    expect(detectIOS(ua, 2).isIOS).toBe(true);
  });

  it("detects an iPod and an in-app WebView with a dotted version", () => {
    expect(detectIOS("Mozilla/5.0 (iPod touch; CPU iPhone OS 16_6 like Mac OS X)")).toEqual({
      isIOS: true,
      major: 16,
      minor: 6,
    });
    expect(detectIOS("Mozilla/5.0 (iPhone; CPU iPhone OS 17.2 like Mac OS X)")).toEqual({
      isIOS: true,
      major: 17,
      minor: 2,
    });
  });

  it("defaults maxTouchPoints to zero", () => {
    expect(detectIOS("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)").isIOS).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* supportsIOSWebPush — transcribed from TestSupportsIOSWebPush                 */
/* -------------------------------------------------------------------------- */

describe("supportsIOSWebPush", () => {
  const cases: ReadonlyArray<[major: number, minor: number, want: boolean]> = [
    [16, 3, false],
    [16, 4, true],
    [16, 5, true],
    [15, 9, false],
    [17, 0, true],
    // An unparsed version (the iPadOS desktop user agent) is "too old", so the guide shows the
    // install instructions rather than a button that cannot work.
    [0, 0, false],
  ];

  it.each(cases)("%i.%i -> %s", (major, minor, want) => {
    expect(supportsIOSWebPush(major, minor)).toBe(want);
  });
});

/* -------------------------------------------------------------------------- */
/* evaluatePushGate — transcribed from TestEvaluatePushGate                     */
/* -------------------------------------------------------------------------- */

describe("evaluatePushGate", () => {
  function state(overrides: Partial<PlatformState>): PlatformState {
    return {
      isIOS: false,
      iosMajor: 0,
      iosMinor: 0,
      standalone: false,
      pushSupported: false,
      ...overrides,
    };
  }

  const cases: ReadonlyArray<{ name: string; state: PlatformState; want: PushGate }> = [
    {
      name: "iOS too old",
      state: state({ isIOS: true, iosMajor: 16, iosMinor: 3 }),
      want: "upgrade-ios",
    },
    {
      name: "iOS 16.4 not installed",
      state: state({ isIOS: true, iosMajor: 16, iosMinor: 4, standalone: false }),
      want: "needs-install",
    },
    {
      name: "iOS 16.4 installed",
      state: state({ isIOS: true, iosMajor: 16, iosMinor: 4, standalone: true }),
      want: "ready-to-request",
    },
    {
      name: "iOS 17 installed",
      state: state({ isIOS: true, iosMajor: 17, iosMinor: 0, standalone: true }),
      want: "ready-to-request",
    },
    {
      name: "desktop with push",
      state: state({ isIOS: false, pushSupported: true }),
      want: "ready-to-request",
    },
    {
      name: "desktop without push",
      state: state({ isIOS: false, pushSupported: false }),
      want: "unsupported",
    },
  ];

  it.each(cases)("$name", ({ state: input, want }) => {
    expect(evaluatePushGate(input)).toBe(want);
  });

  it("offers the install step on an uninstalled iOS 17 device that reports no Push API", () => {
    // The regression this ordering exists to prevent: iOS hides the Push API until the app is
    // installed, so reading the capability first would tell the owner their browser cannot do
    // this, when one "Add to Home Screen" fixes it.
    expect(
      evaluatePushGate(
        state({ isIOS: true, iosMajor: 17, iosMinor: 0, standalone: false, pushSupported: false }),
      ),
    ).toBe("needs-install");
  });
});

/* -------------------------------------------------------------------------- */
/* Standalone + state assembly                                                 */
/* -------------------------------------------------------------------------- */

describe("detectStandalone", () => {
  it("accepts navigator.standalone alone (installed iOS web app)", () => {
    expect(detectStandalone({ ...NO_SIGNALS, navigatorStandalone: true })).toBe(true);
  });

  it("accepts the display-mode media query alone (installed Chrome/Edge PWA)", () => {
    expect(detectStandalone({ ...NO_SIGNALS, displayModeStandalone: true })).toBe(true);
  });

  it("is false when neither signal is set", () => {
    expect(detectStandalone(NO_SIGNALS)).toBe(false);
  });
});

describe("platformState", () => {
  it("assembles the detected version, standalone state, and push capability", () => {
    expect(
      platformState({
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)",
        maxTouchPoints: 5,
        navigatorStandalone: true,
        displayModeStandalone: false,
        pushApiAvailable: true,
      }),
    ).toEqual({
      isIOS: true,
      iosMajor: 17,
      iosMinor: 4,
      standalone: true,
      pushSupported: true,
    });
  });

  it("carries an installed iPadOS device through to a ready gate", () => {
    // The end-to-end shape of the hardest case: desktop user agent, touch screen, installed,
    // and therefore version-less — which alone would read as "too old".
    const signals: PlatformSignals = {
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17.0 Safari/605.1.15",
      maxTouchPoints: 5,
      navigatorStandalone: false,
      displayModeStandalone: true,
      pushApiAvailable: true,
    };
    const derived = platformState(signals);
    expect(derived.isIOS).toBe(true);
    expect(derived.standalone).toBe(true);
    // Version zero still gates on the OS check, so the guide asks for an update rather than
    // promising a prompt it cannot deliver. Documented here because it is a real limitation of
    // the desktop user agent, not an oversight.
    expect(evaluatePushGate(derived)).toBe("upgrade-ios");
  });
});

/* -------------------------------------------------------------------------- */
/* Browser reads                                                               */
/* -------------------------------------------------------------------------- */

describe("readPlatformSignals", () => {
  it("degrades to every signal off in an environment with no browser APIs", () => {
    // jsdom has a navigator but no matchMedia, no PushManager, and no navigator.standalone.
    // That is the same answer a prerender gives, and it must not throw.
    const signals = readPlatformSignals();
    expect(signals.navigatorStandalone).toBe(false);
    expect(signals.displayModeStandalone).toBe(false);
    expect(signals.pushApiAvailable).toBe(false);
  });

  it("reads the user agent, touch points, and both standalone signals", () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)",
      maxTouchPoints: 5,
      standalone: true,
      serviceWorker: {},
    });
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("standalone") }));
    vi.stubGlobal("PushManager", class {});
    vi.stubGlobal("Notification", { permission: "default" });

    expect(readPlatformSignals()).toEqual({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)",
      maxTouchPoints: 5,
      navigatorStandalone: true,
      displayModeStandalone: true,
      pushApiAvailable: true,
    });
  });

  it("requires service worker, PushManager, and Notification together", () => {
    vi.stubGlobal("navigator", { userAgent: "x", maxTouchPoints: 0, serviceWorker: {} });
    vi.stubGlobal("PushManager", class {});
    // No Notification: nothing can request permission, so this is not a usable push stack.
    vi.stubGlobal("Notification", undefined);
    expect(readPlatformSignals().pushApiAvailable).toBe(false);
  });

  it("survives a navigator whose properties throw", () => {
    vi.stubGlobal("navigator", {
      get userAgent(): string {
        throw new Error("blocked");
      },
    });
    expect(() => readPlatformSignals()).not.toThrow();
    expect(readPlatformSignals().userAgent).toBe("");
  });

  it("survives matchMedia throwing", () => {
    vi.stubGlobal("matchMedia", () => {
      throw new Error("blocked");
    });
    expect(readPlatformSignals().displayModeStandalone).toBe(false);
  });
});

describe("readNotificationPermission", () => {
  it("returns default when there is no Notification API", () => {
    vi.stubGlobal("Notification", undefined);
    expect(readNotificationPermission()).toBe("default");
  });

  it("reports the browser's current permission without prompting", () => {
    const requestPermission = vi.fn();
    vi.stubGlobal("Notification", { permission: "granted", requestPermission });
    expect(readNotificationPermission()).toBe("granted");
    expect(requestPermission).not.toHaveBeenCalled();
  });
});
