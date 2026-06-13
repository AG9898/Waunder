package components

import (
	"context"
	"strconv"

	"github.com/maxence-charriere/go-app/v10/pkg/app"
)

// submitState tracks the explicit approve+submit lifecycle, separate from the
// draft fetch (loadState). The submit is never auto-fired: it advances out of
// submitIdle only on an explicit user click.
type submitState int

const (
	submitIdle submitState = iota
	submitSending
	submitDone
	submitError
)

// DraftReview renders a generated ApplicationDraft (resume emphasis, cover
// letter, structured answers, and the worker autofill preview) for review,
// then surfaces an explicit approve+submit action that POSTs to
// /api/applications/:id/submit. Approval is always an explicit user action;
// the component never submits on mount. The submit status and audit result
// (dispatched ATS) are surfaced after the action.
type DraftReview struct {
	app.Compo

	// Client is the Rails client; tests inject a mock and it defaults to the
	// same-origin HTTP client on mount.
	Client RailsClient
	// AppID is the application to review; normally parsed from the route path.
	AppID int

	state  loadState
	draft  ApplicationDraft
	err    string

	submit       submitState
	submitErr    string
	submitResult SubmitResult
}

func (r *DraftReview) OnMount(ctx app.Context)     { r.start(ctx) }
func (r *DraftReview) OnPreRender(ctx app.Context) { r.start(ctx) }

func (r *DraftReview) start(ctx app.Context) {
	if r.Client == nil {
		r.Client = NewRailsClient()
	}
	if id, ok := appIDFromPath(ctx.Page().URL().Path); ok {
		r.AppID = id
	}
	r.load(ctx)
}

// OnNav re-fetches when the route changes to a different application id while
// the component instance is reused.
func (r *DraftReview) OnNav(ctx app.Context) {
	if id, ok := appIDFromPath(ctx.Page().URL().Path); ok && id != r.AppID {
		r.AppID = id
		r.submit = submitIdle
		r.submitErr = ""
		r.submitResult = SubmitResult{}
		r.load(ctx)
	}
}

func (r *DraftReview) load(ctx app.Context) {
	r.state = loadLoading
	ctx.Update()
	id := r.AppID
	reqCtx := ctx.Context
	ctx.Async(func() {
		draft, err := r.Client.ApplicationDraft(reqCtx, id)
		ctx.Dispatch(func(ctx app.Context) {
			applyResult(ctx, &r.state, &r.err, err, func() { r.draft = draft })
		})
	})
}

// approveAndSubmit is the explicit user action: it submits the application for
// trusted dispatch. It is wired to the approve button's OnClick and runs only
// when the user clicks it — the screen never submits on mount or render.
func (r *DraftReview) approveAndSubmit(ctx app.Context, _ app.Event) {
	if r.submit == submitSending || r.submit == submitDone {
		return
	}
	r.submit = submitSending
	r.submitErr = ""
	ctx.Update()
	reqCtx := ctx.Context
	ctx.Async(func() {
		res, err := r.Client.SubmitApplication(reqCtx, r.AppID)
		ctx.Dispatch(func(ctx app.Context) {
			r.applySubmitResult(res, err)
			ctx.Update()
		})
	})
}

// applySubmitResult records the outcome of a submit attempt. Split out from the
// app.Context plumbing so the state transition and audit-surfacing logic is
// unit-testable without the go-app engine.
func (r *DraftReview) applySubmitResult(res SubmitResult, err error) {
	if err != nil {
		r.submit = submitError
		if IsUnauthorized(err) {
			r.submitErr = "Your session expired. Please sign in again."
		} else {
			r.submitErr = "Submit failed. Please try again."
		}
		return
	}
	r.submitResult = res
	r.submit = submitDone
}

// doSubmit performs the submit call and applies the result synchronously. It is
// the body invoked inside the async click handler; tests drive it directly to
// exercise the full submit path without the go-app engine.
func (r *DraftReview) doSubmit(ctx context.Context) {
	r.submit = submitSending
	res, err := r.Client.SubmitApplication(ctx, r.AppID)
	r.applySubmitResult(res, err)
}

