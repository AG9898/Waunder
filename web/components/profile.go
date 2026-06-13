package components

import (
	"context"

	"github.com/maxence-charriere/go-app/v10/pkg/app"
)

// saveState tracks the explicit profile-save lifecycle, separate from the
// initial profile fetch (loadState). It advances out of saveIdle only when the
// user submits the form.
type saveState int

const (
	saveIdle saveState = iota
	saveSending
	saveDone
	saveError
)

// ProfileView renders the single-user structured profile (GET /api/profile)
// and lets the owner edit the non-sensitive text/URL fields, writing them back
// (PATCH /api/profile). Sensitive contact details are shown only as presence
// flags — Rails never serializes the raw encrypted PII, and this screen never
// edits it. The current primary resume's ingest status is surfaced read-only;
// the resume itself is sourced from the portfolio export pipeline.
type ProfileView struct {
	app.Compo

	// Client is the Rails client; tests inject a mock and it defaults to the
	// same-origin HTTP client on mount.
	Client RailsClient
	// Pusher is forwarded to the embedded push toggle; tests inject a mock and
	// it defaults to the live browser subscriber on the child's mount when nil.
	Pusher PushSubscriber

	state   loadState
	profile Profile
	err     string

	edit    ProfileEdit
	save    saveState
	saveErr string
}

func (p *ProfileView) OnMount(ctx app.Context)     { p.ensureClient(); p.load(ctx) }
func (p *ProfileView) OnPreRender(ctx app.Context) { p.ensureClient(); p.load(ctx) }

func (p *ProfileView) ensureClient() {
	if p.Client == nil {
		p.Client = NewRailsClient()
	}
}

func (p *ProfileView) load(ctx app.Context) {
	p.state = loadLoading
	ctx.Update()
	reqCtx := ctx.Context
	ctx.Async(func() {
		profile, err := p.Client.Profile(reqCtx)
		ctx.Dispatch(func(ctx app.Context) {
			applyResult(ctx, &p.state, &p.err, err, func() {
				p.profile = profile
				p.edit = editFromProfile(profile)
			})
		})
	})
}

// editFromProfile seeds the editable form fields from a fetched profile. It is
// pure so the read→edit mapping is unit-testable without the engine.
func editFromProfile(profile Profile) ProfileEdit {
	return ProfileEdit{
		FullName:     profile.FullName,
		Headline:     profile.Headline,
		Summary:      profile.Summary,
		Location:     profile.Location,
		LinkedInURL:  profile.LinkedInURL,
		GitHubURL:    profile.GitHubURL,
		PortfolioURL: profile.PortfolioURL,
	}
}

// fieldSetter returns an OnInput handler that writes the input value into the
// pointed-to edit field. Keeping the field wiring in one place avoids a closure
// per field at the call site.
func (p *ProfileView) fieldSetter(field *string) app.EventHandler {
	return func(ctx app.Context, _ app.Event) {
		*field = ctx.JSSrc().Get("value").String()
	}
}

// submit is wired to the form's OnSubmit. It runs only on an explicit user
// submit; the screen never writes the profile on mount or render.
func (p *ProfileView) submit(ctx app.Context, e app.Event) {
	e.PreventDefault()
	if p.save == saveSending {
		return
	}
	p.save = saveSending
	p.saveErr = ""
	ctx.Update()
	edit := p.edit
	reqCtx := ctx.Context
	ctx.Async(func() {
		profile, err := p.Client.UpdateProfile(reqCtx, edit)
		ctx.Dispatch(func(ctx app.Context) {
			p.applySaveResult(profile, err)
			ctx.Update()
		})
	})
}

// applySaveResult records the outcome of a profile save. Split out from the
// app.Context plumbing so the state transition is unit-testable without the
// go-app engine.
func (p *ProfileView) applySaveResult(profile Profile, err error) {
	if err != nil {
		p.save = saveError
		if IsUnauthorized(err) {
			p.saveErr = "Your session expired. Please sign in again."
		} else {
			p.saveErr = "Could not save your profile. Please try again."
		}
		return
	}
	p.profile = profile
	p.edit = editFromProfile(profile)
	p.save = saveDone
}

// doSave performs the update synchronously and applies the result. It is the
// body invoked inside the async submit handler; tests drive it directly to
// exercise the full save path without the go-app engine.
func (p *ProfileView) doSave(ctx context.Context) {
	p.save = saveSending
	profile, err := p.Client.UpdateProfile(ctx, p.edit)
	p.applySaveResult(profile, err)
}

