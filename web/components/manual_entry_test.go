package components

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
)

func TestManualEntryRendersForm(t *testing.T) {
	c := &ManualEntry{Client: &mockClient{}}
	html := renderHTML(t, c)

	for _, want := range []string{
		"Import a job", "Job URL", "External application URL (optional)", "Posting text", "manual-entry-form",
		"manual-entry-url", "manual-entry-application-url", "manual-entry-text", "Import job", "/jobs",
	} {
		if !strings.Contains(html, want) {
			t.Errorf("manual entry HTML missing %q\n%s", want, html)
		}
	}
}

func TestManualEntrySubmitPostsInputAndSurfacesJob(t *testing.T) {
	m := &mockClient{createResult: ManualJobResult{
		ID:            42,
		Title:         "Staff Engineer",
		Company:       "Acme",
		ScoringStatus: "pending",
	}}
	c := &ManualEntry{
		Client:         m,
		url:            "  https://boards.greenhouse.io/acme/jobs/42  ",
		applicationURL: "  https://careers.acme.com/apply/42  ",
		text:           "  Build platforms.  ",
		title:          " Staff Engineer ",
	}

	c.doSubmit(context.Background())

	if m.createCalls != 1 {
		t.Fatalf("CreateJobPost called %d times, want 1", m.createCalls)
	}
	// Fields are trimmed before sending; Rails owns the rest of normalization.
	if m.createInput.URL != "https://boards.greenhouse.io/acme/jobs/42" {
		t.Errorf("URL = %q, not trimmed", m.createInput.URL)
	}
	if m.createInput.ApplicationURL != "https://careers.acme.com/apply/42" {
		t.Errorf("ApplicationURL = %q, not trimmed", m.createInput.ApplicationURL)
	}
	if m.createInput.Text != "Build platforms." {
		t.Errorf("Text = %q, not trimmed", m.createInput.Text)
	}
	if m.createInput.Title != "Staff Engineer" {
		t.Errorf("Title = %q, not trimmed", m.createInput.Title)
	}
	if c.state != entryDone {
		t.Fatalf("state = %v, want entryDone", c.state)
	}
	if c.result.ID != 42 {
		t.Errorf("result.ID = %d, want 42", c.result.ID)
	}

	html := renderHTML(t, &ManualEntry{Client: m, state: entryDone, result: c.result})
	for _, want := range []string{"Staff Engineer", "Acme", "being scored", "/jobs/42", "View job"} {
		if !strings.Contains(html, want) {
			t.Errorf("result HTML missing %q\n%s", want, html)
		}
	}
}

func TestManualEntryRejectsEmptyInputWithoutCalling(t *testing.T) {
	m := &mockClient{}
	c := &ManualEntry{Client: m}

	if c.inputPresent() {
		t.Fatal("inputPresent() true for empty form")
	}
	// Empty form must not reach the API.
	if m.createCalls != 0 {
		t.Fatalf("CreateJobPost called %d times for empty form, want 0", m.createCalls)
	}
}

func TestManualEntryApplyCreateResultErrors(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want string
	}{
		{"unauthorized", &APIError{Status: http.StatusUnauthorized}, "session expired"},
		{"unprocessable", &APIError{Status: 422}, "valid URL"},
		{"transient", errors.New("boom"), "Please try again"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := &ManualEntry{}
			c.applyCreateResult(ManualJobResult{}, tc.err)
			if c.state != entryError {
				t.Fatalf("state = %v, want entryError", c.state)
			}
			if !strings.Contains(c.err, tc.want) {
				t.Errorf("err = %q, want substring %q", c.err, tc.want)
			}
		})
	}
}

func TestImportMessageAndLinkLabel(t *testing.T) {
	cases := []struct {
		name     string
		r        ManualJobResult
		want     string
		wantLink string
	}{
		{"new pending", ManualJobResult{ID: 1, Title: "Eng", Company: "Acme", ScoringStatus: "pending", Import: ManualJobImportResult{Status: manualImportNew}}, "Imported Eng — Acme. It is being scored and will appear in your feed.", "View job"},
		{"tracked", ManualJobResult{ID: 2, Title: "Eng", Import: ManualJobImportResult{Status: manualImportAlreadyTracked, ApplicationStatus: "approved"}}, "Already tracked: Eng. Current application status: approved.", "View tracked job"},
		{"submitted", ManualJobResult{ID: 3, Title: "Eng", Import: ManualJobImportResult{Status: manualImportAlreadySubmitted}}, "Already submitted: Eng.", "View submitted job"},
		{"possible match", ManualJobResult{ID: 4, Title: "Eng", Import: ManualJobImportResult{Status: manualImportPossibleMatch}}, "Possible match: Eng. Review the existing job before importing another.", "Review possible match"},
		{"missing import defaults new", ManualJobResult{ID: 5, ScoringStatus: "scored"}, "Imported Job #5.", "View job"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := importMessage(tc.r); got != tc.want {
				t.Errorf("importMessage = %q, want %q", got, tc.want)
			}
			if got := importLinkLabel(tc.r); got != tc.wantLink {
				t.Errorf("importLinkLabel = %q, want %q", got, tc.wantLink)
			}
		})
	}
}

func TestManualEntryRendersAllImportResults(t *testing.T) {
	cases := []struct {
		name    string
		result  ManualJobResult
		message string
		link    string
	}{
		{"new", ManualJobResult{ID: 42, Title: "Staff Engineer", Import: ManualJobImportResult{Status: manualImportNew}}, "Imported Staff Engineer", "View job"},
		{"tracked", ManualJobResult{ID: 42, Title: "Staff Engineer", Import: ManualJobImportResult{Status: manualImportAlreadyTracked}}, "Already tracked", "View tracked job"},
		{"submitted", ManualJobResult{ID: 42, Title: "Staff Engineer", Import: ManualJobImportResult{Status: manualImportAlreadySubmitted}}, "Already submitted", "View submitted job"},
		{"possible match", ManualJobResult{ID: 42, Title: "Staff Engineer", Import: ManualJobImportResult{Status: manualImportPossibleMatch}}, "Possible match", "Review possible match"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			html := renderHTML(t, &ManualEntry{Client: &mockClient{}, state: entryDone, result: tc.result})
			for _, want := range []string{tc.message, tc.link, `href="/jobs/42"`} {
				if !strings.Contains(html, want) {
					t.Errorf("result HTML missing %q\n%s", want, html)
				}
			}
		})
	}
}

func TestManualEntryNeverImportsOnRender(t *testing.T) {
	m := &mockClient{}
	_ = renderHTML(t, &ManualEntry{Client: m})
	if m.createCalls != 0 {
		t.Fatalf("CreateJobPost called on render: %d", m.createCalls)
	}
}

func TestEntryButtonLabel(t *testing.T) {
	if got := entryButtonLabel(entrySubmitting); got != "Importing…" {
		t.Errorf("submitting label = %q", got)
	}
	if got := entryButtonLabel(entryIdle); got != "Import job" {
		t.Errorf("idle label = %q", got)
	}
}
