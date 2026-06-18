package components

import (
	"context"
	"errors"

	"github.com/maxence-charriere/go-app/v10/pkg/app"
)

// ErrPushUnsupported is returned by a PushSubscriber when the browser exposes no
// usable Push API (so the toggle renders an unsupported state instead of an
// error).
var ErrPushUnsupported = errors.New("push not supported")

// ErrPushDenied is returned when the user denied the browser notification
// permission prompt, so the toggle can explain rather than retry blindly.
var ErrPushDenied = errors.New("push permission denied")

// PushSubscriber abstracts the browser Push API behind an interface so the
// subscription flow is testable without a real browser (TESTING.md: mock the
// browser Notification/Push APIs behind an abstraction). The production
// implementation drives navigator.serviceWorker / PushManager via the go-app JS
// bridge; tests inject a mock that returns canned subscriptions.
//
// No business logic lives here: it only translates between the browser Push API
// and the PushSubscription shape Rails stores.
type PushSubscriber interface {
	// Supported reports whether the Push API is usable in this environment.
	Supported() bool

	// Subscribe requests notification permission (if needed) and subscribes to
	// push with the given application server (public VAPID) key, returning the
	// resulting browser subscription. It returns ErrPushDenied when the user
	// declines permission.
	Subscribe(ctx context.Context, vapidPublicKey string) (PushSubscription, error)

	// CurrentEndpoint returns the endpoint of the active browser subscription,
	// or "" when there is none.
	CurrentEndpoint(ctx context.Context) (string, error)

	// Unsubscribe cancels the active browser push subscription.
	Unsubscribe(ctx context.Context) error
}

// pushUIState is the rendered state of the push toggle.
type pushUIState int

const (
	pushUnknown     pushUIState = iota // initial / still determining
	pushUnsupported                    // browser cannot do push
	pushOff                            // supported, not subscribed
	pushOn                             // subscribed
	pushBusy                           // a subscribe/unsubscribe is in flight
	pushFailed                         // last action failed
)

// PushToggle is the push-subscription control. It reads the public VAPID key
// from Rails, subscribes via the browser Push API, and posts the resulting
// subscription to Rails (POST /api/push_subscription) for the daily digest. The
// owner can unsubscribe, which cancels the browser subscription and removes it
// from Rails (DELETE /api/push_subscription). The browser Push API is reached
// through the Pusher abstraction so the flow is testable without a browser.
type PushToggle struct {
	app.Compo

	// Client is the Rails client; tests inject a mock and it defaults to the
	// same-origin HTTP client on mount.
	Client RailsClient
	// Pusher is the browser Push API abstraction; tests inject a mock. When nil
	// it defaults to the live browser subscriber on mount.
	Pusher PushSubscriber

	state    pushUIState
	endpoint string
	errMsg   string
}

func (t *PushToggle) OnMount(ctx app.Context)     { t.start(ctx) }
func (t *PushToggle) OnPreRender(ctx app.Context) { t.start(ctx) }

func (t *PushToggle) start(ctx app.Context) {
	if t.Client == nil {
		t.Client = NewRailsClient()
	}
	if t.Pusher == nil {
		t.Pusher = NewBrowserPusher()
	}
	t.refresh(ctx)
}

// refresh determines the current subscription state from the browser.
func (t *PushToggle) refresh(ctx app.Context) {
	reqCtx := ctx.Context
	pusher := t.Pusher
	ctx.Async(func() {
		if !pusher.Supported() {
			ctx.Dispatch(func(ctx app.Context) {
				t.state = pushUnsupported
				ctx.Update()
			})
			return
		}
		endpoint, err := pusher.CurrentEndpoint(reqCtx)
		ctx.Dispatch(func(ctx app.Context) {
			if err != nil {
				t.state = pushFailed
				t.errMsg = pushErrorMessage(err)
				ctx.Update()
				return
			}
			t.endpoint = endpoint
			t.state = initialPushState(true, endpoint)
			ctx.Update()
		})
	})
}

// initialPushState maps supported/endpoint facts to the rendered toggle state.
// Pure so the gating is unit-testable without the engine.
func initialPushState(supported bool, endpoint string) pushUIState {
	if !supported {
		return pushUnsupported
	}
	if endpoint != "" {
		return pushOn
	}
	return pushOff
}

