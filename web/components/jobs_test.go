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

	draft      ApplicationDraft
	draftErr   error
	gotDraftID int

	submitResult SubmitResult
	submitErr    error
	gotSubmitID  int
	submitCalls  int

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

func (m *mockClient) ApplicationDraft(_ context.Context, id int) (ApplicationDraft, error) {
	m.gotDraftID = id
	return m.draft, m.draftErr
}

func (m *mockClient) SubmitApplication(_ context.Context, id int) (SubmitResult, error) {
	m.gotSubmitID = id
	m.submitCalls++
	return m.submitResult, m.submitErr
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
