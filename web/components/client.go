package components

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
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

	// Jobs fetches a page of the job feed (GET /api/job_posts). The params carry
	// the server-side filter/sort/lifecycle-state selection and 1-based page; the
	// returned JobPage carries the rows plus the page envelope so the UI can
	// drive Prev/Next. All filtering, sorting, and paging happen in Rails.
	Jobs(ctx context.Context, params JobFeedParams) (JobPage, error)

	// ScoreJobPost explicitly requests scoring for an unscored job
	// (POST /api/job_posts/:id/score). It never submits an application.
	ScoreJobPost(ctx context.Context, id int) (JobSummary, error)

	// SetJobLifecycle transitions one or more JobPosts between the lifecycle
	// bins (active/backlog/removed). A single id uses the member endpoint
	// (PATCH /api/job_posts/:id/lifecycle); multiple ids use the bulk
	// collection endpoint (PATCH /api/job_posts/lifecycle) in one transaction.
	// "removed" is a soft-delete owned by Rails; this never destroys a row and
	// never submits an application. Returns the updated rows.
	SetJobLifecycle(ctx context.Context, ids []int, state string) ([]JobSummary, error)

	// Job fetches a single scored job with its detail fields and resolved
	// route (GET /api/job_posts/:id).
	Job(ctx context.Context, id int) (JobDetail, error)

	// Digest fetches the daily digest landing payload (GET /api/digest).
	Digest(ctx context.Context) (Digest, error)

	// IngestionBatches fetches the ingestion history grouped into batches —
	// one alert/digest email's postings per batch, newest first
	// (GET /api/ingestion_batches).
	IngestionBatches(ctx context.Context) ([]IngestionBatch, error)

	// CreateApplication starts (or reuses) an application for a job and kicks
	// off draft generation in Rails (POST /api/applications). It returns the
	// application id to navigate to its draft-review screen. It never approves
	// or submits — that stays an explicit later action on the review screen.
	CreateApplication(ctx context.Context, jobID int) (CreateApplicationResult, error)

	// ApplicationDraft fetches the generated draft for an application
	// (GET /api/applications/:id). It carries the resume emphasis, cover
	// letter, structured answers, and worker-shaped autofill preview for
	// review before the user approves and submits.
	ApplicationDraft(ctx context.Context, id int) (ApplicationDraft, error)

	// UpdateApplicationDraft persists owner-reviewed edits to the autofill
	// preview before submit (PATCH /api/applications/:id/draft). Rails keeps
	// ATS/routing metadata authoritative and updates the answer values.
	UpdateApplicationDraft(ctx context.Context, id int, autofill AutofillPreview) (ApplicationDraft, error)

	// SubmitApplication explicitly approves and submits an application
	// (POST /api/applications/:id/submit). This is only called on an explicit
	// user action; Rails dispatches the trusted submit task to the worker.
	SubmitApplication(ctx context.Context, id int) (SubmitResult, error)

	// Applications fetches the user-facing application tracker
	// (GET /api/applications). This is distinct from the worker task queue: it
	// lists pipeline status/stage for jobs the owner is tracking.
	Applications(ctx context.Context) ([]ApplicationTracker, error)

	// UpdateApplicationStatus changes a tracked application's user-facing
	// pipeline state (PATCH /api/applications/:id/status). It never submits.
	UpdateApplicationStatus(ctx context.Context, id int, update ApplicationStatusUpdate) (ApplicationTracker, error)

	// UpdateJobApplicationStatus changes or creates the tracked application
	// state for a job post (PATCH /api/job_posts/:id/application_status). It is
	// used by job-detail status controls and never submits.
	UpdateJobApplicationStatus(ctx context.Context, jobID int, update ApplicationStatusUpdate) (ApplicationTracker, error)

	// Profile fetches the single-user structured profile (GET /api/profile).
	// Sensitive contact details come back as presence flags only; Rails never
	// serializes the raw encrypted PII.
	Profile(ctx context.Context) (Profile, error)

	// UpdateProfile writes the editable structured profile fields
	// (PATCH /api/profile) and returns the refreshed profile.
	UpdateProfile(ctx context.Context, edit ProfileEdit) (Profile, error)

	// VAPIDPublicKey fetches the public web-push key
	// (GET /api/push/vapid_public_key). The value is public by design; the
	// private VAPID secret never leaves Rails.
	VAPIDPublicKey(ctx context.Context) (string, error)

	// Subscribe stores a browser Web Push subscription
	// (POST /api/push_subscription) for the daily digest dispatch.
	Subscribe(ctx context.Context, sub PushSubscription) error

	// Unsubscribe removes the stored subscription for an endpoint
	// (DELETE /api/push_subscription).
	Unsubscribe(ctx context.Context, endpoint string) error

	// Contacts fetches the saved ContactCandidates for a job
	// (GET /api/job_posts/:id/contact_candidates): people worth reaching out
	// to about the posting, with a relevance reason. Read-only.
	Contacts(ctx context.Context, jobID int) ([]ContactCandidate, error)

	// GenerateOutreach generates an outreach draft for a contact candidate
	// (POST /api/contact_candidates/:id/outreach_drafts) from a loose template.
	// Rails drafts the message via the LLM; it NEVER sends anything. The draft
	// is returned for copy/manual sending only.
	GenerateOutreach(ctx context.Context, candidateID int, looseTemplate string) (OutreachDraft, error)

	// CreateJobPost submits a manual job entry (a URL and/or pasted posting
	// text) to POST /api/job_posts. Rails deterministically normalizes it into
	// a JobPost with source "manual" and runs it through the same route-resolve
	// and scoring pipeline as email ingestion; the created post then appears in
	// the feed once scored. All normalization and scoring happen in Rails.
	CreateJobPost(ctx context.Context, input ManualJobInput) (ManualJobResult, error)
}

