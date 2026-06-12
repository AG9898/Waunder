package components

import (
	"context"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
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

	jobs, err := c.Jobs(context.Background())
	if err != nil {
		t.Fatalf("Jobs after login: %v", err)
	}
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
	_, err := c.Jobs(context.Background())
	if !IsUnauthorized(err) {
		t.Fatalf("expected unauthorized APIError, got %v", err)
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
