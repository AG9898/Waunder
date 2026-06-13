package components

import (
	"context"
	"strconv"
	"strings"

	"github.com/maxence-charriere/go-app/v10/pkg/app"
)

// entryState tracks the manual-entry submit lifecycle. The submit advances out
// of entryIdle only on an explicit user click; nothing is posted on mount.
type entryState int

const (
	entryIdle entryState = iota
	entrySubmitting
	entryDone
	entryError
)

// ManualEntry is the manual job entry form (WEB-06). It collects a job URL
// and/or pasted posting text (plus optional title/company hints) and posts them
// to POST /api/job_posts. Rails owns all normalization, route resolution, and
// scoring; this screen carries no business logic. On success it surfaces the
// created JobPost with a link to its detail, so the new post can be followed
// into the feed once Rails finishes scoring it.
type ManualEntry struct {
	app.Compo

	// Client is the Rails client; tests inject a mock and it defaults to the
	// same-origin HTTP client on mount.
	Client RailsClient

	url     string
	text    string
	title   string
	company string

	state  entryState
	err    string
	result ManualJobResult
}

func (m *ManualEntry) OnMount(app.Context)     { m.ensureClient() }
func (m *ManualEntry) OnPreRender(app.Context) { m.ensureClient() }

func (m *ManualEntry) ensureClient() {
	if m.Client == nil {
		m.Client = NewRailsClient()
	}
}

func (m *ManualEntry) onURLInput(ctx app.Context, _ app.Event) {
	m.url = ctx.JSSrc().Get("value").String()
}

func (m *ManualEntry) onTextInput(ctx app.Context, _ app.Event) {
	m.text = ctx.JSSrc().Get("value").String()
}

func (m *ManualEntry) onTitleInput(ctx app.Context, _ app.Event) {
	m.title = ctx.JSSrc().Get("value").String()
}

func (m *ManualEntry) onCompanyInput(ctx app.Context, _ app.Event) {
	m.company = ctx.JSSrc().Get("value").String()
}

// submit is wired to the form's OnSubmit. It validates a minimal client hint
// (URL or text present), then posts the entry. The actual normalization and
// validation are Rails' responsibility; this only avoids a pointless round trip
// on a wholly empty form.
func (m *ManualEntry) submit(ctx app.Context, e app.Event) {
	e.PreventDefault()
	if m.state == entrySubmitting {
		return
	}
	if !m.inputPresent() {
		m.state = entryError
		m.err = "Enter a job URL or paste the posting text."
		ctx.Update()
		return
	}

	m.state = entrySubmitting
	m.err = ""
	ctx.Update()

	reqCtx := ctx.Context
	in := m.input()
	ctx.Async(func() {
		res, err := m.Client.CreateJobPost(reqCtx, in)
		ctx.Dispatch(func(ctx app.Context) {
			m.applyCreateResult(res, err)
			ctx.Update()
		})
	})
}

// doSubmit performs the create call and applies the result synchronously. It is
// the body invoked inside the async click handler; tests drive it directly to
// exercise the full submit path without the go-app engine.
func (m *ManualEntry) doSubmit(ctx context.Context) {
	m.state = entrySubmitting
	res, err := m.Client.CreateJobPost(ctx, m.input())
	m.applyCreateResult(res, err)
}

// applyCreateResult records the outcome of a create attempt. Split out from the
// app.Context plumbing so the state transition is unit-testable without the
// go-app engine.
func (m *ManualEntry) applyCreateResult(res ManualJobResult, err error) {
	if err != nil {
		m.state = entryError
		m.err = createErrorStatus(err)
		return
	}
	m.result = res
	m.state = entryDone
}

// input snapshots the trimmed form fields into the request shape.
func (m *ManualEntry) input() ManualJobInput {
	return ManualJobInput{
		URL:     strings.TrimSpace(m.url),
		Text:    strings.TrimSpace(m.text),
		Title:   strings.TrimSpace(m.title),
		Company: strings.TrimSpace(m.company),
	}
}

