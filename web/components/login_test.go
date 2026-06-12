package components

import (
	"net/http"
	"strings"
	"testing"
)

func TestLoginRendersForm(t *testing.T) {
	c := &Login{Client: &mockClient{}}
	html := renderHTML(t, c)
	for _, want := range []string{"login-passphrase", "Sign in", `type="password"`, "login-submit"} {
		if !strings.Contains(html, want) {
			t.Errorf("login HTML missing %q\n%s", want, html)
		}
	}
}

func TestLoginErrorStatus(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want string
	}{
		{"unauthorized", &APIError{Status: http.StatusUnauthorized}, "Incorrect passphrase."},
		{"server error", &APIError{Status: http.StatusInternalServerError}, "Could not sign in. Please try again."},
		{"transport error", errTransport, "Could not sign in. Please try again."},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := loginErrorStatus(tc.err); got != tc.want {
				t.Errorf("loginErrorStatus = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestLoginButtonText(t *testing.T) {
	if got := loginButtonText(false); got != "Sign in" {
		t.Errorf("idle button = %q, want %q", got, "Sign in")
	}
	if got := loginButtonText(true); got != "Signing in…" {
		t.Errorf("submitting button = %q", got)
	}
}

var errTransport = &transportError{}

type transportError struct{}

func (*transportError) Error() string { return "dial failed" }
