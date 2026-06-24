package components

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/maxence-charriere/go-app/v10/pkg/app"
)

// mockClient is an in-memory RailsClient for component/render tests so screens
// render without a backend (TESTING.md: mock the Rails client behind an
// interface).
type mockClient struct {
	loginErr  error
	loginPass string

	jobs      []JobSummary
	jobsPage  PageMeta
	jobsErr   error
	jobsCalls int
	gotParams JobFeedParams
	// unscoredJobs, when set, is returned instead of jobs when the requested
	// params carry status=unscored, so the unscored toggle is testable.
	unscoredJobs      []JobSummary
	unscoredJobsCalls int
	scoreJob          JobSummary
	scoreJobErr       error
	gotScoreJobID     int
	scoreJobCalls     int

	lifecycleResult []JobSummary
	lifecycleErr    error
	gotLifecycleIDs []int
	gotLifecycle    string
	lifecycleCalls  int

	job    JobDetail
	jobErr error
	gotID  int

	digest    Digest
	digestErr error

	batches        []IngestionBatch
	batchesPage    PageMeta
	batchesErr     error
	batchesCalls   int
	gotBatchesPage int

	createApp      CreateApplicationResult
	createAppErr   error
	gotCreateAppID int
	createAppCalls int

	draft      ApplicationDraft
	draftErr   error
	gotDraftID int

	updateDraft      ApplicationDraft
	updateDraftErr   error
	gotUpdateDraftID int
	updatedAutofill  AutofillPreview
	updateDraftCalls int

	submitResult SubmitResult
	submitErr    error
	gotSubmitID  int
	submitCalls  int

	applications []ApplicationTracker
	appsErr      error

	updateAppStatus      ApplicationTracker
	updateAppStatusErr   error
	gotUpdateAppStatusID int
	gotUpdateAppStatus   ApplicationStatusUpdate
	updateAppStatusCalls int
	updateJobStatus      ApplicationTracker
	updateJobStatusErr   error
	gotUpdateJobStatusID int
	gotUpdateJobStatus   ApplicationStatusUpdate
	updateJobStatusCalls int

	profile       Profile
	profileErr    error
	updated       ProfileEdit
	updateErr     error
	updateCalls   int
	vapidKey      string
	vapidErr      error
	subscribed    PushSubscription
	subscribeErr  error
	unsubEndpoint string
	unsubErr      error

	contacts      []ContactCandidate
	contactsErr   error
	gotContactsID int

	outreach        OutreachDraft
	outreachErr     error
	gotOutreachID   int
	gotOutreachTmpl string
	generateCalls   int

	createResult ManualJobResult
	createErr    error
	createInput  ManualJobInput
	createCalls  int
}

func (m *mockClient) Login(_ context.Context, passphrase string) error {
	m.loginPass = passphrase
	return m.loginErr
}

func (m *mockClient) Jobs(_ context.Context, params JobFeedParams) (JobPage, error) {
	m.jobsCalls++
	m.gotParams = params
	if m.jobsErr != nil {
		return JobPage{}, m.jobsErr
	}
	rows := m.jobs
	if params.Status == jobListUnscored {
		m.unscoredJobsCalls++
		rows = m.unscoredJobs
	}
	return JobPage{Jobs: rows, Page: m.jobsPage}, nil
}

func (m *mockClient) ScoreJobPost(_ context.Context, id int) (JobSummary, error) {
	m.gotScoreJobID = id
	m.scoreJobCalls++
	return m.scoreJob, m.scoreJobErr
}

func (m *mockClient) SetJobLifecycle(_ context.Context, ids []int, state string) ([]JobSummary, error) {
	m.lifecycleCalls++
	m.gotLifecycleIDs = ids
	m.gotLifecycle = state
	if m.lifecycleErr != nil {
		return nil, m.lifecycleErr
	}
	return m.lifecycleResult, nil
}

func (m *mockClient) Job(_ context.Context, id int) (JobDetail, error) {
	m.gotID = id
	return m.job, m.jobErr
}

func (m *mockClient) Digest(context.Context) (Digest, error) {
	return m.digest, m.digestErr
}

func (m *mockClient) IngestionBatches(_ context.Context, page int) (IngestionBatchPage, error) {
	m.batchesCalls++
	m.gotBatchesPage = page
	if m.batchesErr != nil {
		return IngestionBatchPage{}, m.batchesErr
	}
	return IngestionBatchPage{Batches: m.batches, Page: m.batchesPage}, nil
}

func (m *mockClient) CreateApplication(_ context.Context, jobID int) (CreateApplicationResult, error) {
	m.gotCreateAppID = jobID
	m.createAppCalls++
	return m.createApp, m.createAppErr
}

func (m *mockClient) ApplicationDraft(_ context.Context, id int) (ApplicationDraft, error) {
	m.gotDraftID = id
	return m.draft, m.draftErr
}

func (m *mockClient) UpdateApplicationDraft(_ context.Context, id int, autofill AutofillPreview) (ApplicationDraft, error) {
	m.gotUpdateDraftID = id
	m.updatedAutofill = autofill
	m.updateDraftCalls++
	if m.updateDraftErr != nil {
		return ApplicationDraft{}, m.updateDraftErr
	}
	if m.updateDraft.ApplicationID != 0 {
		return m.updateDraft, nil
	}
	draft := m.draft
	draft.Autofill = autofill
	draft.DraftReady = autofillReady(autofill)
	return draft, nil
}

func (m *mockClient) SubmitApplication(_ context.Context, id int) (SubmitResult, error) {
	m.gotSubmitID = id
	m.submitCalls++
	return m.submitResult, m.submitErr
}

func (m *mockClient) Applications(context.Context) ([]ApplicationTracker, error) {
	return m.applications, m.appsErr
}

