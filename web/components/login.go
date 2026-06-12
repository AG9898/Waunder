package components

import "github.com/maxence-charriere/go-app/v10/pkg/app"

// Login is the passphrase entry screen. It posts the single-user passphrase to
// POST /api/session through the same-origin /api proxy; on success Rails sets
// the signed, HTTP-only session cookie and the app navigates to the digest.
//
// No secret is stored client-side: the passphrase is held only long enough to
// post it, and the resulting session lives in the HTTP-only cookie that the
// browser manages.
type Login struct {
	app.Compo

	// Client is the Rails client. Tests inject a mock; it defaults to the
	// same-origin HTTP client on mount when nil.
	Client RailsClient

	// OnSuccess is invoked after a successful login. When nil, the component
	// navigates to the digest landing ("/").
	OnSuccess func(ctx app.Context)

	passphrase string
	status     string
	submitting bool
}

// OnMount installs the default same-origin client when none was injected.
func (l *Login) OnMount(app.Context) {
	if l.Client == nil {
		l.Client = NewRailsClient()
	}
}

func (l *Login) onInput(ctx app.Context, e app.Event) {
	l.passphrase = ctx.JSSrc().Get("value").String()
}

func (l *Login) submit(ctx app.Context, e app.Event) {
	e.PreventDefault()
	if l.submitting {
		return
	}
	if l.passphrase == "" {
		l.status = "Enter your passphrase."
		ctx.Update()
		return
	}

	pass := l.passphrase
	l.submitting = true
	l.status = ""
	ctx.Update()

	reqCtx := ctx.Context
	ctx.Async(func() {
		err := l.Client.Login(reqCtx, pass)
		ctx.Dispatch(func(ctx app.Context) {
			l.submitting = false
			l.passphrase = ""
			if err != nil {
				l.status = loginErrorStatus(err)
				ctx.Update()
				return
			}
			if l.OnSuccess != nil {
				l.OnSuccess(ctx)
				return
			}
			ctx.Navigate("/")
		})
	})
}

// Render shows the passphrase form and any status message.
func (l *Login) Render() app.UI {
	return app.Div().Class("login-screen").Body(
		app.H1().Text("Waunder"),
		app.Form().Class("login-form").OnSubmit(l.submit).Body(
			app.Input().
				Class("login-passphrase").
				Type("password").
				Placeholder("Passphrase").
				AutoComplete(true).
				Value(l.passphrase).
				OnInput(l.onInput),
			app.Button().
				Class("login-submit").
				Type("submit").
				Disabled(l.submitting).
				Text(loginButtonText(l.submitting)),
		),
		app.If(l.status != "", func() app.UI {
			return app.P().Class("login-status").Text(l.status)
		}),
	)
}

// loginErrorStatus maps a failed login to the status message shown to the user:
// a 401 means the passphrase was wrong; anything else is a transient failure.
func loginErrorStatus(err error) string {
	if IsUnauthorized(err) {
		return "Incorrect passphrase."
	}
	return "Could not sign in. Please try again."
}

func loginButtonText(submitting bool) string {
	if submitting {
		return "Signing in…"
	}
	return "Sign in"
}
