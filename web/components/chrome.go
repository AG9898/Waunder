package components

import "github.com/maxence-charriere/go-app/v10/pkg/app"

const layoutStorageKey = "waunder.layout"

// AppChrome shares navigation and a device-local layout preference across routes.
// CSS resolves Auto from the viewport, including installed PWAs and resized windows.
type AppChrome struct {
	app.Compo
	Active string
	layout string
	// updateReady is set once a newer build has been downloaded in the
	// background by the service worker but is not yet running on this page.
	updateReady bool
	storageErr  string
}

func normalizeLayout(value string) string {
	switch value {
	case "desktop", "mobile":
		return value
	default:
		return "auto"
	}
}

func (c *AppChrome) OnMount(ctx app.Context) {
	var saved string
	if err := ctx.LocalStorage().Get(layoutStorageKey, &saved); err != nil {
		saved = "auto"
	}
	c.layout = normalizeLayout(saved)
	c.applyLayout()
	// An update may have landed before this chrome mounted (a background
	// download during an earlier screen), so adopt the pending state too.
	c.applyAppUpdate(ctx.AppUpdateAvailable())
	checkForAppUpdate()
	ctx.Update()
}

// OnAppUpdate fires when the service worker has fetched a newer build in the
// background. go-app's own service worker is cache-first with no revalidation,
// so the running page keeps the old WebAssembly until it is reloaded — without
// this the update is downloaded and then silently never applied, which is
// especially sticky for an installed PWA that is resumed rather than reloaded.
func (c *AppChrome) OnAppUpdate(ctx app.Context) {
	c.applyAppUpdate(ctx.AppUpdateAvailable())
	ctx.Update()
}

// applyAppUpdate records a pending update. Split from the lifecycle hook so it
// is testable without an app.Context. It only ever latches on: a downloaded
// update stays pending until the page actually reloads.
func (c *AppChrome) applyAppUpdate(available bool) {
	if available {
		c.updateReady = true
	}
}

// checkForAppUpdate asks the service worker to look for a newer build. The
// browser only checks automatically on a full page load, so an installed PWA
// resumed from memory can run a stale build indefinitely; the chrome remounts
// on every in-app navigation, which makes this a cheap recurring check.
func checkForAppUpdate() {
	if !app.IsClient {
		return
	}
	if try := app.Window().Get("goappTryUpdate"); try.Truthy() {
		app.Window().Call("goappTryUpdate")
	}
}

// reloadForUpdate swaps in the downloaded build. It is an explicit user action
// rather than an automatic reload, so an in-progress form edit is never
// discarded out from under the owner.
func (c *AppChrome) reloadForUpdate(ctx app.Context, _ app.Event) {
	ctx.Reload()
}

func (c *AppChrome) applyLayout() {
	if app.IsClient {
		app.Window().Get("document").Get("documentElement").Call("setAttribute", "data-layout", normalizeLayout(c.layout))
	}
}

func (c *AppChrome) selectLayout(ctx app.Context, _ app.Event) {
	c.layout = normalizeLayout(ctx.JSSrc().Get("value").String())
	c.storageErr = ""
	if err := ctx.LocalStorage().Set(layoutStorageKey, c.layout); err != nil {
		c.storageErr = "Layout changed. This browser could not save the preference."
	}
	c.applyLayout()
	ctx.Update()
}

func (c *AppChrome) Render() app.UI {
	link := func(name, href, label string) app.UI {
		a := app.A().Class(tabClass(c.Active, name)).Href(href).Text(label)
		if c.Active == name {
			a.Attr("aria-current", "page")
		}
		return a
	}
	return app.Header().Class("app-chrome").Body(
		app.Div().Class("app-toolbar").Body(
			app.A().Class("app-brand").Href("/").Text("Waunder"),
			app.A().Class("app-add-job").Href("/jobs/new").Text("Import job"),
			app.Label().Class("layout-control").Body(
				app.Span().Text("Layout"),
				app.Select().Class("layout-select").OnChange(c.selectLayout).Body(
					app.Option().Value("auto").Selected(normalizeLayout(c.layout) == "auto").Text("Auto"),
					app.Option().Value("desktop").Selected(c.layout == "desktop").Text("Desktop"),
					app.Option().Value("mobile").Selected(c.layout == "mobile").Text("Mobile"),
				),
			),
		),
		app.Nav().Class("app-tabs").Aria("label", "Main navigation").Body(
			link("digest", "/", "Intake"),
			link("jobs", "/jobs", "Jobs"),
			link("applications", "/applications", "Applications"),
			link("profile", "/profile", "Profile"),
		),
		app.If(c.updateReady, func() app.UI {
			return app.Div().Class("app-update").Attr("role", "status").Body(
				app.Span().Class("app-update-text").Text("A new version of Waunder is ready."),
				app.Button().Class("app-update-reload").OnClick(c.reloadForUpdate).Text("Reload"),
			)
		}),
		app.If(c.storageErr != "", func() app.UI {
			return app.P().Class("layout-error").Attr("role", "status").Text(c.storageErr)
		}),
	)
}