// inputPresent reports whether the form has at least a URL or pasted text — the
// minimum Rails requires. It is the only client-side validation, kept as a hint
// so the authoritative check stays in Rails.
func (m *ManualEntry) inputPresent() bool {
	in := m.input()
	return in.URL != "" || in.Text != ""
}

func (m *ManualEntry) Render() app.UI {
	return app.Div().Class("manual-entry").Body(
		app.A().Class("manual-entry-back").Href("/jobs").Text("← Jobs"),
		app.H1().Text("Add a job"),
		app.P().Class("manual-entry-note").
			Text("Paste a job link and/or the posting text. It is scored and added to your feed."),
		app.Form().Class("manual-entry-form").OnSubmit(m.submit).Body(
			app.Label().Class("manual-entry-label").Body(
				app.Span().Text("Job URL"),
				app.Input().
					Class("manual-entry-url").
					Type("url").
					Placeholder("https://…").
					Value(m.url).
					OnInput(m.onURLInput),
			),
			app.Label().Class("manual-entry-label").Body(
				app.Span().Text("Posting text"),
				app.Textarea().
					Class("manual-entry-text").
					Placeholder("Paste the job description…").
					Text(m.text).
					OnInput(m.onTextInput),
			),
			app.Label().Class("manual-entry-label").Body(
				app.Span().Text("Title (optional)"),
				app.Input().
					Class("manual-entry-title").
					Type("text").
					Value(m.title).
					OnInput(m.onTitleInput),
			),
			app.Label().Class("manual-entry-label").Body(
				app.Span().Text("Company (optional)"),
				app.Input().
					Class("manual-entry-company").
					Type("text").
					Value(m.company).
					OnInput(m.onCompanyInput),
			),
			app.Button().
				Class("manual-entry-submit").
				Type("submit").
				Disabled(m.state == entrySubmitting).
				Text(entryButtonLabel(m.state)),
		),
		app.If(m.state == entryError, func() app.UI {
			return app.P().Class("manual-entry-error").Text(m.err)
		}),
		app.If(m.state == entryDone, func() app.UI {
			return m.renderResult()
		}),
	)
}

// renderResult confirms the created job and links to its detail, so the user
// can follow the new post into the feed once Rails finishes scoring it.
func (m *ManualEntry) renderResult() app.UI {
	r := m.result
	return app.Div().Class("manual-entry-result").Body(
		app.P().Class("manual-entry-result-msg").Text(createdMessage(r)),
		app.A().
			Class("manual-entry-result-link").
			Href("/jobs/"+strconv.Itoa(r.ID)).
			Text("View job"),
	)
}

// --- helpers ---

func entryButtonLabel(s entryState) string {
	if s == entrySubmitting {
		return "Adding…"
	}
	return "Add job"
}

// createErrorStatus maps a failed create to the message shown to the user. A
// 422 is invalid input (Rails rejected the URL/text); 401 is an expired
// session; anything else is a transient failure.
func createErrorStatus(err error) string {
	if IsUnauthorized(err) {
		return "Your session expired. Please sign in again."
	}
	if isUnprocessable(err) {
		return "Could not add that job. Provide a valid URL or paste the posting text."
	}
	return "Could not add the job. Please try again."
}

// createdMessage describes the created post, preferring its title/company and
// noting that scoring is still in progress when it is.
func createdMessage(r ManualJobResult) string {
	label := r.Title
	if r.Title != "" && r.Company != "" {
		label = r.Title + " — " + r.Company
	}
	if label == "" {
		label = "Job #" + strconv.Itoa(r.ID)
	}
	if r.ScoringStatus == "pending" || r.ScoringStatus == "" {
		return "Added " + label + ". It is being scored and will appear in your feed."
	}
	return "Added " + label + "."
}

// isUnprocessable reports whether err is an APIError carrying a 422, so the
// invalid-input path can surface a more specific message.
func isUnprocessable(err error) bool {
	var apiErr *APIError
	if !asAPIError(err, &apiErr) {
		return false
	}
	return apiErr.Status == 422
}
