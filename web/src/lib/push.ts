/**
 * The browser Push API, ported from `web/components/push_browser.go` (see docs/GO_MIGRATION.md).
 *
 * The Go build reached the PushManager through go-app's JS bridge: every call went out as
 * `app.Window().Get(...)`, and because Go has no `await`, each returned promise was funnelled
 * back through a hand-written adapter that allocated two `app.FuncOf` callbacks, `Release`d them,
 * and blocked a goroutine on a channel. That adapter — and the `app.Value` marshalling around it,
 * which serialized the subscription with `JSON.stringify` only to `json.Unmarshal` it again — is
 * the bulk of the 157 lines this module replaces. In TypeScript the browser API is just the
 * browser API, so what is left is the part that was always real: the four operations the toggle
 * needs, and the two error kinds it renders differently.
 *
 * ## Nothing here subscribes on its own
 *
 * `subscribe` is only ever reached from an explicit click (`components/push-toggle.tsx`). That is
 * not merely a UI convention: requesting notification permission without a user gesture is how a
 * browser decides to block the origin permanently, and `AGENTS.md` requires the owner to opt in.
 * `currentEndpoint` is the only call made on mount, and it reads existing state without prompting.
 *
 * ## The seam
 *
 * `PushEnvironment` is the narrow slice of the browser this module touches — service-worker
 * readiness, the permission prompt, and a feature check. Injecting it is what lets the tests run
 * the real flow against a **mocked PushManager**: no notification is ever requested and no push is
 * ever sent. It is the same shape of seam as `OpenrouterClient`'s `http:` transport in Rails and
 * the `RailsClient` mock the Go screens used.
 *
 * Rails is not called from here at all. Reading the VAPID key and persisting the subscription are
 * the component's job, so this module stays a pure translation of the browser API into the
 * `PushSubscription` shape Rails stores.
 */
import { isUnauthorized } from "../api/errors";
import { PushSubscriptionSchema } from "../api/schemas";
import type { PushSubscription as PushSubscriptionPayload } from "../api/schemas";

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The browser exposes no usable Push API, so the toggle renders its unsupported guidance
 * instead of an error. Ported from `ErrPushUnsupported`.
 *
 * Also raised when Rails has no VAPID key configured: from the owner's side "this device cannot
 * receive push" is the same fact whether the browser or the server is missing the capability.
 */
export class PushUnsupportedError extends Error {
  override readonly name = "PushUnsupportedError";

  constructor(message = "push not supported") {
    super(message);
  }
}

/** The owner declined the notification permission prompt. Ported from `ErrPushDenied`. */
export class PushDeniedError extends Error {
  override readonly name = "PushDeniedError";

  constructor(message = "push permission denied") {
    super(message);
  }
}

/* -------------------------------------------------------------------------- */
/* The browser seam                                                            */
/* -------------------------------------------------------------------------- */

/** The subset of `PushSubscription` (the browser object) this module reads. */
export interface BrowserPushSubscription {
  readonly endpoint: string;
  toJSON(): { endpoint?: string | null | undefined; keys?: Record<string, string> | undefined };
  unsubscribe(): Promise<boolean>;
}

/** The subset of `PushManager` this module drives. */
export interface PushManagerLike {
  subscribe(options: {
    userVisibleOnly: boolean;
    applicationServerKey: string;
  }): Promise<BrowserPushSubscription>;
  getSubscription(): Promise<BrowserPushSubscription | null>;
}

/** The subset of `ServiceWorkerRegistration` this module reads. */
export interface PushRegistration {
  readonly pushManager: PushManagerLike;
}

/**
 * The browser capabilities the push flow needs. A real `ServiceWorkerRegistration` and
 * `PushManager` satisfy these structurally, so the production environment below is a thin
 * forwarder and tests supply a fake with no DOM at all.
 */
export interface PushEnvironment {
  /** Whether the Push API is usable here. False in jsdom, in SSR, and in unsupported browsers. */
  supported(): boolean;
  /** `navigator.serviceWorker.ready`. */
  ready(): Promise<PushRegistration>;
  /** `Notification.requestPermission()`. Shows the browser prompt — user gesture only. */
  requestPermission(): Promise<NotificationPermission>;
}

/** What the toggle calls. Ported from the Go `PushSubscriber` interface. */
export interface PushSubscriber {
  /** Whether the Push API is usable in this environment. */
  supported(): boolean;
  /**
   * Requests notification permission if needed and subscribes with the given application server
   * (public VAPID) key. Rejects with `PushDeniedError` when the owner declines and
   * `PushUnsupportedError` when the Push API is missing.
   */
  subscribe(vapidPublicKey: string): Promise<PushSubscriptionPayload>;
  /** The active browser subscription's endpoint, or `""` when there is none. */
  currentEndpoint(): Promise<string>;
  /** Cancels the active browser subscription, if there is one. */
  unsubscribe(): Promise<void>;
}

/**
 * The live browser environment.
 *
 * Every lookup is guarded because this runs in three places that are not browsers: jsdom under
 * Vitest, a prerender, and any browser without the Push API (Safari before iOS 16.4, and iOS at
 * all until the app is installed to the home screen). All three answer "unsupported", which is a
 * rendered state rather than an error — the same thing go-app's server-side JS shim produced.
 */
