package components

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
)

func sampleProfile() Profile {
	return Profile{
		FullName:     "Ada Lovelace",
		Headline:     "Platform Engineer",
		Summary:      "Builds reliable systems.",
		Location:     "London",
		LinkedInURL:  "https://linkedin.com/in/ada",
		GitHubURL:    "https://github.com/ada",
		PortfolioURL: "https://ada.dev",
		Contact: ProfileContact{
			EmailPresent:         true,
			PhonePresent:         false,
			StreetAddressPresent: true,
		},
		Resume: &ResumeSummary{
			Title:        "Ada Lovelace — Resume",
			ParseStatus:  "parsed",
			FileAttached: true,
			Filename:     "cv.pdf",
		},
	}
}

func TestProfileRendersFieldsAndPresenceFlags(t *testing.T) {
	c := &ProfileView{Client: &mockClient{profile: sampleProfile()}, Pusher: &mockPusher{}}
	html := renderHTML(t, c)

	for _, want := range []string{
		"Ada Lovelace", "Platform Engineer", "Builds reliable systems.",
		"London", "https://linkedin.com/in/ada", "https://github.com/ada", "https://ada.dev",
		"Email: set", "Phone: not set", "Street address: set",
		"Ada Lovelace — Resume", "Parse status:", "cv.pdf",
		`class="profile-resume-status profile-resume-status-parsed">parsed`,
	} {
		if !strings.Contains(html, want) {
			t.Errorf("profile HTML missing %q\n%s", want, html)
		}
	}
	// Encrypted contact values must never be rendered, only presence flags.
	if strings.Contains(html, "@") {
		t.Errorf("profile HTML leaked an email-shaped value:\n%s", html)
	}
}

func TestResumeStatusClass(t *testing.T) {
	if got := resumeStatusClass("parsed"); got != "profile-resume-status-parsed" {
		t.Errorf("resumeStatusClass(parsed) = %q, want profile-resume-status-parsed", got)
	}
	if got := resumeStatusClass("pending"); got != "profile-resume-status-pending" {
		t.Errorf("resumeStatusClass(pending) = %q, want profile-resume-status-pending", got)
	}
}

func TestProfileNoResume(t *testing.T) {
	p := sampleProfile()
	p.Resume = nil
	c := &ProfileView{Client: &mockClient{profile: p}, Pusher: &mockPusher{}}
	html := renderHTML(t, c)
	if !strings.Contains(html, "No resume ingested yet") {
		t.Errorf("expected empty resume state, got:\n%s", html)
	}
}

func TestProfileLoadError(t *testing.T) {
	c := &ProfileView{Client: &mockClient{profileErr: errors.New("boom")}, Pusher: &mockPusher{}}
	html := renderHTML(t, c)
	if !strings.Contains(html, "Could not load data") {
		t.Errorf("expected load error, got:\n%s", html)
	}
}

func TestEditFromProfileSeedsEditableFields(t *testing.T) {
	edit := editFromProfile(sampleProfile())
	if edit.FullName != "Ada Lovelace" || edit.Headline != "Platform Engineer" ||
		edit.LinkedInURL != "https://linkedin.com/in/ada" || edit.PortfolioURL != "https://ada.dev" {
		t.Errorf("editFromProfile did not seed editable fields: %+v", edit)
	}
}

func TestProfileSaveWritesViaAPI(t *testing.T) {
	updated := sampleProfile()
	updated.Headline = "Staff Engineer"
	m := &mockClient{profile: updated}
	p := &ProfileView{Client: m, Pusher: &mockPusher{}}
	p.edit = ProfileEdit{FullName: "Ada Lovelace", Headline: "Staff Engineer"}

	p.doSave(context.Background())

	if m.updateCalls != 1 {
		t.Fatalf("expected 1 UpdateProfile call, got %d", m.updateCalls)
	}
	if m.updated.Headline != "Staff Engineer" {
		t.Errorf("UpdateProfile got headline %q, want %q", m.updated.Headline, "Staff Engineer")
	}
	if p.save != saveDone {
		t.Errorf("save state = %v, want saveDone", p.save)
	}
	// The form is reseeded from the refreshed profile after save.
	if p.edit.Headline != "Staff Engineer" {
		t.Errorf("edit not reseeded after save: %+v", p.edit)
	}
}

func TestProfileSaveError(t *testing.T) {
	p := &ProfileView{Client: &mockClient{updateErr: errors.New("nope")}, Pusher: &mockPusher{}}
	p.doSave(context.Background())
	if p.save != saveError || !strings.Contains(p.saveErr, "Could not save") {
		t.Errorf("expected save error state, got %v / %q", p.save, p.saveErr)
	}
}

func TestProfileSaveUnauthorized(t *testing.T) {
	p := &ProfileView{Client: &mockClient{updateErr: &APIError{Status: http.StatusUnauthorized}}, Pusher: &mockPusher{}}
	p.doSave(context.Background())
	if p.save != saveError || !strings.Contains(p.saveErr, "session expired") {
		t.Errorf("expected session-expired save error, got %v / %q", p.save, p.saveErr)
	}
}

func TestPresenceLabel(t *testing.T) {
	if presenceLabel(true) != "set" || presenceLabel(false) != "not set" {
		t.Errorf("presenceLabel mapping wrong")
	}
}

func TestSaveButtonLabel(t *testing.T) {
	cases := map[saveState]string{
		saveIdle:    "Save profile",
		saveSending: "Saving…",
		saveDone:    "Saved",
		saveError:   "Save profile",
	}
	for s, want := range cases {
		if got := saveButtonLabel(s); got != want {
			t.Errorf("saveButtonLabel(%v) = %q, want %q", s, got, want)
		}
	}
}
