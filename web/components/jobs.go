package components

import (
	"context"
	"strconv"

	"github.com/maxence-charriere/go-app/v10/pkg/app"
)

// loadState tracks the async fetch lifecycle shared by the data screens.
type loadState int

const (
	loadIdle loadState = iota
	loadLoading
	loadDone
	loadError
)

const sessionExpiredMessage = "Your session expired. Please sign in again."

// JobList renders the scored job feed (GET /api/job_posts). Each row links to
// the job detail screen. Scored fields are owned by Rails; this screen only
// renders them.
type JobList struct {
	app.Compo

	// Client is the Rails client; tests inject a mock and it defaults to the
	// same-origin HTTP client on mount.
	Client RailsClient

	state loadState
	jobs  []JobSummary
	err   string
}

func (j *JobList) OnMount(ctx app.Context)     { j.ensureClient(); j.load(ctx) }
func (j *JobList) OnPreRender(ctx app.Context) { j.ensureClient(); j.load(ctx) }

func (j *JobList) ensureClient() {
	if j.Client == nil {
		j.Client = NewRailsClient()
	}
}

func (j *JobList) load(ctx app.Context) {
	j.state = loadLoading
	ctx.Update()
	reqCtx := ctx.Context
	ctx.Async(func() {
		jobs, err := j.Client.Jobs(reqCtx)
		ctx.Dispatch(func(ctx app.Context) {
			applyResult(ctx, &j.state, &j.err, err, func() { j.jobs = jobs })
		})
	})
}

func (j *JobList) Render() app.UI {
	return app.Div().Class("job-list").Body(
		renderAppTabs("jobs"),
		app.H1().Text("Jobs"),
		renderLoad(j.state, j.err, func() app.UI {
			if len(j.jobs) == 0 {
				return app.P().Class("job-list-empty").Text("No jobs yet.")
			}
			return app.Ul().Class("job-list-items").Body(
				app.Range(j.jobs).Slice(func(i int) app.UI {
					job := j.jobs[i]
					return app.Li().Class("job-list-item").Body(
						app.A().
							Class("job-list-link").
							Href("/jobs/"+strconv.Itoa(job.ID)).
							Body(
								app.Span().Class("job-title").Text(job.Title),
								app.Span().Class("job-company").Text(job.Company),
								app.If(SourceLabel(job.Source) != "", func() app.UI {
									return app.Span().Class("job-source").Body(
										sourceIcon(job.Source),
										app.Text(SourceLabel(job.Source)),
									)
								}),
								app.Span().
									Class("job-score").
									Class("job-score--"+MatchScoreBand(job.MatchScore, job.ScoringStatus)).
									Text(MatchScoreLabel(job.MatchScore, job.ScoringStatus)),
							),
					)
				}),
			)
		}),
	)
}

// JobDetailView renders the full scored view of a single job: summary, match
// score, relevant/missing requirements, red flags, alignment notes, and the
// resolved application route (GET /api/job_posts/:id).
type JobDetailView struct {
	app.Compo

	// Client is the Rails client; tests inject a mock.
	Client RailsClient
	// JobID is the job to render; normally parsed from the route path.
	JobID int

	state loadState
	job   JobDetail
	err   string

	applyState applyStatus
	applyErr   string

	statusSaving bool
	statusErr    string
}

// applyStatus tracks the explicit "start application" action, separate from the
// job fetch (loadState). It never fires on mount: it advances out of applyIdle
// only on an explicit user click of the apply button.
type applyStatus int

const (
	applyIdle applyStatus = iota
	applyCreating
	applyError
)

func (d *JobDetailView) OnMount(ctx app.Context)     { d.start(ctx) }
func (d *JobDetailView) OnPreRender(ctx app.Context) { d.start(ctx) }

func (d *JobDetailView) start(ctx app.Context) {
	if d.Client == nil {
		d.Client = NewRailsClient()
	}
	if id, ok := jobIDFromPath(ctx.Page().URL().Path); ok {
		d.JobID = id
	}
	d.load(ctx)
}

// OnNav re-fetches when the route changes to a different job id while the
// component instance is reused.
func (d *JobDetailView) OnNav(ctx app.Context) {
	if id, ok := jobIDFromPath(ctx.Page().URL().Path); ok && id != d.JobID {
		d.JobID = id
		d.load(ctx)
	}
}

func (d *JobDetailView) load(ctx app.Context) {
	d.state = loadLoading
	ctx.Update()
	id := d.JobID
	reqCtx := ctx.Context
	ctx.Async(func() {
		job, err := d.Client.Job(reqCtx, id)
		ctx.Dispatch(func(ctx app.Context) {
			applyResult(ctx, &d.state, &d.err, err, func() { d.job = job })
		})
	})
}

