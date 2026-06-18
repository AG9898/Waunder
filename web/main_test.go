package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ag9898/waunder/web/components"
	"github.com/maxence-charriere/go-app/v10/pkg/app"
)

func TestRegisterAPIProxyRoutesForwardsAPIAndResendWebhook(t *testing.T) {
	var paths []string
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		w.WriteHeader(http.StatusAccepted)
	}))
	t.Cleanup(backend.Close)

	proxy, err := newAPIProxy(backend.URL)
	if err != nil {
		t.Fatalf("newAPIProxy() error = %v", err)
	}

	mux := http.NewServeMux()
	registerAPIProxyRoutes(mux, proxy)
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)

	for _, path := range []string{"/api/job_posts", "/webhooks/resend/inbound"} {
		resp, err := http.Post(server.URL+path, "application/json", nil)
		if err != nil {
			t.Fatalf("POST %s error = %v", path, err)
		}
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusAccepted {
			t.Fatalf("POST %s status = %d, want %d", path, resp.StatusCode, http.StatusAccepted)
		}
	}

	want := []string{"/api/job_posts", "/webhooks/resend/inbound"}
	if len(paths) != len(want) {
		t.Fatalf("proxied paths = %v, want %v", paths, want)
	}
	for i := range want {
		if paths[i] != want[i] {
			t.Fatalf("proxied paths = %v, want %v", paths, want)
		}
	}
}

func TestAppHandlerRegistersStylesheet(t *testing.T) {
	// app.Handler only serves a page for routes registered with app.Route;
	// main() registers these before RunWhenOnBrowser(), so register the "/"
	// route here too (route registration is a process-global, idempotent
	// no-op for an already-registered path).
	app.Route("/", func() app.Composer { return &components.DigestView{} })

	handler := newAppHandler()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	resp, err := http.Get(server.URL + "/")
	if err != nil {
		t.Fatalf("GET / error = %v", err)
	}
	t.Cleanup(func() { _ = resp.Body.Close() })

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body error = %v", err)
	}

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET / status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	want := `<link type="text/css" href="/web/app.css" rel="stylesheet">`
	if !strings.Contains(string(body), want) {
		// go-app attribute ordering is generated and not part of our contract;
		// fall back to checking the stylesheet href is present at all.
		if !strings.Contains(string(body), `href="/web/app.css"`) ||
			!strings.Contains(string(body), `rel="stylesheet"`) {
			t.Fatalf("response body does not register /web/app.css as a stylesheet: %s", body)
		}
	}
}
