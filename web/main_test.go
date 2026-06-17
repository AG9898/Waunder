package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
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
