package components

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"testing"
)

// newTestRailsClient returns an httpRailsClient pointed at a test server,
// reusing a cookie jar so we can assert the session cookie is carried between
// requests the way the browser does same-origin.
func newTestRailsClient(t *testing.T, base string) *httpRailsClient {
	t.Helper()
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("cookie jar: %v", err)
	}
	return &httpRailsClient{http: &http.Client{Jar: jar}, base: base}
}

func TestClientLoginSendsPassphraseAndCarriesCookie(t *testing.T) {
	var gotPass string
	mux := http.NewServeMux()
	mux.HandleFunc("/api/session", func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Fatalf("parse form: %v", err)
		}
		gotPass = r.PostFormValue("passphrase")
		http.SetCookie(w, &http.Cookie{Name: "_waunder_session", Value: "signed", Path: "/"})
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	mux.HandleFunc("/api/job_posts", func(w http.ResponseWriter, r *http.Request) {
		if c, err := r.Cookie("_waunder_session"); err != nil || c.Value != "signed" {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
		_, _ = w.Write([]byte(`{"job_posts":[{"id":1,"title":"Eng","company":"Acme","match_score":80,"scoring_status":"scored"}]}`))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	c := newTestRailsClient(t, srv.URL)

	if err := c.Login(context.Background(), "hunter2"); err != nil {
		t.Fatalf("Login: %v", err)
	}
	if gotPass != "hunter2" {
		t.Errorf("server got passphrase %q, want %q", gotPass, "hunter2")
	}

	page, err := c.Jobs(context.Background(), JobFeedParams{})
	if err != nil {
		t.Fatalf("Jobs after login: %v", err)
	}
	jobs := page.Jobs
	if len(jobs) != 1 || jobs[0].Title != "Eng" || jobs[0].MatchScore == nil || *jobs[0].MatchScore != 80 {
		t.Errorf("unexpected jobs decode: %+v", jobs)
	}
}

func TestClientUnauthorizedMapsToAPIError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
	}))
	defer srv.Close()

	c := &httpRailsClient{http: srv.Client(), base: srv.URL}
	_, err := c.Jobs(context.Background(), JobFeedParams{})
	if !IsUnauthorized(err) {
		t.Fatalf("expected unauthorized APIError, got %v", err)
	}
}

func TestClientIntakeReadsAndUpdatesState(t *testing.T) {
	var patchEnabled bool
	mux := http.NewServeMux()
	mux.HandleFunc("/api/intake", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodPatch {
			var body struct {
				Intake struct {
					Enabled bool `json:"enabled"`
				} `json:"intake"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode intake body: %v", err)
			}
			patchEnabled = body.Intake.Enabled
			_, _ = w.Write([]byte(`{"intake":{"enabled":false,"held_count":3}}`))
			return
		}
		_, _ = w.Write([]byte(`{"intake":{"enabled":true,"held_count":0}}`))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()
	c := &httpRailsClient{http: srv.Client(), base: srv.URL}

	status, err := c.Intake(context.Background())
	if err != nil || !status.Enabled {
		t.Fatalf("Intake = %+v, %v", status, err)
	}
	status, err = c.SetIntake(context.Background(), false)
	if err != nil {
		t.Fatalf("SetIntake: %v", err)
	}
	if patchEnabled || status.Enabled || status.HeldCount != 3 {
		t.Fatalf("unexpected updated intake: sent=%v response=%+v", patchEnabled, status)
	}
}

func TestClientJobsBuildsFilterQueryAndDecodesPage(t *testing.T) {
	var gotQuery url.Values
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.Query()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"job_posts":[{"id":2,"title":"Backend","company":"CapCo","scoring_status":"filtered","lifecycle_state":"backlog"}],"page":{"number":2,"size":30,"total":45,"has_next":false}}`))
	}))
	defer srv.Close()
	c := &httpRailsClient{http: srv.Client(), base: srv.URL}

	page, err := c.Jobs(context.Background(), JobFeedParams{
		Status:    "unscored",
		State:     "backlog",
		Sort:      "score",
		ScoreBand: "high",
		Source:    "linkedin",
		Location:  "Vancouver",
		DateFrom:  "2026-06-01",
		DateTo:    "2026-06-23",
		Page:      2,
	})
	if err != nil {
		t.Fatalf("Jobs: %v", err)
	}

	want := map[string]string{
		"status":     "unscored",
		"state":      "backlog",
		"sort":       "score",
		"score_band": "high",
		"source":     "linkedin",
		"location":   "Vancouver",
		"date_from":  "2026-06-01",
		"date_to":    "2026-06-23",
		"page":       "2",
	}
	for k, v := range want {
		if gotQuery.Get(k) != v {
			t.Errorf("query %s = %q, want %q (full %v)", k, gotQuery.Get(k), v, gotQuery)
		}
	}
	if len(page.Jobs) != 1 || page.Jobs[0].LifecycleState != "backlog" {
		t.Fatalf("unexpected jobs decode: %+v", page.Jobs)
	}
	if page.Page.Number != 2 || page.Page.Total != 45 || page.Page.HasNext {
		t.Fatalf("unexpected page envelope: %+v", page.Page)
	}
}

