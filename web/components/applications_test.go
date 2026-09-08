package components

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/maxence-charriere/go-app/v10/pkg/app"
)

func trackerJobs() []JobSummary {
	return []JobSummary{
		{
			ID: 42, Title: "Staff Engineer", Company: "Acme", Source: "linkedin",
			MatchScore: intPtr(82), ScoringStatus: "scored", CreatedAt: "2026-09-01T10:00:00Z",
			Application: &ApplicationTracker{
				ApplicationID: 7, JobPostID: 42, PipelineStatus: "applied", PipelineStage: "waiting",
				LastStatusChange: "2026-09-05T09:30:00Z",
			},
		},
		{
			ID: 43, Title: "Principal Engineer", Company: "Globex", Source: "glassdoor",
			ScoringStatus: "deferred", CreatedAt: "2026-09-03T10:00:00Z",
		},
	}
}

func TestApplicationsViewRendersTrackerRows(t *testing.T) {
	c := &ApplicationsView{Client: &mockClient{
		jobs:       trackerJobs(),
		jobsPage:   PageMeta{Number: 1, Size: 30, Total: 2},
		jobsCounts: ApplicationCounts{All: 2, NotApplied: 1, Applied: 1},
	}}
	html := renderHTML(t, c)

	for _, want := range []string{
		"Applications", "tracker-table", "Staff Engineer", "Acme", "/jobs/42",
		"Principal Engineer", "Globex", "/jobs/43",
		// Both a tracked and an untracked job get an inline status control; the
		// untracked one carries the "Not applied" placeholder.
		"tracker-status-select", "Not applied", "Waiting",
		"1 Sep 2026", "3 Sep 2026", "5 Sep 2026",
		// go-app renders element attributes from a map, so attribute order is
		// not stable — assert the active class and the Applications-tab href
		// separately rather than as one order-dependent substring.
		"app-tab-active", `href="/applications"`,
	} {
		if !strings.Contains(html, want) {
			t.Errorf("tracker HTML missing %q\n%s", want, html)
		}
	}
}

func TestApplicationsViewRendersGroupTabsWithCounts(t *testing.T) {
	c := &ApplicationsView{Client: &mockClient{
		jobs:       trackerJobs(),
		jobsCounts: ApplicationCounts{All: 12, NotApplied: 7, Applied: 3, InProgress: 1, Closed: 1},
	}}
	html := renderHTML(t, c)

	for _, want := range []string{
		"tracker-tabs", "All", "Not applied", "Applied", "In progress", "Closed",
		"tracker-tab-count", ">12<", ">7<", ">3<",
		// The header answers "how many have I actually applied to" — applied,
		// in progress, and closed all count as applied to.
		"Applied to", "Jobs tracked", ">5<",
	} {
		if !strings.Contains(html, want) {
			t.Errorf("tracker tabs HTML missing %q\n%s", want, html)
		}
	}
}

func TestApplicationsViewRequestsEveryIntakedJob(t *testing.T) {
	m := &mockClient{jobs: trackerJobs()}
	c := &ApplicationsView{Client: m}

	c.doLoad(context.Background())

	// status=all is the fix for the tracker showing nothing: the feed default
	// is scored-only, and triage leaves most intaked postings unscored.
	if m.gotParams.Status != "all" {
		t.Errorf("tracker requested status = %q, want all", m.gotParams.Status)
	}
	// Backlogged postings are still applyable, so the default bin spans both.
	if m.gotParams.State != jobStateOpen {
		t.Errorf("tracker requested state = %q, want %q", m.gotParams.State, jobStateOpen)
	}
	if m.gotParams.Sort != trackerSortNewest {
		t.Errorf("tracker requested sort = %q, want %q", m.gotParams.Sort, trackerSortNewest)
	}
	if m.gotParams.Application != groupAll {
		t.Errorf("tracker requested application group = %q, want all", m.gotParams.Application)
	}
	if c.state != loadDone || len(c.jobs) != 2 {
		t.Fatalf("unexpected load: state=%d jobs=%d", c.state, len(c.jobs))
	}
}

