package components

import (
	"strings"
	"testing"

	"github.com/maxence-charriere/go-app/v10/pkg/app"
)

func TestChromeNavigationAndLayout(t *testing.T) {
	html := renderHTML(t, &AppChrome{Active: "jobs"})
	for _, want := range []string{`aria-label="Main navigation"`, `aria-current="page"`, `href="/jobs/new"`, "Import job", `value="auto"`, `value="desktop"`, `value="mobile"`} {
		if !strings.Contains(html, want) {
			t.Errorf("missing %s", want)
		}
	}
}

func TestNormalizeLayout(t *testing.T) {
	for _, value := range []string{"", "auto", "broken", "Desktop"} {
		if got := normalizeLayout(value); got != "auto" {
			t.Errorf("normalizeLayout(%q) = %q", value, got)
		}
	}
	for _, value := range []string{"desktop", "mobile"} {
		if got := normalizeLayout(value); got != value {
			t.Errorf("normalizeLayout(%q) = %q", value, got)
		}
	}
}

func TestCopyButtonDoesNotReportSuccessOnRender(t *testing.T) {
	html := renderHTML(t, &CopyButton{Text: "Private draft", Label: "Copy answer"})
	if !strings.Contains(html, "Copy answer") || strings.Contains(html, "Copied.") || strings.Contains(html, "Private draft") {
		t.Fatal("copy control should expose its action, with no premature success or duplicate draft content")
	}
}

func TestPipelineStageEmptyOption(t *testing.T) {
	if pipelineStageValue("none") != "" || pipelineStageValue("waiting") != "waiting" {
		t.Fatal("stage option sentinel must round trip to an empty stage")
	}
	if PipelineStatusLabel("applied", "") != "Applied" {
		t.Fatal("an empty stage should not be displayed as a stage")
	}
}

func TestAppChromeShowsUpdateBannerOnlyWhenPending(t *testing.T) {
	c := &AppChrome{Active: "jobs"}

	// No update downloaded: the chrome must stay quiet.
	var quiet strings.Builder
	app.PrintHTML(&quiet, c.Render())
	if strings.Contains(quiet.String(), "app-update") {
		t.Errorf("update banner rendered with no pending update:\n%s", quiet.String())
	}

	c.applyAppUpdate(true)
	if !c.updateReady {
		t.Fatal("applyAppUpdate(true) should mark an update pending")
	}
	var pending strings.Builder
	app.PrintHTML(&pending, c.Render())
	for _, want := range []string{"app-update", "A new version of Waunder is ready.", "Reload"} {
		if !strings.Contains(pending.String(), want) {
			t.Errorf("update banner missing %q\n%s", want, pending.String())
		}
	}

	// A pending update latches: it stays until the page actually reloads, so a
	// later false reading cannot silently hide the banner.
	c.applyAppUpdate(false)
	if !c.updateReady {
		t.Error("a pending update should not be cleared by a later false reading")
	}
}
