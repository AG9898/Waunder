package components

import (
	"strings"
	"testing"
)

func TestChromeNavigationAndLayout(t *testing.T) {
	html := renderHTML(t, &AppChrome{Active: "jobs"})
	for _, want := range []string{`aria-label="Main navigation"`, `aria-current="page"`, `href="/jobs/new"`, `value="auto"`, `value="desktop"`, `value="mobile"`} {
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
