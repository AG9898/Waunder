package components

import "github.com/maxence-charriere/go-app/v10/pkg/app"

// CopyButton copies only on an explicit click and reports browser permission failures.
type CopyButton struct {
	app.Compo
	Text    string
	Label   string
	message string
	busy    bool
}

func (b *CopyButton) Render() app.UI {
	return app.Div().Class("copy-control").Body(
		app.Button().Class("copy-button").Type("button").Disabled(b.busy).OnClick(b.copy).Text(b.Label),
		app.Span().Class("copy-status").Attr("role", "status").Text(b.message),
	)
}

func (b *CopyButton) copy(ctx app.Context, _ app.Event) {
	if !app.IsClient || b.busy {
		return
	}
	clipboard := app.Window().Get("navigator").Get("clipboard")
	if !clipboard.Truthy() {
		b.message = "Select the text and copy it manually."
		ctx.Update()
		return
	}
	b.busy = true
	b.message = ""
	var success, failure app.Func
	finish := func(message string) {
		ctx.Dispatch(func(ctx app.Context) {
			b.busy = false
			b.message = message
			ctx.Update()
		})
		success.Release()
		failure.Release()
	}
	success = app.FuncOf(func(app.Value, []app.Value) any { finish("Copied."); return nil })
	failure = app.FuncOf(func(app.Value, []app.Value) any {
		finish("Copy was blocked. Select the text and copy it manually.")
		return nil
	})
	clipboard.Call("writeText", b.Text).Call("then", success, failure)
	ctx.Update()
}