func TestApplicationsViewGroupTabFiltersServerSide(t *testing.T) {
	m := &mockClient{jobs: trackerJobs()}
	c := &ApplicationsView{Client: m}

	if !c.applyGroup(groupApplied) {
		t.Fatal("applyGroup should report a change")
	}
	if c.pageNum != 1 {
		t.Errorf("group change should reset paging, page = %d", c.pageNum)
	}
	if got := c.params().Application; got != groupApplied {
		t.Errorf("params application = %q, want %q", got, groupApplied)
	}
	// Re-selecting the active tab must not refetch.
	if c.applyGroup(groupApplied) {
		t.Error("re-selecting the active group should not report a change")
	}
}

func TestApplicationsViewBinAndSortControls(t *testing.T) {
	c := &ApplicationsView{Client: &mockClient{}}

	if !c.applyBin(jobStateRemoved) || c.params().State != jobStateRemoved {
		t.Fatalf("applyBin: state = %q", c.params().State)
	}
	if c.applyBin(jobStateRemoved) {
		t.Error("re-selecting the active bin should not report a change")
	}
	if !c.applySort(trackerSortActivity) || c.params().Sort != trackerSortActivity {
		t.Fatalf("applySort: sort = %q", c.params().Sort)
	}
	if c.applySort("") {
		t.Error("an empty sort value should be ignored")
	}
}

func TestApplicationsViewRendersControls(t *testing.T) {
	c := &ApplicationsView{Client: &mockClient{jobs: trackerJobs()}}
	html := renderHTML(t, c)

	for _, want := range []string{
		"tracker-bin-select", "Active + backlog", "Backlog only", "Removed",
		"tracker-sort-select", "Newest intake", "Recent activity", "Highest match",
	} {
		if !strings.Contains(html, want) {
			t.Errorf("tracker controls missing %q\n%s", want, html)
		}
	}
}

func TestApplicationsViewPagination(t *testing.T) {
	c := &ApplicationsView{
		state: loadDone,
		jobs:  trackerJobs(),
		page:  PageMeta{Number: 1, Size: 30, Total: 75, HasNext: true},
	}
	var sb strings.Builder
	app.PrintHTML(&sb, c.renderRows())
	for _, want := range []string{"Page 1 of 3", "Previous", "Next", "tracker-pagination"} {
		if !strings.Contains(sb.String(), want) {
			t.Errorf("tracker pagination missing %q\n%s", want, sb.String())
		}
	}

	if !c.applyNextPage() || c.pageNum != 2 {
		t.Fatalf("applyNextPage: page = %d, want 2", c.pageNum)
	}
	c.page.Number = 1
	if c.applyPrevPage() {
		t.Fatal("applyPrevPage should not advance below page 1")
	}
}

func TestApplicationsViewEmptyStatesExplainTheActiveTab(t *testing.T) {
	for group, want := range map[string]string{
		groupAll:        "No jobs intaked yet.",
		groupNotApplied: "Nothing left to apply to in this view.",
		groupApplied:    "No applications submitted yet.",
		groupInProgress: "Nothing in progress yet.",
		groupClosed:     "No closed applications yet.",
	} {
		c := &ApplicationsView{state: loadDone, group: group}
		var sb strings.Builder
		app.PrintHTML(&sb, c.renderRows())
		if !strings.Contains(sb.String(), want) {
			t.Errorf("group %q empty state missing %q\n%s", group, want, sb.String())
		}
	}
}

func TestApplicationsViewUnauthorized(t *testing.T) {
	c := &ApplicationsView{Client: &mockClient{jobsErr: &APIError{Status: http.StatusUnauthorized}}}
	html := renderHTML(t, c)
	if !strings.Contains(html, "session expired") {
		t.Errorf("expected unauthorized state, got:\n%s", html)
	}
}

func TestApplicationsViewNeverWritesStatusOnRender(t *testing.T) {
	m := &mockClient{jobs: trackerJobs()}
	c := &ApplicationsView{Client: m}
	renderHTML(t, c)
	if m.updateJobStatusCalls != 0 {
		t.Fatalf("status writes after render = %d, want 0", m.updateJobStatusCalls)
	}
	if m.createAppCalls != 0 || m.submitCalls != 0 {
		t.Fatalf("tracker must never draft or submit: create=%d submit=%d", m.createAppCalls, m.submitCalls)
	}
}

