/**
 * Web Push notifications: what Rails' payload means, and where a notification click goes.
 *
 * Rails sends `{title, body, data: {url, count}}` (`api/app/services/daily_digest_builder.rb`)
 * and **does not change for this client** — the shape is a preserved contract
 * (docs/GO_MIGRATION.md). go-app's generated worker read a top-level `notification.path` Rails
 * never sends and overwrote the `data` key with its own `{goapp: …}`, so `data.url` was discarded
 * and the click target has been dead since the digest shipped. Everything here reads `data.url`.
 *
 * The handlers take the scope as an argument rather than closing over `self`, so the service
 * worker (`src/sw.ts`) stays a thin wiring file and the real behavior is driven in tests with a
 * fake scope and fake events. The scope types below are the narrow slice of
 * `ServiceWorkerGlobalScope` these handlers touch: declaring them here keeps the TypeScript
 * program on the DOM lib (`tsconfig.json`), which the whole app needs, instead of pulling in the
 * WebWorker lib that conflicts with it.
 */

/** Where a notification goes when the payload names no target. Rails sends `"/"` today. */
export const DEFAULT_NOTIFICATION_PATH = "/";

/** Shown when a push arrives with no usable title. Rails always sends one. */
export const DEFAULT_NOTIFICATION_TITLE = "Waunder";

/**
 * The notification's app icon and badge. go-app set neither, so the daily digest rendered with a
 * browser default glyph. `/icon.svg` is the same source icon the manifest uses (FE-02/FE-10).
 */
export const NOTIFICATION_ICON = "/icon.svg";
export const NOTIFICATION_BADGE = "/icon.svg";

/** The message a focused window answers by routing in place, instead of reloading. */
export const SW_NAVIGATE_MESSAGE = "waunder:navigate";

/** Posted to the focused client on a notification click. `url` is app-relative. */
export interface SwNavigateMessage {
  type: typeof SW_NAVIGATE_MESSAGE;
  url: string;
}

/** The notification options this worker sets. A narrow view of `NotificationOptions`. */
export interface SwNotificationOptions {
  body: string;
  icon: string;
  badge: string;
  data: SwNotificationData;
}

/** What travels on the notification from `push` to `notificationclick`. */
export interface SwNotificationData {
  /** Absolute, same-origin. Resolved once when the notification is shown. */
  url: string;
  /** Rails' count of newly scored postings, or `null` when it sent none. */
  count: number | null;
}

/** An open window belonging to this app. */
export interface SwWindowClient {
  readonly url: string;
  focus(): Promise<unknown>;
  postMessage(message: SwNavigateMessage): void;
}

/** The slice of `ServiceWorkerGlobalScope` these handlers use. */
export interface SwScope {
  readonly location: { readonly origin: string };
  readonly registration: {
    showNotification(title: string, options: SwNotificationOptions): Promise<void>;
  };
  readonly clients: {
    matchAll(options: {
      type: "window";
      includeUncontrolled: boolean;
    }): Promise<readonly SwWindowClient[]>;
    openWindow(url: string): Promise<unknown>;
  };
}

/** A `PushEvent`. `data` is null when the push carried no body. */
export interface SwPushEvent {
  readonly data: { text(): string } | null;
}

/** A `NotificationEvent`. */
export interface SwNotificationClickEvent {
  readonly notification: {
    readonly data: unknown;
    close(): void;
  };
}

/** Rails' push payload, after parsing and with the target already resolved. */
export interface DigestNotification {
  title: string;
  body: string;
  /** Absolute and same-origin — see `resolveNotificationUrl`. */
  url: string;
  count: number | null;
}

/**
 * Shows the notification Rails asked for, with the app icon and badge set.
 *
 * A malformed or absent body is not an error worth dropping the push over: the owner still gets a
 * notification that opens the app, which is strictly better than silence.
 */
export async function handlePush(scope: SwScope, event: SwPushEvent): Promise<void> {
  const notification = readPushPayload(event, scope.location.origin);

  await scope.registration.showNotification(notification.title, {
    body: notification.body,
    icon: NOTIFICATION_ICON,
    badge: NOTIFICATION_BADGE,
    data: { url: notification.url, count: notification.count },
  });
}

/**
 * Opens the notification's target: focus an app window that is already open and route it in
 * place, or open a new one.
 *
 * The URL is re-resolved from the notification rather than trusted as stored, because a
 * notification shown by an older worker is still clickable after this one takes over.
 */
