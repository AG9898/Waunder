package components

import (
	"context"
	"strconv"
	"strings"

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

	state loadState
	draft ApplicationDraft
	err   string

	submit       submitState
	submitErr    string
	submitResult SubmitResult

	save    saveState
	saveErr string
	dirty   bool
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
		r.save = saveIdle
		r.saveErr = ""
		r.dirty = false
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
			applyResult(ctx, &r.state, &r.err, err, func() {
				r.draft = draft
				r.dirty = false
				r.save = saveIdle
				r.saveErr = ""
			})
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
	if !r.canSubmit() {
		return
	}
	r.submit = submitSending
	r.submitErr = ""
	ctx.Update()
	reqCtx := ctx.Context
	autofill := r.draft.Autofill
	dirty := r.dirty
	ctx.Async(func() {
		var saveErr error
		var draft ApplicationDraft
		if dirty {
			draft, saveErr = r.Client.UpdateApplicationDraft(reqCtx, r.AppID, autofill)
		}
		var res SubmitResult
		var err error
		canSubmitAfterSave := true
		if dirty && saveErr == nil {
			canSubmitAfterSave = draftReady(draft) && len(draft.AutofillWarnings) == 0
		}
		if saveErr == nil && canSubmitAfterSave {
			res, err = r.Client.SubmitApplication(reqCtx, r.AppID)
		}
		ctx.Dispatch(func(ctx app.Context) {
			if dirty {
				r.applySaveResult(draft, saveErr)
				if saveErr != nil {
					r.submit = submitError
					r.submitErr = previewSaveErrorStatus(saveErr)
					ctx.Update()
					return
				}
				if !canSubmitAfterSave {
					r.submit = submitError
					r.submitErr = blockedSubmitMessage(r.draft)
					ctx.Update()
					return
				}
			}
			r.applySubmitResult(res, err)
			ctx.Update()
		})
	})
}

func (r *DraftReview) savePreview(ctx app.Context, _ app.Event) {
	if r.save == saveSending || !r.dirty {
		return
	}
	r.save = saveSending
	r.saveErr = ""
	ctx.Update()
	reqCtx := ctx.Context
	autofill := r.draft.Autofill
	ctx.Async(func() {
		draft, err := r.Client.UpdateApplicationDraft(reqCtx, r.AppID, autofill)
		ctx.Dispatch(func(ctx app.Context) {
			r.applySaveResult(draft, err)
			ctx.Update()
		})
	})
}

func (r *DraftReview) applySaveResult(draft ApplicationDraft, err error) {
	if err != nil {
		r.save = saveError
		r.saveErr = previewSaveErrorStatus(err)
		return
	}
	r.draft = draft
	r.dirty = false
	r.save = saveDone
	r.saveErr = ""
}

func (r *DraftReview) doSavePreview(ctx context.Context) {
	r.save = saveSending
	draft, err := r.Client.UpdateApplicationDraft(ctx, r.AppID, r.draft.Autofill)
	r.applySaveResult(draft, err)
}

// applySubmitResult records the outcome of a submit attempt. Split out from the
// app.Context plumbing so the state transition and audit-surfacing logic is
// unit-testable without the go-app engine.
func (r *DraftReview) applySubmitResult(res SubmitResult, err error) {
	if err != nil {
		r.submit = submitError
		r.submitErr = submitErrorStatus(err)
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
	if r.dirty {
		draft, err := r.Client.UpdateApplicationDraft(ctx, r.AppID, r.draft.Autofill)
		r.applySaveResult(draft, err)
		if err != nil {
			r.submit = submitError
			r.submitErr = previewSaveErrorStatus(err)
			return
		}
	}
	if !r.canSubmit() {
		r.submit = submitError
		r.submitErr = blockedSubmitMessage(r.draft)
		return
	}
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
					return app.P().Class("draft-status").Text("Status: " + d.Status)
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
				r.renderAutofill(),
				renderWorkerReport(d),
				r.renderSubmit(),
			)
		}),
	)
}

