/**
 * The push-subscription control, ported from `web/components/push.go`
 * (see docs/GO_MIGRATION.md).
 *
 * Markup, classes, and copy are unchanged. The control reads the public VAPID key from Rails,
 * subscribes through the browser Push API, and posts the resulting subscription to
 * `POST /api/push_subscription` so the daily digest has somewhere to go. Turning it off cancels
 * the browser subscription first, then removes it from Rails with `DELETE /api/push_subscription`.
 *
 * ## The VAPID key comes from the API, not the build
 *
 * The Go build read `VAPID_PUBLIC_KEY` out of go-app's `Env` map, which meant the `web` service
 * had to carry the variable and bake it into the WASM bundle. `GET /api/push/vapid_public_key`
 * already served the same value — it is public by design; the private half never leaves Rails —
 * so this port fetches it at click time and the deployed frontend needs no push configuration of
 * its own (docs/ENV_VARS.md). One fewer variable to keep in sync across two services, and a
 * rotated key takes effect without a frontend rebuild.
 *
 * ## Subscribing is a user action, always
 *
 * The only call made on mount is `currentEndpoint()`, which reads the browser's existing
 * subscription and never prompts. Nothing subscribes, nothing requests notification permission,
 * and nothing is posted to Rails until the owner clicks — asking for permission unprompted is
 * both against `AGENTS.md` and the way an origin gets permanently blocked. `push-toggle.test.tsx`
 * asserts the zero counts after a plain render.
 *
 * Neither write goes through `useMutation`: writes to Rails must never be retried automatically,
 * and there is no cached read to invalidate, so the two handlers own the whole flow with the same
 * `busy` guard the Go build used.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchVapidPublicKey, subscribePush, unsubscribePush } from "../api/endpoints";
import {
  PushUnsupportedError,
  createPushSubscriber,
  hasPushError,
  initialPushState,
  pushErrorMessage,
  pushErrorState,
} from "../lib/push";
import type { PushSubscriber, PushUiState } from "../lib/push";

export interface PushToggleProps {
  /**
   * The browser Push API. Tests inject a subscriber over a mocked PushManager; in the app it
   * defaults to the live one, exactly as the Go component defaulted `Pusher` on mount.
   */
  subscriber?: PushSubscriber;
}

export function PushToggle({ subscriber }: PushToggleProps = {}) {
  const pusher = useMemo(() => subscriber ?? createPushSubscriber(), [subscriber]);

  const [state, setState] = useState<PushUiState>("unknown");
  const [endpoint, setEndpoint] = useState("");
  const [message, setMessage] = useState("");

  /**
   * `refresh`: derive the current state from the browser. Reads only — it never prompts, and an
   * unsupported browser is answered without touching the service worker at all.
   *
   * `current` guards the late resolution of a read belonging to a previous subscriber, so a
   * stale answer cannot overwrite the state the owner is looking at.
   */
  useEffect(() => {
    let current = true;
    void (async () => {
      const supported = pusher.supported();
      try {
        const active = await (supported ? pusher.currentEndpoint() : Promise.resolve(""));
        if (!current) return;
        setEndpoint(active);
        setState(initialPushState(supported, active));
      } catch (cause) {
        if (!current) return;
        setState(pushErrorState(cause));
        setMessage(pushErrorMessage(cause));
      }
    })();
    return () => {
      current = false;
    };
  }, [pusher]);

  /** `enable`: the full subscribe path, reached only from the button's click. */
  const enable = useCallback(async () => {
    setState("busy");
    setMessage("");
    try {
      const key = await fetchVapidPublicKey();
      // Rails answers with an empty key when web push is not configured. Nothing to subscribe to.
      if (key === "") throw new PushUnsupportedError();

      const subscription = await pusher.subscribe(key);
      await subscribePush(subscription);

      setEndpoint(subscription.endpoint);
      setState("on");
    } catch (cause) {
      const next = pushErrorState(cause);
      setState(next);
      setMessage(next === "unsupported" ? "" : pushErrorMessage(cause));
    }
  }, [pusher]);

  /** `disable`: cancel in the browser first, then remove the stored subscription from Rails. */
  const disable = useCallback(async () => {
    setState("busy");
    setMessage("");
    try {
      await pusher.unsubscribe();
      await unsubscribePush(endpoint);
      setEndpoint("");
      setState("off");
    } catch (cause) {
      setState(pushErrorState(cause));
      setMessage(pushErrorMessage(cause));
    }
  }, [pusher, endpoint]);

  const onEnable = useCallback(() => {
    void enable();
  }, [enable]);
  const onDisable = useCallback(() => {
    void disable();
  }, [disable]);

  return (
    <div className="push-toggle">
      <h2>Push notifications</h2>
      <p className="push-toggle-note">
        Get the daily job digest as a push notification on this device.
      </p>
      {renderPushControl(state, { onEnable, onDisable })}
      {hasPushError(state) && message !== "" ? (
        <p className="push-toggle-error" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The control itself, split out of the component so a single state can be rendered on its own.
 *
 * `type="button"` is the one addition to the Go markup: the toggle sits inside `ProfileView`'s
 * `<form className="profile-form">`, where an untyped button defaults to `submit`. go-app bound
 * its own click handler and stopped there; in plain HTML the same markup would also submit the
 * profile form. No stylesheet rule keys off the attribute, so nothing about the rendering changes.
 */
function renderPushControl(
  state: PushUiState,
  handlers: { onEnable: () => void; onDisable: () => void },
) {
  switch (state) {
    case "unsupported":
      return (
        <p className="push-toggle-unsupported">
          Push notifications aren&apos;t available in this browser. Install the app to your home
          screen on iOS 16.4+.
        </p>
      );
    case "on":
      return (
        <div className="push-toggle-control">
          <span className="push-toggle-status push-toggle-status-on">On</span>
          <button type="button" className="push-toggle-disable" onClick={handlers.onDisable}>
            Turn off notifications
          </button>
        </div>
      );
    case "busy":
      return (
        <button type="button" className="push-toggle-busy" disabled>
          Working…
        </button>
      );
    default:
      // off, unknown, denied, failed — all offer the enable control.
      return (
        <button type="button" className="push-toggle-enable" onClick={handlers.onEnable}>
          Turn on notifications
        </button>
      );
  }
}