// apply is the explicit user action that starts an application for this job: it
// asks Rails to create (or reuse) an Application and generate a draft, then
// navigates to the draft-review screen where the user approves and submits. It
// runs only on an explicit click — the screen never starts an application on
// mount or render.
func (d *JobDetailView) apply(ctx app.Context, _ app.Event) {
	if d.applyState == applyCreating {
		return
	}
	d.applyState = applyCreating
	d.applyErr = ""
	ctx.Update()
	reqCtx := ctx.Context
	id := d.JobID
	ctx.Async(func() {
		res, err := d.Client.CreateApplication(reqCtx, id)
		ctx.Dispatch(func(ctx app.Context) {
			if appID, ok := d.applyCreateResult(res, err); ok {
				ctx.Navigate("/applications/" + strconv.Itoa(appID))
				return
			}
			ctx.Update()
		})
	})
}

// doApply performs the create-application call and applies the result
// synchronously. It is the body invoked inside the async click handler; tests
// drive it directly to exercise the path without the go-app engine.
func (d *JobDetailView) doApply(ctx context.Context) (int, bool) {
	d.applyState = applyCreating
	res, err := d.Client.CreateApplication(ctx, d.JobID)
	return d.applyCreateResult(res, err)
}

// applyCreateResult records the outcome of an apply attempt. It returns the new
// application id and ok=true when the caller should navigate to the review
// screen. Split out from the app.Context plumbing so the state transition is
// unit-testable without the go-app engine.
func (d *JobDetailView) applyCreateResult(res CreateApplicationResult, err error) (int, bool) {
	if err != nil {
		d.applyState = applyError
		if IsUnauthorized(err) {
			d.applyErr = sessionExpiredMessage
		} else {
			d.applyErr = "Could not start the application. Please try again."
		}
		return 0, false
	}
	d.applyState = applyIdle
	return res.ApplicationID, true
}

func (d *JobDetailView) Render() app.UI {
	return app.Div().Class("job-detail").Body(
		app.A().Class("job-detail-back").Href("/jobs").Text("← Jobs"),
		renderLoad(d.state, d.err, func() app.UI {
			job := d.job
			return app.Div().Class("job-detail-body").Body(
				app.H1().Class("job-title").Text(job.Title),
				app.P().Class("job-company").Text(job.Company),
				app.If(SourceLabel(job.Source) != "", func() app.UI {
					return app.P().Class("job-source").Body(
						sourceIcon(job.Source),
						app.Text("Source: "+SourceLabel(job.Source)),
					)
				}),
				app.If(job.Compensation != "", func() app.UI {
					return app.P().Class("job-compensation").Text(job.Compensation)
				}),
				app.P().
					Class("job-score").
					Class("job-score--"+MatchScoreBand(job.MatchScore, job.ScoringStatus)).
					Text("Match: "+MatchScoreLabel(job.MatchScore, job.ScoringStatus)),
				app.If(job.Summary != "", func() app.UI {
					return app.P().Class("job-summary").Text(job.Summary)
				}),
				requirementList("Relevant requirements", "job-relevant", job.RelevantRequirements),
				requirementList("Missing requirements", "job-missing", job.MissingRequirements),
				requirementList("Red flags", "job-red-flags", job.RedFlags),
				app.If(job.ResumeAlignment != "", func() app.UI {
					return app.P().Class("job-alignment").Text(job.ResumeAlignment)
				}),
				app.If(job.ApplicationStrategy != "", func() app.UI {
					return app.P().Class("job-strategy").Text(job.ApplicationStrategy)
				}),
				renderRoute(job.Route),
				d.renderPipelineStatus(job.Application),
				d.renderApply(),
				app.A().
					Class("job-contacts-link").
					Href("/jobs/"+strconv.Itoa(job.ID)+"/contacts").
					Text("View contacts and outreach"),
			)
		}),
	)
}

func (d *JobDetailView) renderPipelineStatus(application *ApplicationTracker) app.UI {
	status := "interested"
	stage := ""
	if application != nil {
		status = application.PipelineStatus
		stage = application.PipelineStage
	}
	return app.Div().Class("job-pipeline-status").Body(
		app.H2().Text("Application status"),
		app.Label().Class("pipeline-select-label").Body(
			app.Span().Text("Status"),
			app.Select().
				Class("pipeline-status-select").
				OnChange(d.jobStatusSetter(stage)).
				Body(pipelineStatusOptions(status)...),
		),
		app.Label().Class("pipeline-select-label").Body(
			app.Span().Text("Stage"),
			app.Select().
				Class("pipeline-stage-select").
				OnChange(d.jobStageSetter(status)).
				Body(pipelineStageOptions(stage)...),
		),
		app.If(d.statusSaving, func() app.UI {
			return app.P().Class("job-pipeline-saving").Text("Saving…")
		}),
		app.If(d.statusErr != "", func() app.UI {
			return app.P().Class("job-pipeline-error").Text(d.statusErr)
		}),
	)
}