// renderSubmit shows the explicit approve+submit control and its status/audit
// result. The button is the only path to submission.
func (r *DraftReview) renderSubmit() app.UI {
	ready := r.canSubmit()
	return app.Div().Class("draft-submit").Body(
		app.H2().Text("Approve and submit"),
		app.P().Class("draft-submit-note").
			Text(submitNote(r.draft)),
		app.Button().
			Class("draft-submit-button").
			Disabled(!ready || r.submit == submitSending || r.submit == submitDone).
			OnClick(r.approveAndSubmit).
			Text(submitButtonLabel(r.submit, r.draft, r.dirty)),
		app.If(r.submit == submitError, func() app.UI {
			return app.P().Class("draft-submit-error").Text(r.submitErr)
		}),
		app.If(r.submit == submitDone, func() app.UI {
			return app.P().Class("draft-submit-result").Text(submitResultLabel(r.submitResult))
		}),
	)
}

func (r *DraftReview) renderAutofill() app.UI {
	af := r.draft.Autofill
	return app.Div().Class("draft-autofill").Body(
		app.H2().Text("Autofill preview"),
		app.If(!autofillPresent(af), func() app.UI {
			return app.P().Class("draft-autofill-pending").Text("Preparing draft...")
		}),
		app.If(af.ATS != "", func() app.UI {
			return app.P().Class("draft-autofill-ats").Text("ATS: " + af.ATS)
		}),
		app.If(af.ApplyURL != "", func() app.UI {
			return app.A().
				Class("draft-autofill-url").
				Href(af.ApplyURL).
				Target("_blank").
				Text(af.ApplyURL)
		}),
		r.renderAutofillWarnings(),
		app.If(len(af.Answers) > 0, func() app.UI {
			return app.Form().Class("draft-autofill-form").OnSubmit(func(ctx app.Context, e app.Event) {
				e.PreventDefault()
				r.savePreview(ctx, e)
			}).Body(
				app.H2().Text("Fields the worker will fill"),
				app.Ul().Class("draft-autofill-answers").Body(
					app.Range(af.Answers).Slice(func(i int) app.UI {
						answer := af.Answers[i]
						warning, hasWarning := r.warningFor(answer.Field)
						return app.Li().Class("draft-autofill-answer").Body(
							app.Label().Class("draft-autofill-field").Body(
								app.Span().Class("draft-answer-field").Text(answer.Field),
								app.Textarea().
									Class("draft-autofill-value").
									Text(answer.Value).
									OnInput(r.answerValueSetter(i)),
							),
							app.If(hasWarning, func() app.UI {
								return app.P().Class("draft-autofill-warning").Text(warning.Message)
							}),
						)
					}),
				),
				app.Button().
					Class("draft-preview-save").
					Type("submit").
					Disabled(!r.dirty || r.save == saveSending).
					Text(previewSaveButtonLabel(r.save, r.dirty)),
				app.If(r.save == saveError, func() app.UI {
					return app.P().Class("draft-preview-error").Text(r.saveErr)
				}),
				app.If(r.save == saveDone && !r.dirty, func() app.UI {
					return app.P().Class("draft-preview-ok").Text("Preview saved.")
				}),
			)
		}),
	)
}

func (r *DraftReview) renderAutofillWarnings() app.UI {
	if len(r.draft.AutofillWarnings) == 0 {
		return nil
	}
	return app.Div().Class("draft-autofill-warnings").Body(
		app.Range(r.draft.AutofillWarnings).Slice(func(i int) app.UI {
			warning := r.draft.AutofillWarnings[i]
			return app.P().Class("draft-autofill-warning").Text(warning.Field + ": " + warning.Message)
		}),
	)
}

func (r *DraftReview) answerValueSetter(index int) app.EventHandler {
	return func(ctx app.Context, _ app.Event) {
		if index < 0 || index >= len(r.draft.Autofill.Answers) {
			return
		}
		r.draft.Autofill.Answers[index].Value = ctx.JSSrc().Get("value").String()
		r.dirty = true
		r.save = saveIdle
		r.saveErr = ""
		ctx.Update()
	}
}

