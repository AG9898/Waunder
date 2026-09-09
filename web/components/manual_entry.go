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

// lookupState tracks the posting-metadata lookup that prefills title, company,
// and posting text. Like the submit, it only leaves lookupIdle on an explicit
// user action (committing the URL field, or pressing Look up) — never on mount.
type lookupState int

const (
	lookupIdle lookupState = iota
	lookupRunning
	lookupDone
	lookupFailed
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

	url            string
	applicationURL string
	text           string
	title          string
	company        string

	// Set once the owner types in a prefillable field, so a later lookup never
	// overwrites what they wrote themselves.
	titleTouched   bool
	companyTouched bool
	textTouched    bool

	// lookedUpURL is the URL the last lookup ran against, so committing the
	// field again without changing it does not refetch.
	lookedUpURL string
	lookupState lookupState
	lookupNote  string

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

func (m *ManualEntry) onApplicationURLInput(ctx app.Context, _ app.Event) {
	m.applicationURL = ctx.JSSrc().Get("value").String()
}

func (m *ManualEntry) onTextInput(ctx app.Context, _ app.Event) {
	m.text = ctx.JSSrc().Get("value").String()
	m.textTouched = true
}

func (m *ManualEntry) onTitleInput(ctx app.Context, _ app.Event) {
	m.title = ctx.JSSrc().Get("value").String()
	m.titleTouched = true
}

func (m *ManualEntry) onCompanyInput(ctx app.Context, _ app.Event) {
	m.company = ctx.JSSrc().Get("value").String()
	m.companyTouched = true
}

// onURLChange fires when the URL field is committed (blur or Enter). Reading
// the posting there means the common case — paste a link, move on — prefills
// itself without an extra tap.
func (m *ManualEntry) onURLChange(ctx app.Context, _ app.Event) {
	m.url = ctx.JSSrc().Get("value").String()
	m.startLookup(ctx, false)
}

// lookup is the explicit Look up button, which refetches even when the URL has
// not changed since the last attempt.
func (m *ManualEntry) lookup(ctx app.Context, _ app.Event) {
	m.startLookup(ctx, true)
}

// startLookup reads the posting behind the current URL and prefills the form
// from it. It is a no-op without a URL, and skips a repeat fetch of a URL it
// already read unless the owner asked again.
func (m *ManualEntry) startLookup(ctx app.Context, forced bool) {
	url := strings.TrimSpace(m.url)
	if url == "" || m.lookupState == lookupRunning {
		return
	}
	if !forced && url == m.lookedUpURL {
		return
	}

	m.lookupState = lookupRunning
	m.lookupNote = ""
	ctx.Update()

	reqCtx := ctx.Context
	ctx.Async(func() {
		res, err := m.Client.LookupPosting(reqCtx, url)
		ctx.Dispatch(func(ctx app.Context) {
			m.applyLookupResult(url, res, err)
			ctx.Update()
		})
	})
}

// doLookup performs the lookup and applies the result synchronously. It is the
// body invoked inside the async handler; tests drive it directly to exercise
// the prefill without the go-app engine.
func (m *ManualEntry) doLookup(ctx context.Context) {
	url := strings.TrimSpace(m.url)
	if url == "" {
		return
	}
	m.lookupState = lookupRunning
	res, err := m.Client.LookupPosting(ctx, url)
	m.applyLookupResult(url, res, err)
}

// applyLookupResult prefills the fields the owner has not typed in themselves.
// A posting Rails could not read is not an error state for the form — the
// fields simply stay empty and the owner fills them in by hand.
func (m *ManualEntry) applyLookupResult(url string, res PostingLookup, err error) {
	m.lookedUpURL = url
	if err != nil {
		m.lookupState = lookupFailed
		m.lookupNote = lookupErrorNote(err)
		return
	}
	if !res.OK() {
		m.lookupState = lookupFailed
		m.lookupNote = "Could not read that posting. Add the title and company yourself."
		return
	}

	filled := make([]string, 0, 3)
	if res.Title != "" && !m.titleTouched {
		m.title = res.Title
		filled = append(filled, "title")
	}
	if res.Company != "" && !m.companyTouched {
		m.company = res.Company
		filled = append(filled, "company")
	}
	if res.Description != "" && !m.textTouched && strings.TrimSpace(m.text) == "" {
		m.text = res.Description
		filled = append(filled, "posting text")
	}

	m.lookupState = lookupDone
	if len(filled) == 0 {
		m.lookupNote = "Read the listing; your entries were kept."
		return
	}
	m.lookupNote = "Filled in " + joinFields(filled) + " from the listing."
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
		URL:            strings.TrimSpace(m.url),
		ApplicationURL: strings.TrimSpace(m.applicationURL),
		Text:           strings.TrimSpace(m.text),
		Title:          strings.TrimSpace(m.title),
		Company:        strings.TrimSpace(m.company),
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
		renderAppTabs("jobs"),
		app.A().Class("manual-entry-back").Href("/jobs").Text("← Jobs"),
		app.H1().Text("Import a job"),
		app.P().Class("manual-entry-note").
			Text("Paste a listing link and the title, company, and description are read from the posting. Add an external application link when you have one."),
		app.Form().Class("manual-entry-form").OnSubmit(m.submit).Body(
			app.Label().Class("manual-entry-label").Body(
				app.Span().Text("Job URL"),
				app.Input().
					Class("manual-entry-url").
					Type("url").
					Placeholder("https://…").
					Value(m.url).
					OnInput(m.onURLInput).
					OnChange(m.onURLChange),
			),
			m.renderLookup(),
			app.Label().Class("manual-entry-label").Body(
				app.Span().Text("Title"),
				app.Input().
					Class("manual-entry-title").
					Type("text").
					Value(m.title).
					OnInput(m.onTitleInput),
			),
			app.Label().Class("manual-entry-label").Body(
				app.Span().Text("Company"),
				app.Input().
					Class("manual-entry-company").
					Type("text").
					Value(m.company).
					OnInput(m.onCompanyInput),
			),
			app.Label().Class("manual-entry-label").Body(
				app.Span().Text("External application URL (optional)"),
				app.Input().
					Class("manual-entry-application-url").
					Type("url").
					Placeholder("https://careers.example.com/apply").
					Value(m.applicationURL).
					OnInput(m.onApplicationURLInput),
			),
			app.Label().Class("manual-entry-label").Body(
				app.Span().Text("Posting text"),
				app.Textarea().
					Class("manual-entry-text").
					Placeholder("Paste the job description…").
					Text(m.text).
					OnInput(m.onTextInput),
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

// renderLookup is the read-the-posting control that sits under the URL field:
// an explicit retry button plus the outcome of the last lookup. Prefilling is
// advisory — the fields stay editable and the form submits fine without it.
func (m *ManualEntry) renderLookup() app.UI {
	return app.Div().Class("manual-entry-lookup").Body(
		app.Button().
			Class("manual-entry-lookup-button").
			Type("button").
			Disabled(m.lookupState == lookupRunning || strings.TrimSpace(m.url) == "").
			OnClick(m.lookup).
			Text(lookupButtonLabel(m.lookupState)),
		app.If(m.lookupNote != "", func() app.UI {
			return app.P().Class(lookupNoteClass(m.lookupState)).Text(m.lookupNote)
		}),
	)
}

// renderResult confirms the created job and links to its detail, so the user
// can follow the new post into the feed once Rails finishes scoring it.
func (m *ManualEntry) renderResult() app.UI {
	r := m.result
	return app.Div().Class("manual-entry-result").Body(
		app.P().Class("manual-entry-result-msg").Text(importMessage(r)),
		app.A().
			Class("manual-entry-result-link").
			Href("/jobs/"+strconv.Itoa(r.ID)).
			Text(importLinkLabel(r)),
	)
}

// --- helpers ---

func lookupButtonLabel(s lookupState) string {
	if s == lookupRunning {
		return "Reading posting…"
	}
	return "Look up details"
}

func lookupNoteClass(s lookupState) string {
	if s == lookupFailed {
		return "manual-entry-lookup-warning"
	}
	return "manual-entry-lookup-note"
}

// lookupErrorNote keeps a failed lookup non-blocking: the only actionable case
// is an expired session, and everything else falls back to typing the fields.
func lookupErrorNote(err error) string {
	if IsUnauthorized(err) {
		return "Your session expired. Please sign in again."
	}
	return "Could not read that posting. Add the title and company yourself."
}

// joinFields renders a short list as prose ("title and company").
func joinFields(fields []string) string {
	switch len(fields) {
	case 0:
		return ""
	case 1:
		return fields[0]
	case 2:
		return fields[0] + " and " + fields[1]
	default:
		return strings.Join(fields[:len(fields)-1], ", ") + ", and " + fields[len(fields)-1]
	}
}

func entryButtonLabel(s entryState) string {
	if s == entrySubmitting {
		return "Importing…"
	}
	return "Import job"
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

const (
	manualImportNew              = "new"
	manualImportAlreadyTracked   = "already_tracked"
	manualImportAlreadySubmitted = "already_submitted"
	manualImportPossibleMatch    = "possible_match"
)

// importMessage renders the outcome Rails reported without inferring whether a
// record is a duplicate. A possible-match status is supported as a non-blocking
// review state should Rails surface one later.
func importMessage(r ManualJobResult) string {
	label := r.Title
	if r.Title != "" && r.Company != "" {
		label = r.Title + " — " + r.Company
	}
	if label == "" {
		label = "Job #" + strconv.Itoa(r.ID)
	}
	switch r.Import.Status {
	case manualImportAlreadyTracked:
		if r.Import.ApplicationStatus != "" {
			return "Already tracked: " + label + ". Current application status: " + r.Import.ApplicationStatus + "."
		}
		return "Already tracked: " + label + "."
	case manualImportAlreadySubmitted:
		return "Already submitted: " + label + "."
	case manualImportPossibleMatch:
		return "Possible match: " + label + ". Review the existing job before importing another."
	}
	if r.ScoringStatus == "pending" || r.ScoringStatus == "" {
		return "Imported " + label + ". It is being scored and will appear in your feed."
	}
	return "Imported " + label + "."
}

func importLinkLabel(r ManualJobResult) string {
	switch r.Import.Status {
	case manualImportAlreadyTracked:
		return "View tracked job"
	case manualImportAlreadySubmitted:
		return "View submitted job"
	case manualImportPossibleMatch:
		return "Review possible match"
	default:
		return "View job"
	}
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
