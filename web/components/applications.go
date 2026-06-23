package components

import (
	"context"
	"strconv"

	"github.com/maxence-charriere/go-app/v10/pkg/app"
)

// Applications-tab view modes. The tab can show the tracked-application cards
// (the default pipeline view) or a flat table of every job post — an in-app
// spreadsheet-style tracker that links each row back to its job posting.
const (
	viewApplications = "applications"
	viewTable        = "table"
)

type ApplicationsView struct {
	app.Compo

	Client RailsClient

	state        loadState
	applications []ApplicationTracker
	err          string
	savingID     int
	statusErr    string

	// view selects the active mode (viewApplications | viewTable). The zero
	// value renders as viewApplications via currentView.
	view string

	// Table view state. Jobs are fetched lazily the first time the user opens
	// the table, so the default applications view costs no extra request.
	jobsState loadState
	jobs      []JobSummary
	jobsErr   string
}

func (v *ApplicationsView) OnMount(ctx app.Context)     { v.ensureClient(); v.load(ctx) }
func (v *ApplicationsView) OnPreRender(ctx app.Context) { v.ensureClient(); v.load(ctx) }

func (v *ApplicationsView) ensureClient() {
	if v.Client == nil {
		v.Client = NewRailsClient()
	}
}

func (v *ApplicationsView) load(ctx app.Context) {
	v.state = loadLoading
	ctx.Update()
	reqCtx := ctx.Context
	ctx.Async(func() {
		applications, err := v.Client.Applications(reqCtx)
		ctx.Dispatch(func(ctx app.Context) {
			applyResult(ctx, &v.state, &v.err, err, func() { v.applications = applications })
		})
	})
}

func (v *ApplicationsView) Render() app.UI {
	return app.Div().Class("applications").Body(
		renderAppTabs("applications"),
		v.renderHeader(),
		v.renderViewSelector(),
		v.renderActiveView(),
	)
}

// currentView resolves the active view, treating the zero value as the default
// applications (pipeline) view.
func (v *ApplicationsView) currentView() string {
	if v.view == viewTable {
		return viewTable
	}
	return viewApplications
}

// renderHeader shows the screen title with a stats cluster in the top-right.
// For now the only stat is the total count for the active view (tracked
// applications, or all jobs in the table view); more stats can join the cluster
// later.
func (v *ApplicationsView) renderHeader() app.UI {
	total := len(v.applications)
	caption := "Total tracked"
	if v.currentView() == viewTable {
		total = len(v.jobs)
		caption = "Total jobs"
	}
	return app.Div().Class("applications-header").Body(
		app.H1().Text("Applications"),
		app.Div().Class("applications-stats").Body(
			app.Div().Class("applications-stat").Body(
				app.Span().Class("applications-stat-value").Text(strconv.Itoa(total)),
				app.Span().Class("applications-stat-label").Text(caption),
			),
		),
	)
}

// renderViewSelector is the segmented control that switches between the tracked
// applications cards and the all-jobs table.
func (v *ApplicationsView) renderViewSelector() app.UI {
	return app.Div().Class("applications-view-selector").Attr("role", "tablist").Body(
		app.Button().
			Class("view-selector-option").
			Class(viewSelectorClass(v.currentView(), viewApplications)).
			OnClick(v.showApplications).
			Text("Applications"),
		app.Button().
			Class("view-selector-option").
			Class(viewSelectorClass(v.currentView(), viewTable)).
			OnClick(v.showTable).
			Text("All jobs"),
	)
}

func viewSelectorClass(active, name string) string {
	if active == name {
		return "view-selector-option-active"
	}
	return ""
}

func (v *ApplicationsView) renderActiveView() app.UI {
	if v.currentView() == viewTable {
		return v.renderTable()
	}
	return v.renderApplicationsList()
}

func (v *ApplicationsView) renderApplicationsList() app.UI {
	return renderLoad(v.state, v.err, func() app.UI {
		if len(v.applications) == 0 {
			return app.P().Class("applications-empty").Text("No tracked applications yet.")
		}
		return app.Ul().Class("applications-list").Body(
			app.Range(v.applications).Slice(func(i int) app.UI {
				return v.renderApplication(v.applications[i])
			}),
		)
	})
}

// renderTable renders the all-jobs spreadsheet-style tracker: one row per job
// post with a link back to the job posting. Filtering/sorting is planned (see
// docs/STYLE_GUIDE.md and docs/PRD.md) but not yet implemented — the table lists
// every job for now.
func (v *ApplicationsView) renderTable() app.UI {
	return renderLoad(v.jobsState, v.jobsErr, func() app.UI {
		if len(v.jobs) == 0 {
			return app.P().Class("jobs-table-empty").Text("No jobs yet.")
		}
		return app.Div().Class("jobs-table-wrap").Body(
			app.Table().Class("jobs-table").Body(
				app.THead().Body(
					app.Tr().Body(
						app.Th().Text("Title"),
						app.Th().Text("Company"),
						app.Th().Text("Source"),
						app.Th().Class("jobs-table-score-col").Text("Match"),
						app.Th().Class("jobs-table-action-col").Text(""),
					),
				),
				app.TBody().Body(
					app.Range(v.jobs).Slice(func(i int) app.UI {
						return v.renderJobRow(v.jobs[i])
					}),
				),
			),
		)
	})
}