func (r *DraftReview) Render() app.UI {
	return app.Div().Class("draft-review").Body(
		app.A().Class("draft-back").Href("/jobs").Text("← Jobs"),
		renderLoad(r.state, r.err, func() app.UI {
			d := r.draft
			return app.Div().Class("draft-body").Body(
				app.H1().Class("draft-title").Text(draftHeading(d)),
				app.If(d.Status != "", func() app.UI {
					return app.P().Class("draft-status").Text("Status: "+d.Status)
				}),
				app.If(d.ResumeEmphasis != "", func() app.UI {
					return app.Div().Class("draft-resume-emphasis").Body(
						app.H2().Text("Resume emphasis"),
						app.P().Text(d.ResumeEmphasis),
					)
				}),
				app.If(d.CoverLetter != "", func() app.UI {
					return app.Div().Class("draft-cover-letter").Body(
						app.H2().Text("Cover letter"),
						app.P().Text(d.CoverLetter),
					)
				}),
				answerList("Application answers", "draft-answers", d.StructuredAnswers),
				renderAutofill(d.Autofill),
				r.renderSubmit(),
			)
		}),
	)
}

// renderSubmit shows the explicit approve+submit control and its status/audit
// result. The button is the only path to submission.
func (r *DraftReview) renderSubmit() app.UI {
	return app.Div().Class("draft-submit").Body(
		app.H2().Text("Approve and submit"),
		app.P().Class("draft-submit-note").
			Text("Submitting dispatches a trusted automated submission. This is your explicit approval."),
		app.Button().
			Class("draft-submit-button").
			Disabled(r.submit == submitSending || r.submit == submitDone).
			OnClick(r.approveAndSubmit).
			Text(submitButtonLabel(r.submit)),
		app.If(r.submit == submitError, func() app.UI {
			return app.P().Class("draft-submit-error").Text(r.submitErr)
		}),
		app.If(r.submit == submitDone, func() app.UI {
			return app.P().Class("draft-submit-result").Text(submitResultLabel(r.submitResult))
		}),
	)
}

// --- render helpers ---

func answerList(heading, class string, answers []StructuredAnswer) app.UI {
	return app.If(len(answers) > 0, func() app.UI {
		return app.Div().Class(class).Body(
			app.H2().Text(heading),
			app.Ul().Body(
				app.Range(answers).Slice(func(i int) app.UI {
					a := answers[i]
					return app.Li().Class("draft-answer").Body(
						app.Span().Class("draft-answer-field").Text(a.Field),
						app.Span().Class("draft-answer-value").Text(a.Value),
					)
				}),
			),
		)
	})
}

func renderAutofill(af AutofillPreview) app.UI {
	return app.If(af.ATS != "" || af.ApplyURL != "" || len(af.Answers) > 0, func() app.UI {
		return app.Div().Class("draft-autofill").Body(
			app.H2().Text("Autofill preview"),
			app.If(af.ATS != "", func() app.UI {
				return app.P().Class("draft-autofill-ats").Text("ATS: "+af.ATS)
			}),
			app.If(af.ApplyURL != "", func() app.UI {
				return app.A().
					Class("draft-autofill-url").
					Href(af.ApplyURL).
					Target("_blank").
					Text(af.ApplyURL)
			}),
			answerList("Fields the worker will fill", "draft-autofill-answers", af.Answers),
		)
	})
}

// draftHeading renders a human heading for the draft, preferring the job
// title/company and falling back to the application id.
func draftHeading(d ApplicationDraft) string {
	if d.JobTitle != "" && d.Company != "" {
		return d.JobTitle + " — " + d.Company
	}
	if d.JobTitle != "" {
		return d.JobTitle
	}
	return "Application #" + strconv.Itoa(d.ApplicationID)
}

func submitButtonLabel(s submitState) string {
	switch s {
	case submitSending:
		return "Submitting…"
	case submitDone:
		return "Submitted"
	default:
		return "Approve and submit"
	}
}

// submitResultLabel surfaces the dispatch/audit result of a submit.
func submitResultLabel(res SubmitResult) string {
	if res.ATS != "" {
		return "Submitted: dispatched to " + res.ATS + "."
	}
	return "Submitted: application dispatched."
}

// appIDFromPath extracts the numeric application id from an
// "/applications/:id" path. It returns ok=false when the path does not match.
func appIDFromPath(path string) (int, bool) {
	const prefix = "/applications/"
	if len(path) <= len(prefix) || path[:len(prefix)] != prefix {
		return 0, false
	}
	id, err := strconv.Atoi(path[len(prefix):])
	if err != nil {
		return 0, false
	}
	return id, true
}