// ManualJobInput is the owner-submitted manual entry: a URL and/or pasted
// posting text, with optional title/company hints. Rails requires at least one
// of URL or Text and validates the URL is HTTP(S). The web layer carries no
// validation logic of its own beyond a "needs URL or text" client hint.
type ManualJobInput struct {
	URL     string `json:"url"`
	Text    string `json:"text"`
	Title   string `json:"title"`
	Company string `json:"company"`
}

// ManualJobResult is the created JobPost as the manual-entry endpoint returns
// it (HTTP 201). It carries enough to confirm creation and link to the new
// post in the feed; scoring runs asynchronously, so ScoringStatus starts
// "pending".
type ManualJobResult struct {
	ID            int      `json:"id"`
	Title         string   `json:"title"`
	Company       string   `json:"company"`
	PostingURL    string   `json:"posting_url"`
	Source        string   `json:"source"`
	ScoringStatus string   `json:"scoring_status"`
	Route         JobRoute `json:"route"`
}

// ContactCandidate is a person worth reaching out to about a job posting, as
// Rails serializes it. It carries no send action; outreach is drafted on
// demand and sent manually by the user.
type ContactCandidate struct {
	ID              int    `json:"id"`
	JobPostID       int    `json:"job_post_id"`
	Name            string `json:"name"`
	Title           string `json:"title"`
	CompanyName     string `json:"company_name"`
	LinkedInURL     string `json:"linkedin_url"`
	RelevanceReason string `json:"relevance_reason"`
}

// OutreachDraft is a generated outreach message for a contact candidate. It is
// PREFILLED FOR MANUAL SENDING ONLY: Rails never sends it and this client never
// triggers a send. The user copies the message and sends it themselves.
type OutreachDraft struct {
	ID                 int    `json:"id"`
	ContactCandidateID int    `json:"contact_candidate_id"`
	Message            string `json:"message"`
	LooseTemplate      string `json:"loose_template"`
}

