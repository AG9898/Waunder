package components

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/maxence-charriere/go-app/v10/pkg/app"
)

// contactItemHTML renders a single contact row (renderContact) without the
// mount lifecycle, so a pre-set generate state is reflected directly.
func contactItemHTML(v *ContactsView, c ContactCandidate) string {
	var sb strings.Builder
	app.PrintHTML(&sb, v.renderContact(c))
	return sb.String()
}

func sampleContacts() []ContactCandidate {
	return []ContactCandidate{
		{
			ID:              11,
			JobPostID:       7,
			Name:            "Ada Lovelace",
			Title:           "Engineering Manager",
			CompanyName:     "Acme",
			LinkedInURL:     "https://www.linkedin.com/in/ada",
			RelevanceReason: "Owns the platform team this role joins.",
		},
		{
			ID:        12,
			JobPostID: 7,
			Name:      "Grace Hopper",
		},
	}
}

func TestContactsRendersCandidates(t *testing.T) {
	c := &ContactsView{JobID: 7, Client: &mockClient{contacts: sampleContacts()}}
	html := renderHTML(t, c)

	for _, want := range []string{
		"Ada Lovelace",
		"Engineering Manager at Acme",
		"Owns the platform team this role joins.",
		"https://www.linkedin.com/in/ada",
		"Grace Hopper",
		"Generate draft",
		// manual-send-only guidance must be present on the screen
		"manual sending only",
	} {
		if !strings.Contains(html, want) {
			t.Errorf("contacts HTML missing %q\n%s", want, html)
		}
	}
}

func TestContactsFetchesByJobID(t *testing.T) {
	m := &mockClient{contacts: sampleContacts()}
	c := &ContactsView{JobID: 42, Client: m}
	renderHTML(t, c)
	if m.gotContactsID != 42 {
		t.Errorf("Contacts called with id %d, want 42", m.gotContactsID)
	}
}

func TestContactsEmpty(t *testing.T) {
	c := &ContactsView{JobID: 7, Client: &mockClient{contacts: nil}}
	html := renderHTML(t, c)
	if !strings.Contains(html, "No contacts yet.") {
		t.Errorf("expected empty state, got:\n%s", html)
	}
}

func TestContactsLoadError(t *testing.T) {
	c := &ContactsView{JobID: 7, Client: &mockClient{contactsErr: errors.New("boom")}}
	html := renderHTML(t, c)
	if !strings.Contains(html, "Could not load data") {
		t.Errorf("expected error state, got:\n%s", html)
	}
}

func TestContactsLoadUnauthorized(t *testing.T) {
	c := &ContactsView{JobID: 7, Client: &mockClient{contactsErr: &APIError{Status: http.StatusUnauthorized}}}
	html := renderHTML(t, c)
	if !strings.Contains(html, "session expired") {
		t.Errorf("expected session-expired message, got:\n%s", html)
	}
}

// TestContactsDoesNotGenerateOrSendOnMount is the core safety guard: rendering
// the contacts screen must never generate an outreach draft and must never
// send anything. Outreach is generated only on an explicit user click and is
// always prefilled for manual sending only.
func TestContactsDoesNotGenerateOnMount(t *testing.T) {
	m := &mockClient{contacts: sampleContacts()}
	c := &ContactsView{JobID: 7, Client: m}
	renderHTML(t, c)
	if m.generateCalls != 0 {
		t.Errorf("GenerateOutreach was called %d times on render; outreach must only be generated on an explicit user action", m.generateCalls)
	}
}

// TestContactsNoSendAffordance asserts the rendered screen exposes no send
// control — only copy/manual-send affordances. This locks in the product
// constraint that the UI never sends outreach.
func TestContactsNoSendAffordance(t *testing.T) {
	c := &ContactsView{JobID: 7, Client: &mockClient{contacts: sampleContacts()}}
	html := strings.ToLower(renderHTML(t, c))
	if strings.Contains(html, "send") && !strings.Contains(html, "manual sending only") {
		t.Errorf("contacts screen mentions sending without the manual-only guard\n%s", html)
	}
	// No control class implies an automated send action.
	for _, forbidden := range []string{`class="contact-outreach-send"`, "auto-send", "send message", "send outreach"} {
		if strings.Contains(html, forbidden) {
			t.Errorf("contacts screen exposes a send affordance %q; must be manual/copy only", forbidden)
		}
	}
}