func (v *ApplicationsView) renderJobRow(job JobSummary) app.UI {
	href := "/jobs/" + strconv.Itoa(job.ID)
	return app.Tr().Class("jobs-table-row").Body(
		app.Td().Class("jobs-table-title").Body(
			app.A().Href(href).Text(job.Title),
		),
		app.Td().Class("jobs-table-company").Text(job.Company),
		app.Td().Class("jobs-table-source").Body(
			app.If(SourceLabel(job.Source) != "", func() app.UI {
				return app.Span().Class("job-source").Body(
					sourceIcon(job.Source),
					app.Text(SourceLabel(job.Source)),
				)
			}),
		),
		app.Td().Class("jobs-table-score").Body(
			app.Span().
				Class("job-score").
				Class("job-score--"+MatchScoreBand(job.MatchScore, job.ScoringStatus)).
				Text(MatchScoreLabel(job.MatchScore, job.ScoringStatus)),
		),
		app.Td().Class("jobs-table-action").Body(
			app.A().Class("jobs-table-view").Href(href).Text("View"),
		),
	)
}

// showApplications switches to the pipeline (cards) view.
func (v *ApplicationsView) showApplications(ctx app.Context, _ app.Event) {
	v.view = viewApplications
	ctx.Update()
}

// showTable switches to the all-jobs table, lazily fetching the jobs the first
// time it is opened.
func (v *ApplicationsView) showTable(ctx app.Context, _ app.Event) {
	v.view = viewTable
	if v.jobsState == loadIdle {
		v.loadJobs(ctx)
		return
	}
	ctx.Update()
}

func (v *ApplicationsView) loadJobs(ctx app.Context) {
	v.jobsState = loadLoading
	ctx.Update()
	reqCtx := ctx.Context
	ctx.Async(func() {
		page, err := v.Client.Jobs(reqCtx, JobFeedParams{})
		ctx.Dispatch(func(ctx app.Context) {
			v.applyJobsResult(page.Jobs, err)
			ctx.Update()
		})
	})
}

// doShowTable is the engine-free body of showTable, used by tests to exercise
// the lazy fetch + state transition without the go-app runtime.
func (v *ApplicationsView) doShowTable(ctx context.Context) {
	v.view = viewTable
	if v.jobsState != loadIdle {
		return
	}
	v.jobsState = loadLoading
	page, err := v.Client.Jobs(ctx, JobFeedParams{})
	v.applyJobsResult(page.Jobs, err)
}

func (v *ApplicationsView) applyJobsResult(jobs []JobSummary, err error) {
	if err != nil {
		v.jobsState = loadError
		if IsUnauthorized(err) {
			v.jobsErr = sessionExpiredMessage
		} else {
			v.jobsErr = "Could not load data. Please try again."
		}
		return
	}
	v.jobs = jobs
	v.jobsState = loadDone
}

func (v *ApplicationsView) renderApplication(application ApplicationTracker) app.UI {
	return app.Li().Class("application-row").Body(
		app.Div().Class("application-row-main").Body(
			app.A().
				Class("application-title").
				Href("/jobs/"+strconv.Itoa(application.JobPostID)).
				Text(application.JobTitle),
			app.Span().Class("application-company").Text(application.Company),
			app.Span().Class("application-status-pill").
				Text(PipelineStatusLabel(application.PipelineStatus, application.PipelineStage)),
		),
		app.Div().Class("application-row-meta").Body(
			app.Span().Class("application-automation-status").
				Text("Automation: "+AutomationStatusLabel(application.AutomationStatus)),
			app.If(application.SubmittedAt != "", func() app.UI {
				return app.Span().Class("application-submitted-at").Text("Submitted")
			}),
			app.If(application.FailureReason != "", func() app.UI {
				return app.Span().Class("application-failure").Text(application.FailureReason)
			}),
		),
		app.Div().Class("application-status-controls").Body(
			v.pipelineStatusSelect(application),
			v.pipelineStageSelect(application),
			app.A().
				Class("application-review-link").
				Href("/applications/"+strconv.Itoa(application.ApplicationID)).
				Text("Review"),
		),
		app.If(v.savingID == application.ApplicationID, func() app.UI {
			return app.P().Class("application-status-saving").Text("Saving…")
		}),
		app.If(v.statusErr != "" && v.savingID == 0, func() app.UI {
			return app.P().Class("application-status-error").Text(v.statusErr)
		}),
	)
}

func (v *ApplicationsView) pipelineStatusSelect(application ApplicationTracker) app.UI {
	return app.Label().Class("pipeline-select-label").Body(
		app.Span().Text("Status"),
		app.Select().
			Class("pipeline-status-select").
			OnChange(v.statusSetter(application)).
			Body(pipelineStatusOptions(application.PipelineStatus)...),
	)
}