func (d *JobDetailView) jobStatusSetter(_ string) app.EventHandler {
	return func(ctx app.Context, _ app.Event) {
		next := ctx.JSSrc().Get("value").String()
		d.saveJobPipelineStatus(ctx, ApplicationStatusUpdate{PipelineStatus: next})
	}
}

func (d *JobDetailView) jobStageSetter(status string) app.EventHandler {
	return func(ctx app.Context, _ app.Event) {
		next := ctx.JSSrc().Get("value").String()
		if status == "" {
			status = "interested"
		}
		d.saveJobPipelineStatus(ctx, ApplicationStatusUpdate{PipelineStatus: status, PipelineStage: next})
	}
}

func (d *JobDetailView) saveJobPipelineStatus(ctx app.Context, update ApplicationStatusUpdate) {
	if d.statusSaving {
		return
	}
	d.statusSaving = true
	d.statusErr = ""
	ctx.Update()
	reqCtx := ctx.Context
	id := d.JobID
	ctx.Async(func() {
		application, err := d.Client.UpdateJobApplicationStatus(reqCtx, id, update)
		ctx.Dispatch(func(ctx app.Context) {
			d.applyJobStatusResult(application, err)
			ctx.Update()
		})
	})
}

func (d *JobDetailView) doJobStatusUpdate(ctx context.Context, update ApplicationStatusUpdate) {
	d.statusSaving = true
	application, err := d.Client.UpdateJobApplicationStatus(ctx, d.JobID, update)
	d.applyJobStatusResult(application, err)
}

func (d *JobDetailView) applyJobStatusResult(application ApplicationTracker, err error) {
	d.statusSaving = false
	if err != nil {
		if IsUnauthorized(err) {
			d.statusErr = sessionExpiredMessage
		} else {
			d.statusErr = "Could not update application status."
		}
		return
	}
	d.job.Application = &application
	d.statusErr = ""
}

// renderApply shows the explicit "start application" control: it prepares a
// tailored draft (and, for supported ATS targets, the trusted auto-submit
// payload) for review before the user approves and submits on the next screen.
// The button is the only path that starts an application.
func (d *JobDetailView) renderApply() app.UI {
	return app.Div().Class("job-apply").Body(
		app.Button().
			Class("job-apply-button").
			Disabled(d.applyState == applyCreating).
			OnClick(d.apply).
			Text(applyButtonLabel(d.applyState)),
		app.P().Class("job-apply-note").
			Text("Generates a tailored draft to review before you approve and submit."),
		app.If(d.applyState == applyError, func() app.UI {
			return app.P().Class("job-apply-error").Text(d.applyErr)
		}),
	)
}

func applyButtonLabel(s applyStatus) string {
	if s == applyCreating {
		return "Preparing…"
	}
	return "Apply"
}

// Digest renders the daily digest landing: the date and the scored jobs
// surfaced for that day (GET /api/digest). Each job links to its detail.
type DigestView struct {
	app.Compo

	// Client is the Rails client; tests inject a mock.
	Client RailsClient

	state  loadState
	digest Digest
	err    string
}

func (v *DigestView) OnMount(ctx app.Context)     { v.ensureClient(); v.load(ctx) }
func (v *DigestView) OnPreRender(ctx app.Context) { v.ensureClient(); v.load(ctx) }

func (v *DigestView) ensureClient() {
	if v.Client == nil {
		v.Client = NewRailsClient()
	}
}

func (v *DigestView) load(ctx app.Context) {
	v.state = loadLoading
	ctx.Update()
	reqCtx := ctx.Context
	ctx.Async(func() {
		digest, err := v.Client.Digest(reqCtx)
		ctx.Dispatch(func(ctx app.Context) {
			applyResult(ctx, &v.state, &v.err, err, func() { v.digest = digest })
		})
	})
}

