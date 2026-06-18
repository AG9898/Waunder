package components

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/maxence-charriere/go-app/v10/pkg/app"
)

// mockPusher is a test double for the browser Push API abstraction. It records
// the VAPID key it was subscribed with and returns canned results so the push
// flow is exercised without a real browser. It is shared by the profile tests
// (which embed a PushToggle) and the push tests here.
type mockPusher struct {
	supported       bool
	currentEndpoint string
	currentErr      error
	subscription    PushSubscription
	subscribeErr    error
	gotVAPIDKey     string
	unsubscribeErr  error
	unsubscribed    bool
}

func (m *mockPusher) Supported() bool { return m.supported }

func (m *mockPusher) Subscribe(_ context.Context, vapidPublicKey string) (PushSubscription, error) {
	m.gotVAPIDKey = vapidPublicKey
	if m.subscribeErr != nil {
		return PushSubscription{}, m.subscribeErr
	}
	return m.subscription, nil
}

func (m *mockPusher) CurrentEndpoint(context.Context) (string, error) {
	return m.currentEndpoint, m.currentErr
}

func (m *mockPusher) Unsubscribe(context.Context) error {
	m.unsubscribed = true
	return m.unsubscribeErr
}

func sampleSubscription() PushSubscription {
	return PushSubscription{
		Endpoint: "https://push.example/abc",
		Keys:     PushSubscriptionKeys{P256dh: "p256dh-key", Auth: "auth-key"},
	}
}

func TestInitialPushState(t *testing.T) {
	cases := []struct {
		name      string
		supported bool
		endpoint  string
		want      pushUIState
	}{
		{"unsupported", false, "", pushUnsupported},
		{"unsupported with endpoint", false, "https://push", pushUnsupported},
		{"supported no endpoint", true, "", pushOff},
		{"supported with endpoint", true, "https://push", pushOn},
	}
	for _, tc := range cases {
		if got := initialPushState(tc.supported, tc.endpoint); got != tc.want {
			t.Errorf("%s: initialPushState(%v,%q) = %v, want %v", tc.name, tc.supported, tc.endpoint, got, tc.want)
		}
	}
}

func TestDoSubscribeUsesPublicVAPIDKeyAndPersists(t *testing.T) {
	sub := sampleSubscription()
	c := &mockClient{vapidKey: "BPUBLICKEY"}
	p := &mockPusher{supported: true, subscription: sub}
	toggle := &PushToggle{Client: c, Pusher: p}

	got, err := toggle.doSubscribe(context.Background())
	if err != nil {
		t.Fatalf("doSubscribe: %v", err)
	}
	if p.gotVAPIDKey != "BPUBLICKEY" {
		t.Errorf("subscribed with VAPID key %q, want %q", p.gotVAPIDKey, "BPUBLICKEY")
	}
	if c.subscribed.Endpoint != sub.Endpoint || c.subscribed.Keys.Auth != sub.Keys.Auth {
		t.Errorf("subscription not persisted to Rails: %+v", c.subscribed)
	}
	if got.Endpoint != sub.Endpoint {
		t.Errorf("doSubscribe returned %+v, want endpoint %q", got, sub.Endpoint)
	}
}

func TestDoSubscribeNoVAPIDKeyIsUnsupported(t *testing.T) {
	toggle := &PushToggle{Client: &mockClient{vapidKey: ""}, Pusher: &mockPusher{supported: true}}
	_, err := toggle.doSubscribe(context.Background())
	if !errors.Is(err, ErrPushUnsupported) {
		t.Errorf("expected ErrPushUnsupported with no VAPID key, got %v", err)
	}
}

func TestDoSubscribeDoesNotPersistOnBrowserError(t *testing.T) {
	c := &mockClient{vapidKey: "BPUBLICKEY"}
	p := &mockPusher{supported: true, subscribeErr: ErrPushDenied}
	toggle := &PushToggle{Client: c, Pusher: p}

	_, err := toggle.doSubscribe(context.Background())
	if !errors.Is(err, ErrPushDenied) {
		t.Fatalf("expected ErrPushDenied, got %v", err)
	}
	if c.subscribed.Endpoint != "" {
		t.Errorf("must not persist a subscription when the browser subscribe failed: %+v", c.subscribed)
	}
}

func TestApplySubscribeStateTransitions(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		toggle := &PushToggle{}
		toggle.applySubscribe(sampleSubscription(), nil)
		if toggle.state != pushOn || toggle.endpoint != sampleSubscription().Endpoint {
			t.Errorf("state=%v endpoint=%q, want pushOn + endpoint", toggle.state, toggle.endpoint)
		}
	})
	t.Run("unsupported", func(t *testing.T) {
		toggle := &PushToggle{}
		toggle.applySubscribe(PushSubscription{}, ErrPushUnsupported)
		if toggle.state != pushUnsupported {
			t.Errorf("state=%v, want pushUnsupported", toggle.state)
		}
	})
	t.Run("denied is a failure with guidance", func(t *testing.T) {
		toggle := &PushToggle{}
		toggle.applySubscribe(PushSubscription{}, ErrPushDenied)
		if toggle.state != pushFailed || !strings.Contains(toggle.errMsg, "blocked") {
			t.Errorf("state=%v msg=%q, want pushFailed + blocked guidance", toggle.state, toggle.errMsg)
		}
	})
}