func (r *DraftReview) warningFor(field string) (AutofillWarning, bool) {
	for _, warning := range r.draft.AutofillWarnings {
		if warning.Field == field {
			return warning, true
		}
	}
	return AutofillWarning{}, false
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

func submitButtonLabel(s submitState, draft ApplicationDraft, dirty bool) string {
	switch s {
	case submitSending:
		return "Submitting…"
	case submitDone:
		return "Submitted"
	default:
		if !draftReady(draft) {
			return "Preparing draft..."
		}
		if len(draft.AutofillWarnings) > 0 {
			return "Manual review required"
		}
		if dirty {
			return "Save and submit"
		}
		return "Approve and submit"
	}
}

func previewSaveButtonLabel(state saveState, dirty bool) string {
	switch state {
	case saveSending:
		return "Saving..."
	case saveDone:
		if !dirty {
			return "Saved"
		}
	}
	if dirty {
		return "Save preview"
	}
	return "Preview saved"
}

func submitNote(draft ApplicationDraft) string {
	if !draftReady(draft) {
		return "The draft is still being prepared."
	}
	if len(draft.AutofillWarnings) > 0 {
		return "This application has fields that need manual review before trusted auto-submit."
	}
	return "Submitting dispatches a trusted automated submission. This is your explicit approval."
}

func submitErrorStatus(err error) string {
	if IsUnauthorized(err) {
		return "Your session expired. Please sign in again."
	}
	switch APIErrorCode(err) {
	case "draft_required":
		return "The draft is still being prepared. Try again in a moment."
	case "unsafe_payload":
		return "Manual review is required before auto-submit."
	case "unsupported_ats":
		return "Auto-submit is not supported for this application route."
	case "invalid_payload":
		return "The autofill preview needs review before submit."
	default:
		return "Submit failed. Please try again."
	}
}

func blockedSubmitMessage(draft ApplicationDraft) string {
	if len(draft.AutofillWarnings) > 0 {
		return "Manual review is required before auto-submit."
	}
	return "The draft is still being prepared. Try again in a moment."
}

func previewSaveErrorStatus(err error) string {
	if IsUnauthorized(err) {
		return "Your session expired. Please sign in again."
	}
	return "Could not save the autofill preview. Please try again."
}

func (r *DraftReview) canSubmit() bool {
	return draftReady(r.draft) && len(r.draft.AutofillWarnings) == 0
}

func draftReady(draft ApplicationDraft) bool {
	if !draft.DraftReady {
		return false
	}
	if !autofillReady(draft.Autofill) {
		return false
	}
	for _, answer := range draft.Autofill.Answers {
		if strings.TrimSpace(answer.Field) == "" || strings.TrimSpace(answer.Value) == "" {
			return false
		}
	}
	return true
}

func autofillReady(af AutofillPreview) bool {
	return strings.TrimSpace(af.ATS) != "" &&
		strings.TrimSpace(af.ApplyURL) != "" &&
		len(af.Answers) > 0
}

func autofillPresent(af AutofillPreview) bool {
	return strings.TrimSpace(af.ATS) != "" ||
		strings.TrimSpace(af.ApplyURL) != "" ||
		len(af.Answers) > 0
}

func renderWorkerReport(draft ApplicationDraft) app.UI {
	report := draft.WorkerReport
	return app.If((draft.Status == "paused" || draft.Status == "failed") && (draft.FailureReason != "" || report != nil), func() app.UI {
		return app.Div().Class("draft-worker-report").Body(
			app.H2().Text("Submit result"),
			app.If(draft.FailureReason != "", func() app.UI {
				return app.P().Class("draft-worker-reason").Text(draft.FailureReason)
			}),
			app.If(report != nil && report.Reason != "" && report.Reason != draft.FailureReason, func() app.UI {
				return app.P().Class("draft-worker-reason").Text(report.Reason)
			}),
			app.If(report != nil && len(report.Logs) > 0, func() app.UI {
				return app.Ul().Class("draft-worker-logs").Body(
					app.Range(report.Logs).Slice(func(i int) app.UI {
						return app.Li().Text(report.Logs[i])
					}),
				)
			}),
			app.If(report != nil && len(report.Screenshots) > 0, func() app.UI {
				return app.Ul().Class("draft-worker-screenshots").Body(
					app.Range(report.Screenshots).Slice(func(i int) app.UI {
						ref := report.Screenshots[i]
						return app.Li().Text(ref)
					}),
				)
			}),
		)
	})
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
