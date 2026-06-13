package components

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/maxence-charriere/go-app/v10/pkg/app"
)

func sampleDraft() ApplicationDraft {
	return ApplicationDraft{
		ApplicationID:  7,
		JobTitle:       "Staff Engineer",
		Company:        "Acme",
		Status:         "draft",
		ResumeEmphasis: "Lead with the payments platform work.",
		CoverLetter:    "Dear hiring team, I am excited to apply.",
		StructuredAnswers: []StructuredAnswer{
			{Field: "Why this role?", Value: "Deep backend fit."},
		},
		Autofill: AutofillPreview{
			ATS:      "greenhouse",
			ApplyURL: "https://boards.greenhouse.io/acme/jobs/7",
			Answers: []StructuredAnswer{
				{Field: "first_name", Value: "Ada"},
			},
		},
	}
}

func TestDraftReviewRendersFields(t *testing.T) {
	c := &DraftReview{AppID: 7, Client: &mockClient{draft: sampleDraft()}}
	html := renderHTML(t, c)

	for _, want := range []string{
		"Staff Engineer — Acme",
		"Status: draft",
		"Lead with the payments platform work.",
		"Dear hiring team, I am excited to apply.",
		"Why this role?", "Deep backend fit.",
		"Autofill preview", "ATS: greenhouse",
		"https://boards.greenhouse.io/acme/jobs/7",
		"first_name", "Ada",
		"Approve and submit",
	} {
		if !strings.Contains(html, want) {
			t.Errorf("draft HTML missing %q\n%s", want, html)
		}
	}
}

func TestDraftReviewFetchesByID(t *testing.T) {
	m := &mockClient{draft: sampleDraft()}
	c := &DraftReview{AppID: 42, Client: m}
	renderHTML(t, c)
	if m.gotDraftID != 42 {
		t.Errorf("ApplicationDraft called with id %d, want 42", m.gotDraftID)
	}
}

func TestDraftReviewLoadError(t *testing.T) {
	c := &DraftReview{AppID: 7, Client: &mockClient{draftErr: errors.New("boom")}}
	html := renderHTML(t, c)
	if !strings.Contains(html, "Could not load data") {
		t.Errorf("expected error state, got:\n%s", html)
	}
}

// TestDraftReviewDoesNotSubmitOnMount guards the core safety rule: rendering
// the review screen must never submit. Submission is an explicit user action.
func TestDraftReviewDoesNotSubmitOnMount(t *testing.T) {
	m := &mockClient{draft: sampleDraft()}
	c := &DraftReview{AppID: 7, Client: m}
	renderHTML(t, c)
	if m.submitCalls != 0 {
		t.Errorf("submit was called %d times on render; must only submit on explicit user action", m.submitCalls)
	}
}

// TestDraftReviewApproveAndSubmit drives the explicit approve+submit action
// (doSubmit is the body of the OnClick handler) and asserts the submit endpoint
// is called once, with the right id, and that the audit result is recorded so
// the UI can surface it (submitDone + dispatched ATS).
func TestDraftReviewApproveAndSubmit(t *testing.T) {
	m := &mockClient{
		draft:        sampleDraft(),
		submitResult: SubmitResult{Status: "dispatched", ApplicationID: 7, ATS: "greenhouse"},
	}
	c := &DraftReview{AppID: 7, Client: m}
	c.doSubmit(context.Background())

	if m.submitCalls != 1 {
		t.Fatalf("submit called %d times, want 1", m.submitCalls)
	}
	if m.gotSubmitID != 7 {
		t.Errorf("submit called with id %d, want 7", m.gotSubmitID)
	}
	if c.submit != submitDone {
		t.Errorf("submit state = %v, want submitDone", c.submit)
	}
	if got := submitResultLabel(c.submitResult); !strings.Contains(got, "greenhouse") {
		t.Errorf("audit result label = %q, want it to mention dispatched ATS", got)
	}
}