func TestApplicationsViewSetStatusWritesThroughJobEndpoint(t *testing.T) {
	m := &mockClient{
		jobs:            trackerJobs(),
		updateJobStatus: ApplicationTracker{ApplicationID: 9, JobPostID: 43, PipelineStatus: "applied"},
	}
	c := &ApplicationsView{Client: m, jobs: trackerJobs(), state: loadDone}

	c.doSetStatus(context.Background(), 43, "applied")

	// The job-post endpoint creates the Application on first use, so an
	// untracked row can be marked applied without a draft ever being generated.
	if m.gotUpdateJobStatusID != 43 || m.gotUpdateJobStatus.PipelineStatus != "applied" {
		t.Fatalf("unexpected status write: id=%d update=%+v", m.gotUpdateJobStatusID, m.gotUpdateJobStatus)
	}
	if m.createAppCalls != 0 || m.submitCalls != 0 {
		t.Fatalf("tracker must never draft or submit: create=%d submit=%d", m.createAppCalls, m.submitCalls)
	}
	// Rails owns which rows match the tab and the group tallies, so the write
	// is followed by a refetch rather than a local patch.
	if m.jobsCalls != 1 {
		t.Fatalf("jobs refetch after write = %d, want 1", m.jobsCalls)
	}
	if c.savingID != 0 || c.statusErr != "" {
		t.Fatalf("unexpected post-write state: savingID=%d err=%q", c.savingID, c.statusErr)
	}
}

func TestApplicationsViewSetStatusIgnoresNotAppliedPlaceholder(t *testing.T) {
	m := &mockClient{jobs: trackerJobs()}
	c := &ApplicationsView{Client: m, jobs: trackerJobs(), state: loadDone}

	c.doSetStatus(context.Background(), 43, notAppliedOption)

	// Untracking would destroy the application's draft and audit history, so
	// the placeholder is inert rather than a destructive reset.
	if m.updateJobStatusCalls != 0 {
		t.Fatalf("placeholder selection wrote status: calls = %d, want 0", m.updateJobStatusCalls)
	}
}

func TestApplicationsViewSetStatusError(t *testing.T) {
	m := &mockClient{jobs: trackerJobs(), updateJobStatusErr: errors.New("boom")}
	c := &ApplicationsView{Client: m, jobs: trackerJobs(), state: loadDone}

	c.doSetStatus(context.Background(), 43, "applied")

	if c.statusErr == "" {
		t.Fatal("expected status error")
	}
	if c.savingID != 0 {
		t.Fatalf("savingID should clear after a failed write, got %d", c.savingID)
	}
	// A failed write must not blank the rows the user was looking at.
	if len(c.jobs) != 2 {
		t.Fatalf("rows dropped after a failed write: %d", len(c.jobs))
	}
}

func TestTrackerGroupMapsPipelineStatus(t *testing.T) {
	cases := map[string]string{
		"":             groupNotApplied,
		"interested":   groupNotApplied,
		"drafting":     groupNotApplied,
		"needs_review": groupNotApplied,
		"applied":      groupApplied,
		"interviewing": groupInProgress,
		"offer":        groupInProgress,
		"rejected":     groupClosed,
		"withdrawn":    groupClosed,
		"archived":     groupClosed,
	}
	for status, want := range cases {
		if got := TrackerGroup(&ApplicationTracker{PipelineStatus: status}); got != want {
			t.Errorf("TrackerGroup(%q) = %q, want %q", status, got, want)
		}
	}
	if got := TrackerGroup(nil); got != groupNotApplied {
		t.Errorf("TrackerGroup(nil) = %q, want %q", got, groupNotApplied)
	}
}

func TestTrackerDateFormatting(t *testing.T) {
	if got := trackerDate("2026-09-05T09:30:00Z"); got != "5 Sep 2026" {
		t.Errorf("trackerDate = %q, want 5 Sep 2026", got)
	}
	if got := trackerDate(""); got != "—" {
		t.Errorf("trackerDate(empty) = %q, want an em dash", got)
	}
	if got := trackerUpdatedLabel(JobSummary{}); got != "—" {
		t.Errorf("trackerUpdatedLabel with no application = %q, want an em dash", got)
	}
}
