package components

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
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
		`class="app-tab app-tab-active" href="/applications"`,
	} {
		if !strings.Contains(html, want) {
			t.Errorf("applications HTML missing %q\n%s", want, html)
		}
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
