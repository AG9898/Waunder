/**
 * Platform detection for the install / notification guide, ported from
 * `web/components/pwa.go` (see docs/GO_MIGRATION.md).
 *
 * The question this module answers is narrow and entirely deterministic: *may this browser be
 * asked for notification permission right now, and if not, what does the owner have to do first?*
 * On every platform except Apple's the answer is a plain capability check. On iOS it is not:
 * Safari exposes the Push API **only to a web app that has been added to the home screen**, and
 * only from iOS/iPadOS 16.4 onward. Asking anyway produces no prompt and no error — just a
 * subscribe call that never resolves into anything — so the gate has to be computed before the
 * button is offered rather than discovered from a failure.
 *
 * ## Why the detection is a pure module
 *
 * The two hard parts — iPadOS reporting a desktop Safari user agent, and the 16.4 version
 * boundary — are exactly the parts that cannot be exercised in CI: the owner's real client is an
 * iOS home-screen web app, which no test runner here can be. So the browser facts are read once,
 * at the edge (`readPlatformSignals`), and every decision made from them is a pure function over
 * a plain record. `platform.test.ts` then drives the same user-agent case table
 * `web/components/pwa_test.go` asserted, in a runner with no browser at all.
 *
 * That split is also what keeps the iPadOS case honest. A Macintosh user agent with a touch
 * screen is an iPad; the same user agent with no touch screen is a Mac. Nothing in the string
 * distinguishes them, so `maxTouchPoints` is a required input rather than something read inside
 * the detection.
 *
 * ## Relationship to `lib/push.ts`
 *
 * This module decides whether to *offer* the permission request. `lib/push.ts` performs it.
 * They read the same capability (service worker + `PushManager` + `Notification`) so the guide
 * cannot promise a prompt that `subscribe` then refuses as unsupported — `pwa.go` checked only
 * the first two, which left exactly that gap open.
 */

/* -------------------------------------------------------------------------- */
/* iOS detection                                                               */
/* -------------------------------------------------------------------------- */

/** What `detectIOS` returns. Ported from Go's `(isIOS, major, minor)` tuple. */
export interface IOSDetection {
  /** Whether the user agent denotes an iOS or iPadOS device. */
  readonly isIOS: boolean;
  /** Major OS version, or `0` when not iOS or the version is not in the user agent. */
  readonly major: number;
  /** Minor OS version, or `0` under the same conditions. */
  readonly minor: number;
}

/**
 * Extracts the OS version from an iOS/iPadOS user agent, e.g.
 * `"CPU iPhone OS 16_4 like Mac OS X"` → `16`, `4`.
 *
 * Transcribed unchanged from `iosVersionRe`. Both the `_` and `.` separators are accepted
 * because the token is underscore-separated in the user agent but dot-separated in a few
 * embedded WebViews. The bare `OS` alternative is what matches the iPad form (`CPU OS 17_0`),
 * and it cannot accidentally match `Mac OS X 10_15_7`, since `X` follows the space rather than
 * a digit — which is why a desktop Safari user agent yields version `0.0` even when
 * `maxTouchPoints` identifies it as an iPad.
 */
const IOS_VERSION_RE = /(?:CPU (?:iPhone )?OS|iPhone OS|OS) (\d+)[_.](\d+)/;

/**
 * Reports whether the user agent denotes an iOS/iPadOS device and, when the string carries it,
 * the major/minor OS version.
 *
 * `maxTouchPoints` is `navigator.maxTouchPoints`. It exists in the signature for one reason:
 * since iPadOS 13, an iPad reports the **desktop Safari** user agent, identical to a Mac's. A
 * Macintosh user agent reporting more than one touch point is therefore treated as iOS. The
 * `> 1` threshold rather than `> 0` is deliberate — a Mac with a trackpad or a touch-capable
 * external display can report a single touch point.
 */
