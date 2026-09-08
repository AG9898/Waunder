package components

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/maxence-charriere/go-app/v10/pkg/app"
)

// Tracker groups over Application#pipeline_status, mirroring the Rails
// APPLICATION_GROUPS constant. groupAll is the empty filter: Rails treats an
// unknown or blank group as "every group".
const (
	groupAll        = ""
	groupNotApplied = "not_applied"
	groupApplied    = "applied"
	groupInProgress = "in_progress"
	groupClosed     = "closed"
)

// jobStateOpen spans the active and backlog lifecycle bins. The tracker
// defaults to it so a backlogged posting the owner still wants to apply to
// stays visible, while removed jobs stay hidden behind their own bin.
const jobStateOpen = "open"

// Tracker sort options, matching the Rails feed's `sort` parameter.
const (
	trackerSortNewest   = "newest"
	trackerSortActivity = "activity"
	trackerSortScore    = "score"
)

// notAppliedOption is the sentinel value of the placeholder status <option>
// shown for a job post with no tracked application. Selecting it is a no-op:
// clearing a tracked application would destroy its draft and audit history, so
// untracking is deliberately not a row action.
const notAppliedOption = "not_applied"

// ApplicationsView is the application tracker: one row per intaked job post,
// showing whether it has been applied to and letting the owner set that status
// inline. It reads the job feed (GET /api/job_posts) rather than the tracked-
// applications list, because the question it answers — what have I applied to,
// and what haven't I — needs the jobs with no application too.
//
// Every status write goes through PATCH /api/job_posts/:id/application_status,
// which creates the Application on first use. It is tracker-only: it never
// generates a draft and never submits.
type ApplicationsView struct {
	app.Compo

	Client RailsClient

	state  loadState
	jobs   []JobSummary
	page   PageMeta
	counts ApplicationCounts
	err    string

	// group is the active tracker tab (groupAll and the group* constants).
	group string
	// bin is the lifecycle bin; empty means jobStateOpen (active + backlog).
	bin string
	// sort is the row order; empty means trackerSortNewest.
	sort string
	// pageNum is the current 1-based page.
	pageNum int

	// savingID is the job post whose status write is in flight, so its row can
	// show progress and concurrent writes are refused.
	savingID  int
	statusErr string
}

func (v *ApplicationsView) OnMount(ctx app.Context)     { v.ensureClient(); v.load(ctx) }
func (v *ApplicationsView) OnPreRender(ctx app.Context) { v.ensureClient(); v.load(ctx) }

func (v *ApplicationsView) ensureClient() {
	if v.Client == nil {
		v.Client = NewRailsClient()
	}
}

// params builds the server query from the current tab, bin, sort, and page.
// status=all is what makes the tracker differ from the Jobs feed: an intaked
// posting that triage deferred or filtered has never been scored, but it is
// still something the owner may have applied to.
func (v *ApplicationsView) params() JobFeedParams {
	page := v.pageNum
	if page < 1 {
		page = 1
	}
	return JobFeedParams{
		Status:      "all",
		State:       v.currentBin(),
		Sort:        v.currentSort(),
		Application: v.group,
		Page:        page,
	}
}

func (v *ApplicationsView) currentBin() string {
	if v.bin == "" {
		return jobStateOpen
	}
	return v.bin
}

func (v *ApplicationsView) currentSort() string {
	if v.sort == "" {
		return trackerSortNewest
	}
	return v.sort
}

func (v *ApplicationsView) load(ctx app.Context) {
	v.state = loadLoading
	ctx.Update()
	reqCtx := ctx.Context
	params := v.params()
	ctx.Async(func() {
		page, err := v.Client.Jobs(reqCtx, params)
		ctx.Dispatch(func(ctx app.Context) {
			v.applyLoadResult(page, err)
			ctx.Update()
		})
	})
}

// doLoad is the engine-free body of load, so tests can exercise the fetch and
// state transition without the go-app runtime.
func (v *ApplicationsView) doLoad(ctx context.Context) {
	v.state = loadLoading
	page, err := v.Client.Jobs(ctx, v.params())
	v.applyLoadResult(page, err)
}

func (v *ApplicationsView) applyLoadResult(page JobPage, err error) {
	if err != nil {
		v.state = loadError
		if IsUnauthorized(err) {
			v.err = sessionExpiredMessage
		} else {
			v.err = "Could not load data. Please try again."
		}
		return
	}
	v.jobs = page.Jobs
	v.page = page.Page
	v.counts = page.Counts
	v.err = ""
	v.state = loadDone
}

func (v *ApplicationsView) Render() app.UI {
	return app.Div().Class("applications").Body(
		renderAppTabs("applications"),
		v.renderHeader(),
		v.renderGroupTabs(),
		v.renderControls(),
		app.If(v.statusErr != "", func() app.UI {
			return app.P().Class("tracker-status-error").Attr("role", "alert").Text(v.statusErr)
		}),
		v.renderRows(),
	)
}