func TestDoUnsubscribeCancelsBrowserThenRails(t *testing.T) {
	c := &mockClient{}
	p := &mockPusher{supported: true}
	toggle := &PushToggle{Client: c, Pusher: p}

	if err := toggle.doUnsubscribe(context.Background(), "https://push.example/abc"); err != nil {
		t.Fatalf("doUnsubscribe: %v", err)
	}
	if !p.unsubscribed {
		t.Error("expected browser Unsubscribe to be called")
	}
	if c.unsubEndpoint != "https://push.example/abc" {
		t.Errorf("Rails Unsubscribe got endpoint %q", c.unsubEndpoint)
	}
}

func TestDoUnsubscribeSkipsRailsOnBrowserError(t *testing.T) {
	c := &mockClient{}
	p := &mockPusher{supported: true, unsubscribeErr: errors.New("boom")}
	toggle := &PushToggle{Client: c, Pusher: p}

	if err := toggle.doUnsubscribe(context.Background(), "https://push.example/abc"); err == nil {
		t.Fatal("expected error from browser Unsubscribe")
	}
	if c.unsubEndpoint != "" {
		t.Errorf("must not call Rails Unsubscribe when the browser unsubscribe failed: %q", c.unsubEndpoint)
	}
}

func TestApplyUnsubscribeStateTransitions(t *testing.T) {
	t.Run("success clears endpoint", func(t *testing.T) {
		toggle := &PushToggle{state: pushOn, endpoint: "https://push"}
		toggle.applyUnsubscribe(nil)
		if toggle.state != pushOff || toggle.endpoint != "" {
			t.Errorf("state=%v endpoint=%q, want pushOff + cleared", toggle.state, toggle.endpoint)
		}
	})
	t.Run("error", func(t *testing.T) {
		toggle := &PushToggle{state: pushOn}
		toggle.applyUnsubscribe(errors.New("boom"))
		if toggle.state != pushFailed {
			t.Errorf("state=%v, want pushFailed", toggle.state)
		}
	})
}

func TestPushErrorMessage(t *testing.T) {
	if msg := pushErrorMessage(ErrPushDenied); !strings.Contains(msg, "blocked") {
		t.Errorf("denied message = %q", msg)
	}
	if msg := pushErrorMessage(&APIError{Status: http.StatusUnauthorized}); !strings.Contains(msg, "session expired") {
		t.Errorf("unauthorized message = %q", msg)
	}
	if msg := pushErrorMessage(errors.New("other")); !strings.Contains(msg, "Could not update") {
		t.Errorf("default message = %q", msg)
	}
}

func TestPushToggleRendersUnsupportedState(t *testing.T) {
	// An unsupported browser (the server/test build) renders the unsupported
	// guidance and never auto-subscribes.
	toggle := &PushToggle{Client: &mockClient{}, Pusher: &mockPusher{supported: false}}
	html := renderHTML(t, toggle)
	if !strings.Contains(html, "available in this browser") {
		t.Errorf("expected unsupported state, got:\n%s", html)
	}
}

func TestPushToggleSupportedRendersEnableAndDoesNotSubscribe(t *testing.T) {
	c := &mockClient{vapidKey: "BPUBLICKEY"}
	toggle := &PushToggle{Client: c, Pusher: &mockPusher{supported: true}}
	html := renderHTML(t, toggle)
	if !strings.Contains(html, "Turn on notifications") {
		t.Errorf("expected enable control, got:\n%s", html)
	}
	// Rendering/mount must never auto-subscribe: no VAPID fetch, no persist.
	if c.subscribed.Endpoint != "" {
		t.Errorf("push toggle auto-subscribed on render: %+v", c.subscribed)
	}
}

func TestPushToggleOnStateShowsStatusAndDisable(t *testing.T) {
	// PushToggle.start()/refresh() runs on OnMount/OnPreRender and would
	// overwrite a hand-set "on" state via the mock pusher's CurrentEndpoint,
	// so drive the pure renderer directly to assert the "on" status markup.
	toggle := &PushToggle{state: pushOn, endpoint: "https://push.example/abc"}
	ui := renderPushControl(toggle)
	var sb strings.Builder
	app.PrintHTML(&sb, ui)
	html := sb.String()
	if !strings.Contains(html, `class="push-toggle-status push-toggle-status-on">On`) {
		t.Errorf("expected on-status pill, got:\n%s", html)
	}
	if !strings.Contains(html, "Turn off notifications") {
		t.Errorf("expected disable control alongside status, got:\n%s", html)
	}
}