func TestClientJobsOmitsDefaultParams(t *testing.T) {
	var gotRawQuery string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotRawQuery = r.URL.RawQuery
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"job_posts":[],"page":{"number":1,"size":30,"total":0,"has_next":false}}`))
	}))
	defer srv.Close()
	c := &httpRailsClient{http: srv.Client(), base: srv.URL}

	if _, err := c.Jobs(context.Background(), JobFeedParams{Page: 1}); err != nil {
		t.Fatalf("Jobs: %v", err)
	}
	if gotRawQuery != "" {
		t.Fatalf("expected no query for default params, got %q", gotRawQuery)
	}
}

func TestClientScoreJobPost(t *testing.T) {
	var gotPath, gotMethod string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotMethod = r.Method
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"job_post":{"id":2,"title":"Backend","company":"CapCo","scoring_status":"pending"}}`))
	}))
	defer srv.Close()
	c := &httpRailsClient{http: srv.Client(), base: srv.URL}

	job, err := c.ScoreJobPost(context.Background(), 2)

	if err != nil {
		t.Fatalf("ScoreJobPost: %v", err)
	}
	if gotMethod != http.MethodPost || gotPath != "/api/job_posts/2/score" {
		t.Fatalf("request = %s %s, want POST /api/job_posts/2/score", gotMethod, gotPath)
	}
	if job.ID != 2 || job.ScoringStatus != "pending" {
		t.Fatalf("unexpected job: %+v", job)
	}
}

func TestClientJobDecodesFullDetail(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/api/job_posts/7") {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(`{"job_post":{"id":7,"title":"Staff","company":"Acme","match_score":91,"scoring_status":"scored","relevant_requirements":["Go"],"missing_requirements":["K8s"],"red_flags":["on-call"],"route":{"route_type":"greenhouse","recommended_route":"direct_ats","application_url":"https://x"}}}`))
	}))
	defer srv.Close()

	c := &httpRailsClient{http: srv.Client(), base: srv.URL}
	job, err := c.Job(context.Background(), 7)
	if err != nil {
		t.Fatalf("Job: %v", err)
	}
	if job.ID != 7 || job.Route.RecommendedRoute != "direct_ats" || len(job.RelevantRequirements) != 1 {
		t.Errorf("unexpected detail decode: %+v", job)
	}
}

func TestClientCreateJobPostSendsExternalApplicationURLAndDecodesImport(t *testing.T) {
	var gotInput ManualJobInput
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/job_posts" {
			t.Fatalf("request = %s %s, want POST /api/job_posts", r.Method, r.URL.Path)
		}
		var body struct {
			JobPost ManualJobInput `json:"job_post"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		gotInput = body.JobPost
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"job_post":{"id":42,"title":"Staff Engineer","company":"Acme","scoring_status":"pending"},"import":{"status":"already_tracked","application_status":"approved"}}`))
	}))
	defer srv.Close()

	c := &httpRailsClient{http: srv.Client(), base: srv.URL}
	result, err := c.CreateJobPost(context.Background(), ManualJobInput{
		URL:            "https://www.linkedin.com/jobs/view/42",
		ApplicationURL: "https://careers.acme.com/jobs/42",
		Text:           "Build systems",
	})
	if err != nil {
		t.Fatalf("CreateJobPost: %v", err)
	}
	if gotInput.ApplicationURL != "https://careers.acme.com/jobs/42" {
		t.Errorf("application URL = %q", gotInput.ApplicationURL)
	}
	if result.ID != 42 || result.Import.Status != manualImportAlreadyTracked || result.Import.ApplicationStatus != "approved" {
		t.Errorf("unexpected import result: %+v", result)
	}
}