export async function handleNotificationClick(
  scope: SwScope,
  event: SwNotificationClickEvent,
): Promise<void> {
  event.notification.close();

  const data = event.notification.data;
  const url = resolveNotificationUrl(
    isRecord(data) ? data["url"] : undefined,
    scope.location.origin,
  );

  await openNotificationTarget(scope, url);
}

/** Reads Rails' `{title, body, data: {url, count}}` off a push event. */
export function readPushPayload(event: SwPushEvent, origin: string): DigestNotification {
  const payload = parseJson(event.data?.text());
  const body = isRecord(payload) ? payload : {};
  const data = isRecord(body["data"]) ? body["data"] : {};

  return {
    title: asText(body["title"]) || DEFAULT_NOTIFICATION_TITLE,
    body: asText(body["body"]),
    url: resolveNotificationUrl(data["url"], origin),
    count: asCount(data["count"]),
  };
}

/**
 * Resolves a payload's target to an absolute, same-origin URL.
 *
 * Rails sends a path (`"/"`), which is only meaningful against this origin. Anything that does not
 * resolve to this origin — another host, a `javascript:` URL, a protocol-relative `//host/path`
 * that reads like a path and is not one, a missing key — falls back to the app root: a push body
 * is the one input here that arrives from outside the app, and the worker must never hand an
 * arbitrary URL to `openWindow`.
 */
export function resolveNotificationUrl(candidate: unknown, origin: string): string {
  const fallback = new URL(DEFAULT_NOTIFICATION_PATH, origin);
  if (typeof candidate !== "string" || candidate.trim() === "") return fallback.href;

  let resolved: URL;
  try {
    resolved = new URL(candidate, origin);
  } catch {
    return fallback.href;
  }

  return resolved.origin === fallback.origin ? resolved.href : fallback.href;
}

/** The router-relative path of an absolute URL: what a focused client is asked to navigate to. */
export function appPath(url: string, origin: string): string {
  try {
    const parsed = new URL(url, origin);
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return DEFAULT_NOTIFICATION_PATH;
  }
}

/**
 * Routes an open window to `url`, or opens one.
 *
 * A focused client is sent a message rather than `client.navigate(url)`: navigating is a full
 * document load that throws away the React tree and the whole TanStack cache, where the message
 * lets the app route with the history API. `installSwNavigation` is the other half.
 */
async function openNotificationTarget(scope: SwScope, url: string): Promise<void> {
  const windows = await scope.clients.matchAll({ type: "window", includeUncontrolled: true });
  const origin = scope.location.origin;
  const sameOrigin = windows.filter((client) => isSameOrigin(client.url, origin));
  const target = sameOrigin.find((client) => client.url === url) ?? sameOrigin[0];

  if (!target) {
    await scope.clients.openWindow(url);
    return;
  }

  // Focusing can be refused (a browser that requires a user gesture it does not credit the click
  // with); opening a window is then the only way the click goes anywhere at all.
  try {
    await target.focus();
  } catch {
    await scope.clients.openWindow(url);
    return;
  }

  target.postMessage({ type: SW_NAVIGATE_MESSAGE, url: appPath(url, origin) });
}

/** The page-side source of worker messages. A narrow view of `ServiceWorkerContainer`. */
export interface SwMessageSource {
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}

/**
 * Routes this window when the service worker reports a notification click, and returns the
 * unsubscribe function.
 *
 * Installed once in `main.tsx` against the router object, the same way the 401 boundary is
 * (`lib/auth.ts`). Where there is no service worker at all — an unsupported browser, a test —
 * this is a no-op rather than a guard every caller has to write.
 */
export function installSwNavigation(
  navigate: (path: string) => void,
  source: SwMessageSource | undefined = globalThis.navigator?.serviceWorker,
): () => void {
  if (!source) return () => {};

  const listener = (event: { data: unknown }) => {
    const path = readNavigateMessage(event.data);
    if (path !== null) navigate(path);
  };

  source.addEventListener("message", listener);
  return () => source.removeEventListener("message", listener);
}

/** The path a navigate message carries, or `null` for any other worker message. */
export function readNavigateMessage(data: unknown): string | null {
  if (!isRecord(data) || data["type"] !== SW_NAVIGATE_MESSAGE) return null;
  const url = data["url"];
  return typeof url === "string" && url !== "" ? url : null;
}

function isSameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

function parseJson(raw: string | undefined): unknown {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