func (m *mockClient) UpdateApplicationStatus(_ context.Context, id int, update ApplicationStatusUpdate) (ApplicationTracker, error) {
	m.gotUpdateAppStatusID = id
	m.gotUpdateAppStatus = update
	m.updateAppStatusCalls++
	return m.updateAppStatus, m.updateAppStatusErr
}

func (m *mockClient) UpdateJobApplicationStatus(_ context.Context, jobID int, update ApplicationStatusUpdate) (ApplicationTracker, error) {
	m.gotUpdateJobStatusID = jobID
	m.gotUpdateJobStatus = update
	m.updateJobStatusCalls++
	return m.updateJobStatus, m.updateJobStatusErr
}

func (m *mockClient) Profile(context.Context) (Profile, error) {
	return m.profile, m.profileErr
}

func (m *mockClient) UpdateProfile(_ context.Context, edit ProfileEdit) (Profile, error) {
	m.updated = edit
	m.updateCalls++
	if m.updateErr != nil {
		return Profile{}, m.updateErr
	}
	return m.profile, nil
}

func (m *mockClient) VAPIDPublicKey(context.Context) (string, error) {
	return m.vapidKey, m.vapidErr
}

func (m *mockClient) Subscribe(_ context.Context, sub PushSubscription) error {
	m.subscribed = sub
	return m.subscribeErr
}

func (m *mockClient) Unsubscribe(_ context.Context, endpoint string) error {
	m.unsubEndpoint = endpoint
	return m.unsubErr
}

func (m *mockClient) Contacts(_ context.Context, jobID int) ([]ContactCandidate, error) {
	m.gotContactsID = jobID
	return m.contacts, m.contactsErr
}

func (m *mockClient) GenerateOutreach(_ context.Context, candidateID int, looseTemplate string) (OutreachDraft, error) {
	m.gotOutreachID = candidateID
	m.gotOutreachTmpl = looseTemplate
	m.generateCalls++
	return m.outreach, m.outreachErr
}

func (m *mockClient) CreateJobPost(_ context.Context, input ManualJobInput) (ManualJobResult, error) {
	m.createInput = input
	m.createCalls++
	return m.createResult, m.createErr
}

// renderHTML loads a component in the go-app test engine, runs its full
// lifecycle (OnMount + async fetch + dispatch), and returns the rendered HTML
// so we can assert on rendered scored fields without a backend.
func renderHTML(t *testing.T, c app.Composer) string {
	t.Helper()
	e := app.NewTestEngine()
	if err := e.Load(c); err != nil {
		t.Fatalf("Load: %v", err)
	}
	e.ConsumeAll()

	var sb strings.Builder
	app.PrintHTML(&sb, c)
	return sb.String()
}

func intPtr(n int) *int { return &n }

func TestMatchScoreLabel(t *testing.T) {
	cases := []struct {
		name   string
		score  *int
		status string
		want   string
	}{
		{"scored zero", intPtr(0), "scored", "0%"},
		{"scored value", intPtr(82), "scored", "82%"},
		{"pending", nil, "pending", "Scoring…"},
		{"empty status", nil, "", "Scoring…"},
		{"filtered", nil, "filtered", "Filtered"},
		{"deferred", nil, "deferred", "Queued later"},
		{"skipped", nil, "skipped", "Not scored"},
		{"failed", nil, "failed", "Scoring failed"},
		{"unknown nil", nil, "weird", "Not scored"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := MatchScoreLabel(tc.score, tc.status); got != tc.want {
				t.Errorf("MatchScoreLabel(%v,%q) = %q, want %q", tc.score, tc.status, got, tc.want)
			}
		})
	}
}

func TestRouteLabel(t *testing.T) {
	cases := []struct {
		route JobRoute
		want  string
	}{
		{JobRoute{RecommendedRoute: "direct_ats", RouteType: "greenhouse"}, "direct_ats"},
		{JobRoute{RouteType: "linkedin_easy_apply"}, "linkedin_easy_apply"},
		{JobRoute{}, "unknown"},
	}
	for _, tc := range cases {
		if got := RouteLabel(tc.route); got != tc.want {
			t.Errorf("RouteLabel(%+v) = %q, want %q", tc.route, got, tc.want)
		}
	}
}

func TestJobIDFromPath(t *testing.T) {
	cases := []struct {
		path   string
		wantID int
		wantOK bool
	}{
		{"/jobs/42", 42, true},
		{"/jobs/1", 1, true},
		{"/jobs/", 0, false},
		{"/jobs", 0, false},
		{"/jobs/abc", 0, false},
		{"/other/3", 0, false},
	}
	for _, tc := range cases {
		id, ok := jobIDFromPath(tc.path)
		if id != tc.wantID || ok != tc.wantOK {
			t.Errorf("jobIDFromPath(%q) = (%d,%v), want (%d,%v)", tc.path, id, ok, tc.wantID, tc.wantOK)
		}
	}
}

func TestJobListRendersScoredFields(t *testing.T) {
	c := &JobList{Client: &mockClient{
		jobs: []JobSummary{
			{ID: 7, Title: "Staff Engineer", Company: "Acme", MatchScore: intPtr(88), ScoringStatus: "scored"},
			{ID: 9, Title: "Backend Dev", Company: "Globex", MatchScore: nil, ScoringStatus: "pending"},
		},
	}}
	html := renderHTML(t, c)

	for _, want := range []string{"Scored", "Unscored", "Staff Engineer", "Acme", "88%", "Backend Dev", "Globex", "Scoring…", "/jobs/7", "/jobs/9"} {
		if !strings.Contains(html, want) {
			t.Errorf("job list HTML missing %q\n%s", want, html)
		}
	}
}

