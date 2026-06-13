package components

import (
	"context"
	"strconv"

	"github.com/maxence-charriere/go-app/v10/pkg/app"
)

// generateState tracks the per-candidate outreach-draft generation lifecycle.
// It always starts at generateIdle and only advances out of it on an explicit
// user click — the screen never generates or sends on mount/render.
type generateState int

const (
	generateIdle generateState = iota
	generateRunning
	generateDone
	generateError
)

// ContactsView renders the saved ContactCandidates for a job and lets the user
// generate an outreach draft per candidate ON DEMAND. Outreach is PREFILLED FOR
// MANUAL SENDING ONLY: the screen exposes no send action and never contacts
// anyone — generating a draft only returns drafted text that the user copies
// and sends themselves. Generation is always an explicit user click; the
// component never generates on mount or render.
type ContactsView struct {
	app.Compo

	// Client is the Rails client; tests inject a mock and it defaults to the
	// same-origin HTTP client on mount.
	Client RailsClient
	// JobID is the job whose contacts are shown; normally parsed from the path.
	JobID int

	state    loadState
	contacts []ContactCandidate
	err      string

	// gen holds the per-candidate generation state, keyed by candidate id.
	gen map[int]*outreachGen
}

// outreachGen is the per-candidate generation state: the lifecycle phase, the
// loose template the user typed, the resulting draft, and any error message.
type outreachGen struct {
	state    generateState
	template string
	draft    OutreachDraft
	errMsg   string
}

func (v *ContactsView) OnMount(ctx app.Context)     { v.start(ctx) }
func (v *ContactsView) OnPreRender(ctx app.Context) { v.start(ctx) }

func (v *ContactsView) start(ctx app.Context) {
	if v.Client == nil {
		v.Client = NewRailsClient()
	}
	if v.gen == nil {
		v.gen = map[int]*outreachGen{}
	}
	if id, ok := contactsJobIDFromPath(ctx.Page().URL().Path); ok {
		v.JobID = id
	}
	v.load(ctx)
}

// OnNav re-fetches when the route changes to a different job id while the
// component instance is reused.
func (v *ContactsView) OnNav(ctx app.Context) {
	if id, ok := contactsJobIDFromPath(ctx.Page().URL().Path); ok && id != v.JobID {
		v.JobID = id
		v.gen = map[int]*outreachGen{}
		v.load(ctx)
	}
}

func (v *ContactsView) load(ctx app.Context) {
	v.state = loadLoading
	ctx.Update()
	id := v.JobID
	reqCtx := ctx.Context
	ctx.Async(func() {
		contacts, err := v.Client.Contacts(reqCtx, id)
		ctx.Dispatch(func(ctx app.Context) {
			applyResult(ctx, &v.state, &v.err, err, func() { v.contacts = contacts })
		})
	})
}

// genFor returns (and lazily creates) the generation state for a candidate.
func (v *ContactsView) genFor(candidateID int) *outreachGen {
	if v.gen == nil {
		v.gen = map[int]*outreachGen{}
	}
	g, ok := v.gen[candidateID]
	if !ok {
		g = &outreachGen{}
		v.gen[candidateID] = g
	}
	return g
}

// onTemplateInput records the loose template the user typed for a candidate.
// It writes only local state; nothing is sent anywhere.
func (v *ContactsView) onTemplateInput(candidateID int) func(ctx app.Context, e app.Event) {
	return func(ctx app.Context, e app.Event) {
		v.genFor(candidateID).template = ctx.JSSrc().Get("value").String()
	}
}

// generate is the explicit per-candidate user action wired to the "Generate
// draft" button's OnClick. It runs ONLY when the user clicks it and only ever
// drafts a message for manual sending — it never sends outreach.
func (v *ContactsView) generate(candidateID int) func(ctx app.Context, e app.Event) {
	return func(ctx app.Context, e app.Event) {
		g := v.genFor(candidateID)
		if g.state == generateRunning {
			return
		}
		tmpl := g.template
		g.state = generateRunning
		g.errMsg = ""
		ctx.Update()
		reqCtx := ctx.Context
		ctx.Async(func() {
			draft, err := v.Client.GenerateOutreach(reqCtx, candidateID, tmpl)
			ctx.Dispatch(func(ctx app.Context) {
				applyGenerateResult(g, draft, err)
				ctx.Update()
			})
		})
	}
}

// doGenerate is the body of the generate click handler, taking only a plain
// context so the full generate path is unit-testable without the go-app engine.
func (v *ContactsView) doGenerate(ctx context.Context, candidateID string, looseTemplate string) {
	id, err := strconv.Atoi(candidateID)
	if err != nil {
		return
	}
	g := v.genFor(id)
	g.template = looseTemplate
	g.state = generateRunning
	draft, callErr := v.Client.GenerateOutreach(ctx, id, looseTemplate)
	applyGenerateResult(g, draft, callErr)
}

// applyGenerateResult records the outcome of a generate attempt. Split out from
// the app.Context plumbing so the state transition is unit-testable. It maps the
// LLM-unavailable / generic failure responses to user-facing messages.
func applyGenerateResult(g *outreachGen, draft OutreachDraft, err error) {
	if err != nil {
		g.state = generateError
		switch {
		case IsUnauthorized(err):
			g.errMsg = "Your session expired. Please sign in again."
		case isServiceUnavailable(err):
			g.errMsg = "Outreach drafting is not configured right now."
		default:
			g.errMsg = "Could not generate a draft. Please try again."
		}
		return
	}
	g.draft = draft
	g.state = generateDone
}

