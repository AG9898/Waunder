// Command web is the Waunder PWA service: a Go + go-app WebAssembly
// frontend plus a small HTTP server that serves the app shell and proxies
// /api requests to the Rails backend.
//
// This single main package is compiled twice:
//   - to WebAssembly (GOOS=js GOARCH=wasm) -> static/app.wasm, the frontend.
//   - to a native binary, the server that serves the app and proxies the API.
//
// On the client, app.RunWhenOnBrowser() takes over and the server code below
// never runs. On the server, RunWhenOnBrowser() is a no-op and we start HTTP.
package main

import (
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"

	"github.com/ag9898/waunder/web/components"
	"github.com/maxence-charriere/go-app/v10/pkg/app"
)

func main() {
	// Client-side routing: which component renders for which path. The data
	// screens fetch from the same-origin /api proxy (carrying the session
	// cookie) and render scored fields owned by Rails.
	app.Route("/", func() app.Composer { return &components.DigestView{} })
	app.Route("/login", func() app.Composer { return &components.Login{} })
	app.Route("/jobs", func() app.Composer { return &components.JobList{} })
	app.Route("/jobs/new", func() app.Composer { return &components.ManualEntry{} })
	app.Route("/profile", func() app.Composer { return &components.ProfileView{} })
	app.RouteWithRegexp(`^/jobs/\d+$`, func() app.Composer { return &components.JobDetailView{} })
	app.RouteWithRegexp(`^/jobs/\d+/contacts$`, func() app.Composer { return &components.ContactsView{} })
	app.RouteWithRegexp(`^/applications/\d+$`, func() app.Composer { return &components.DraftReview{} })
	app.RunWhenOnBrowser()

	// --- Server-side only below this point ---

	mux := http.NewServeMux()

	// Proxy /api/* to the Rails backend over Railway's private network so the
	// browser stays same-origin (no CORS) and Rails needs no public domain.
	// Skipped when unset so the PWA still serves standalone in local dev.
	if api := os.Getenv("API_INTERNAL_URL"); api != "" {
		proxy, err := newAPIProxy(api)
		if err != nil {
			log.Fatalf("invalid API_INTERNAL_URL %q: %v", api, err)
		}
		mux.Handle("/api/", proxy)
		log.Printf("proxying /api/ -> %s", api)
	} else {
		log.Print("API_INTERNAL_URL not set; /api proxy disabled")
	}

	// go-app serves the PWA: app shell, app.wasm, generated wasm_exec.js,
	// service worker, and the web manifest. go-app auto-generates the manifest
	// (display: standalone) and the offline app-shell service worker; we only
	// supply the metadata, icon, and PWA chrome here.
	//
	// Static resources (including app.wasm and the icon) are served from the
	// ./web directory under the /web/ URL prefix (go-app default convention).
	//
	// VAPID_PUBLIC_KEY is the public web-push key. It is public by design and
	// is forwarded into the PWA env so the client can subscribe; the private
	// VAPID secret lives only in Rails. No other business logic crosses here.
	mux.Handle("/", &app.Handler{
		Name:            "Waunder",
		ShortName:       "Waunder",
		Title:           "Waunder",
		Description:     "Personal job application assistant",
		Lang:            "en",
		StartURL:        "/",
		BackgroundColor: "#2d2c2c",
		ThemeColor:      "#2d2c2c",
		Icon: app.Icon{
			Default:  "/web/icon.svg",
			Large:    "/web/icon.svg",
			SVG:      "/web/icon.svg",
			Maskable: "/web/icon.svg",
		},
		Env: map[string]string{
			"VAPID_PUBLIC_KEY": os.Getenv("VAPID_PUBLIC_KEY"),
		},
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8000"
	}

	log.Printf("listening on :%s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatal(err)
	}
}

// newAPIProxy returns a reverse proxy to the Rails backend at target.
func newAPIProxy(target string) (http.Handler, error) {
	u, err := url.Parse(target)
	if err != nil {
		return nil, err
	}
	return httputil.NewSingleHostReverseProxy(u), nil
}