func TestJobListRendersUnscoredFieldsAndScoreButtons(t *testing.T) {
	c := &JobList{
		view: jobListUnscored,
		Client: &mockClient{
			unscoredJobs: []JobSummary{
				{ID: 7, Title: "CAD Technician", Company: "DraftCo", ScoringStatus: "filtered", TriageStatus: "rejected"},
				{ID: 9, Title: "Backend Developer", Company: "CapCo", ScoringStatus: "deferred", TriageStatus: "eligible"},
			},
		},
	}
	html := renderHTML(t, c)

	for _, want := range []string{"CAD Technician", "Filtered", "Backend Developer", "Queued later", "Score", "/jobs/7"} {
		if !strings.Contains(html, want) {
			t.Errorf("unscored job list HTML missing %q\n%s", want, html)
		}
	}
}

func TestJobListDoScoreJob(t *testing.T) {
	m := &mockClient{scoreJob: JobSummary{ID: 7, Title: "Backend Developer", Company: "CapCo", ScoringStatus: "pending"}}
	c := &JobList{
		view:   jobListUnscored,
		Client: m,
		jobs:   []JobSummary{{ID: 7, Title: "Backend Developer", Company: "CapCo", ScoringStatus: "filtered"}},
	}

	c.doScoreJob(context.Background(), 7)

	if m.scoreJobCalls != 1 || m.gotScoreJobID != 7 {
		t.Fatalf("ScoreJobPost calls = %d id = %d, want 1 id 7", m.scoreJobCalls, m.gotScoreJobID)
	}
	if c.jobs[0].ScoringStatus != "pending" {
		t.Fatalf("job status = %q, want pending", c.jobs[0].ScoringStatus)
	}
	if c.scoreState(7) != scoreIdle || c.scoreErr(7) != "" {
		t.Fatalf("score state = %d err = %q, want idle with no error", c.scoreState(7), c.scoreErr(7))
	}
}

func TestJobListNeverScoresOnRender(t *testing.T) {
	m := &mockClient{unscoredJobs: []JobSummary{{ID: 7, Title: "Backend Developer", Company: "CapCo", ScoringStatus: "filtered"}}}
	c := &JobList{view: jobListUnscored, Client: m}

	_ = renderHTML(t, c)

	if m.scoreJobCalls != 0 {
		t.Fatalf("ScoreJobPost called on render: %d", m.scoreJobCalls)
	}
}

func TestSourceLabel(t *testing.T) {
	cases := map[string]string{
		"linkedin":    "LinkedIn",
		"glassdoor":   "Glassdoor",
		"indeed":      "Indeed",
		"manual":      "Manual entry",
		"inbound_llm": "Email alert",
		"":            "",
		"weird":       "weird",
	}
	for source, want := range cases {
		if got := SourceLabel(source); got != want {
			t.Errorf("SourceLabel(%q) = %q, want %q", source, got, want)
		}
	}
}

func TestMatchScoreBand(t *testing.T) {
	cases := []struct {
		score  *int
		status string
		want   string
	}{
		{nil, "pending", "pending"},
		{nil, "skipped", "pending"},
		{intPtr(90), "scored", "high"},
		{intPtr(75), "scored", "high"},
		{intPtr(74), "scored", "mid"},
		{intPtr(50), "scored", "mid"},
		{intPtr(49), "scored", "low"},
		{intPtr(0), "scored", "low"},
	}
	for _, tc := range cases {
		if got := MatchScoreBand(tc.score, tc.status); got != tc.want {
			t.Errorf("MatchScoreBand(%v,%q) = %q, want %q", tc.score, tc.status, got, tc.want)
		}
	}
}

func TestSourceIconPath(t *testing.T) {
	cases := map[string]string{
		"linkedin":    "/web/icons/linkedin.svg",
		"glassdoor":   "/web/icons/glassdoor.svg",
		"indeed":      "/web/icons/indeed.svg",
		"manual":      "",
		"inbound_llm": "",
		"":            "",
	}
	for source, want := range cases {
		if got := SourceIconPath(source); got != want {
			t.Errorf("SourceIconPath(%q) = %q, want %q", source, got, want)
		}
	}
}

func TestSourceEmoji(t *testing.T) {
	cases := map[string]string{
		"manual":      "✍️",
		"inbound_llm": "📧",
		"inbound":     "📧",
		"linkedin":    "", // branded sources render a logo, not an emoji
		"glassdoor":   "",
		"":            "",
	}
	for source, want := range cases {
		if got := SourceEmoji(source); got != want {
			t.Errorf("SourceEmoji(%q) = %q, want %q", source, got, want)
		}
	}
}

func TestJobListRendersScoreBandAndSourceLogo(t *testing.T) {
	c := &JobList{Client: &mockClient{
		jobs: []JobSummary{
			{ID: 7, Title: "Staff Engineer", Company: "Acme", Source: "linkedin", MatchScore: intPtr(88), ScoringStatus: "scored"},
			{ID: 9, Title: "Backend Dev", Company: "Globex", Source: "manual", MatchScore: nil, ScoringStatus: "pending"},
		},
	}}
	html := renderHTML(t, c)
	for _, want := range []string{"job-score--high", "job-score--pending", "job-source-logo", "/web/icons/linkedin.svg", "✍️"} {
		if !strings.Contains(html, want) {
			t.Errorf("job list HTML missing %q\n%s", want, html)
		}
	}
}

func TestJobListRendersSourceOrigin(t *testing.T) {
	c := &JobList{Client: &mockClient{
		jobs: []JobSummary{
			{ID: 7, Title: "Staff Engineer", Company: "Acme", Source: "linkedin", MatchScore: intPtr(88), ScoringStatus: "scored"},
			{ID: 9, Title: "Backend Dev", Company: "Globex", Source: "glassdoor", MatchScore: nil, ScoringStatus: "pending"},
		},
	}}
	html := renderHTML(t, c)

	for _, want := range []string{"LinkedIn", "Glassdoor"} {
		if !strings.Contains(html, want) {
			t.Errorf("job list HTML missing source origin %q\n%s", want, html)
		}
	}
}

