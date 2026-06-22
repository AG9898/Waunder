package components

import (
	"context"
	"strconv"

	"github.com/maxence-charriere/go-app/v10/pkg/app"
)

type ApplicationsView struct {
	app.Compo

	Client RailsClient

	state        loadState
	applications []ApplicationTracker
	err          string
	savingID     int
	statusErr    string
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
		app.H1().Text("Applications"),
		renderLoad(v.state, v.err, func() app.UI {
			if len(v.applications) == 0 {
				return app.P().Class("applications-empty").Text("No tracked applications yet.")
			}
			return app.Ul().Class("applications-list").Body(
				app.Range(v.applications).Slice(func(i int) app.UI {
					return v.renderApplication(v.applications[i])
				}),
			)
		}),
	)
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