func (v *ApplicationsView) pipelineStageSelect(application ApplicationTracker) app.UI {
	return app.Label().Class("pipeline-select-label").Body(
		app.Span().Text("Stage"),
		app.Select().
			Class("pipeline-stage-select").
			OnChange(v.stageSetter(application)).
			Body(pipelineStageOptions(application.PipelineStage)...),
	)
}

func (v *ApplicationsView) statusSetter(application ApplicationTracker) app.EventHandler {
	return func(ctx app.Context, _ app.Event) {
		next := ctx.JSSrc().Get("value").String()
		v.saveStatus(ctx, application.ApplicationID, ApplicationStatusUpdate{PipelineStatus: next})
	}
}

func (v *ApplicationsView) stageSetter(application ApplicationTracker) app.EventHandler {
	return func(ctx app.Context, _ app.Event) {
		next := ctx.JSSrc().Get("value").String()
		v.saveStatus(ctx, application.ApplicationID, ApplicationStatusUpdate{
			PipelineStatus: application.PipelineStatus,
			PipelineStage:  next,
		})
	}
}

func (v *ApplicationsView) saveStatus(ctx app.Context, id int, update ApplicationStatusUpdate) {
	if v.savingID != 0 {
		return
	}
	v.savingID = id
	v.statusErr = ""
	ctx.Update()
	reqCtx := ctx.Context
	ctx.Async(func() {
		application, err := v.Client.UpdateApplicationStatus(reqCtx, id, update)
		ctx.Dispatch(func(ctx app.Context) {
			v.applyStatusResult(application, err)
			ctx.Update()
		})
	})
}

func (v *ApplicationsView) doStatusUpdate(ctx context.Context, id int, update ApplicationStatusUpdate) {
	v.savingID = id
	application, err := v.Client.UpdateApplicationStatus(ctx, id, update)
	v.applyStatusResult(application, err)
}

func (v *ApplicationsView) applyStatusResult(application ApplicationTracker, err error) {
	if err != nil {
		v.savingID = 0
		if IsUnauthorized(err) {
			v.statusErr = sessionExpiredMessage
		} else {
			v.statusErr = "Could not update application status."
		}
		return
	}
	for i := range v.applications {
		if v.applications[i].ApplicationID == application.ApplicationID {
			v.applications[i] = application
			break
		}
	}
	v.savingID = 0
	v.statusErr = ""
}

func renderAppTabs(active string) app.UI {
	return app.Nav().Class("app-tabs").Body(
		app.A().Class(tabClass(active, "digest")).Href("/").Text("Digest"),
		app.A().Class(tabClass(active, "jobs")).Href("/jobs").Text("Jobs"),
		app.A().Class(tabClass(active, "applications")).Href("/applications").Text("Applications"),
		app.A().Class(tabClass(active, "profile")).Href("/profile").Text("Profile"),
	)
}

func tabClass(active, name string) string {
	if active == name {
		return "app-tab app-tab-active"
	}
	return "app-tab"
}

type optionDef struct {
	value string
	label string
}

var pipelineStatusDefs = []optionDef{
	{"interested", "Interested"},
	{"drafting", "Drafting"},
	{"applied", "Applied"},
	{"interviewing", "Interviewing"},
	{"offer", "Offer"},
	{"rejected", "Rejected"},
	{"withdrawn", "Withdrawn"},
	{"archived", "Archived"},
	{"needs_review", "Needs review"},
}

var pipelineStageDefs = []optionDef{
	{"", "No stage"},
	{"waiting", "Waiting"},
	{"recruiter_screen", "Recruiter screen"},
	{"phone_screen", "Phone screen"},
	{"technical", "Technical"},
	{"take_home", "Take-home"},
	{"onsite", "Onsite"},
	{"final", "Final"},
	{"reference_check", "Reference check"},
	{"offer_negotiation", "Offer negotiation"},
}

func pipelineStatusOptions(selected string) []app.UI {
	return optionNodes(pipelineStatusDefs, selected)
}

func pipelineStageOptions(selected string) []app.UI {
	return optionNodes(pipelineStageDefs, selected)
}

func optionNodes(defs []optionDef, selected string) []app.UI {
	nodes := make([]app.UI, 0, len(defs))
	for _, def := range defs {
		nodes = append(nodes, app.Option().Value(def.value).Selected(def.value == selected).Text(def.label))
	}
	return nodes
}

func PipelineStatusLabel(status, stage string) string {
	statusLabel := optionLabel(status, pipelineStatusDefs)
	if statusLabel == "" {
		statusLabel = "Interested"
	}
	stageLabel := optionLabel(stage, pipelineStageDefs)
	if stageLabel == "" || status == "interested" || status == "drafting" {
		return statusLabel
	}
	return statusLabel + " · " + stageLabel
}

func AutomationStatusLabel(status string) string {
	switch status {
	case "draft":
		return "Draft"
	case "approved":
		return "Dispatched"
	case "submitted":
		return "Submitted"
	case "paused":
		return "Paused"
	case "failed":
		return "Failed"
	default:
		if status == "" {
			return "Draft"
		}
		return status
	}
}

func optionLabel(value string, defs []optionDef) string {
	for _, def := range defs {
		if def.value == value {
			return def.label
		}
	}
	return ""
}