func TestJobListDefaultParams(t *testing.T) {
	m := &mockClient{jobs: []JobSummary{{ID: 1, Title: "Eng", Company: "Acme"}}}
	c := &JobList{Client: m}
	renderHTML(t, c)
	got := m.gotParams
	if got.Status != jobListScored || got.State != jobStateActive || got.Sort != jobSortOldest || got.Page != 1 {
		t.Fatalf("default params = %+v, want scored/active/oldest/page1", got)
	}
}

func TestJobListRendersControls(t *testing.T) {
	m := &mockClient{jobs: []JobSummary{{ID: 1, Title: "Eng", Company: "Acme"}}, jobsPage: PageMeta{Number: 1, Size: 30, Total: 1, HasNext: false}}
	c := &JobList{Client: m}
	html := renderHTML(t, c)
	for _, want := range []string{
		"job-bin-tabs", "Active", "Backlog", "Removed",
		"job-filters", "job-filter-score-band", "job-filter-source",
		"job-filter-location", "job-filter-date-from", "job-filter-date-to",
		"job-filter-sort", "Oldest first", "Highest score",
		"job-pagination", "job-page-prev", "job-page-next", "Page 1 of 1",
	} {
		if !strings.Contains(html, want) {
			t.Errorf("job list HTML missing control %q\n%s", want, html)
		}
	}
}

func TestJobListApplyBinResetsAndRequestsState(t *testing.T) {
	c := &JobList{pageNum: 3, jobs: []JobSummary{{ID: 1}}}
	c.normalizeDefaults()
	c.applyBin(jobStateBacklog)
	if c.bin != jobStateBacklog {
		t.Fatalf("bin = %q, want backlog", c.bin)
	}
	if c.pageNum != 1 || c.jobs != nil {
		t.Fatalf("expected feed reset to page 1 with cleared rows, got page %d jobs %v", c.pageNum, c.jobs)
	}
	if got := c.feedParams(); got.State != jobStateBacklog || got.Page != 1 {
		t.Fatalf("feedParams = %+v, want backlog page 1", got)
	}
}

func TestJobListApplyFiltersFeedIntoParams(t *testing.T) {
	c := &JobList{}
	c.normalizeDefaults()
	c.applyScoreBand("high")
	c.applySource("linkedin")
	c.applyLocation("Vancouver")
	c.applyDateFrom("2026-06-01")
	c.applyDateTo("2026-06-23")
	c.applySort(jobSortScore)

	got := c.feedParams()
	if got.ScoreBand != "high" || got.Source != "linkedin" || got.Location != "Vancouver" ||
		got.DateFrom != "2026-06-01" || got.DateTo != "2026-06-23" || got.Sort != jobSortScore {
		t.Fatalf("feedParams = %+v", got)
	}
	if got.Page != 1 {
		t.Fatalf("changing a filter should reset to page 1, got %d", got.Page)
	}
}

func TestJobListPagingRespectsEnvelope(t *testing.T) {
	c := &JobList{}
	c.normalizeDefaults()
	// No next page advertised: Next is a no-op.
	c.page = PageMeta{Number: 1, HasNext: false}
	if c.applyNextPage() {
		t.Fatalf("applyNextPage advanced past the last page")
	}
	// Next page advertised: advance.
	c.page = PageMeta{Number: 1, HasNext: true}
	if !c.applyNextPage() || c.pageNum != 2 {
		t.Fatalf("applyNextPage did not advance to page 2, page=%d", c.pageNum)
	}
	// Prev from page 1 is a no-op; from page 2 it steps back.
	if !c.applyPrevPage() || c.pageNum != 1 {
		t.Fatalf("applyPrevPage did not step back to page 1, page=%d", c.pageNum)
	}
	if c.applyPrevPage() {
		t.Fatalf("applyPrevPage stepped before page 1")
	}
}

func TestJobListNeverFetchesOnControlRender(t *testing.T) {
	m := &mockClient{jobs: []JobSummary{{ID: 1, Title: "Eng", Company: "Acme"}}}
	c := &JobList{Client: m}
	renderHTML(t, c)
	// Exactly one fetch — the initial mount/pre-render load. Rendering the
	// filter/sort/bin/pagination controls must not trigger extra fetches.
	if m.jobsCalls != 1 {
		t.Fatalf("jobs fetched %d times on render, want exactly 1 (initial load)", m.jobsCalls)
	}
}

func TestJobListUnscoredBinEmptyText(t *testing.T) {
	c := &JobList{bin: jobStateBacklog, Client: &mockClient{jobs: nil}}
	html := renderHTML(t, c)
	if !strings.Contains(html, "No jobs in the backlog.") {
		t.Errorf("expected backlog empty state, got:\n%s", html)
	}
}

func TestJobListEmpty(t *testing.T) {
	c := &JobList{Client: &mockClient{jobs: nil}}
	html := renderHTML(t, c)
	if !strings.Contains(html, "No scored jobs yet.") {
		t.Errorf("expected empty state, got:\n%s", html)
	}
}

func TestJobListError(t *testing.T) {
	c := &JobList{Client: &mockClient{jobsErr: errors.New("boom")}}
	html := renderHTML(t, c)
	if !strings.Contains(html, "Could not load data") {
		t.Errorf("expected error state, got:\n%s", html)
	}
}

