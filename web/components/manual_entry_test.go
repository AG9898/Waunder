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
		"Add a job", "Job URL", "Posting text", "manual-entry-form",
		"manual-entry-url", "manual-entry-text", "Add job", "/jobs",
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
		Client: m,
		url:    "  https://boards.greenhouse.io/acme/jobs/42  ",
		text:   "  Build platforms.  ",
		title:  " Staff Engineer ",
	}

	c.doSubmit(context.Background())

	if m.createCalls != 1 {
		t.Fatalf("CreateJobPost called %d times, want 1", m.createCalls)
	}
	// Fields are trimmed before sending; Rails owns the rest of normalization.
	if m.createInput.URL != "https://boards.greenhouse.io/acme/jobs/42" {
		t.Errorf("URL = %q, not trimmed", m.createInput.URL)
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

func TestCreatedMessage(t *testing.T) {
	cases := []struct {
		name string
		r    ManualJobResult
		want string
	}{
		{"title+company pending", ManualJobResult{ID: 1, Title: "Eng", Company: "Acme", ScoringStatus: "pending"}, "Added Eng — Acme. It is being scored and will appear in your feed."},
		{"title only scored", ManualJobResult{ID: 2, Title: "Eng", ScoringStatus: "scored"}, "Added Eng."},
		{"no title falls back to id", ManualJobResult{ID: 3, ScoringStatus: "scored"}, "Added Job #3."},
		{"empty status treated pending", ManualJobResult{ID: 4, Title: "Eng"}, "Added Eng. It is being scored and will appear in your feed."},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := createdMessage(tc.r); got != tc.want {
				t.Errorf("createdMessage = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestEntryButtonLabel(t *testing.T) {
	if got := entryButtonLabel(entrySubmitting); got != "Adding…" {
		t.Errorf("submitting label = %q", got)
	}
	if got := entryButtonLabel(entryIdle); got != "Add job" {
		t.Errorf("idle label = %q", got)
	}
}