// renderHeader pairs the title with the tracked/total split, so the answer to
// "how much have I actually applied to" is legible before reading any row.
func (v *ApplicationsView) renderHeader() app.UI {
	tracked := v.counts.Applied + v.counts.InProgress + v.counts.Closed
	return app.Div().Class("applications-header").Body(
		app.H1().Text("Applications"),
		app.Div().Class("applications-stats").Body(
			v.renderStat(tracked, "Applied to"),
			v.renderStat(v.counts.All, "Jobs tracked"),
		),
	)
}

func (v *ApplicationsView) renderStat(value int, caption string) app.UI {
	return app.Div().Class("applications-stat").Body(
		app.Span().Class("applications-stat-value").Text(strconv.Itoa(value)),
		app.Span().Class("applications-stat-label").Text(caption),
	)
}

// renderGroupTabs is the primary filter: the tracker states a job can be in.
// Each tab carries the server's count for that group.
func (v *ApplicationsView) renderGroupTabs() app.UI {
	tab := func(group, label string, count int) app.UI {
		return app.Button().
			Class("tracker-tab").
			Class(viewSelectorClass(v.group, group)).
			Attr("role", "tab").
			Aria("selected", v.group == group).
			OnClick(v.showGroup(group)).
			Body(
				app.Span().Class("tracker-tab-label").Text(label),
				app.Span().Class("tracker-tab-count").Text(strconv.Itoa(count)),
			)
	}
	return app.Nav().Class("tracker-tabs").Attr("role", "tablist").Aria("label", "Application status").Body(
		tab(groupAll, "All", v.counts.All),
		tab(groupNotApplied, "Not applied", v.counts.NotApplied),
		tab(groupApplied, "Applied", v.counts.Applied),
		tab(groupInProgress, "In progress", v.counts.InProgress),
		tab(groupClosed, "Closed", v.counts.Closed),
	)
}

// renderControls holds the secondary selections — which lifecycle bin the rows
// come from, and their order.
func (v *ApplicationsView) renderControls() app.UI {
	return app.Div().Class("tracker-controls").Body(
		app.Label().Class("tracker-control").Body(
			app.Span().Text("Show"),
			app.Select().Class("tracker-bin-select").OnChange(v.setBin).Body(
				trackerOption(jobStateOpen, "Active + backlog", v.currentBin()),
				trackerOption(jobStateActive, "Active only", v.currentBin()),
				trackerOption(jobStateBacklog, "Backlog only", v.currentBin()),
				trackerOption(jobStateRemoved, "Removed", v.currentBin()),
			),
		),
		app.Label().Class("tracker-control").Body(
			app.Span().Text("Sort"),
			app.Select().Class("tracker-sort-select").OnChange(v.setSort).Body(
				trackerOption(trackerSortNewest, "Newest intake", v.currentSort()),
				trackerOption(trackerSortActivity, "Recent activity", v.currentSort()),
				trackerOption(trackerSortScore, "Highest match", v.currentSort()),
			),
		),
	)
}

// trackerOption builds a select <option>. Unlike the feed filters there is no
// empty-valued choice here, so no all-sentinel is needed.
func trackerOption(value, label, current string) app.UI {
	return app.Option().Value(value).Selected(value == current).Text(label)
}

func (v *ApplicationsView) renderRows() app.UI {
	return renderLoad(v.state, v.err, func() app.UI {
		if len(v.jobs) == 0 {
			return app.P().Class("tracker-empty").Text(trackerEmptyMessage(v.group))
		}
		return app.Div().Class("tracker-wrap").Body(
			app.Table().Class("tracker-table").Body(
				app.THead().Body(
					app.Tr().Body(
						app.Th().Class("tracker-col-job").Text("Job"),
						app.Th().Class("tracker-col-company").Text("Company"),
						app.Th().Class("tracker-col-status").Text("Status"),
						app.Th().Class("tracker-col-date").Text("Intaked"),
						app.Th().Class("tracker-col-date").Text("Updated"),
					),
				),
				app.TBody().Body(
					app.Range(v.jobs).Slice(func(i int) app.UI {
						return v.renderRow(v.jobs[i])
					}),
				),
			),
			v.renderPagination(),
		)
	})
}

// trackerEmptyMessage explains an empty result in the terms of the active tab,
// so "nothing here" never reads as "the tracker is broken".
func trackerEmptyMessage(group string) string {
	switch group {
	case groupNotApplied:
		return "Nothing left to apply to in this view."
	case groupApplied:
		return "No applications submitted yet."
	case groupInProgress:
		return "Nothing in progress yet."
	case groupClosed:
		return "No closed applications yet."
	default:
		return "No jobs intaked yet."
	}
}

