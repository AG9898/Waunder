package components

import "github.com/maxence-charriere/go-app/v10/pkg/app"

const layoutStorageKey = "waunder.layout"

// AppChrome shares navigation and a device-local layout preference across routes.
// CSS resolves Auto from the viewport, including installed PWAs and resized windows.
type AppChrome struct {
	app.Compo
	Active     string
	layout     string
	storageErr string
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
			app.A().Class("app-add-job").Href("/jobs/new").Text("+ Add job"),
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
		app.If(c.storageErr != "", func() app.UI {
			return app.P().Class("layout-error").Attr("role", "status").Text(c.storageErr)
		}),
	)
}
