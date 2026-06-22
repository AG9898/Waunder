package components

import (
	"context"
	"errors"
	"net/http"
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

	jobs    []JobSummary
	jobsErr error

	job    JobDetail
	jobErr error
	gotID  int

	digest    Digest
	digestErr error

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

func (m *mockClient) Jobs(context.Context) ([]JobSummary, error) {
	return m.jobs, m.jobsErr
}

func (m *mockClient) Job(_ context.Context, id int) (JobDetail, error) {
	m.gotID = id
	return m.job, m.jobErr
}

func (m *mockClient) Digest(context.Context) (Digest, error) {
	return m.digest, m.digestErr
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

	for _, want := range []string{"Staff Engineer", "Acme", "88%", "Backend Dev", "Globex", "Scoring…", "/jobs/7", "/jobs/9"} {
		if !strings.Contains(html, want) {
			t.Errorf("job list HTML missing %q\n%s", want, html)
		}
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

func TestJobListEmpty(t *testing.T) {
	c := &JobList{Client: &mockClient{jobs: nil}}
	html := renderHTML(t, c)
	if !strings.Contains(html, "No jobs yet.") {
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

func TestDigestRendersJobs(t *testing.T) {
	c := &DigestView{Client: &mockClient{digest: Digest{
		Date: "2026-06-12",
		Jobs: []JobSummary{
			{ID: 3, Title: "Platform Eng", Company: "Initech", MatchScore: intPtr(75), ScoringStatus: "scored"},
		},
	}}}
	html := renderHTML(t, c)

	for _, want := range []string{"Daily digest", "2026-06-12", "Platform Eng", "Initech", "75%", "/jobs/3"} {
		if !strings.Contains(html, want) {
			t.Errorf("digest HTML missing %q\n%s", want, html)
		}
	}
}

func TestDigestEmpty(t *testing.T) {
	c := &DigestView{Client: &mockClient{digest: Digest{Date: "2026-06-12"}}}
	html := renderHTML(t, c)
	if !strings.Contains(html, "No new jobs today.") {
		t.Errorf("expected empty digest state, got:\n%s", html)
	}
}

func TestDigestUnauthorizedLinksToLogin(t *testing.T) {
	c := &DigestView{Client: &mockClient{digestErr: &APIError{Status: http.StatusUnauthorized}}}
	html := renderHTML(t, c)
	for _, want := range []string{"session expired", "Sign in", `href="/login"`} {
		if !strings.Contains(html, want) {
			t.Errorf("expected unauthorized digest state to include %q, got:\n%s", want, html)
		}
	}
}