// Profile is the single-user structured profile as Rails serializes it. The
// editable text/array fields are echoed back in full; sensitive contact
// details (email, phone, address) are exposed only as presence flags so raw
// encrypted PII never reaches the client.
type Profile struct {
	FullName     string         `json:"full_name"`
	Headline     string         `json:"headline"`
	Summary      string         `json:"summary"`
	Location     string         `json:"location"`
	LinkedInURL  string         `json:"linkedin_url"`
	GitHubURL    string         `json:"github_url"`
	PortfolioURL string         `json:"portfolio_url"`
	Contact      ProfileContact `json:"contact"`
	Resume       *ResumeSummary `json:"resume"`
}

// ProfileContact carries presence flags only for the encrypted contact fields.
type ProfileContact struct {
	EmailPresent         bool `json:"email_present"`
	PhonePresent         bool `json:"phone_present"`
	StreetAddressPresent bool `json:"street_address_present"`
}

// ResumeSummary is the metadata for the current primary resume document. It is
// nil when no resume has been ingested yet.
type ResumeSummary struct {
	Title        string `json:"title"`
	ParseStatus  string `json:"parse_status"`
	FileAttached bool   `json:"file_attached"`
	Filename     string `json:"filename"`
}

// ProfileEdit is the set of editable profile fields the form writes back. Only
// the non-sensitive text/URL fields are editable here; sensitive contact
// details and the structured resume arrays are sourced from the resume ingest.
type ProfileEdit struct {
	FullName     string `json:"full_name"`
	Headline     string `json:"headline"`
	Summary      string `json:"summary"`
	Location     string `json:"location"`
	LinkedInURL  string `json:"linkedin_url"`
	GitHubURL    string `json:"github_url"`
	PortfolioURL string `json:"portfolio_url"`
}

// PushSubscription is the browser Web Push subscription posted to Rails. It
// mirrors the PushSubscriptionJSON the browser hands back, so the worker/digest
// dispatch can send to the endpoint with the stored keys.
type PushSubscription struct {
	Endpoint string               `json:"endpoint"`
	Keys     PushSubscriptionKeys `json:"keys"`
}

// PushSubscriptionKeys are the browser-supplied encryption keys for a push
// subscription.
type PushSubscriptionKeys struct {
	P256dh string `json:"p256dh"`
	Auth   string `json:"auth"`
}

// JobSummary is the compact job-feed row: enough to render the list and link
// to detail. Mirrors the scored fields Rails owns on JobPost.
type JobSummary struct {
	ID             int      `json:"id"`
	Title          string   `json:"title"`
	Company        string   `json:"company"`
	Source         string   `json:"source"`
	MatchScore     *int     `json:"match_score"`
	ScoringStatus  string   `json:"scoring_status"`
	TriageStatus   string   `json:"triage_status"`
	TriageScore    *int     `json:"triage_score"`
	TriageReasons  []string `json:"triage_reasons"`
	LifecycleState string   `json:"lifecycle_state"`
	Summary        string   `json:"summary"`
}

// JobFeedParams is the owner-selected feed query carried to GET /api/job_posts.
// Empty fields are omitted so Rails applies its defaults (status=scored,
// state=active, sort=oldest, page=1). All filtering/sorting/paging is server-
// side; the web layer only serializes these into query params.
type JobFeedParams struct {
	// Status is "scored" (default) or "unscored".
	Status string
	// State is the lifecycle bin: "active" (default), "backlog", or "removed".
	State string
	// Sort is "oldest" (default) or "score".
	Sort string
	// ScoreBand filters to "high", "mid", "low", or "unscored"; empty = all.
	ScoreBand string
	// Source filters to one ingestion source (e.g. "linkedin"); empty = all.
	Source string
	// Location is a case-insensitive substring match; empty = all.
	Location string
	// DateFrom / DateTo bound the created_at range (YYYY-MM-DD); empty = open.
	DateFrom string
	DateTo   string
	// Page is the 1-based page number; <=0 is treated as 1.
	Page int
}