func (v *DigestView) Render() app.UI {
	return app.Div().Class("digest").Body(
		renderAppTabs("digest"),
		app.H1().Text("Daily digest"),
		renderLoad(v.state, v.err, func() app.UI {
			return app.Div().Class("digest-body").Body(
				app.If(v.digest.Date != "", func() app.UI {
					return app.P().Class("digest-date").Text(v.digest.Date)
				}),
				app.If(len(v.digest.Jobs) == 0, func() app.UI {
					return app.P().Class("digest-empty").Text("No new jobs today.")
				}).Else(func() app.UI {
					return app.Ul().Class("digest-items").Body(
						app.Range(v.digest.Jobs).Slice(func(i int) app.UI {
							job := v.digest.Jobs[i]
							return app.Li().Class("digest-item").Body(
								app.A().
									Class("digest-link").
									Href("/jobs/"+strconv.Itoa(job.ID)).
									Body(
										app.Span().Class("job-title").Text(job.Title),
										app.Span().Class("job-company").Text(job.Company),
										app.If(SourceLabel(job.Source) != "", func() app.UI {
											return app.Span().Class("job-source").Body(
												sourceIcon(job.Source),
												app.Text(SourceLabel(job.Source)),
											)
										}),
										app.Span().
											Class("job-score").
											Class("job-score--"+MatchScoreBand(job.MatchScore, job.ScoringStatus)).
											Text(MatchScoreLabel(job.MatchScore, job.ScoringStatus)),
									),
							)
						}),
					)
				}),
			)
		}),
	)
}

// --- shared render helpers ---

// sourceIcon renders the origin marker shown before a source label: the
// official brand logo (self-hosted SVG) for branded sources, an emoji for
// non-branded ones (manual/email), or nothing when neither applies.
func sourceIcon(source string) app.UI {
	if path := SourceIconPath(source); path != "" {
		return app.Img().
			Class("job-source-logo").
			Src(path).
			Alt(SourceLabel(source)).
			Attr("loading", "lazy")
	}
	if e := SourceEmoji(source); e != "" {
		return app.Span().Class("job-source-emoji").Text(e)
	}
	return app.Text("")
}

// applyResult updates the shared load state from an async fetch result. On a
// 401 it leaves an auth-specific error so the caller could route to login.
func applyResult(ctx app.Context, state *loadState, errMsg *string, err error, set func()) {
	if err != nil {
		*state = loadError
		if IsUnauthorized(err) {
			*errMsg = sessionExpiredMessage
		} else {
			*errMsg = "Could not load data. Please try again."
		}
		ctx.Update()
		return
	}
	set()
	*state = loadDone
	ctx.Update()
}

// renderLoad shows loading / error chrome, or the supplied content when loaded.
func renderLoad(state loadState, errMsg string, content func() app.UI) app.UI {
	switch state {
	case loadLoading, loadIdle:
		return app.P().Class("loading").Text("Loading…")
	case loadError:
		return renderLoadError(errMsg)
	default:
		return content()
	}
}

func renderLoadError(errMsg string) app.UI {
	return app.Div().Class("load-error").Body(
		app.P().Text(errMsg),
		app.If(errMsg == sessionExpiredMessage, func() app.UI {
			return app.A().Class("sign-in-link").Href("/login").Text("Sign in")
		}),
	)
}

func requirementList(heading, class string, items []string) app.UI {
	return app.If(len(items) > 0, func() app.UI {
		return app.Div().Class(class).Body(
			app.H2().Text(heading),
			app.Ul().Body(
				app.Range(items).Slice(func(i int) app.UI {
					return app.Li().Text(items[i])
				}),
			),
		)
	})
}

func renderRoute(route JobRoute) app.UI {
	return app.If(route.RouteType != "" || route.RecommendedRoute != "", func() app.UI {
		return app.Div().Class("job-route").Body(
			app.H2().Text("How to apply"),
			app.P().Class("job-route-type").Text(RouteLabel(route)),
			app.If(route.ApplicationURL != "", func() app.UI {
				return app.A().
					Class("job-route-link").
					Href(route.ApplicationURL).
					Target("_blank").
					Text("Open application")
			}),
		)
	})
}

// RouteLabel renders a resolved route for display, preferring the recommended
// route string and falling back to the route type.
func RouteLabel(route JobRoute) string {
	if route.RecommendedRoute != "" {
		return route.RecommendedRoute
	}
	if route.RouteType != "" {
		return route.RouteType
	}
	return "unknown"
}

// jobIDFromPath extracts the numeric job id from a "/jobs/:id" path. It returns
// ok=false when the path does not match that shape.
func jobIDFromPath(path string) (int, bool) {
	const prefix = "/jobs/"
	if len(path) <= len(prefix) || path[:len(prefix)] != prefix {
		return 0, false
	}
	id, err := strconv.Atoi(path[len(prefix):])
	if err != nil {
		return 0, false
	}
	return id, true
}
