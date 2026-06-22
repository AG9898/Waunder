package components

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/maxence-charriere/go-app/v10/pkg/app"
)

func TestApplicationsViewRendersTrackerRows(t *testing.T) {
	c := &ApplicationsView{Client: &mockClient{
		applications: []ApplicationTracker{
			{
				ApplicationID:    7,
				JobPostID:        42,
				JobTitle:         "Staff Engineer",
				Company:          "Acme",
				AutomationStatus: "submitted",
				PipelineStatus:   "applied",
				PipelineStage:    "waiting",
				SubmittedAt:      "2026-06-22T10:00:00Z",
			},
			{
				ApplicationID:    8,
				JobPostID:        43,
				JobTitle:         "Principal Engineer",
				Company:          "Globex",
				AutomationStatus: "draft",
				PipelineStatus:   "interviewing",
				PipelineStage:    "technical",
			},
		},
	}}
	html := renderHTML(t, c)

	for _, want := range []string{
		"Applications", "Staff Engineer", "Acme", "Applied · Waiting", "Automation: Submitted",
		"Principal Engineer", "Globex", "Interviewing · Technical", "/jobs/42", "/applications/7",
		// go-app renders element attributes from a map, so attribute order is
		// not stable — assert the active class and the Applications-tab href
		// separately rather than as one order-dependent substring.
		"app-tab-active", `href="/applications"`,
	} {
		if !strings.Contains(html, want) {
			t.Errorf("applications HTML missing %q\n%s", want, html)
		}
	}
}

func TestApplicationsViewRendersSelectorAndStats(t *testing.T) {
	c := &ApplicationsView{Client: &mockClient{
		applications: []ApplicationTracker{
			{ApplicationID: 7, JobPostID: 42, JobTitle: "Staff Engineer", Company: "Acme"},
			{ApplicationID: 8, JobPostID: 43, JobTitle: "Principal Engineer", Company: "Globex"},
		},
	}}
	html := renderHTML(t, c)

	for _, want := range []string{
		"applications-view-selector", "All jobs", "applications-stat-value",
		">2<", "Total tracked",
	} {
		if !strings.Contains(html, want) {
			t.Errorf("applications HTML missing %q\n%s", want, html)
		}
	}
}

func TestApplicationsViewDoesNotLoadJobsOnMount(t *testing.T) {
	m := &mockClient{
		applications: []ApplicationTracker{{ApplicationID: 7, JobPostID: 42, JobTitle: "Staff"}},
		jobs:         []JobSummary{{ID: 1, Title: "Eng", Company: "Acme"}},
	}
	c := &ApplicationsView{Client: m}
	renderHTML(t, c)
	if m.jobsCalls != 0 {
		t.Fatalf("jobs fetched on mount: calls = %d, want 0 (table view is lazy)", m.jobsCalls)
	}
}

func TestApplicationsViewDoShowTableLoadsJobs(t *testing.T) {
	m := &mockClient{jobs: []JobSummary{
		{ID: 1, Title: "Eng", Company: "Acme", Source: "linkedin", MatchScore: intPtr(80), ScoringStatus: "scored"},
	}}
	c := &ApplicationsView{Client: m}

	c.doShowTable(context.Background())

	if c.view != viewTable {
		t.Fatalf("view = %q, want %q", c.view, viewTable)
	}
	if m.jobsCalls != 1 || c.jobsState != loadDone || len(c.jobs) != 1 {
		t.Fatalf("unexpected table load: calls=%d state=%d jobs=%d", m.jobsCalls, c.jobsState, len(c.jobs))
	}

	// A second open must not refetch.
	c.doShowTable(context.Background())
	if m.jobsCalls != 1 {
		t.Fatalf("table refetched on reopen: calls = %d, want 1", m.jobsCalls)
	}
}