func TestClientGenerateAndFetchCoverLetter(t *testing.T) {
	var calls []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls = append(calls, r.Method+" "+r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		switch r.Method {
		case http.MethodGet:
			_, _ = w.Write([]byte(`{"cover_letter_draft":{"id":3,"job_post_id":42,"body":"Dear Acme team","generated_at":"2026-09-09T12:00:00Z"}}`))
		case http.MethodPost:
			_, _ = w.Write([]byte(`{"cover_letter_draft":{"id":3,"job_post_id":42,"body":"Dear Acme team","generated_at":"2026-09-09T12:00:00Z"}}`))
		}
	}))
	defer srv.Close()

	c := &httpRailsClient{http: srv.Client(), base: srv.URL}
	draft, err := c.GenerateCoverLetter(context.Background(), 42)
	if err != nil {
		t.Fatalf("GenerateCoverLetter: %v", err)
	}
	fetched, err := c.CoverLetter(context.Background(), 42)
	if err != nil {
		t.Fatalf("CoverLetter: %v", err)
	}
	if draft.Body != "Dear Acme team" || fetched == nil || fetched.JobPostID != 42 {
		t.Fatalf("unexpected cover letter responses: generated=%+v fetched=%+v", draft, fetched)
	}
	want := []string{"POST /api/job_posts/42/cover_letter_draft", "GET /api/job_posts/42/cover_letter_draft"}
	if !reflect.DeepEqual(calls, want) {
		t.Errorf("calls = %#v, want %#v", calls, want)
	}
}

func TestClientUpdateApplicationDraftSendsAnswers(t *testing.T) {
	var gotPath string
	var gotAnswers []StructuredAnswer
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		if r.Method != http.MethodPatch {
			t.Errorf("method = %s, want PATCH", r.Method)
		}
		var body struct {
			ApplicationDraft struct {
				AutofillPayload struct {
					Answers []StructuredAnswer `json:"answers"`
				} `json:"autofill_payload"`
			} `json:"application_draft"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		gotAnswers = body.ApplicationDraft.AutofillPayload.Answers
		_, _ = w.Write([]byte(`{"application":{"application_id":7,"draft_ready":true,"autofill_payload":{"ats":"greenhouse","apply_url":"https://x","answers":[{"field":"full_name","value":"Ada"}]}}}`))
	}))
	defer srv.Close()

	c := &httpRailsClient{http: srv.Client(), base: srv.URL}
	draft, err := c.UpdateApplicationDraft(context.Background(), 7, AutofillPreview{
		Answers: []StructuredAnswer{{Field: "full_name", Value: "Ada"}},
	})
	if err != nil {
		t.Fatalf("UpdateApplicationDraft: %v", err)
	}
	if gotPath != "/api/applications/7/draft" {
		t.Errorf("path = %q, want /api/applications/7/draft", gotPath)
	}
	if len(gotAnswers) != 1 || gotAnswers[0].Value != "Ada" {
		t.Errorf("answers sent = %+v", gotAnswers)
	}
	if !draft.DraftReady || draft.Autofill.ATS != "greenhouse" {
		t.Errorf("unexpected draft response: %+v", draft)
	}
}

func TestClientUpdateJobApplicationStatusSendsPipelineUpdate(t *testing.T) {
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		if r.Method != http.MethodPatch {
			t.Errorf("method = %s, want PATCH", r.Method)
		}
		_, _ = w.Write([]byte(`{"application":{"application_id":9,"job_post_id":42,"pipeline_status":"applied","pipeline_stage":"waiting"}}`))
	}))
	defer srv.Close()

	c := &httpRailsClient{http: srv.Client(), base: srv.URL}
	application, err := c.UpdateJobApplicationStatus(context.Background(), 42, ApplicationStatusUpdate{PipelineStatus: "applied"})
	if err != nil {
		t.Fatalf("UpdateJobApplicationStatus: %v", err)
	}
	if gotPath != "/api/job_posts/42/application_status" {
		t.Errorf("path = %q, want /api/job_posts/42/application_status", gotPath)
	}
	if application.ApplicationID != 9 || application.PipelineStage != "waiting" {
		t.Errorf("unexpected response: %+v", application)
	}
}

func TestAPIErrorCodeParsesRailsErrorShape(t *testing.T) {
	err := &APIError{
		Status: http.StatusUnprocessableEntity,
		Body:   `{"error":{"code":"unsafe_payload","message":"Autofill payload contains sensitive fields"}}`,
	}
	if got := APIErrorCode(err); got != "unsafe_payload" {
		t.Errorf("APIErrorCode = %q", got)
	}
	if got := APIErrorMessage(err); got != "Autofill payload contains sensitive fields" {
		t.Errorf("APIErrorMessage = %q", got)
	}
}

// guard against accidentally changing the same-origin path shape.
func TestClientUsesAPINamespace(t *testing.T) {
	var paths []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		_, _ = w.Write([]byte(`{"digest":{"date":"2026-06-12","jobs":[]}}`))
	}))
	defer srv.Close()

	c := &httpRailsClient{http: srv.Client(), base: srv.URL}
	if _, err := c.Digest(context.Background()); err != nil {
		t.Fatalf("Digest: %v", err)
	}
	if len(paths) != 1 || paths[0] != "/api/digest" {
		t.Errorf("digest hit paths %v, want [/api/digest]", paths)
	}
	_ = url.Values{}
}