func (v *ContactsView) Render() app.UI {
	return app.Div().Class("contacts-view").Body(
		app.A().Class("contacts-back").Href(v.backHref()).Text("← Job"),
		app.H1().Class("contacts-title").Text("Contacts"),
		app.P().Class("contacts-note").
			Text("Outreach drafts are prefilled for manual sending only. Copy a draft and send it yourself — Waunder never sends messages for you."),
		renderLoad(v.state, v.err, func() app.UI {
			if len(v.contacts) == 0 {
				return app.P().Class("contacts-empty").Text("No contacts yet.")
			}
			return app.Ul().Class("contacts-list").Body(
				app.Range(v.contacts).Slice(func(i int) app.UI {
					return v.renderContact(v.contacts[i])
				}),
			)
		}),
	)
}

// renderContact renders one candidate and its outreach draft chrome (the loose
// template input, the explicit generate button, and the drafted message with a
// copy affordance). There is deliberately no send control anywhere here.
func (v *ContactsView) renderContact(c ContactCandidate) app.UI {
	g := v.genFor(c.ID)
	return app.Li().Class("contact").Body(
		app.P().Class("contact-name").Text(c.Name),
		app.If(c.Title != "" || c.CompanyName != "", func() app.UI {
			return app.P().Class("contact-role").Text(contactRole(c))
		}),
		app.If(c.RelevanceReason != "", func() app.UI {
			return app.P().Class("contact-relevance").Text(c.RelevanceReason)
		}),
		app.If(c.LinkedInURL != "", func() app.UI {
			return app.A().
				Class("contact-linkedin").
				Href(c.LinkedInURL).
				Target("_blank").
				Text("LinkedIn profile")
		}),
		v.renderOutreach(c, g),
	)
}

// renderOutreach renders the per-candidate outreach controls: a loose template
// field, the explicit generate button, and (once drafted) the message in a
// read-only textarea with a copy button. Manual-send only — no send action.
func (v *ContactsView) renderOutreach(c ContactCandidate, g *outreachGen) app.UI {
	return app.Div().Class("contact-outreach").Body(
		app.Textarea().
			Class("contact-outreach-template").
			Placeholder("Optional: notes or a loose template for the draft").
			Text(g.template).
			OnInput(v.onTemplateInput(c.ID)),
		app.Button().
			Class("contact-outreach-generate").
			Type("button").
			Disabled(g.state == generateRunning).
			OnClick(v.generate(c.ID)).
			Text(generateButtonLabel(g.state)),
		app.If(g.state == generateError, func() app.UI {
			return app.P().Class("contact-outreach-error").Text(g.errMsg)
		}),
		app.If(g.state == generateDone, func() app.UI {
			return app.Div().Class("contact-outreach-draft").Body(
				app.P().Class("contact-outreach-manual").
					Text("Copy this draft and send it manually. Waunder does not send it."),
				app.Textarea().
					Class("contact-outreach-message").
					ReadOnly(true).
					Text(g.draft.Message),
				app.Button().
					Class("contact-outreach-copy").
					Type("button").
					OnClick(copyToClipboard(g.draft.Message)).
					Text("Copy draft"),
			)
		}),
	)
}

func (v *ContactsView) backHref() string {
	if v.JobID > 0 {
		return "/jobs/" + strconv.Itoa(v.JobID)
	}
	return "/jobs"
}

// --- pure helpers (unit-tested without the engine) ---

// contactRole renders the "Title at Company" line for a candidate, omitting the
// pieces that are blank.
func contactRole(c ContactCandidate) string {
	switch {
	case c.Title != "" && c.CompanyName != "":
		return c.Title + " at " + c.CompanyName
	case c.Title != "":
		return c.Title
	default:
		return c.CompanyName
	}
}

// copyToClipboard returns an OnClick handler that copies the drafted message to
// the browser clipboard via the navigator.clipboard API. This is a copy
// affordance only — it never sends the message. On the server build go-app's JS
// shim makes the call inert, so render tests exercise the handler safely.
func copyToClipboard(text string) func(ctx app.Context, e app.Event) {
	return func(ctx app.Context, e app.Event) {
		clipboard := app.Window().Get("navigator").Get("clipboard")
		if clipboard.Truthy() {
			clipboard.Call("writeText", text)
		}
	}
}

func generateButtonLabel(s generateState) string {
	switch s {
	case generateRunning:
		return "Generating…"
	case generateDone:
		return "Regenerate draft"
	default:
		return "Generate draft"
	}
}

// isServiceUnavailable reports whether err is an APIError carrying a 503, which
// Rails returns when outreach generation (the LLM) is not configured.
func isServiceUnavailable(err error) bool {
	var apiErr *APIError
	if !asAPIError(err, &apiErr) {
		return false
	}
	return apiErr.Status == 503
}

// contactsJobIDFromPath extracts the job id from a "/jobs/:id/contacts" path.
// It returns ok=false when the path does not match.
func contactsJobIDFromPath(path string) (int, bool) {
	const prefix = "/jobs/"
	const suffix = "/contacts"
	if len(path) <= len(prefix)+len(suffix) {
		return 0, false
	}
	if path[:len(prefix)] != prefix || path[len(path)-len(suffix):] != suffix {
		return 0, false
	}
	id, err := strconv.Atoi(path[len(prefix) : len(path)-len(suffix)])
	if err != nil {
		return 0, false
	}
	return id, true
}