func TestApplicationsViewRendersJobsTable(t *testing.T) {
	c := &ApplicationsView{
		view:      viewTable,
		jobsState: loadDone,
		jobs: []JobSummary{
			{ID: 1, Title: "Staff Engineer", Company: "Acme", Source: "linkedin", MatchScore: intPtr(82), ScoringStatus: "scored"},
			{ID: 2, Title: "Backend Dev", Company: "Globex", Source: "glassdoor", MatchScore: nil, ScoringStatus: "pending"},
		},
	}
	var sb strings.Builder
	app.PrintHTML(&sb, c.renderTable())
	html := sb.String()

	for _, want := range []string{
		"jobs-table", "Staff Engineer", "Acme", "Backend Dev", "Globex",
		"/jobs/1", "/jobs/2", "82%", "job-score--high", "job-score--pending",
		"/web/icons/linkedin.svg", ">View<",
	} {
		if !strings.Contains(html, want) {
			t.Errorf("jobs table HTML missing %q\n%s", want, html)
		}
	}
}

func TestApplicationsViewTableEmpty(t *testing.T) {
	c := &ApplicationsView{view: viewTable, jobsState: loadDone, jobs: nil}
	var sb strings.Builder
	app.PrintHTML(&sb, c.renderTable())
	if !strings.Contains(sb.String(), "No jobs yet.") {
		t.Errorf("expected empty table state, got:\n%s", sb.String())
	}
}

func TestApplicationsViewEmpty(t *testing.T) {
	c := &ApplicationsView{Client: &mockClient{}}
	html := renderHTML(t, c)
	if !strings.Contains(html, "No tracked applications yet.") {
		t.Errorf("expected empty state, got:\n%s", html)
	}
}

func TestApplicationsViewUnauthorized(t *testing.T) {
	c := &ApplicationsView{Client: &mockClient{appsErr: &APIError{Status: http.StatusUnauthorized}}}
	html := renderHTML(t, c)
	if !strings.Contains(html, "session expired") {
		t.Errorf("expected unauthorized state, got:\n%s", html)
	}
}

func TestApplicationsViewNeverUpdatesStatusOnRender(t *testing.T) {
	m := &mockClient{applications: []ApplicationTracker{{ApplicationID: 7, JobPostID: 42, JobTitle: "Staff"}}}
	c := &ApplicationsView{Client: m}
	renderHTML(t, c)
	if m.updateAppStatusCalls != 0 {
		t.Fatalf("status update calls after render = %d, want 0", m.updateAppStatusCalls)
	}
}

func TestApplicationsViewDoStatusUpdate(t *testing.T) {
	m := &mockClient{
		applications: []ApplicationTracker{{ApplicationID: 7, JobPostID: 42, JobTitle: "Staff", PipelineStatus: "interested"}},
		updateAppStatus: ApplicationTracker{
			ApplicationID:  7,
			JobPostID:      42,
			JobTitle:       "Staff",
			PipelineStatus: "interviewing",
			PipelineStage:  "technical",
		},
	}
	c := &ApplicationsView{
		Client:       m,
		applications: m.applications,
	}

	c.doStatusUpdate(context.Background(), 7, ApplicationStatusUpdate{
		PipelineStatus: "interviewing",
		PipelineStage:  "technical",
	})

	if m.gotUpdateAppStatusID != 7 || m.gotUpdateAppStatus.PipelineStatus != "interviewing" {
		t.Fatalf("unexpected status update call: id=%d update=%+v", m.gotUpdateAppStatusID, m.gotUpdateAppStatus)
	}
	if c.statusErr != "" || c.savingID != 0 {
		t.Fatalf("unexpected update state: err=%q savingID=%d", c.statusErr, c.savingID)
	}
	if got := c.applications[0].PipelineStage; got != "technical" {
		t.Fatalf("updated application stage = %q, want technical", got)
	}
}

func TestApplicationsViewStatusUpdateError(t *testing.T) {
	m := &mockClient{
		applications:       []ApplicationTracker{{ApplicationID: 7, JobPostID: 42, JobTitle: "Staff"}},
		updateAppStatusErr: errors.New("boom"),
	}
	c := &ApplicationsView{Client: m, applications: m.applications}

	c.doStatusUpdate(context.Background(), 7, ApplicationStatusUpdate{PipelineStatus: "rejected"})

	if c.statusErr == "" {
		t.Fatal("expected status error")
	}
}