func TestJobListRendersLifecycleControls(t *testing.T) {
	// Active bin: rows expose Backlog + Remove and the bulk Backlog/Remove bar.
	active := &JobList{Client: &mockClient{jobs: []JobSummary{{ID: 7, Title: "Eng", Company: "Acme"}}}}
	html := renderHTML(t, active)
	for _, want := range []string{
		"job-select", "job-lifecycle-backlog", "job-lifecycle-remove",
		"job-bulk-actions", "job-bulk-backlog", "job-bulk-remove", "selected",
	} {
		if !strings.Contains(html, want) {
			t.Errorf("active job list missing lifecycle control %q\n%s", want, html)
		}
	}
	if strings.Contains(html, "job-lifecycle-restore") {
		t.Errorf("active bin should not offer Restore\n%s", html)
	}

	// Backlog bin: rows expose Restore and the bulk Restore bar.
	backlog := &JobList{bin: jobStateBacklog, Client: &mockClient{jobs: []JobSummary{{ID: 7, Title: "Eng", Company: "Acme"}}}}
	html = renderHTML(t, backlog)
	for _, want := range []string{"job-lifecycle-restore", "job-bulk-restore"} {
		if !strings.Contains(html, want) {
			t.Errorf("backlog job list missing %q\n%s", want, html)
		}
	}
	if strings.Contains(html, "job-lifecycle-backlog") {
		t.Errorf("backlog bin should not offer Backlog action\n%s", html)
	}
}

func TestJobListNeverMutatesLifecycleOnRender(t *testing.T) {
	m := &mockClient{jobs: []JobSummary{{ID: 7, Title: "Eng", Company: "Acme"}}}
	c := &JobList{Client: m}
	_ = renderHTML(t, c)
	if m.lifecycleCalls != 0 {
		t.Fatalf("SetJobLifecycle called on render: %d, want 0", m.lifecycleCalls)
	}
}

func TestJobListDoSetLifecycleSingleRemovesRow(t *testing.T) {
	m := &mockClient{lifecycleResult: []JobSummary{{ID: 7, LifecycleState: jobStateBacklog}}}
	c := &JobList{
		Client: m,
		jobs:   []JobSummary{{ID: 7, Title: "Eng"}, {ID: 9, Title: "Dev"}},
	}
	c.normalizeDefaults()

	c.doSetLifecycle(context.Background(), []int{7}, jobStateBacklog)

	if m.lifecycleCalls != 1 || m.gotLifecycle != jobStateBacklog {
		t.Fatalf("SetJobLifecycle calls=%d state=%q, want 1 backlog", m.lifecycleCalls, m.gotLifecycle)
	}
	if len(m.gotLifecycleIDs) != 1 || m.gotLifecycleIDs[0] != 7 {
		t.Fatalf("lifecycle ids = %v, want [7]", m.gotLifecycleIDs)
	}
	// The transitioned row leaves the active view; the other stays.
	if len(c.jobs) != 1 || c.jobs[0].ID != 9 {
		t.Fatalf("rows after transition = %+v, want only id 9", c.jobs)
	}
	if c.lifecycleBusy || c.lifecycleErr != "" {
		t.Fatalf("unexpected lifecycle state: busy=%v err=%q", c.lifecycleBusy, c.lifecycleErr)
	}
}

func TestJobListDoSetLifecycleBulk(t *testing.T) {
	m := &mockClient{lifecycleResult: []JobSummary{
		{ID: 7, LifecycleState: jobStateRemoved}, {ID: 9, LifecycleState: jobStateRemoved},
	}}
	c := &JobList{
		Client:   m,
		jobs:     []JobSummary{{ID: 7}, {ID: 9}, {ID: 11}},
		selected: map[int]bool{7: true, 9: true},
	}
	c.normalizeDefaults()

	ids := c.selectedIDs()
	c.doSetLifecycle(context.Background(), ids, jobStateRemoved)

	if m.lifecycleCalls != 1 || len(m.gotLifecycleIDs) != 2 {
		t.Fatalf("bulk lifecycle ids = %v calls=%d, want 2 ids", m.gotLifecycleIDs, m.lifecycleCalls)
	}
	// Both selected rows leave the view; selection is cleared; id 11 remains.
	if len(c.jobs) != 1 || c.jobs[0].ID != 11 {
		t.Fatalf("rows after bulk = %+v, want only id 11", c.jobs)
	}
	if c.selectedCount() != 0 {
		t.Fatalf("selection not cleared after bulk, count=%d", c.selectedCount())
	}
}

func TestJobListDoSetLifecycleRestore(t *testing.T) {
	m := &mockClient{lifecycleResult: []JobSummary{{ID: 7, LifecycleState: jobStateActive}}}
	c := &JobList{
		bin:    jobStateRemoved,
		Client: m,
		jobs:   []JobSummary{{ID: 7, Title: "Eng"}},
	}
	c.normalizeDefaults()

	c.doSetLifecycle(context.Background(), []int{7}, jobStateActive)

	if m.gotLifecycle != jobStateActive {
		t.Fatalf("restore state = %q, want active", m.gotLifecycle)
	}
	// Restored row leaves the Removed bin view.
	if len(c.jobs) != 0 {
		t.Fatalf("rows after restore = %+v, want empty", c.jobs)
	}
}

func TestJobListDoSetLifecycleError(t *testing.T) {
	m := &mockClient{lifecycleErr: &APIError{Status: http.StatusInternalServerError}}
	c := &JobList{Client: m, jobs: []JobSummary{{ID: 7}}}
	c.normalizeDefaults()

	c.doSetLifecycle(context.Background(), []int{7}, jobStateBacklog)

	if c.lifecycleErr == "" {
		t.Fatalf("expected a lifecycle error message")
	}
	// On error the row stays in the view.
	if len(c.jobs) != 1 {
		t.Fatalf("rows after failed transition = %+v, want unchanged", c.jobs)
	}
}

func TestJobListToggleSelect(t *testing.T) {
	c := &JobList{}
	c.applyToggleSelect(7)
	if !c.isSelected(7) || c.selectedCount() != 1 {
		t.Fatalf("expected id 7 selected, count 1")
	}
	c.applyToggleSelect(7)
	if c.isSelected(7) || c.selectedCount() != 0 {
		t.Fatalf("expected id 7 deselected, count 0")
	}
}

func TestJobListUnauthorized(t *testing.T) {
	c := &JobList{Client: &mockClient{jobsErr: &APIError{Status: http.StatusUnauthorized}}}
	html := renderHTML(t, c)
	if !strings.Contains(html, "session expired") {
		t.Errorf("expected session-expired message, got:\n%s", html)
	}
	for _, want := range []string{"Sign in", `href="/login"`} {
		if !strings.Contains(html, want) {
			t.Errorf("expected unauthorized state to include %q, got:\n%s", want, html)
		}
	}
}