func (v *ApplicationsView) renderRow(job JobSummary) app.UI {
	href := "/jobs/" + strconv.Itoa(job.ID)
	return app.Tr().Class("tracker-row").Class(trackerRowClass(job.Application)).Body(
		app.Td().Class("tracker-cell tracker-cell-job").Attr("data-label", "Job").Body(
			app.A().Class("tracker-job-link").Href(href).Text(job.Title),
		),
		app.Td().Class("tracker-cell tracker-cell-company").Attr("data-label", "Company").Text(job.Company),
		app.Td().Class("tracker-cell tracker-cell-status").Attr("data-label", "Status").Body(
			v.renderStatusControl(job),
		),
		app.Td().Class("tracker-cell tracker-cell-date").Attr("data-label", "Intaked").Text(trackerDate(job.CreatedAt)),
		app.Td().Class("tracker-cell tracker-cell-date").Attr("data-label", "Updated").Text(trackerUpdatedLabel(job)),
	)
}

// trackerRowClass tints a row by its tracker group so applied and closed rows
// are separable at a glance without a colour-coded column of their own.
func trackerRowClass(application *ApplicationTracker) string {
	return "tracker-row--" + TrackerGroup(application)
}

// TrackerGroup maps a job's tracked application to the tracker group it falls
// in, mirroring the Rails APPLICATION_GROUPS constant. A job with no tracked
// application, or one still being considered or drafted, counts as not applied.
func TrackerGroup(application *ApplicationTracker) string {
	if application == nil {
		return groupNotApplied
	}
	switch application.PipelineStatus {
	case "applied":
		return groupApplied
	case "interviewing", "offer":
		return groupInProgress
	case "rejected", "withdrawn", "archived":
		return groupClosed
	default:
		return groupNotApplied
	}
}

// renderStatusControl is the inline status editor. A job with no tracked
// application shows a selected "Not applied" placeholder; picking any real
// status creates the application in Rails.
func (v *ApplicationsView) renderStatusControl(job JobSummary) app.UI {
	status := ""
	stage := ""
	if job.Application != nil {
		status = job.Application.PipelineStatus
		stage = job.Application.PipelineStage
	}
	return app.Div().Class("tracker-status").Body(
		app.Select().
			Class("tracker-status-select").
			Aria("label", "Application status for "+job.Title).
			Disabled(v.savingID != 0).
			OnChange(v.setStatus(job.ID)).
			Body(trackerStatusOptions(status)...),
		app.If(stage != "" && status != "", func() app.UI {
			return app.Span().Class("tracker-stage").Text(optionLabel(stage, pipelineStageDefs))
		}),
		app.If(v.savingID == job.ID, func() app.UI {
			return app.Span().Class("tracker-saving").Attr("role", "status").Text("Saving…")
		}),
	)
}

// trackerStatusOptions lists the pipeline statuses, prepending the "Not
// applied" placeholder only while the job has no tracked application — there is
// no supported transition back to untracked.
func trackerStatusOptions(selected string) []app.UI {
	nodes := make([]app.UI, 0, len(pipelineStatusDefs)+1)
	if selected == "" {
		nodes = append(nodes, app.Option().Value(notAppliedOption).Selected(true).Text("Not applied"))
	}
	return append(nodes, pipelineStatusOptions(selected)...)
}

func (v *ApplicationsView) renderPagination() app.UI {
	return app.Div().Class("tracker-pagination job-pagination").Body(
		app.Button().
			Class("tracker-page-prev").
			Disabled(v.page.Number <= 1).
			OnClick(v.prevPage).
			Text("Previous"),
		app.Span().Class("tracker-page-indicator").Text(pageIndicatorLabel(v.page)),
		app.Button().
			Class("tracker-page-next").
			Disabled(!v.page.HasNext).
			OnClick(v.nextPage).
			Text("Next"),
	)
}

func (v *ApplicationsView) showGroup(group string) app.EventHandler {
	return func(ctx app.Context, _ app.Event) {
		if v.applyGroup(group) {
			v.load(ctx)
		}
	}
}

// applyGroup records a tab change and resets paging. Split from the handler so
// the transition is unit-testable without the engine.
func (v *ApplicationsView) applyGroup(group string) bool {
	if v.group == group {
		return false
	}
	v.group = group
	v.pageNum = 1
	return true
}

func (v *ApplicationsView) setBin(ctx app.Context, _ app.Event) {
	if v.applyBin(ctx.JSSrc().Get("value").String()) {
		v.load(ctx)
	}
}

func (v *ApplicationsView) applyBin(bin string) bool {
	if bin == "" || bin == v.currentBin() {
		return false
	}
	v.bin = bin
	v.pageNum = 1
	return true
}