export function detectIOS(userAgent: string, maxTouchPoints = 0): IOSDetection {
  const isAppleMobile =
    userAgent.includes("iPhone") || userAgent.includes("iPad") || userAgent.includes("iPod");

  // iPadOS masquerading as desktop Safari: Macintosh user agent with a touch screen.
  const isIPadOSDesktop = userAgent.includes("Macintosh") && maxTouchPoints > 1;

  if (!isAppleMobile && !isIPadOSDesktop) {
    return { isIOS: false, major: 0, minor: 0 };
  }

  const match = IOS_VERSION_RE.exec(userAgent);
  if (!match) {
    // Detected as iOS, but the version is not in the string — the iPadOS desktop user agent
    // carries no OS token at all. Zero flows through `supportsIOSWebPush` as "too old", which
    // is the safe answer: the guide shows the install instructions instead of a dead button.
    return { isIOS: true, major: 0, minor: 0 };
  }

  return { isIOS: true, major: Number(match[1] ?? 0), minor: Number(match[2] ?? 0) };
}

/**
 * Whether the detected iOS version can receive Web Push at all.
 *
 * Apple shipped Web Push for home-screen web apps in iOS/iPadOS **16.4**. Below that there is no
 * Push API on any iOS browser — they all run WebKit, so this is a property of the OS rather than
 * of the browser the owner chose.
 */
export function supportsIOSWebPush(major: number, minor: number): boolean {
  if (major > 16) return true;
  if (major === 16) return minor >= 4;
  return false;
}

/* -------------------------------------------------------------------------- */
/* Platform state                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The install/notification readiness of the current browser, derived from the raw signals.
 * Ported from Go's `PlatformState`.
 */
export interface PlatformState {
  /** Whether this is an iOS or iPadOS device. */
  readonly isIOS: boolean;
  /** Detected major iOS version, `0` when unknown or not iOS. */
  readonly iosMajor: number;
  /** Detected minor iOS version, `0` when unknown or not iOS. */
  readonly iosMinor: number;
  /** Whether the page is running as an installed, home-screen app. */
  readonly standalone: boolean;
  /** Whether the Push API stack is available in this browser. */
  readonly pushSupported: boolean;
}

/**
 * The raw browser facts the state is derived from. Reading them is the only part of this module
 * that touches a browser, so a test supplies this record directly.
 */
export interface PlatformSignals {
  /** `navigator.userAgent`. */
  readonly userAgent: string;
  /** `navigator.maxTouchPoints`. */
  readonly maxTouchPoints: number;
  /** `navigator.standalone` — iOS Safari's installed-web-app flag, non-standard and iOS-only. */
  readonly navigatorStandalone: boolean;
  /** `matchMedia("(display-mode: standalone)").matches` — the standard signal everywhere else. */
  readonly displayModeStandalone: boolean;
  /** Whether service worker + `PushManager` + `Notification` are all present. */
  readonly pushApiAvailable: boolean;
}

/**
 * Whether the app is running installed to the home screen.
 *
 * Both signals are needed and neither is redundant: `navigator.standalone` is non-standard and
 * exists only on iOS, while `display-mode: standalone` is the standard media query that iOS
 * Safari did not support for home-screen web apps until relatively recently. Taking either as
 * sufficient is what makes the check work on both an installed iOS web app and an installed
 * Chrome/Edge PWA.
 */
export function detectStandalone(signals: PlatformSignals): boolean {
  return signals.navigatorStandalone || signals.displayModeStandalone;
}

/** Derives the platform state from raw signals. Pure; this is the whole of `readPlatformState`
 * minus its browser reads. */
export function platformState(signals: PlatformSignals): PlatformState {
  const ios = detectIOS(signals.userAgent, signals.maxTouchPoints);
  return {
    isIOS: ios.isIOS,
    iosMajor: ios.major,
    iosMinor: ios.minor,
    standalone: detectStandalone(signals),
    pushSupported: signals.pushApiAvailable,
  };
}

/* -------------------------------------------------------------------------- */
/* The push gate                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The decision the guide renders. Ported from Go's `PushGate` iota enum as a string union: the
 * Go constants were only ever compared, never ordered or serialized, so nothing depended on
 * their numeric values, and a union makes an unhandled case a type error in the component's
 * switch rather than a silent fallthrough to the zero value.
 */
