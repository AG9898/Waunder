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

func TestManualEntryLookupPrefillsEmptyFields(t *testing.T) {
	m := &mockClient{lookup: PostingLookup{
		Status:      "ok",
		Provider:    "linked_in",
		Title:       "MCP/AI Developer",
		Company:     "Autodesk",
		Location:    "Canada",
		Description: "Build the agentic platform.",
	}}
	c := &ManualEntry{Client: m, url: "  https://www.linkedin.com/jobs/view/4435267449  "}

	c.doLookup(context.Background())

	if m.lookupCalls != 1 {
		t.Fatalf("LookupPosting called %d times, want 1", m.lookupCalls)
	}
	// The URL is trimmed before it reaches Rails, like every other field.
	if m.gotLookupURL != "https://www.linkedin.com/jobs/view/4435267449" {
		t.Errorf("looked up %q, not trimmed", m.gotLookupURL)
	}
	if c.title != "MCP/AI Developer" {
		t.Errorf("title = %q, want the listing title", c.title)
	}
	if c.company != "Autodesk" {
		t.Errorf("company = %q, want the listing company", c.company)
	}
	if c.text != "Build the agentic platform." {
		t.Errorf("text = %q, want the listing description", c.text)
	}
	if c.lookupState != lookupDone {
		t.Fatalf("lookupState = %v, want lookupDone", c.lookupState)
	}
	if !strings.Contains(c.lookupNote, "title, company, and posting text") {
		t.Errorf("lookupNote = %q, want the filled fields named", c.lookupNote)
	}
}

func TestManualEntryLookupNeverOverwritesOwnerInput(t *testing.T) {
	m := &mockClient{lookup: PostingLookup{
		Status:      "ok",
		Title:       "Fetched title",
		Company:     "Fetched company",
		Description: "Fetched description",
	}}
	c := &ManualEntry{
		Client:         m,
		url:            "https://www.linkedin.com/jobs/view/1",
		title:          "My title",
		company:        "My company",
		text:           "My notes",
		titleTouched:   true,
		companyTouched: true,
		textTouched:    true,
	}

	c.doLookup(context.Background())

	if c.title != "My title" || c.company != "My company" || c.text != "My notes" {
		t.Fatalf("lookup overwrote owner input: %q / %q / %q", c.title, c.company, c.text)
	}
	if !strings.Contains(c.lookupNote, "kept") {
		t.Errorf("lookupNote = %q, want it to say the entries were kept", c.lookupNote)
	}
}

func TestManualEntryUnreadablePostingLeavesFormUsable(t *testing.T) {
	m := &mockClient{lookup: PostingLookup{Status: "unavailable", Error: "Could not read the posting"}}
	c := &ManualEntry{Client: m, url: "https://careers.example.com/roles/9"}

	c.doLookup(context.Background())

	if c.lookupState != lookupFailed {
		t.Fatalf("lookupState = %v, want lookupFailed", c.lookupState)
	}
	if c.title != "" || c.company != "" {
		t.Errorf("fields were filled from an unusable lookup: %q / %q", c.title, c.company)
	}
	// A failed lookup must not block the import; the submit path is untouched.
	if c.state != entryIdle {
		t.Errorf("state = %v, want the form still idle and submittable", c.state)
	}
}

func TestManualEntryLookupSurfacesExpiredSession(t *testing.T) {
	m := &mockClient{lookupErr: &APIError{Status: http.StatusUnauthorized}}
	c := &ManualEntry{Client: m, url: "https://www.linkedin.com/jobs/view/1"}

	c.doLookup(context.Background())

	if !strings.Contains(c.lookupNote, "session expired") {
		t.Errorf("lookupNote = %q, want the expired-session message", c.lookupNote)
	}
}

// The lookup is an explicit user action: rendering the form must never fetch a
// posting on its own.
func TestManualEntryNeverLooksUpOnRender(t *testing.T) {
	m := &mockClient{}
	c := &ManualEntry{Client: m, url: "https://www.linkedin.com/jobs/view/1"}

	html := renderHTML(t, c)

	if m.lookupCalls != 0 {
		t.Fatalf("LookupPosting called %d times during render, want 0", m.lookupCalls)
	}
	if !strings.Contains(html, "manual-entry-lookup-button") {
		t.Errorf("lookup control missing from the form\n%s", html)
	}
}

func TestManualEntryLookupSkipsRepeatOfSameURL(t *testing.T) {
	m := &mockClient{lookup: PostingLookup{Status: "ok", Title: "Dev"}}
	c := &ManualEntry{Client: m, url: "https://www.linkedin.com/jobs/view/1"}

	c.doLookup(context.Background())
	c.doLookup(context.Background())

	// doLookup itself always fetches; the skip lives in startLookup, which the
	// URL field commits into. Guard the recorded URL so the skip has a basis.
	if c.lookedUpURL != "https://www.linkedin.com/jobs/view/1" {
		t.Fatalf("lookedUpURL = %q, want the fetched URL recorded", c.lookedUpURL)
	}
	if m.lookupCalls != 2 {
		t.Fatalf("LookupPosting called %d times, want 2", m.lookupCalls)
	}
}