func TestDraftReviewSubmitError(t *testing.T) {
	m := &mockClient{
		draft:     sampleDraft(),
		submitErr: &APIError{Status: http.StatusUnprocessableEntity, Body: "paused"},
	}
	c := &DraftReview{AppID: 7, Client: m}
	c.doSubmit(context.Background())

	if c.submit != submitError {
		t.Fatalf("submit state = %v, want submitError", c.submit)
	}
	if !strings.Contains(c.submitErr, "Submit failed") {
		t.Errorf("submit error = %q, want generic failure message", c.submitErr)
	}
}

func TestDraftReviewSubmitUnauthorized(t *testing.T) {
	m := &mockClient{
		draft:     sampleDraft(),
		submitErr: &APIError{Status: http.StatusUnauthorized},
	}
	c := &DraftReview{AppID: 7, Client: m}
	c.doSubmit(context.Background())

	if !strings.Contains(c.submitErr, "session expired") {
		t.Errorf("submit error = %q, want session-expired message", c.submitErr)
	}
}

// TestDraftReviewRendersSubmitStates checks the submit chrome renders the
// surfaced result and error messages for each submit state.
func TestDraftReviewRendersSubmitStates(t *testing.T) {
	done := &DraftReview{
		AppID:        7,
		Client:       &mockClient{draft: sampleDraft()},
		submit:       submitDone,
		submitResult: SubmitResult{ATS: "lever"},
	}
	if html := submitChromeHTML(done); !strings.Contains(html, "dispatched to lever") {
		t.Errorf("submitDone chrome missing audit result\n%s", html)
	}

	failed := &DraftReview{
		AppID:     7,
		Client:    &mockClient{draft: sampleDraft()},
		submit:    submitError,
		submitErr: "Submit failed. Please try again.",
	}
	if html := submitChromeHTML(failed); !strings.Contains(html, "Submit failed") {
		t.Errorf("submitError chrome missing error message\n%s", html)
	}
}

// submitChromeHTML renders only the submit chrome (renderSubmit), avoiding the
// mount lifecycle so a pre-set submit state is reflected directly.
func submitChromeHTML(r *DraftReview) string {
	var sb strings.Builder
	app.PrintHTML(&sb, r.renderSubmit())
	return sb.String()
}

func TestAppIDFromPath(t *testing.T) {
	cases := []struct {
		path   string
		wantID int
		wantOK bool
	}{
		{"/applications/42", 42, true},
		{"/applications/1", 1, true},
		{"/applications/", 0, false},
		{"/applications", 0, false},
		{"/applications/abc", 0, false},
		{"/jobs/3", 0, false},
	}
	for _, tc := range cases {
		id, ok := appIDFromPath(tc.path)
		if id != tc.wantID || ok != tc.wantOK {
			t.Errorf("appIDFromPath(%q) = (%d,%v), want (%d,%v)", tc.path, id, ok, tc.wantID, tc.wantOK)
		}
	}
}

func TestSubmitButtonLabel(t *testing.T) {
	cases := []struct {
		state submitState
		want  string
	}{
		{submitIdle, "Approve and submit"},
		{submitSending, "Submitting…"},
		{submitDone, "Submitted"},
	}
	for _, tc := range cases {
		if got := submitButtonLabel(tc.state); got != tc.want {
			t.Errorf("submitButtonLabel(%v) = %q, want %q", tc.state, got, tc.want)
		}
	}
}

func TestSubmitResultLabel(t *testing.T) {
	if got := submitResultLabel(SubmitResult{ATS: "lever"}); !strings.Contains(got, "lever") {
		t.Errorf("submitResultLabel = %q, want it to mention the ATS", got)
	}
	if got := submitResultLabel(SubmitResult{}); !strings.Contains(got, "dispatched") {
		t.Errorf("submitResultLabel fallback = %q", got)
	}
}

func TestDraftHeadingFallback(t *testing.T) {
	if got := draftHeading(ApplicationDraft{ApplicationID: 9}); got != "Application #9" {
		t.Errorf("draftHeading fallback = %q, want %q", got, "Application #9")
	}
	if got := draftHeading(ApplicationDraft{JobTitle: "Eng"}); got != "Eng" {
		t.Errorf("draftHeading title-only = %q", got)
	}
}