export type PushGate =
  /** The environment can request push permission now. */
  | "ready-to-request"
  /** iOS, new enough, but not installed — Safari exposes the Push API only to installed apps. */
  | "needs-install"
  /** iOS older than 16.4: no Web Push at all, and no action the owner can take in the app. */
  | "upgrade-ios"
  /** The browser exposes no Push API. */
  | "unsupported";

/**
 * Decides whether the permission request should be offered, and if not, why.
 *
 * The iOS branch deliberately ignores `pushSupported`, and that is the subtle part: on iOS the
 * Push API is **absent until the app is installed**, so an uninstalled iOS 17 device reports no
 * push support even though it is one "Add to Home Screen" away from full support. Reading the
 * capability first would show "this browser does not support push notifications" — true right
 * now, and useless. Version and installed state are what the owner can act on, so they are
 * checked first.
 */
export function evaluatePushGate(state: PlatformState): PushGate {
  if (state.isIOS) {
    if (!supportsIOSWebPush(state.iosMajor, state.iosMinor)) return "upgrade-ios";
    if (!state.standalone) return "needs-install";
    // Installed iOS PWA on 16.4+: the Push API becomes available.
    return "ready-to-request";
  }

  if (!state.pushSupported) return "unsupported";
  return "ready-to-request";
}

/* -------------------------------------------------------------------------- */
/* Browser reads                                                               */
/* -------------------------------------------------------------------------- */

/** `navigator.standalone` is non-standard, so the DOM types do not declare it. */
type StandaloneNavigator = Navigator & { readonly standalone?: unknown };

/**
 * Reads every signal from the live browser.
 *
 * Each read is guarded because this module is loaded in three places that are not a browser tab:
 * Vitest's jsdom (no `matchMedia`, no `PushManager`), a build-time render, and any browser
 * configured to block the APIs. All of those degrade to "not iOS, not installed, no push", which
 * renders the unsupported guidance rather than throwing.
 */
export function readPlatformSignals(): PlatformSignals {
  const nav = safeNavigator();
  return {
    userAgent: read(() => nav?.userAgent, "", isString),
    maxTouchPoints: read(() => nav?.maxTouchPoints, 0, isNumber),
    navigatorStandalone: read(() => (nav as StandaloneNavigator | null)?.standalone, false, isTrue),
    displayModeStandalone: readDisplayModeStandalone(),
    pushApiAvailable: readPushApiAvailable(nav),
  };
}

/**
 * Reads one property, falling back when it is absent, the wrong type, or throws on access.
 *
 * The throwing case is not hypothetical: a browser configured to block fingerprinting surfaces
 * can install a getter that raises, and `navigator` is precisely the object such a policy
 * targets. One unguarded read would take down the whole guide with it.
 */
function read<T>(get: () => unknown, fallback: T, is: (value: unknown) => boolean): T {
  try {
    const value = get();
    return is(value) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

const isString = (value: unknown): boolean => typeof value === "string";
const isNumber = (value: unknown): boolean => typeof value === "number" && Number.isFinite(value);
const isTrue = (value: unknown): boolean => value === true;

/**
 * The browser's current `Notification.permission`, or `"default"` where there is no Notification
 * API to ask. Replaces go-app's `ctx.Notifications().Permission()`.
 *
 * This only reads state; it never prompts. The prompt is `lib/push.ts`'s
 * `requestPermission`, reached from a click.
 */
export function readNotificationPermission(): NotificationPermission {
  try {
    return typeof globalThis.Notification === "undefined"
      ? "default"
      : globalThis.Notification.permission;
  } catch {
    return "default";
  }
}

function safeNavigator(): Navigator | null {
  try {
    return globalThis.navigator ?? null;
  } catch {
    // Touching `navigator` can throw outside a document context.
    return null;
  }
}

function readDisplayModeStandalone(): boolean {
  try {
    return globalThis.matchMedia?.("(display-mode: standalone)").matches === true;
  } catch {
    return false;
  }
}

function readPushApiAvailable(nav: Navigator | null): boolean {
  try {
    if (!nav?.serviceWorker) return false;
    return "PushManager" in globalThis && typeof globalThis.Notification !== "undefined";
  } catch {
    return false;
  }
}