func (p *ProfileView) Render() app.UI {
	return app.Div().Class("profile").Body(
		app.H1().Text("Profile"),
		renderLoad(p.state, p.err, func() app.UI {
			return app.Div().Class("profile-body").Body(
				app.Form().Class("profile-form").OnSubmit(p.submit).Body(
					textField("Full name", "profile-full-name", p.edit.FullName, p.fieldSetter(&p.edit.FullName)),
					textField("Headline", "profile-headline", p.edit.Headline, p.fieldSetter(&p.edit.Headline)),
					textField("Summary", "profile-summary", p.edit.Summary, p.fieldSetter(&p.edit.Summary)),
					textField("Location", "profile-location", p.edit.Location, p.fieldSetter(&p.edit.Location)),
					textField("LinkedIn URL", "profile-linkedin", p.edit.LinkedInURL, p.fieldSetter(&p.edit.LinkedInURL)),
					textField("GitHub URL", "profile-github", p.edit.GitHubURL, p.fieldSetter(&p.edit.GitHubURL)),
					textField("Portfolio URL", "profile-portfolio", p.edit.PortfolioURL, p.fieldSetter(&p.edit.PortfolioURL)),
					app.Button().
						Class("profile-save").
						Type("submit").
						Disabled(p.save == saveSending).
						Text(saveButtonLabel(p.save)),
					app.If(p.save == saveError, func() app.UI {
						return app.P().Class("profile-save-error").Text(p.saveErr)
					}),
					app.If(p.save == saveDone, func() app.UI {
						return app.P().Class("profile-save-ok").Text("Profile saved.")
					}),
				),
				renderContact(p.profile.Contact),
				renderResume(p.profile.Resume),
				&PushToggle{Client: p.Client, Pusher: p.Pusher},
			)
		}),
	)
}

// textField renders one labelled text input bound to an OnInput setter.
func textField(label, class, value string, set app.EventHandler) app.UI {
	return app.Label().Class("profile-field").Body(
		app.Span().Class("profile-field-label").Text(label),
		app.Input().
			Class(class).
			Type("text").
			Value(value).
			OnInput(set),
	)
}

// renderContact shows the encrypted contact fields as presence flags only; the
// raw values never reach the client, so the screen reports set/not-set state.
func renderContact(contact ProfileContact) app.UI {
	return app.Div().Class("profile-contact").Body(
		app.H2().Text("Contact details"),
		app.P().Class("profile-contact-note").
			Text("Contact details are encrypted at rest and shown only as set/not set."),
		app.Ul().Body(
			contactRow("Email", contact.EmailPresent),
			contactRow("Phone", contact.PhonePresent),
			contactRow("Street address", contact.StreetAddressPresent),
		),
	)
}

func contactRow(label string, present bool) app.UI {
	return app.Li().Class("profile-contact-row").Text(label + ": " + presenceLabel(present))
}

func presenceLabel(present bool) string {
	if present {
		return "set"
	}
	return "not set"
}

// renderResume surfaces the current primary resume's ingest metadata read-only.
// The resume is sourced from the portfolio export pipeline (push-on-export to
// POST /api/profile/resume); this screen reports its status.
func renderResume(resume *ResumeSummary) app.UI {
	return app.Div().Class("profile-resume").Body(
		app.H2().Text("Resume"),
		app.If(resume == nil, func() app.UI {
			return app.P().Class("profile-resume-empty").
				Text("No resume ingested yet. It syncs from the portfolio export pipeline.")
		}).Else(func() app.UI {
			return app.Ul().Class("profile-resume-meta").Body(
				app.Li().Class("profile-resume-title").Text("Title: "+resume.Title),
				app.Li().Class("profile-resume-status").Text("Parse status: "+resume.ParseStatus),
				app.Li().Class("profile-resume-file").Text("File: "+resumeFileLabel(resume)),
			)
		}),
	)
}

func resumeFileLabel(resume *ResumeSummary) string {
	if resume.FileAttached {
		if resume.Filename != "" {
			return resume.Filename
		}
		return "attached"
	}
	return "not attached"
}

func saveButtonLabel(s saveState) string {
	switch s {
	case saveSending:
		return "Saving…"
	case saveDone:
		return "Saved"
	default:
		return "Save profile"
	}
}