export function browserPushEnvironment(): PushEnvironment {
  return {
    supported: pushApiAvailable,
    ready: () => globalThis.navigator.serviceWorker.ready,
    requestPermission: () => globalThis.Notification.requestPermission(),
  };
}

function pushApiAvailable(): boolean {
  try {
    const nav: Navigator | undefined = globalThis.navigator;
    if (!nav?.serviceWorker) return false;
    return "PushManager" in globalThis && typeof globalThis.Notification !== "undefined";
  } catch {
    // Touching `navigator` can throw outside a document context; that is also "unsupported".
    return false;
  }
}

/**
 * The production `PushSubscriber`, over whatever environment it is handed.
 *
 * Ordering inside `subscribe` is deliberate and matches `push_browser.go`: permission first, then
 * service-worker readiness, then the subscription. Asking for permission before awaiting `ready`
 * keeps the prompt inside the click's user-gesture window, which some browsers require.
 */
export function createPushSubscriber(
  environment: PushEnvironment = browserPushEnvironment(),
): PushSubscriber {
  return {
    supported: () => environment.supported(),

    async subscribe(vapidPublicKey: string): Promise<PushSubscriptionPayload> {
      if (!environment.supported()) throw new PushUnsupportedError();

      const permission = await environment.requestPermission();
      if (permission !== "granted") throw new PushDeniedError();

      const registration = await environment.ready();
      // The key is passed as the base64url string Rails serves, exactly as the Go build did.
      // `PushSubscriptionOptionsInit.applicationServerKey` accepts a DOMString and decodes it,
      // so there is no byte-array conversion to get wrong.
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidPublicKey,
      });
      return readSubscription(subscription);
    },

    async currentEndpoint(): Promise<string> {
      if (!environment.supported()) return "";
      const registration = await environment.ready();
      const subscription = await registration.pushManager.getSubscription();
      // Read the endpoint off the object rather than through `readSubscription`: this runs on
      // every mount, and a subscription whose keys the browser will not re-expose must still
      // report "on" rather than flipping the toggle to a failure the owner cannot act on.
      return subscription?.endpoint ?? "";
    },

    async unsubscribe(): Promise<void> {
      if (!environment.supported()) return;
      const registration = await environment.ready();
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) return;
      await subscription.unsubscribe();
    },
  };
}

/**
 * Reads a browser subscription into the payload Rails stores.
 *
 * `toJSON()` is the source, as in `decodeSubscription`: it is the only way to get at the
 * `p256dh` and `auth` encryption keys, which are not properties of the subscription object.
 * Unlike Go's `json.Unmarshal`, a missing endpoint or missing keys is rejected rather than
 * zero-valued — an empty key posted to Rails produces a stored subscription that can never be
 * encrypted to, and the resulting silence looks exactly like a working subscription.
 */
export function readSubscription(subscription: BrowserPushSubscription): PushSubscriptionPayload {
  const json = subscription.toJSON();
  const parsed = PushSubscriptionSchema.safeParse({
    endpoint: json.endpoint ?? subscription.endpoint,
    keys: { p256dh: json.keys?.["p256dh"], auth: json.keys?.["auth"] },
  });
  if (!parsed.success) {
    throw new Error("browser push subscription is missing its endpoint or encryption keys");
  }
  return parsed.data;
}

/* -------------------------------------------------------------------------- */
/* Rendered state                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The toggle's rendered state. Ported from `pushUIState`, with `denied` split out of the Go
 * build's single `pushFailed`: a blocked permission is not a transient failure — retrying cannot
 * fix it — so it is its own state, distinct from `unsupported`, `on`, and `off`. It renders the
 * same markup `pushFailed` did (the enable control plus `.push-toggle-error`), only with the
 * guidance message pinned, so no new stylesheet rule is involved.
 */
export type PushUiState = "unknown" | "unsupported" | "off" | "on" | "busy" | "denied" | "failed";

/** Whether a state shows the error paragraph. */
export function hasPushError(state: PushUiState): boolean {
  return state === "denied" || state === "failed";
}

/**
 * Maps supported/endpoint facts to the rendered state. Ported from `initialPushState`, and pure
 * for the same reason: it is the gate that decides whether the owner sees "on", and it should be
 * assertable without a browser.
 */
export function initialPushState(supported: boolean, endpoint: string): PushUiState {
  if (!supported) return "unsupported";
  return endpoint !== "" ? "on" : "off";
}

/** The state a failed subscribe/unsubscribe lands in. */
export function pushErrorState(error: unknown): PushUiState {
  if (error instanceof PushUnsupportedError) return "unsupported";
  if (error instanceof PushDeniedError) return "denied";
  return "failed";
}

/** `pushErrorMessage`, unchanged: the three owner-facing strings, byte for byte. */
export function pushErrorMessage(error: unknown): string {
  if (error instanceof PushDeniedError) {
    return "Notifications were blocked. Enable them in your browser settings to get the daily digest.";
  }
  if (isUnauthorized(error)) {
    return "Your session expired. Please sign in again.";
  }
  return "Could not update push notifications. Please try again.";
}
