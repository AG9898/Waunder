package components

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// RailsClient is the read/auth surface the screens need from the Rails API.
// It is an interface so component/render tests can inject a mock and run
// without a backend (the production implementation is httpRailsClient, which
// talks to the same-origin /api proxy via the browser fetch stack).
//
// No business logic lives in this client: it only serializes requests and
// decodes the JSON shapes Rails returns. All scoring, route resolution, and
// digest assembly happen in Rails.
type RailsClient interface {
	// Login posts the passphrase to POST /api/session. On success Rails sets
	// the signed, HTTP-only session cookie; subsequent calls carry it.
	Login(ctx context.Context, passphrase string) error

	// Jobs fetches the scored job feed (GET /api/job_posts).
	Jobs(ctx context.Context) ([]JobSummary, error)

	// Job fetches a single scored job with its detail fields and resolved
	// route (GET /api/job_posts/:id).
	Job(ctx context.Context, id int) (JobDetail, error)

	// Digest fetches the daily digest landing payload (GET /api/digest).
	Digest(ctx context.Context) (Digest, error)
}

// JobSummary is the compact job-feed row: enough to render the list and link
// to detail. Mirrors the scored fields Rails owns on JobPost.
type JobSummary struct {
	ID            int    `json:"id"`
	Title         string `json:"title"`
	Company       string `json:"company"`
	MatchScore    *int   `json:"match_score"`
	ScoringStatus string `json:"scoring_status"`
	Summary       string `json:"summary"`
}

// JobDetail carries the full scored view of one job: the LLM summary and
// match score, the relevant/missing requirements and red flags, the resume
// alignment and application strategy notes, and the deterministically
// resolved application route.
type JobDetail struct {
	ID                   int      `json:"id"`
	Title                string   `json:"title"`
	Company              string   `json:"company"`
	PostingURL           string   `json:"posting_url"`
	MatchScore           *int     `json:"match_score"`
	ScoringStatus        string   `json:"scoring_status"`
	Summary              string   `json:"summary"`
	RelevantRequirements []string `json:"relevant_requirements"`
	MissingRequirements  []string `json:"missing_requirements"`
	RedFlags             []string `json:"red_flags"`
	ResumeAlignment      string   `json:"resume_alignment_notes"`
	ApplicationStrategy  string   `json:"application_strategy"`
	Route                JobRoute `json:"route"`
}

// JobRoute is the resolved application route for a job: how the application
// should be submitted and where. Owned by Rails' ApplicationRouteResolver.
type JobRoute struct {
	RouteType        string `json:"route_type"`
	RecommendedRoute string `json:"recommended_route"`
	ApplicationURL   string `json:"application_url"`
}

// Digest is the daily digest landing payload: the date it covers and the
// scored jobs surfaced for that day.
type Digest struct {
	Date string       `json:"date"`
	Jobs []JobSummary `json:"jobs"`
}

// MatchScoreLabel renders a job's match score for display. It distinguishes
// "not yet scored" (nil score / non-scored status) from an actual 0 score so
// the UI never shows a misleading "0%" for a pending job.
func MatchScoreLabel(score *int, scoringStatus string) string {
	if score == nil {
		switch scoringStatus {
		case "pending", "":
			return "Scoring…"
		case "skipped":
			return "Not scored"
		case "failed":
			return "Scoring failed"
		default:
			return "Not scored"
		}
	}
	return fmt.Sprintf("%d%%", *score)
}

// httpRailsClient is the production RailsClient. It targets same-origin paths
// (the page is served by the web service, which proxies /api/* to Rails), so
// the session cookie is sent automatically by the browser.
type httpRailsClient struct {
	http *http.Client
	base string // base URL prefix; "" in the browser (same-origin)
}

// NewRailsClient returns the same-origin Rails client used by the live PWA.
func NewRailsClient() RailsClient {
	return &httpRailsClient{http: http.DefaultClient}
}

func (c *httpRailsClient) Login(ctx context.Context, passphrase string) error {
	form := url.Values{}
	form.Set("passphrase", passphrase)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		c.base+"/api/session", strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	return c.do(req, nil)
}

func (c *httpRailsClient) Jobs(ctx context.Context) ([]JobSummary, error) {
	var out struct {
		JobPosts []JobSummary `json:"job_posts"`
	}
	if err := c.get(ctx, "/api/job_posts", &out); err != nil {
		return nil, err
	}
	return out.JobPosts, nil
}

func (c *httpRailsClient) Job(ctx context.Context, id int) (JobDetail, error) {
	var out struct {
		JobPost JobDetail `json:"job_post"`
	}
	if err := c.get(ctx, fmt.Sprintf("/api/job_posts/%d", id), &out); err != nil {
		return JobDetail{}, err
	}
	return out.JobPost, nil
}

func (c *httpRailsClient) Digest(ctx context.Context) (Digest, error) {
	var out struct {
		Digest Digest `json:"digest"`
	}
	if err := c.get(ctx, "/api/digest", &out); err != nil {
		return Digest{}, err
	}
	return out.Digest, nil
}

func (c *httpRailsClient) get(ctx context.Context, path string, dst any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	return c.do(req, dst)
}

// do executes a request, treats non-2xx as an error, and decodes the body into
// dst when dst is non-nil.
func (c *httpRailsClient) do(req *http.Request, dst any) error {
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return &APIError{Status: resp.StatusCode, Body: strings.TrimSpace(string(body))}
	}
	if dst == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(dst)
}

// APIError is returned when the Rails API responds with a non-2xx status.
type APIError struct {
	Status int
	Body   string
}

func (e *APIError) Error() string {
	if e.Body == "" {
		return fmt.Sprintf("api request failed: status %d", e.Status)
	}
	return fmt.Sprintf("api request failed: status %d: %s", e.Status, e.Body)
}

// IsUnauthorized reports whether err is an APIError carrying a 401, so screens
// can route the user back to the login flow when the session is missing or
// expired.
func IsUnauthorized(err error) bool {
	var apiErr *APIError
	if !asAPIError(err, &apiErr) {
		return false
	}
	return apiErr.Status == http.StatusUnauthorized
}

func asAPIError(err error, target **APIError) bool {
	for err != nil {
		if ae, ok := err.(*APIError); ok {
			*target = ae
			return true
		}
		type unwrapper interface{ Unwrap() error }
		u, ok := err.(unwrapper)
		if !ok {
			return false
		}
		err = u.Unwrap()
	}
	return false
}