// query renders the params into URL query values, omitting empty fields so the
// server applies its defaults.
func (p JobFeedParams) query() url.Values {
	q := url.Values{}
	set := func(key, val string) {
		if strings.TrimSpace(val) != "" {
			q.Set(key, val)
		}
	}
	set("status", p.Status)
	set("state", p.State)
	set("sort", p.Sort)
	set("score_band", p.ScoreBand)
	set("source", p.Source)
	set("location", p.Location)
	set("date_from", p.DateFrom)
	set("date_to", p.DateTo)
	if p.Page > 1 {
		q.Set("page", strconv.Itoa(p.Page))
	}
	return q
}

// JobPage is one page of the job feed: the rows plus the server's page envelope
// (1-based number, size, total matches, and whether a next page exists).
type JobPage struct {
	Jobs []JobSummary `json:"job_posts"`
	Page PageMeta     `json:"page"`
}

// PageMeta is the pagination envelope Rails returns alongside the feed rows.
type PageMeta struct {
	Number  int  `json:"number"`
	Size    int  `json:"size"`
	Total   int  `json:"total"`
	HasNext bool `json:"has_next"`
}

// JobDetail carries the full scored view of one job: the LLM summary and
// match score, the relevant/missing requirements and red flags, the resume
// alignment and application strategy notes, and the deterministically
// resolved application route.
type JobDetail struct {
	ID                   int                 `json:"id"`
	Title                string              `json:"title"`
	Company              string              `json:"company"`
	Source               string              `json:"source"`
	PostingURL           string              `json:"posting_url"`
	Compensation         string              `json:"compensation"`
	MatchScore           *int                `json:"match_score"`
	ScoringStatus        string              `json:"scoring_status"`
	TriageStatus         string              `json:"triage_status"`
	TriageScore          *int                `json:"triage_score"`
	TriageReasons        []string            `json:"triage_reasons"`
	LifecycleState       string              `json:"lifecycle_state"`
	Summary              string              `json:"summary"`
	RelevantRequirements []string            `json:"relevant_requirements"`
	MissingRequirements  []string            `json:"missing_requirements"`
	RedFlags             []string            `json:"red_flags"`
	ResumeAlignment      string              `json:"resume_alignment_notes"`
	ApplicationStrategy  string              `json:"application_strategy"`
	Route                JobRoute            `json:"route"`
	Application          *ApplicationTracker `json:"application"`
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

// IngestionBatch is one ingestion event: the postings from a single alert or
// digest email, grouped by source and arrival time. Derived in Rails
// (IngestionBatchBuilder); the postings travel with the batch so the UI can
// drill in without a second request.
type IngestionBatch struct {
	ID         string       `json:"id"`
	Source     string       `json:"source"`
	IngestedAt string       `json:"ingested_at"`
	Date       string       `json:"date"`
	Count      int          `json:"count"`
	Jobs       []JobSummary `json:"jobs"`
}

// ApplicationDraft is the generated, reviewable application draft: the
// drafted application materials (resume emphasis, cover letter), the
// structured question answers, and the worker-shaped autofill preview. All
// content is generated by Rails' ApplicationDraftGenerator; this screen only
// renders it for review and surfaces the explicit approve+submit action.
type ApplicationDraft struct {
	ApplicationID     int                `json:"application_id"`
	JobTitle          string             `json:"job_title"`
	Company           string             `json:"company"`
	Status            string             `json:"status"`
	PipelineStatus    string             `json:"pipeline_status"`
	PipelineStage     string             `json:"pipeline_stage"`
	PipelineNote      string             `json:"pipeline_note"`
	LastStatusChange  string             `json:"last_status_change_at"`
	NextFollowUpOn    string             `json:"next_follow_up_on"`
	ResumeEmphasis    string             `json:"resume_emphasis_notes"`
	CoverLetter       string             `json:"cover_letter"`
	DraftReady        bool               `json:"draft_ready"`
	FailureReason     string             `json:"failure_reason"`
	StructuredAnswers []StructuredAnswer `json:"structured_answers"`
	Autofill          AutofillPreview    `json:"autofill_payload"`
	AutofillWarnings  []AutofillWarning  `json:"autofill_warnings"`
	WorkerReport      *WorkerReport      `json:"worker_report"`
}

// ApplicationTracker is the user-facing status row for a job application. The
// pipeline fields are separate from AutomationStatus, which remains Rails'
// worker-submit lifecycle.
type ApplicationTracker struct {
	ApplicationID    int           `json:"application_id"`
	JobPostID        int           `json:"job_post_id"`
	JobTitle         string        `json:"job_title"`
	Company          string        `json:"company"`
	Status           string        `json:"status"`
	AutomationStatus string        `json:"automation_status"`
	PipelineStatus   string        `json:"pipeline_status"`
	PipelineStage    string        `json:"pipeline_stage"`
	PipelineNote     string        `json:"pipeline_note"`
	LastStatusChange string        `json:"last_status_change_at"`
	NextFollowUpOn   string        `json:"next_follow_up_on"`
	ApprovedAt       string        `json:"approved_at"`
	SubmittedAt      string        `json:"submitted_at"`
	FailureReason    string        `json:"failure_reason"`
	DraftReady       bool          `json:"draft_ready"`
	WorkerReport     *WorkerReport `json:"worker_report"`
}

// ApplicationStatusUpdate is the user-facing pipeline edit. Status is required;
// stage/note/follow-up are optional.
type ApplicationStatusUpdate struct {
	PipelineStatus string `json:"pipeline_status"`
	PipelineStage  string `json:"pipeline_stage"`
	PipelineNote   string `json:"pipeline_note"`
	NextFollowUpOn string `json:"next_follow_up_on"`
}

// StructuredAnswer is one reviewed question/answer pair the worker will fill.
type StructuredAnswer struct {
	Field string `json:"field"`
	Value string `json:"value"`
}

// AutofillPreview mirrors the worker ApplicationTask payload (workers/src/
// types.ts): the resolved ATS, the apply URL, and the field answers the
// worker would submit. The draft screen lets the user edit answer values and
// persists those edits before approving.
type AutofillPreview struct {
	ATS       string             `json:"ats"`
	ApplyURL  string             `json:"apply_url"`
	Answers   []StructuredAnswer `json:"answers"`
	ResumeRef string             `json:"resume_ref"`
}

// AutofillWarning marks an answer field Rails will not allow through the
// trusted-submit gate until the user handles it manually.
type AutofillWarning struct {
	Field   string `json:"field"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

// WorkerReport is the latest terminal report from the Playwright worker.
// It lets the draft review stay visible while showing where a real submit
// paused or failed.
type WorkerReport struct {
	Status      string   `json:"status"`
	Reason      string   `json:"reason"`
	Logs        []string `json:"logs"`
	Screenshots []string `json:"screenshots"`
}

// CreateApplicationResult is the outcome of starting an application from a job
// (POST /api/applications, HTTP 201). It carries the application id to navigate
// to for draft review; draft generation runs asynchronously in Rails.
type CreateApplicationResult struct {
	ApplicationID int    `json:"application_id"`
	Status        string `json:"status"`
}

// SubmitResult is the outcome of an approve+submit action. On success Rails
// dispatches the trusted submit task and reports the resolved ATS; the
// returned audit status lets the UI surface the submission result.
type SubmitResult struct {
	Status        string `json:"status"`
	ApplicationID int    `json:"application_id"`
	ATS           string `json:"ats"`
}

// MatchScoreLabel renders a job's match score for display. It distinguishes
// "not yet scored" (nil score / non-scored status) from an actual 0 score so
// the UI never shows a misleading "0%" for a pending job.
func MatchScoreLabel(score *int, scoringStatus string) string {
	if score == nil {
		switch scoringStatus {
		case "pending", "":
			return "Scoring…"
		case "filtered":
			return "Filtered"
		case "deferred":
			return "Queued later"
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

// MatchScoreBand classifies a job's match score into a coarse band used to
// color-code the score pill: "high" (strong match), "mid" (partial), "low"
// (weak), and "pending" when the job has no numeric score yet. The thresholds
// mirror MatchScoreLabel's "not yet scored" handling so a pending job is never
// colored as a real (low) score.
func MatchScoreBand(score *int, scoringStatus string) string {
	if score == nil {
		return "pending"
	}
	switch {
	case *score >= 75:
		return "high"
	case *score >= 50:
		return "mid"
	default:
		return "low"
	}
}

// SourceIconPath returns the same-origin path to a job source's official brand
// logo (self-hosted SVG under /web/icons, vendored from Simple Icons with the
// brand color baked in). It returns "" for sources without a brand logo (manual
// entry, generic email alerts) — those fall back to SourceEmoji.
func SourceIconPath(source string) string {
	switch source {
	case "linkedin":
		return "/web/icons/linkedin.svg"
	case "glassdoor":
		return "/web/icons/glassdoor.svg"
	case "indeed":
		return "/web/icons/indeed.svg"
	default:
		return ""
	}
}

// SourceEmoji returns a small emoji for job sources that have no official brand
// logo (manual entry, generic email alerts). Branded sources return "" because
// they render their SourceIconPath logo instead.
func SourceEmoji(source string) string {
	switch source {
	case "manual":
		return "✍️"
	case "inbound_llm", "inbound":
		return "📧"
	default:
		return ""
	}
}

// SourceLabel renders a job's ingestion source as a short human-readable
// origin tag (e.g. "LinkedIn", "Glassdoor") so the feed shows where each
// posting came from. Unknown/empty sources fall back to a generic label.
func SourceLabel(source string) string {
	switch source {
	case "linkedin":
		return "LinkedIn"
	case "glassdoor":
		return "Glassdoor"
	case "indeed":
		return "Indeed"
	case "manual":
		return "Manual entry"
	case "inbound_llm", "inbound":
		return "Email alert"
	case "":
		return ""
	default:
		return source
	}
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

func (c *httpRailsClient) Jobs(ctx context.Context, params JobFeedParams) (JobPage, error) {
	path := "/api/job_posts"
	if q := params.query().Encode(); q != "" {
		path += "?" + q
	}
	var page JobPage
	if err := c.get(ctx, path, &page); err != nil {
		return JobPage{}, err
	}
	return page, nil
}

func (c *httpRailsClient) ScoreJobPost(ctx context.Context, id int) (JobSummary, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("%s/api/job_posts/%d/score", c.base, id), nil)
	if err != nil {
		return JobSummary{}, err
	}
	req.Header.Set("Accept", "application/json")
	var out struct {
		JobPost JobSummary `json:"job_post"`
	}
	if err := c.do(req, &out); err != nil {
		return JobSummary{}, err
	}
	return out.JobPost, nil
}

func (c *httpRailsClient) SetJobLifecycle(ctx context.Context, ids []int, state string) ([]JobSummary, error) {
	if len(ids) == 1 {
		body := map[string]any{"lifecycle_state": state}
		var out struct {
			JobPost JobSummary `json:"job_post"`
		}
		path := fmt.Sprintf("/api/job_posts/%d/lifecycle", ids[0])
		if err := c.sendJSON(ctx, http.MethodPatch, path, body, &out); err != nil {
			return nil, err
		}
		return []JobSummary{out.JobPost}, nil
	}
	body := map[string]any{"ids": ids, "lifecycle_state": state}
	var out struct {
		JobPosts []JobSummary `json:"job_posts"`
	}
	if err := c.sendJSON(ctx, http.MethodPatch, "/api/job_posts/lifecycle", body, &out); err != nil {
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

func (c *httpRailsClient) IngestionBatches(ctx context.Context) ([]IngestionBatch, error) {
	var out struct {
		Batches []IngestionBatch `json:"batches"`
	}
	if err := c.get(ctx, "/api/ingestion_batches", &out); err != nil {
		return nil, err
	}
	return out.Batches, nil
}

func (c *httpRailsClient) CreateApplication(ctx context.Context, jobID int) (CreateApplicationResult, error) {
	body := map[string]any{"application": map[string]int{"job_post_id": jobID}}
	var out struct {
		Application CreateApplicationResult `json:"application"`
	}
	if err := c.sendJSON(ctx, http.MethodPost, "/api/applications", body, &out); err != nil {
		return CreateApplicationResult{}, err
	}
	return out.Application, nil
}

func (c *httpRailsClient) ApplicationDraft(ctx context.Context, id int) (ApplicationDraft, error) {
	var out struct {
		Application ApplicationDraft `json:"application"`
	}
	if err := c.get(ctx, fmt.Sprintf("/api/applications/%d", id), &out); err != nil {
		return ApplicationDraft{}, err
	}
	return out.Application, nil
}

func (c *httpRailsClient) UpdateApplicationDraft(ctx context.Context, id int, autofill AutofillPreview) (ApplicationDraft, error) {
	body := map[string]any{
		"application_draft": map[string]any{
			"autofill_payload": map[string]any{
				"answers": autofill.Answers,
			},
		},
	}
	var out struct {
		Application ApplicationDraft `json:"application"`
	}
	if err := c.sendJSON(ctx, http.MethodPatch, fmt.Sprintf("/api/applications/%d/draft", id), body, &out); err != nil {
		return ApplicationDraft{}, err
	}
	return out.Application, nil
}

func (c *httpRailsClient) SubmitApplication(ctx context.Context, id int) (SubmitResult, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("%s/api/applications/%d/submit", c.base, id), nil)
	if err != nil {
		return SubmitResult{}, err
	}
	req.Header.Set("Accept", "application/json")
	var out SubmitResult
	if err := c.do(req, &out); err != nil {
		return SubmitResult{}, err
	}
	return out, nil
}

func (c *httpRailsClient) Applications(ctx context.Context) ([]ApplicationTracker, error) {
	var out struct {
		Applications []ApplicationTracker `json:"applications"`
	}
	if err := c.get(ctx, "/api/applications", &out); err != nil {
		return nil, err
	}
	return out.Applications, nil
}

func (c *httpRailsClient) UpdateApplicationStatus(ctx context.Context, id int, update ApplicationStatusUpdate) (ApplicationTracker, error) {
	body := map[string]any{"application": update}
	var out struct {
		Application ApplicationTracker `json:"application"`
	}
	if err := c.sendJSON(ctx, http.MethodPatch, fmt.Sprintf("/api/applications/%d/status", id), body, &out); err != nil {
		return ApplicationTracker{}, err
	}
	return out.Application, nil
}

func (c *httpRailsClient) UpdateJobApplicationStatus(ctx context.Context, jobID int, update ApplicationStatusUpdate) (ApplicationTracker, error) {
	body := map[string]any{"application": update}
	var out struct {
		Application ApplicationTracker `json:"application"`
	}
	if err := c.sendJSON(ctx, http.MethodPatch, fmt.Sprintf("/api/job_posts/%d/application_status", jobID), body, &out); err != nil {
		return ApplicationTracker{}, err
	}
	return out.Application, nil
}

func (c *httpRailsClient) Profile(ctx context.Context) (Profile, error) {
	var out struct {
		Profile Profile `json:"profile"`
	}
	if err := c.get(ctx, "/api/profile", &out); err != nil {
		return Profile{}, err
	}
	return out.Profile, nil
}

func (c *httpRailsClient) UpdateProfile(ctx context.Context, edit ProfileEdit) (Profile, error) {
	body := map[string]any{"profile": edit}
	var out struct {
		Profile Profile `json:"profile"`
	}
	if err := c.sendJSON(ctx, http.MethodPatch, "/api/profile", body, &out); err != nil {
		return Profile{}, err
	}
	return out.Profile, nil
}

func (c *httpRailsClient) VAPIDPublicKey(ctx context.Context) (string, error) {
	var out struct {
		VAPIDPublicKey string `json:"vapid_public_key"`
	}
	if err := c.get(ctx, "/api/push/vapid_public_key", &out); err != nil {
		return "", err
	}
	return out.VAPIDPublicKey, nil
}

func (c *httpRailsClient) Subscribe(ctx context.Context, sub PushSubscription) error {
	body := map[string]any{"subscription": sub}
	return c.sendJSON(ctx, http.MethodPost, "/api/push_subscription", body, nil)
}

func (c *httpRailsClient) Unsubscribe(ctx context.Context, endpoint string) error {
	body := map[string]any{"subscription": map[string]string{"endpoint": endpoint}}
	return c.sendJSON(ctx, http.MethodDelete, "/api/push_subscription", body, nil)
}

func (c *httpRailsClient) Contacts(ctx context.Context, jobID int) ([]ContactCandidate, error) {
	var out struct {
		ContactCandidates []ContactCandidate `json:"contact_candidates"`
	}
	if err := c.get(ctx, fmt.Sprintf("/api/job_posts/%d/contact_candidates", jobID), &out); err != nil {
		return nil, err
	}
	return out.ContactCandidates, nil
}

func (c *httpRailsClient) GenerateOutreach(ctx context.Context, candidateID int, looseTemplate string) (OutreachDraft, error) {
	body := map[string]any{
		"outreach_draft": map[string]string{"loose_template": looseTemplate},
	}
	var out struct {
		OutreachDraft OutreachDraft `json:"outreach_draft"`
	}
	path := fmt.Sprintf("/api/contact_candidates/%d/outreach_drafts", candidateID)
	if err := c.sendJSON(ctx, http.MethodPost, path, body, &out); err != nil {
		return OutreachDraft{}, err
	}
	return out.OutreachDraft, nil
}

func (c *httpRailsClient) CreateJobPost(ctx context.Context, input ManualJobInput) (ManualJobResult, error) {
	body := map[string]any{"job_post": input}
	var out struct {
		JobPost ManualJobResult `json:"job_post"`
	}
	if err := c.sendJSON(ctx, http.MethodPost, "/api/job_posts", body, &out); err != nil {
		return ManualJobResult{}, err
	}
	return out.JobPost, nil
}

// sendJSON marshals body as JSON, sends it with the given method, and decodes
// the response into dst when dst is non-nil. The same-origin session cookie is
// carried automatically by the browser fetch stack.
func (c *httpRailsClient) sendJSON(ctx context.Context, method, path string, body, dst any) error {
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	return c.do(req, dst)
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

func APIErrorCode(err error) string {
	detail := apiErrorDetail(err)
	return detail.Code
}

func APIErrorMessage(err error) string {
	detail := apiErrorDetail(err)
	return detail.Message
}

type apiErrorPayload struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

type apiErrorFields struct {
	Code    string
	Message string
}

func apiErrorDetail(err error) apiErrorFields {
	var apiErr *APIError
	if !asAPIError(err, &apiErr) || apiErr.Body == "" {
		return apiErrorFields{}
	}
	var payload apiErrorPayload
	if json.Unmarshal([]byte(apiErr.Body), &payload) != nil {
		return apiErrorFields{}
	}
	return apiErrorFields{Code: payload.Error.Code, Message: payload.Error.Message}
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