func TestJobDetailRendersScoredFields(t *testing.T) {
	c := &JobDetailView{
		JobID: 7,
		Client: &mockClient{job: JobDetail{
			ID:                   7,
			Title:                "Staff Engineer",
			Company:              "Acme",
			MatchScore:           intPtr(88),
			ScoringStatus:        "scored",
			Summary:              "Great role for a platform generalist.",
			RelevantRequirements: []string{"Go", "Distributed systems"},
			MissingRequirements:  []string{"Kubernetes"},
			RedFlags:             []string{"On-call rotation heavy"},
			ResumeAlignment:      "Strong alignment on backend depth.",
			ApplicationStrategy:  "Lead with the payments platform project.",
			Route: JobRoute{
				RouteType:        "greenhouse",
				RecommendedRoute: "direct_ats",
				ApplicationURL:   "https://boards.greenhouse.io/acme/jobs/7",
			},
		}},
	}
	html := renderHTML(t, c)

	for _, want := range []string{
		"Staff Engineer", "Acme", "88%",
		"Great role for a platform generalist.",
		"Go", "Distributed systems",
		"Kubernetes", "On-call rotation heavy",
		"Strong alignment on backend depth.",
		"Lead with the payments platform project.",
		"direct_ats", "https://boards.greenhouse.io/acme/jobs/7",
	} {
		if !strings.Contains(html, want) {
			t.Errorf("job detail HTML missing %q\n%s", want, html)
		}
	}
}

func TestJobDetailFetchesByID(t *testing.T) {
	m := &mockClient{job: JobDetail{ID: 42, Title: "X", Company: "Y"}}
	c := &JobDetailView{JobID: 42, Client: m}
	renderHTML(t, c)
	if m.gotID != 42 {
		t.Errorf("Job called with id %d, want 42", m.gotID)
	}
}

func TestJobDetailRendersApplyButton(t *testing.T) {
	c := &JobDetailView{JobID: 7, Client: &mockClient{job: JobDetail{ID: 7, Title: "X", Company: "Y"}}}
	html := renderHTML(t, c)
	for _, want := range []string{"job-apply-button", "Apply"} {
		if !strings.Contains(html, want) {
			t.Errorf("job detail HTML missing apply control %q\n%s", want, html)
		}
	}
}

func TestJobDetailRendersPipelineStatusControls(t *testing.T) {
	c := &JobDetailView{
		JobID: 7,
		Client: &mockClient{job: JobDetail{
			ID:      7,
			Title:   "Staff",
			Company: "Acme",
			Application: &ApplicationTracker{
				ApplicationID:  9,
				JobPostID:      7,
				PipelineStatus: "interviewing",
				PipelineStage:  "technical",
			},
		}},
	}
	html := renderHTML(t, c)
	for _, want := range []string{"Application status", "pipeline-status-select", "pipeline-stage-select", "Interviewing", "Technical"} {
		if !strings.Contains(html, want) {
			t.Errorf("job detail HTML missing status control %q\n%s", want, html)
		}
	}
}

// TestJobDetailNeverAppliesOnRender asserts the apply action is explicit: a full
// render lifecycle (OnMount/OnPreRender) must never start an application.
func TestJobDetailNeverAppliesOnRender(t *testing.T) {
	m := &mockClient{job: JobDetail{ID: 7, Title: "X", Company: "Y"}}
	c := &JobDetailView{JobID: 7, Client: m}
	renderHTML(t, c)
	if m.createAppCalls != 0 {
		t.Errorf("apply ran on render: createAppCalls = %d, want 0", m.createAppCalls)
	}
}

func TestJobDetailNeverUpdatesPipelineStatusOnRender(t *testing.T) {
	m := &mockClient{job: JobDetail{ID: 7, Title: "X", Company: "Y"}}
	c := &JobDetailView{JobID: 7, Client: m}
	renderHTML(t, c)
	if m.updateJobStatusCalls != 0 {
		t.Fatalf("job status update calls after render = %d, want 0", m.updateJobStatusCalls)
	}
}

func TestJobDetailDoJobStatusUpdate(t *testing.T) {
	m := &mockClient{
		job: JobDetail{ID: 7, Title: "X", Company: "Y"},
		updateJobStatus: ApplicationTracker{
			ApplicationID:  11,
			JobPostID:      7,
			PipelineStatus: "applied",
			PipelineStage:  "waiting",
		},
	}
	c := &JobDetailView{JobID: 7, Client: m}

	c.doJobStatusUpdate(context.Background(), ApplicationStatusUpdate{PipelineStatus: "applied"})

	if m.gotUpdateJobStatusID != 7 || m.gotUpdateJobStatus.PipelineStatus != "applied" {
		t.Fatalf("unexpected job status call: id=%d update=%+v", m.gotUpdateJobStatusID, m.gotUpdateJobStatus)
	}
	if c.statusErr != "" || c.statusSaving {
		t.Fatalf("unexpected status state: err=%q saving=%v", c.statusErr, c.statusSaving)
	}
	if c.job.Application == nil || c.job.Application.PipelineStage != "waiting" {
		t.Fatalf("job application not updated: %+v", c.job.Application)
	}
}

func TestJobDetailApplyHappyPath(t *testing.T) {
	m := &mockClient{createApp: CreateApplicationResult{ApplicationID: 31, Status: "draft"}}
	c := &JobDetailView{JobID: 7, Client: m}
	appID, ok := c.doApply(context.Background())
	if !ok || appID != 31 {
		t.Fatalf("doApply = (%d, %v), want (31, true)", appID, ok)
	}
	if m.createAppCalls != 1 || m.gotCreateAppID != 7 {
		t.Errorf("CreateApplication calls=%d jobID=%d, want calls=1 jobID=7", m.createAppCalls, m.gotCreateAppID)
	}
	if c.applyState != applyIdle {
		t.Errorf("applyState = %d, want applyIdle", c.applyState)
	}
}

