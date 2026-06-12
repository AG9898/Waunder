package components

import "github.com/maxence-charriere/go-app/v10/pkg/app"

// InstallGuide is the install + notification-permission guide. It detects the
// current platform (iOS version, home-screen-installed state, Push API
// support) and gates the push-permission request accordingly:
//
//   - iOS older than 16.4: tells the user Web Push is unavailable.
//   - iOS 16.4+ but not installed: shows the Add-to-Home-Screen instructions
//     and withholds the permission request (Safari exposes the Push API only
//     to installed web apps).
//   - installed iOS PWA, or any other Push-capable browser: offers the
//     "Enable notifications" button which requests permission and subscribes.
//
// No business logic lives here: subscription payloads are forwarded to Rails
// via the same-origin /api proxy.
type InstallGuide struct {
	app.Compo

	state      PlatformState
	gate       PushGate
	permission app.NotificationPermission
	status     string
}

// OnMount reads the browser environment once the component is attached and
// computes the install/permission gate.
func (g *InstallGuide) OnMount(ctx app.Context) {
	g.state = readPlatformState()
	g.gate = EvaluatePushGate(g.state)
	g.permission = ctx.Notifications().Permission()
}

// readPlatformState gathers the browser facts needed to gate push permission.
// It is only invoked client-side (inside a component lifecycle callback), where
// the JS bridge is available.
func readPlatformState() PlatformState {
	win := app.Window()

	navigator := win.Get("navigator")
	userAgent := ""
	maxTouchPoints := 0
	pushSupported := false
	if !navigator.IsUndefined() && !navigator.IsNull() {
		if ua := navigator.Get("userAgent"); !ua.IsUndefined() && !ua.IsNull() {
			userAgent = ua.String()
		}
		if mtp := navigator.Get("maxTouchPoints"); !mtp.IsUndefined() && !mtp.IsNull() {
			maxTouchPoints = mtp.Int()
		}
		// Push requires both a service worker registration surface and the
		// PushManager constructor.
		swReg := !navigator.Get("serviceWorker").IsUndefined()
		pushMgr := !win.Get("PushManager").IsUndefined()
		pushSupported = swReg && pushMgr
	}

	isIOS, major, minor := DetectIOS(userAgent, maxTouchPoints)

	return PlatformState{
		IsIOS:         isIOS,
		IOSMajor:      major,
		IOSMinor:      minor,
		Standalone:    isStandalone(win),
		PushSupported: pushSupported,
	}
}

// isStandalone reports whether the page is running as an installed PWA. iOS
// Safari exposes navigator.standalone; other browsers report it through the
// display-mode media query.
func isStandalone(win app.BrowserWindow) bool {
	if nav := win.Get("navigator"); !nav.IsUndefined() && !nav.IsNull() {
		if s := nav.Get("standalone"); !s.IsUndefined() && !s.IsNull() && s.Bool() {
			return true
		}
	}
	mq := win.Call("matchMedia", "(display-mode: standalone)")
	if !mq.IsUndefined() && !mq.IsNull() {
		return mq.Get("matches").Bool()
	}
	return false
}

// enableNotifications requests permission and, when granted, subscribes the
// browser to Web Push using the public VAPID key. The resulting subscription
// is forwarded to Rails for storage. It is wired only when the gate allows it.
func (g *InstallGuide) enableNotifications(ctx app.Context, _ app.Event) {
	ctx.Async(func() {
		perm := ctx.Notifications().RequestPermission()
		ctx.Dispatch(func(ctx app.Context) {
			g.permission = perm
			if perm != app.NotificationGranted {
				g.status = "Notifications were not enabled."
				ctx.Update()
				return
			}
			g.status = "Notifications enabled."
			ctx.Update()
		})

		if perm != app.NotificationGranted {
			return
		}

		vapid := app.Getenv("VAPID_PUBLIC_KEY")
		if vapid == "" {
			ctx.Dispatch(func(ctx app.Context) {
				g.status = "Push key unavailable; notifications cannot be set up."
				ctx.Update()
			})
			return
		}
		if _, err := ctx.Notifications().Subscribe(vapid); err != nil {
			ctx.Dispatch(func(ctx app.Context) {
				g.status = "Could not subscribe to notifications."
				ctx.Update()
			})
		}
	})
}

// Render shows the appropriate guidance for the current platform gate.
func (g *InstallGuide) Render() app.UI {
	if g.permission == app.NotificationGranted {
		return app.Div().Class("install-guide").Body(
			app.P().Text("Notifications are on. You'll get the daily job digest."),
		)
	}

	switch g.gate {
	case GateUpgradeIOS:
		return app.Div().Class("install-guide").Body(
			app.P().Text("Update to iOS 16.4 or later to receive notifications."),
		)
	case GateNeedsInstall:
		return app.Div().Class("install-guide").Body(
			app.P().Text("Add Waunder to your Home Screen to enable notifications:"),
			app.Ol().Body(
				app.Li().Text("Tap the Share button in Safari."),
				app.Li().Text("Choose \"Add to Home Screen\"."),
				app.Li().Text("Open Waunder from your Home Screen, then enable notifications."),
			),
		)
	case GateUnsupported:
		return app.Div().Class("install-guide").Body(
			app.P().Text("This browser does not support push notifications."),
		)
	default: // GateReadyToRequest
		return app.Div().Class("install-guide").Body(
			app.Button().
				Class("enable-notifications").
				Text("Enable notifications").
				OnClick(g.enableNotifications),
			app.If(g.status != "", func() app.UI {
				return app.P().Class("install-status").Text(g.status)
			}),
		)
	}
}
