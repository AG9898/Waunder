// Package components holds the go-app UI components for the Waunder PWA.
package components

import "github.com/maxence-charriere/go-app/v10/pkg/app"

// Home is the root component rendered at "/". Skeleton placeholder shell;
// real screens (job digest, job detail, application review, etc.) come later.
type Home struct {
	app.Compo
}

// Render returns the component's UI tree.
func (h *Home) Render() app.UI {
	return app.Div().
		Class("app-shell").
		Body(
			app.H1().Text("Waunder"),
			app.P().Text("Personal job application assistant — skeleton."),
		)
}