func TestJobDetailApplyError(t *testing.T) {
	m := &mockClient{createAppErr: &APIError{Status: http.StatusInternalServerError}}
	c := &JobDetailView{JobID: 7, Client: m}
	appID, ok := c.doApply(context.Background())
	if ok || appID != 0 {
		t.Fatalf("doApply = (%d, %v), want (0, false)", appID, ok)
	}
	if c.applyState != applyError || c.applyErr == "" {
		t.Errorf("expected applyError state with message, got state=%d err=%q", c.applyState, c.applyErr)
	}
}

func TestJobDetailRendersLifecycleControls(t *testing.T) {
	// Active job: Backlog + Remove.
	active := &JobDetailView{JobID: 7, Client: &mockClient{job: JobDetail{
		ID: 7, Title: "X", Company: "Y", LifecycleState: jobStateActive,
	}}}
	html := renderHTML(t, active)
	for _, want := range []string{"Intake", "job-lifecycle-backlog", "job-lifecycle-remove"} {
		if !strings.Contains(html, want) {
			t.Errorf("active job detail missing lifecycle control %q\n%s", want, html)
		}
	}

	// Removed job: Restore.
	removed := &JobDetailView{JobID: 7, Client: &mockClient{job: JobDetail{
		ID: 7, Title: "X", Company: "Y", LifecycleState: jobStateRemoved,
	}}}
	html = renderHTML(t, removed)
	if !strings.Contains(html, "job-lifecycle-restore") {
		t.Errorf("removed job detail missing Restore control\n%s", html)
	}
}

func TestJobDetailNeverMutatesLifecycleOnRender(t *testing.T) {
	m := &mockClient{job: JobDetail{ID: 7, Title: "X", Company: "Y"}}
	c := &JobDetailView{JobID: 7, Client: m}
	renderHTML(t, c)
	if m.lifecycleCalls != 0 {
		t.Fatalf("SetJobLifecycle ran on render: %d, want 0", m.lifecycleCalls)
	}
}

func TestJobDetailDoSetLifecycle(t *testing.T) {
	m := &mockClient{
		job:             JobDetail{ID: 7, Title: "X", Company: "Y", LifecycleState: jobStateActive},
		lifecycleResult: []JobSummary{{ID: 7, LifecycleState: jobStateBacklog}},
	}
	c := &JobDetailView{JobID: 7, Client: m, job: m.job}

	c.doSetLifecycle(context.Background(), jobStateBacklog)

	if m.lifecycleCalls != 1 || m.gotLifecycle != jobStateBacklog {
		t.Fatalf("SetJobLifecycle calls=%d state=%q, want 1 backlog", m.lifecycleCalls, m.gotLifecycle)
	}
	if len(m.gotLifecycleIDs) != 1 || m.gotLifecycleIDs[0] != 7 {
		t.Fatalf("lifecycle ids = %v, want [7]", m.gotLifecycleIDs)
	}
	if c.job.LifecycleState != jobStateBacklog {
		t.Fatalf("detail lifecycle state = %q, want backlog", c.job.LifecycleState)
	}
	if c.lifecycleBusy || c.lifecycleErr != "" {
		t.Fatalf("unexpected lifecycle state: busy=%v err=%q", c.lifecycleBusy, c.lifecycleErr)
	}
}

func TestJobDetailDoSetLifecycleError(t *testing.T) {
	m := &mockClient{
		job:          JobDetail{ID: 7, LifecycleState: jobStateActive},
		lifecycleErr: &APIError{Status: http.StatusInternalServerError},
	}
	c := &JobDetailView{JobID: 7, Client: m, job: m.job}

	c.doSetLifecycle(context.Background(), jobStateRemoved)

	if c.lifecycleErr == "" {
		t.Fatalf("expected a lifecycle error message")
	}
	if c.job.LifecycleState != jobStateActive {
		t.Fatalf("lifecycle state changed on error: %q", c.job.LifecycleState)
	}
}

func TestDigestRendersBatches(t *testing.T) {
	c := &DigestView{Client: &mockClient{batches: []IngestionBatch{
		{
			ID: "glassdoor-1", Source: "glassdoor", Date: "2026-06-23",
			IngestedAt: "2026-06-23T08:04:00Z", Count: 2,
			Jobs: []JobSummary{
				{ID: 3, Title: "Platform Eng", Company: "Initech", MatchScore: intPtr(75), ScoringStatus: "scored"},
				{ID: 4, Title: "Backend Dev", Company: "Hooli", MatchScore: intPtr(40), ScoringStatus: "scored"},
			},
		},
		{
			ID: "linkedin-1", Source: "linkedin", Date: "2026-06-22",
			IngestedAt: "2026-06-22T07:31:00Z", Count: 1,
			Jobs: []JobSummary{
				{ID: 5, Title: "Staff Eng", Company: "Acme", MatchScore: intPtr(90), ScoringStatus: "scored"},
			},
		},
	}}}
	html := renderHTML(t, c)

	// Source labels + counts on the batch summaries.
	for _, want := range []string{"Recent ingestions", "Glassdoor", "LinkedIn", "2 jobs", "1 job"} {
		if !strings.Contains(html, want) {
			t.Errorf("batch HTML missing %q\n%s", want, html)
		}
	}
	// Each posting in each batch is rendered and links to its detail.
	for _, want := range []string{"Platform Eng", "Backend Dev", "Staff Eng", "/jobs/3", "/jobs/4", "/jobs/5"} {
		if !strings.Contains(html, want) {
			t.Errorf("batch HTML missing posting %q\n%s", want, html)
		}
	}
}