func (v *ApplicationsView) setSort(ctx app.Context, _ app.Event) {
	if v.applySort(ctx.JSSrc().Get("value").String()) {
		v.load(ctx)
	}
}

func (v *ApplicationsView) applySort(sort string) bool {
	if sort == "" || sort == v.currentSort() {
		return false
	}
	v.sort = sort
	v.pageNum = 1
	return true
}

func (v *ApplicationsView) prevPage(ctx app.Context, _ app.Event) {
	if v.applyPrevPage() {
		v.load(ctx)
	}
}

func (v *ApplicationsView) applyPrevPage() bool {
	if v.page.Number <= 1 {
		return false
	}
	v.pageNum = v.page.Number - 1
	return true
}

func (v *ApplicationsView) nextPage(ctx app.Context, _ app.Event) {
	if v.applyNextPage() {
		v.load(ctx)
	}
}

func (v *ApplicationsView) applyNextPage() bool {
	if !v.page.HasNext {
		return false
	}
	next := v.page.Number
	if next < 1 {
		next = 1
	}
	v.pageNum = next + 1
	return true
}

// setStatus writes the row's chosen pipeline status. Rails creates the
// Application on first use; this never generates a draft and never submits.
func (v *ApplicationsView) setStatus(jobID int) app.EventHandler {
	return func(ctx app.Context, _ app.Event) {
		status := ctx.JSSrc().Get("value").String()
		if status == notAppliedOption || v.savingID != 0 {
			return
		}
		v.savingID = jobID
		v.statusErr = ""
		ctx.Update()
		reqCtx := ctx.Context
		params := v.params()
		ctx.Async(func() {
			_, err := v.Client.UpdateJobApplicationStatus(reqCtx, jobID, ApplicationStatusUpdate{PipelineStatus: status})
			// Rails owns the group tallies and which rows match the active tab,
			// so refetch rather than patching the row locally: a status change
			// can move a job out of the tab it was edited in.
			var page JobPage
			if err == nil {
				page, err = v.Client.Jobs(reqCtx, params)
			}
			ctx.Dispatch(func(ctx app.Context) {
				v.applyStatusResult(page, err)
				ctx.Update()
			})
		})
	}
}

// doSetStatus is the engine-free body of setStatus for tests.
func (v *ApplicationsView) doSetStatus(ctx context.Context, jobID int, status string) {
	if status == notAppliedOption || v.savingID != 0 {
		return
	}
	v.savingID = jobID
	v.statusErr = ""
	_, err := v.Client.UpdateJobApplicationStatus(ctx, jobID, ApplicationStatusUpdate{PipelineStatus: status})
	var page JobPage
	if err == nil {
		page, err = v.Client.Jobs(ctx, v.params())
	}
	v.applyStatusResult(page, err)
}

func (v *ApplicationsView) applyStatusResult(page JobPage, err error) {
	v.savingID = 0
	if err != nil {
		if IsUnauthorized(err) {
			v.statusErr = sessionExpiredMessage
		} else {
			v.statusErr = "Could not update application status."
		}
		return
	}
	v.statusErr = ""
	v.applyLoadResult(page, nil)
}

// trackerDate renders an RFC 3339 timestamp as a short calendar date. An
// unparseable or absent value renders as an em dash rather than raw text.
func trackerDate(value string) string {
	parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(value))
	if err != nil {
		return "—"
	}
	return parsed.Format("2 Jan 2006")
}

// trackerUpdatedLabel is when the tracker state last moved. A job with no
// tracked application has never moved, so it renders as an em dash.
func trackerUpdatedLabel(job JobSummary) string {
	if job.Application == nil {
		return "—"
	}
	return trackerDate(job.Application.LastStatusChange)
}

func renderAppTabs(active string) app.UI {
	return &AppChrome{Active: active}
}

func tabClass(active, name string) string {
	if active == name {
		return "app-tab app-tab-active"
	}
	return "app-tab"
}

func viewSelectorClass(active, name string) string {
	if active == name {
		return "view-selector-option-active"
	}
	return ""
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

func pipelineStageValue(value string) string {
	if value == "none" {
		return ""
	}
	return value
}

func optionNodes(defs []optionDef, selected string) []app.UI {
	nodes := make([]app.UI, 0, len(defs))
	for _, def := range defs {
		value := def.value
		if value == "" {
			value = "none"
		}
		nodes = append(nodes, app.Option().Value(value).Selected(def.value == selected).Text(def.label))
	}
	return nodes
}

func PipelineStatusLabel(status, stage string) string {
	statusLabel := optionLabel(status, pipelineStatusDefs)
	if statusLabel == "" {
		statusLabel = "Interested"
	}
	stageLabel := optionLabel(stage, pipelineStageDefs)
	if stage == "" || stageLabel == "" || status == "interested" || status == "drafting" {
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