// enable is wired to the subscribe button's OnClick. It runs only on an
// explicit user action: fetch the VAPID key, subscribe via the browser, then
// store the subscription in Rails.
func (t *PushToggle) enable(ctx app.Context, _ app.Event) {
	if t.state == pushBusy {
		return
	}
	t.state = pushBusy
	t.errMsg = ""
	ctx.Update()
	reqCtx := ctx.Context
	ctx.Async(func() {
		sub, err := t.doSubscribe(reqCtx)
		ctx.Dispatch(func(ctx app.Context) {
			t.applySubscribe(sub, err)
			ctx.Update()
		})
	})
}

// doSubscribe performs the full subscribe path: read the VAPID key, subscribe in
// the browser, and persist to Rails. Returned synchronously so tests can drive
// the whole flow without the go-app engine.
func (t *PushToggle) doSubscribe(ctx context.Context) (PushSubscription, error) {
	key, err := t.Client.VAPIDPublicKey(ctx)
	if err != nil {
		return PushSubscription{}, err
	}
	if key == "" {
		return PushSubscription{}, ErrPushUnsupported
	}
	sub, err := t.Pusher.Subscribe(ctx, key)
	if err != nil {
		return PushSubscription{}, err
	}
	if err := t.Client.Subscribe(ctx, sub); err != nil {
		return PushSubscription{}, err
	}
	return sub, nil
}

// applySubscribe records the outcome of a subscribe attempt. Split from the
// engine plumbing so the state transitions are unit-testable.
func (t *PushToggle) applySubscribe(sub PushSubscription, err error) {
	if err != nil {
		if errors.Is(err, ErrPushUnsupported) {
			t.state = pushUnsupported
			return
		}
		t.state = pushFailed
		t.errMsg = pushErrorMessage(err)
		return
	}
	t.endpoint = sub.Endpoint
	t.state = pushOn
}

// disable is wired to the unsubscribe button's OnClick. It cancels the browser
// subscription and removes it from Rails.
func (t *PushToggle) disable(ctx app.Context, _ app.Event) {
	if t.state == pushBusy {
		return
	}
	t.state = pushBusy
	t.errMsg = ""
	ctx.Update()
	reqCtx := ctx.Context
	endpoint := t.endpoint
	ctx.Async(func() {
		err := t.doUnsubscribe(reqCtx, endpoint)
		ctx.Dispatch(func(ctx app.Context) {
			t.applyUnsubscribe(err)
			ctx.Update()
		})
	})
}

// doUnsubscribe cancels the browser subscription then removes it from Rails.
func (t *PushToggle) doUnsubscribe(ctx context.Context, endpoint string) error {
	if err := t.Pusher.Unsubscribe(ctx); err != nil {
		return err
	}
	return t.Client.Unsubscribe(ctx, endpoint)
}

func (t *PushToggle) applyUnsubscribe(err error) {
	if err != nil {
		t.state = pushFailed
		t.errMsg = pushErrorMessage(err)
		return
	}
	t.endpoint = ""
	t.state = pushOff
}

// pushErrorMessage maps a push flow error to a user-facing message.
func pushErrorMessage(err error) string {
	switch {
	case errors.Is(err, ErrPushDenied):
		return "Notifications were blocked. Enable them in your browser settings to get the daily digest."
	case IsUnauthorized(err):
		return "Your session expired. Please sign in again."
	default:
		return "Could not update push notifications. Please try again."
	}
}

func (t *PushToggle) Render() app.UI {
	return app.Div().Class("push-toggle").Body(
		app.H2().Text("Push notifications"),
		app.P().Class("push-toggle-note").
			Text("Get the daily job digest as a push notification on this device."),
		renderPushControl(t),
		app.If(t.state == pushFailed, func() app.UI {
			return app.P().Class("push-toggle-error").Text(t.errMsg)
		}),
	)
}

func renderPushControl(t *PushToggle) app.UI {
	switch t.state {
	case pushUnsupported:
		return app.P().Class("push-toggle-unsupported").
			Text("Push notifications aren't available in this browser. Install the app to your home screen on iOS 16.4+.")
	case pushOn:
		return app.Div().Class("push-toggle-control").Body(
			app.Span().Class("push-toggle-status push-toggle-status-on").Text("On"),
			app.Button().
				Class("push-toggle-disable").
				OnClick(t.disable).
				Text("Turn off notifications"),
		)
	case pushBusy:
		return app.Button().Class("push-toggle-busy").Disabled(true).Text("Working…")
	default: // pushOff, pushUnknown, pushFailed
		return app.Button().
			Class("push-toggle-enable").
			OnClick(t.enable).
			Text("Turn on notifications")
	}
}
