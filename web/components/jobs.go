package components

import (
	"context"
	"net/url"
	"strconv"
	"time"

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

const (
	jobListScored   = "scored"
	jobListUnscored = "unscored"
)

type scoreRequestState int

const (
	scoreIdle scoreRequestState = iota
	scoreRequesting
	scoreRequestError
)

// JobList renders the job feed. The scored tab uses GET /api/job_posts; the
// unscored tab uses GET /api/job_posts?status=unscored and lets the owner
// explicitly request scoring for filtered/deferred jobs.
type JobList struct {
	app.Compo

	// Client is the Rails client; tests inject a mock and it defaults to the
	// same-origin HTTP client on mount.
	Client RailsClient

	state loadState
	jobs  []JobSummary
	err   string

	view        string
	scoreStates map[int]scoreRequestState
	scoreErrs   map[int]string
}

func (j *JobList) OnMount(ctx app.Context)     { j.ensureClient(); j.load(ctx) }
func (j *JobList) OnPreRender(ctx app.Context) { j.ensureClient(); j.load(ctx) }

func (j *JobList) ensureClient() {
	if j.Client == nil {
		j.Client = NewRailsClient()
	}
}

func (j *JobList) load(ctx app.Context) {
	if j.view == "" {
		j.view = jobListScored
	}
	j.state = loadLoading
	ctx.Update()
	reqCtx := ctx.Context
	view := j.view
	ctx.Async(func() {
		jobs, err := j.fetchJobs(reqCtx, view)
		ctx.Dispatch(func(ctx app.Context) {
			applyResult(ctx, &j.state, &j.err, err, func() { j.jobs = jobs })
		})
	})
}

func (j *JobList) fetchJobs(ctx context.Context, view string) ([]JobSummary, error) {
	if view == jobListUnscored {
		return j.Client.UnscoredJobs(ctx)
	}
	return j.Client.Jobs(ctx)
}

func (j *JobList) Render() app.UI {
	return app.Div().Class("job-list").Body(
		renderAppTabs("jobs"),
		app.H1().Text("Jobs"),
		j.renderViewSelector(),
		renderLoad(j.state, j.err, func() app.UI {
			if len(j.jobs) == 0 {
				return app.P().Class("job-list-empty").Text(j.emptyText())
			}
			return app.Ul().Class("job-list-items").Body(
				app.Range(j.jobs).Slice(func(i int) app.UI {
					job := j.jobs[i]
					return j.renderJobRow(job)
				}),
			)
		}),
	)
}

func (j *JobList) renderViewSelector() app.UI {
	if j.view == "" {
		j.view = jobListScored
	}
	return app.Nav().Class("applications-view-selector job-list-view-selector").Attr("role", "tablist").Body(
		app.Button().
			Class("view-selector-option").
			Class(viewSelectorClass(j.view, jobListScored)).
			Attr("role", "tab").
			OnClick(j.showView(jobListScored)).
			Text("Scored"),
		app.Button().
			Class("view-selector-option").
			Class(viewSelectorClass(j.view, jobListUnscored)).
			Attr("role", "tab").
			OnClick(j.showView(jobListUnscored)).
			Text("Unscored"),
	)
}

func (j *JobList) renderJobRow(job JobSummary) app.UI {
	return app.Li().Class("job-list-item").Body(
		app.Div().Class("job-list-row").Body(
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
			app.If(j.view == jobListUnscored, func() app.UI {
				return j.renderScoreAction(job)
			}),
		),
	)
}

func (j *JobList) renderScoreAction(job JobSummary) app.UI {
	state := j.scoreState(job.ID)
	return app.Div().Class("job-list-score-action").Body(
		app.Button().
			Class("job-list-score-button").
			Disabled(state == scoreRequesting || job.ScoringStatus == "pending").
			OnClick(j.scoreJob(job.ID)).
			Text(scoreButtonLabel(state, job.ScoringStatus)),
		app.If(j.scoreErr(job.ID) != "", func() app.UI {
			return app.P().Class("job-list-score-error").Text(j.scoreErr(job.ID))
		}),
	)
}

func (j *JobList) showView(view string) app.EventHandler {
	return func(ctx app.Context, _ app.Event) {
		if j.view == view {
			return
		}
		j.view = view
		j.jobs = nil
		j.err = ""
		j.load(ctx)
	}
}

func (j *JobList) scoreJob(id int) app.EventHandler {
	return func(ctx app.Context, _ app.Event) {
		if j.scoreState(id) == scoreRequesting {
			return
		}
		j.setScoreState(id, scoreRequesting, "")
		ctx.Update()
		reqCtx := ctx.Context
		ctx.Async(func() {
			job, err := j.Client.ScoreJobPost(reqCtx, id)
			ctx.Dispatch(func(ctx app.Context) {
				j.applyScoreResult(id, job, err)
				ctx.Update()
			})
		})
	}
}

func (j *JobList) doScoreJob(ctx context.Context, id int) {
	j.setScoreState(id, scoreRequesting, "")
	job, err := j.Client.ScoreJobPost(ctx, id)
	j.applyScoreResult(id, job, err)
}

func (j *JobList) applyScoreResult(id int, job JobSummary, err error) {
	if err != nil {
		msg := "Could not request scoring."
		if IsUnauthorized(err) {
			msg = sessionExpiredMessage
		}
		j.setScoreState(id, scoreRequestError, msg)
		return
	}
	for i := range j.jobs {
		if j.jobs[i].ID == id {
			j.jobs[i] = job
			break
		}
	}
	j.setScoreState(id, scoreIdle, "")
}

func (j *JobList) scoreState(id int) scoreRequestState {
	if j.scoreStates == nil {
		return scoreIdle
	}
	return j.scoreStates[id]
}

func (j *JobList) scoreErr(id int) string {
	if j.scoreErrs == nil {
		return ""
	}
	return j.scoreErrs[id]
}

func (j *JobList) setScoreState(id int, state scoreRequestState, err string) {
	if j.scoreStates == nil {
		j.scoreStates = map[int]scoreRequestState{}
	}
	if j.scoreErrs == nil {
		j.scoreErrs = map[int]string{}
	}
	j.scoreStates[id] = state
	if err == "" {
		delete(j.scoreErrs, id)
	} else {
		j.scoreErrs[id] = err
	}
}

func (j *JobList) emptyText() string {
	if j.view == jobListUnscored {
		return "No unscored jobs."
	}
	return "No scored jobs yet."
}

func scoreButtonLabel(state scoreRequestState, scoringStatus string) string {
	if state == scoreRequesting {
		return "Scoring..."
	}
	if scoringStatus == "pending" {
		return "Queued"
	}
	return "Score"
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
	// backHref is where the "back" link returns to. It defaults to the jobs
	// feed but is set to the expanded ingestion batch when the user arrived
	// from the digest landing (via the ?from=digest&batch=… query params).
	backHref string
	// backLabel is the text of the back link, matching backHref's destination.
	backLabel string

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
	d.resolveBack(ctx.Page().URL())
	d.load(ctx)
}

// OnNav re-fetches when the route changes to a different job id while the
// component instance is reused.
func (d *JobDetailView) OnNav(ctx app.Context) {
	d.resolveBack(ctx.Page().URL())
	if id, ok := jobIDFromPath(ctx.Page().URL().Path); ok && id != d.JobID {
		d.JobID = id
		d.load(ctx)
	}
}

// resolveBack sets the back link target from the request URL. When the user
// arrived from the ingestion landing (?from=digest), back returns to that
// screen with the originating batch re-expanded (?batch=…); otherwise it
// falls back to the jobs feed.
func (d *JobDetailView) resolveBack(u *url.URL) {
	d.backHref = "/jobs"
	d.backLabel = "← Jobs"
	if u == nil {
		return
	}
	q := u.Query()
	if q.Get("from") != "digest" {
		return
	}
	d.backLabel = "← Ingestions"
	if batch := q.Get("batch"); batch != "" {
		d.backHref = "/?batch=" + url.QueryEscape(batch)
	} else {
		d.backHref = "/"
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

// backFallback returns the resolved back href, defaulting to the jobs feed when
// resolveBack has not run (e.g. a directly-constructed test component).
func (d *JobDetailView) backFallback() string {
	if d.backHref == "" {
		return "/jobs"
	}
	return d.backHref
}

// backFallbackLabel mirrors backFallback for the link text.
func (d *JobDetailView) backFallbackLabel() string {
	if d.backLabel == "" {
		return "← Jobs"
	}
	return d.backLabel
}

func (d *JobDetailView) Render() app.UI {
	return app.Div().Class("job-detail").Body(
		app.A().Class("job-detail-back").Href(d.backFallback()).Text(d.backFallbackLabel()),
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

// DigestView renders the ingestion-history landing: recently-ingested postings
// grouped into batches (one alert/digest email per batch), grouped by date and
// newest first (GET /api/ingestion_batches). Each batch is a collapsible
// <details> block; expanding it reveals its individual postings, each linking
// to the job detail. This replaces the old top-5-scored "daily digest" list so
// the screen reflects every ingestion as it arrives, not just yesterday's best.
type DigestView struct {
	app.Compo

	// Client is the Rails client; tests inject a mock.
	Client RailsClient

	state   loadState
	batches []IngestionBatch
	err     string
	// openBatch is the id of the batch to render expanded on load, set from the
	// ?batch=… query param so returning from a job detail re-opens its batch.
	openBatch string
}

func (v *DigestView) OnMount(ctx app.Context) {
	v.ensureClient()
	v.openBatch = ctx.Page().URL().Query().Get("batch")
	v.load(ctx)
}

func (v *DigestView) OnPreRender(ctx app.Context) {
	v.ensureClient()
	v.openBatch = ctx.Page().URL().Query().Get("batch")
	v.load(ctx)
}

// OnNav re-reads the open-batch target when navigating back to the landing
// (e.g. via the job-detail back link) so the originating batch re-expands.
func (v *DigestView) OnNav(ctx app.Context) {
	v.openBatch = ctx.Page().URL().Query().Get("batch")
	ctx.Update()
}

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
		batches, err := v.Client.IngestionBatches(reqCtx)
		ctx.Dispatch(func(ctx app.Context) {
			applyResult(ctx, &v.state, &v.err, err, func() { v.batches = batches })
		})
	})
}

func (v *DigestView) Render() app.UI {
	return app.Div().Class("digest").Body(
		renderAppTabs("digest"),
		app.H1().Text("Recent ingestions"),
		renderLoad(v.state, v.err, func() app.UI { return v.renderBatches() }),
	)
}

// renderBatches groups the (newest-first) batches by date, emitting a date
// header each time the date changes, then the batch cards for that date.
func (v *DigestView) renderBatches() app.UI {
	if len(v.batches) == 0 {
		return app.P().Class("digest-empty").Text("No ingestions yet.")
	}

	var lastDate string
	return app.Div().Class("digest-body").Body(
		app.Range(v.batches).Slice(func(i int) app.UI {
			batch := v.batches[i]
			showHeader := batch.Date != lastDate
			lastDate = batch.Date
			return app.Div().Class("digest-batch-group").Body(
				app.If(showHeader, func() app.UI {
					return app.P().Class("digest-date").Text(formatBatchDate(batch.Date))
				}),
				renderBatch(batch, batch.ID == v.openBatch),
			)
		}),
	)
}

// renderBatch renders one ingestion batch as a collapsible block: a summary row
// (source + count + time) the user clicks to reveal the batch's postings. When
// open is true the block renders expanded — used to re-open the batch a user
// returns to from a job detail.
func renderBatch(batch IngestionBatch, open bool) app.UI {
	details := app.Details().Class("digest-batch")
	if open {
		// Only set the boolean attribute when expanding: go-app renders
		// .Open(false) as open="false", which a browser still treats as open.
		details = details.Open(true)
	}
	return details.Body(
		app.Summary().Class("digest-batch-summary").Body(
			app.Span().Class("job-source").Body(
				sourceIcon(batch.Source),
				app.Text(batchSourceLabel(batch.Source)),
			),
			app.Span().Class("digest-batch-count").Text(batchCountLabel(batch.Count)),
			app.If(formatBatchTime(batch.IngestedAt) != "", func() app.UI {
				return app.Span().Class("digest-batch-time").Text(formatBatchTime(batch.IngestedAt))
			}),
		),
		app.Ul().Class("digest-items").Body(
			app.Range(batch.Jobs).Slice(func(i int) app.UI {
				job := batch.Jobs[i]
				return app.Li().Class("digest-item").Body(
					app.A().
						Class("digest-link").
						Href("/jobs/"+strconv.Itoa(job.ID)+"?from=digest&batch="+url.QueryEscape(batch.ID)).
						Body(
							app.Span().Class("job-title").Text(job.Title),
							app.Span().Class("job-company").Text(job.Company),
							app.Span().
								Class("job-score").
								Class("job-score--"+MatchScoreBand(job.MatchScore, job.ScoringStatus)).
								Text(MatchScoreLabel(job.MatchScore, job.ScoringStatus)),
						),
				)
			}),
		),
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

// batchSourceLabel is the source label for a batch summary, falling back to a
// neutral word when the source is unknown so the row is never blank.
func batchSourceLabel(source string) string {
	if label := SourceLabel(source); label != "" {
		return label
	}
	return "Other"
}

// batchCountLabel renders the posting count for a batch summary.
func batchCountLabel(n int) string {
	if n == 1 {
		return "1 job"
	}
	return strconv.Itoa(n) + " jobs"
}

// formatBatchDate renders an ISO date (YYYY-MM-DD) as a friendlier "Mon 2"
// header; on parse failure it returns the raw value rather than nothing.
func formatBatchDate(iso string) string {
	t, err := time.Parse("2006-01-02", iso)
	if err != nil {
		return iso
	}
	return t.Format("Mon, Jan 2")
}

// formatBatchTime renders an RFC3339 timestamp as a short local time of day
// ("3:04 PM"); it returns "" when the value is empty or unparseable so the
// caller can omit the chip.
func formatBatchTime(ts string) string {
	if ts == "" {
		return ""
	}
	t, err := time.Parse(time.RFC3339, ts)
	if err != nil {
		return ""
	}
	return t.Format("3:04 PM")
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
