package components

import (
	"context"
	"encoding/json"

	"github.com/maxence-charriere/go-app/v10/pkg/app"
)

// browserPusher is the production PushSubscriber. It drives the browser's
// service-worker PushManager through the go-app JS bridge. All JS interop is
// confined here so the rest of the push flow stays plain Go and testable; on
// the server build the go-app JS shim makes these calls inert (Supported
// returns false), so the toggle renders an unsupported state during SSR.
type browserPusher struct{}

// NewBrowserPusher returns the live browser-backed PushSubscriber.
func NewBrowserPusher() PushSubscriber { return &browserPusher{} }

// Supported reports whether the running environment exposes the Push API. On
// the server build (no real browser) the go-app window/global lookups are not
// truthy, so this returns false and the toggle shows the unsupported state.
func (b *browserPusher) Supported() bool {
	nav := app.Window().Get("navigator")
	if !nav.Truthy() {
		return false
	}
	return nav.Get("serviceWorker").Truthy() && app.Window().Get("PushManager").Truthy()
}

// Subscribe waits for the service worker, requests notification permission, and
// subscribes to push with the supplied application server (VAPID) key. It
// returns ErrPushDenied when the user declines and ErrPushUnsupported when the
// Push API is missing.
func (b *browserPusher) Subscribe(_ context.Context, vapidPublicKey string) (PushSubscription, error) {
	if !b.Supported() {
		return PushSubscription{}, ErrPushUnsupported
	}

	permission, err := await(app.Window().Get("Notification").Call("requestPermission"))
	if err != nil {
		return PushSubscription{}, err
	}
	if permission.String() != "granted" {
		return PushSubscription{}, ErrPushDenied
	}

	reg, err := await(app.Window().Get("navigator").Get("serviceWorker").Get("ready"))
	if err != nil {
		return PushSubscription{}, err
	}

	opts := map[string]any{
		"userVisibleOnly":      true,
		"applicationServerKey": vapidPublicKey,
	}
	subValue, err := await(reg.Get("pushManager").Call("subscribe", opts))
	if err != nil {
		return PushSubscription{}, err
	}
	return decodeSubscription(subValue)
}

// CurrentEndpoint returns the active subscription's endpoint, or "" when there
// is no current subscription.
func (b *browserPusher) CurrentEndpoint(_ context.Context) (string, error) {
	if !b.Supported() {
		return "", nil
	}
	reg, err := await(app.Window().Get("navigator").Get("serviceWorker").Get("ready"))
	if err != nil {
		return "", err
	}
	subValue, err := await(reg.Get("pushManager").Call("getSubscription"))
	if err != nil {
		return "", err
	}
	if !subValue.Truthy() {
		return "", nil
	}
	sub, err := decodeSubscription(subValue)
	if err != nil {
		return "", err
	}
	return sub.Endpoint, nil
}

// Unsubscribe cancels the active browser subscription if one exists.
func (b *browserPusher) Unsubscribe(_ context.Context) error {
	if !b.Supported() {
		return nil
	}
	reg, err := await(app.Window().Get("navigator").Get("serviceWorker").Get("ready"))
	if err != nil {
		return err
	}
	subValue, err := await(reg.Get("pushManager").Call("getSubscription"))
	if err != nil {
		return err
	}
	if !subValue.Truthy() {
		return nil
	}
	_, err = await(subValue.Call("unsubscribe"))
	return err
}

// decodeSubscription serializes a browser PushSubscription via its toJSON()
// shape (endpoint + keys.p256dh/auth), which is exactly what Rails stores.
func decodeSubscription(sub app.Value) (PushSubscription, error) {
	raw := app.Window().Get("JSON").Call("stringify", sub.Call("toJSON")).String()
	var out PushSubscription
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return PushSubscription{}, err
	}
	return out, nil
}

// await resolves a JS Promise to its value or error using go-app's
// promise-bridging helper, turning the async browser API into synchronous Go
// suitable for calling inside an ctx.Async goroutine.
func await(promise app.Value) (app.Value, error) {
	type result struct {
		value app.Value
		err   error
	}
	ch := make(chan result, 1)

	then := app.FuncOf(func(_ app.Value, args []app.Value) any {
		var v app.Value
		if len(args) > 0 {
			v = args[0]
		}
		ch <- result{value: v}
		return nil
	})
	defer then.Release()

	catch := app.FuncOf(func(_ app.Value, args []app.Value) any {
		msg := "push api call failed"
		if len(args) > 0 && args[0].Truthy() {
			msg = args[0].String()
		}
		ch <- result{err: &jsError{msg: msg}}
		return nil
	})
	defer catch.Release()

	promise.Call("then", then).Call("catch", catch)
	r := <-ch
	return r.value, r.err
}

// jsError carries a rejected-promise message from the browser Push API.
type jsError struct{ msg string }

func (e *jsError) Error() string { return e.msg }