// TestContactsGenerateDraft drives the explicit generate action (doGenerate is
// the body of the OnClick handler) and asserts the draft endpoint is called
// once with the right candidate id and loose template, and that the drafted
// message is recorded for manual copy.
func TestContactsGenerateDraft(t *testing.T) {
	m := &mockClient{
		contacts: sampleContacts(),
		outreach: OutreachDraft{ID: 5, ContactCandidateID: 11, Message: "Hi Ada, I admire your platform work."},
	}
	c := &ContactsView{JobID: 7, Client: m}
	c.doGenerate(context.Background(), "11", "Keep it short and warm.")

	if m.generateCalls != 1 {
		t.Fatalf("GenerateOutreach called %d times, want 1", m.generateCalls)
	}
	if m.gotOutreachID != 11 {
		t.Errorf("GenerateOutreach candidate id = %d, want 11", m.gotOutreachID)
	}
	if m.gotOutreachTmpl != "Keep it short and warm." {
		t.Errorf("GenerateOutreach template = %q, want the typed template", m.gotOutreachTmpl)
	}
	g := c.genFor(11)
	if g.state != generateDone {
		t.Errorf("generate state = %v, want generateDone", g.state)
	}
	if g.draft.Message != "Hi Ada, I admire your platform work." {
		t.Errorf("drafted message = %q, want the generated message", g.draft.Message)
	}
}

// TestContactsGenerateRendersDraft confirms a completed draft renders with the
// manual-send guidance and a copy affordance (and no send control).
func TestContactsGenerateRendersDraft(t *testing.T) {
	c := &ContactsView{JobID: 7, Client: &mockClient{contacts: sampleContacts()}}
	c.doGenerate(context.Background(), "11", "")

	// The mock returns a zero-value draft; set a message via genFor to render.
	c.genFor(11).draft = OutreachDraft{Message: "Hi Ada, quick note about the role."}

	html := contactItemHTML(c, sampleContacts()[0])
	for _, want := range []string{
		"Hi Ada, quick note about the role.",
		"Copy draft",
		"Copy this draft and send it manually",
		"Regenerate draft",
	} {
		if !strings.Contains(html, want) {
			t.Errorf("rendered draft missing %q\n%s", want, html)
		}
	}
}

func TestContactsGenerateServiceUnavailable(t *testing.T) {
	g := &outreachGen{}
	applyGenerateResult(g, OutreachDraft{}, &APIError{Status: http.StatusServiceUnavailable})
	if g.state != generateError {
		t.Fatalf("state = %v, want generateError", g.state)
	}
	if !strings.Contains(g.errMsg, "not configured") {
		t.Errorf("error message = %q, want the not-configured message", g.errMsg)
	}
}

func TestContactsGenerateUnauthorized(t *testing.T) {
	g := &outreachGen{}
	applyGenerateResult(g, OutreachDraft{}, &APIError{Status: http.StatusUnauthorized})
	if !strings.Contains(g.errMsg, "session expired") {
		t.Errorf("error message = %q, want the session-expired message", g.errMsg)
	}
}

func TestContactsGenerateGenericError(t *testing.T) {
	g := &outreachGen{}
	applyGenerateResult(g, OutreachDraft{}, errors.New("boom"))
	if !strings.Contains(g.errMsg, "Could not generate") {
		t.Errorf("error message = %q, want the generic failure message", g.errMsg)
	}
}

func TestContactRole(t *testing.T) {
	cases := []struct {
		c    ContactCandidate
		want string
	}{
		{ContactCandidate{Title: "EM", CompanyName: "Acme"}, "EM at Acme"},
		{ContactCandidate{Title: "EM"}, "EM"},
		{ContactCandidate{CompanyName: "Acme"}, "Acme"},
		{ContactCandidate{}, ""},
	}
	for _, tc := range cases {
		if got := contactRole(tc.c); got != tc.want {
			t.Errorf("contactRole(%+v) = %q, want %q", tc.c, got, tc.want)
		}
	}
}

func TestGenerateButtonLabel(t *testing.T) {
	cases := []struct {
		state generateState
		want  string
	}{
		{generateIdle, "Generate draft"},
		{generateRunning, "Generating…"},
		{generateDone, "Regenerate draft"},
	}
	for _, tc := range cases {
		if got := generateButtonLabel(tc.state); got != tc.want {
			t.Errorf("generateButtonLabel(%v) = %q, want %q", tc.state, got, tc.want)
		}
	}
}

func TestContactsJobIDFromPath(t *testing.T) {
	cases := []struct {
		path   string
		wantID int
		wantOK bool
	}{
		{"/jobs/42/contacts", 42, true},
		{"/jobs/1/contacts", 1, true},
		{"/jobs/contacts", 0, false},
		{"/jobs/42", 0, false},
		{"/jobs//contacts", 0, false},
		{"/jobs/abc/contacts", 0, false},
		{"/other/3/contacts", 0, false},
	}
	for _, tc := range cases {
		id, ok := contactsJobIDFromPath(tc.path)
		if id != tc.wantID || ok != tc.wantOK {
			t.Errorf("contactsJobIDFromPath(%q) = (%d,%v), want (%d,%v)", tc.path, id, ok, tc.wantID, tc.wantOK)
		}
	}
}
