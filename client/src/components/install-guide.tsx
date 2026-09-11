/**
 * The install + notification-permission guide, ported from `web/components/install_guide.go`
 * (see docs/GO_MIGRATION.md).
 *
 * It answers one question in the owner's words: *why can't I turn on notifications, and what do
 * I do about it?* `lib/platform.ts` computes the gate; this component renders the four answers.
 * Markup, classes (`.install-guide`, `.enable-notifications`, `.install-status`) and copy are
 * carried over unchanged, so the screenshot parity gate compares like with like.
 *
 * ## Two corrections to the Go original
 *
 * 1. **The subscription is now actually stored.** `install_guide.go`'s doc comment said the
 *    subscription was "forwarded to Rails for storage", but the code discarded it
 *    (`if _, err := ctx.Notifications().Subscribe(vapid); err != nil`). A browser subscription
 *    Rails never hears about is invisible: the owner sees "notifications are on" and no digest
 *    ever arrives, with nothing anywhere reporting a failure. This port runs the same path
 *    `push-toggle.tsx` does — subscribe, then `POST /api/push_subscription`.
 * 2. **The VAPID key comes from Rails.** The Go build read `VAPID_PUBLIC_KEY` out of go-app's
 *    `Env` map, which required the `web` service to carry the variable and bake it into the
 *    bundle. `FE-13` moved that to `GET /api/push/vapid_public_key` for the push toggle; this
 *    follows, so the frontend still needs no push configuration of its own.
 *
 * The guide's own component was unrouted in the Go build — `main.go` maps `/` to `DigestView`,
 * and only the dead `Home` component rendered it — so nothing here changes a live screen yet.
 * It is mounted by the profile screen (`FE-25`), alongside the push toggle it explains.
 *
 * ## Nothing prompts on mount
 *
 * The only browser reads at mount are `readPlatformSignals()` and `readNotificationPermission()`,
 * both of which inspect existing state. The permission prompt and the subscribe call are reached
 * only from the button's click — requesting permission without a gesture is how an origin gets
 * permanently blocked, and `AGENTS.md` requires the owner to opt in. `install-guide.test.tsx`
 * asserts the zero counts after a plain render of every state.
 */
import { useCallback, useMemo, useState } from "react";

import { fetchVapidPublicKey, subscribePush } from "../api/endpoints";
import { PushDeniedError, createPushSubscriber } from "../lib/push";
import type { PushSubscriber } from "../lib/push";
import {
  evaluatePushGate,
  platformState,
  readNotificationPermission,
  readPlatformSignals,
} from "../lib/platform";
import type { PlatformSignals, PushGate } from "../lib/platform";

export interface InstallGuideProps {
  /** Browser facts. Defaults to the live browser; tests supply a fixed device. */
  signals?: PlatformSignals;
  /** The browser's current `Notification.permission`. Defaults to the live value. */
  permission?: NotificationPermission;
  /** The browser Push API. Tests inject a mock over a fake PushManager. */
  subscriber?: PushSubscriber;
}

export function InstallGuide({ signals, permission, subscriber }: InstallGuideProps = {}) {
  const pusher = useMemo(() => subscriber ?? createPushSubscriber(), [subscriber]);
  const gate = useMemo<PushGate>(
    () => evaluatePushGate(platformState(signals ?? readPlatformSignals())),
    [signals],
  );

  // Seeded once from the browser, then owned by this component: a successful subscribe flips it
  // without a re-read, and a failed one leaves it alone so the owner keeps the button.
  const [granted, setGranted] = useState(
    () => (permission ?? readNotificationPermission()) === "granted",
  );
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  /**
   * The full subscribe path, reached only from the click.
   *
   * `busy` is a guard rather than a spinner: a second click would `POST` a second subscription,
   * and writes to Rails are never repeated automatically (`AGENTS.md`).
   */
  const enable = useCallback(async () => {
    setBusy(true);
    setStatus("");
    try {
      const key = await fetchVapidPublicKey();
      // Rails answers with an empty key when web push is not configured. Reported separately
      // from a subscribe failure, as `install_guide.go` did: this one is a server-side gap the
      // owner cannot fix by clicking again.
      if (key === "") {
        setStatus("Push key unavailable; notifications cannot be set up.");
        return;
      }

      const subscription = await pusher.subscribe(key);
      await subscribePush(subscription);
      setGranted(true);
    } catch (cause) {
      setStatus(enableFailureMessage(cause));
    } finally {
      setBusy(false);
    }
  }, [pusher]);

  const onEnable = useCallback(() => {
    void enable();
  }, [enable]);

  // Permission first, as `install_guide.go` did: once notifications are on, the platform
  // guidance is history and the only useful thing to say is that they are on.
  if (granted) {
    return (
      <div className="install-guide">
        <p>Notifications are on. You&apos;ll get the daily job digest.</p>
      </div>
    );
  }

  switch (gate) {
    case "upgrade-ios":
      return (
        <div className="install-guide">
          <p>Update to iOS 16.4 or later to receive notifications.</p>
        </div>
      );
    case "needs-install":
      return (
        <div className="install-guide">
          <p>Add Waunder to your Home Screen to enable notifications:</p>
          <ol>
            <li>Tap the Share button in Safari.</li>
            <li>Choose &quot;Add to Home Screen&quot;.</li>
            <li>Open Waunder from your Home Screen, then enable notifications.</li>
          </ol>
        </div>
      );
    case "unsupported":
      return (
        <div className="install-guide">
          <p>This browser does not support push notifications.</p>
        </div>
      );
    case "ready-to-request":
      return (
        <div className="install-guide">
          {/*
            `type="button"` is the one addition to the Go markup. go-app bound its own click
            handler, but in plain HTML an untyped button submits any form it is nested in, and
            the profile screen that will host this guide is one big form. No stylesheet rule
            keys off the attribute.
          */}
          <button type="button" className="enable-notifications" onClick={onEnable} disabled={busy}>
            Enable notifications
          </button>
          {status !== "" ? (
            <p className="install-status" role="status">
              {status}
            </p>
          ) : null}
        </div>
      );
  }
}

/**
 * The owner-facing failure strings, byte for byte from `install_guide.go`.
 *
 * A denied permission is separated from every other failure because it is the only one where
 * retrying the button cannot help — the browser will not prompt a second time.
 */
function enableFailureMessage(cause: unknown): string {
  if (cause instanceof PushDeniedError) return "Notifications were not enabled.";
  return "Could not subscribe to notifications.";
}