func TestDigestLinksCarryBatchProvenance(t *testing.T) {
	c := &DigestView{Client: &mockClient{batches: []IngestionBatch{
		{
			ID: "glassdoor-1", Source: "glassdoor", Date: "2026-06-23", Count: 1,
			Jobs: []JobSummary{{ID: 3, Title: "Platform Eng", Company: "Initech"}},
		},
	}}}
	html := renderHTML(t, c)

	// Each posting link records that it came from the digest and which batch,
	// so the job detail's back link can return to the expanded batch.
	for _, want := range []string{"/jobs/3?from=digest", "batch=glassdoor-1"} {
		if !strings.Contains(html, want) {
			t.Errorf("digest link missing provenance %q\n%s", want, html)
		}
	}
}

func TestDigestReopensBatchFromQuery(t *testing.T) {
	c := &DigestView{batches: []IngestionBatch{
		{ID: "glassdoor-1", Source: "glassdoor", Date: "2026-06-23", Count: 1,
			Jobs: []JobSummary{{ID: 3, Title: "Platform Eng"}}},
		{ID: "linkedin-1", Source: "linkedin", Date: "2026-06-22", Count: 1,
			Jobs: []JobSummary{{ID: 5, Title: "Staff Eng"}}},
	}}
	// Render the batch list directly (the OnMount/OnPreRender lifecycle would
	// re-read openBatch from the URL, which the test engine leaves empty).
	c.openBatch = "linkedin-1"
	var sb strings.Builder
	app.PrintHTML(&sb, c.renderBatches())
	html := sb.String()

	// The matching batch is expanded; the other stays collapsed. go-app emits
	// the boolean `open` attribute only on the open <details>.
	if got := strings.Count(html, "<details"); got != 2 {
		t.Fatalf("expected 2 batch blocks, got %d\n%s", got, html)
	}
	if strings.Count(html, " open") != 1 {
		t.Errorf("expected exactly one expanded batch, got:\n%s", html)
	}
}

func TestDigestPaginationControls(t *testing.T) {
	m := &mockClient{
		batches: []IngestionBatch{
			{ID: "glassdoor-1", Source: "glassdoor", Date: "2026-06-23", Count: 1,
				Jobs: []JobSummary{{ID: 3, Title: "Platform Eng"}}},
		},
		batchesPage: PageMeta{Number: 1, Size: 30, Total: 45, HasNext: true},
	}
	c := &DigestView{Client: m}
	html := renderHTML(t, c)

	// Page indicator reads the envelope; Prev is disabled on page 1, Next enabled.
	for _, want := range []string{"Page 1 of 2", "Previous", "Next"} {
		if !strings.Contains(html, want) {
			t.Errorf("digest pagination missing %q\n%s", want, html)
		}
	}
}

func TestDigestNextPageAdvancesAndRequestsNext(t *testing.T) {
	m := &mockClient{
		batches:     []IngestionBatch{{ID: "b1", Source: "linkedin", Count: 1}},
		batchesPage: PageMeta{Number: 1, Size: 30, Total: 60, HasNext: true},
	}
	c := &DigestView{Client: m, pageNum: 1, page: m.batchesPage}

	if !c.applyNextPage() {
		t.Fatal("applyNextPage should advance when HasNext is true")
	}
	if c.pageNum != 2 {
		t.Fatalf("pageNum = %d, want 2", c.pageNum)
	}
	// A subsequent fetch carries the advanced page to the server.
	if _, err := c.Client.IngestionBatches(context.Background(), c.pageNum); err != nil {
		t.Fatalf("fetch: %v", err)
	}
	if m.gotBatchesPage != 2 {
		t.Fatalf("server requested page %d, want 2", m.gotBatchesPage)
	}
}

func TestDigestPrevPageStopsAtOne(t *testing.T) {
	c := &DigestView{page: PageMeta{Number: 1, HasNext: false}, pageNum: 1}
	if c.applyPrevPage() {
		t.Fatal("applyPrevPage should not advance below page 1")
	}
	if c.pageNum != 1 {
		t.Fatalf("pageNum = %d, want 1", c.pageNum)
	}
}

func TestJobDetailBackTarget(t *testing.T) {
	cases := []struct {
		name      string
		raw       string
		wantHref  string
		wantLabel string
	}{
		{"default", "/jobs/3", "/jobs", "← Jobs"},
		{"from digest with batch", "/jobs/3?from=digest&batch=glassdoor-1", "/?batch=glassdoor-1", "← Ingestions"},
		{"from digest no batch", "/jobs/3?from=digest", "/", "← Ingestions"},
		{"unrelated query", "/jobs/3?foo=bar", "/jobs", "← Jobs"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			u, err := url.Parse(tc.raw)
			if err != nil {
				t.Fatalf("parse: %v", err)
			}
			d := &JobDetailView{}
			d.resolveBack(u)
			if d.backFallback() != tc.wantHref {
				t.Errorf("href = %q, want %q", d.backFallback(), tc.wantHref)
			}
			if d.backFallbackLabel() != tc.wantLabel {
				t.Errorf("label = %q, want %q", d.backFallbackLabel(), tc.wantLabel)
			}
		})
	}
}

func TestDigestEmpty(t *testing.T) {
	c := &DigestView{Client: &mockClient{batches: nil}}
	html := renderHTML(t, c)
	if !strings.Contains(html, "No ingestions yet.") {
		t.Errorf("expected empty ingestion state, got:\n%s", html)
	}
}

func TestDigestUnauthorizedLinksToLogin(t *testing.T) {
	c := &DigestView{Client: &mockClient{batchesErr: &APIError{Status: http.StatusUnauthorized}}}
	html := renderHTML(t, c)
	for _, want := range []string{"session expired", "Sign in", `href="/login"`} {
		if !strings.Contains(html, want) {
			t.Errorf("expected unauthorized digest state to include %q, got:\n%s", want, html)
		}
	}
}
