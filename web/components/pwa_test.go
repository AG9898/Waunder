package components

import "testing"

func TestDetectIOS(t *testing.T) {
	cases := []struct {
		name           string
		ua             string
		maxTouchPoints int
		wantIOS        bool
		wantMajor      int
		wantMinor      int
	}{
		{
			name:      "iPhone 16.4",
			ua:        "Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15",
			wantIOS:   true,
			wantMajor: 16,
			wantMinor: 4,
		},
		{
			name:      "iPhone 15.6",
			ua:        "Mozilla/5.0 (iPhone; CPU iPhone OS 15_6_1 like Mac OS X) AppleWebKit/605.1.15",
			wantIOS:   true,
			wantMajor: 15,
			wantMinor: 6,
		},
		{
			name:      "iPad classic UA",
			ua:        "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
			wantIOS:   true,
			wantMajor: 17,
			wantMinor: 0,
		},
		{
			name:           "iPadOS desktop UA with touch",
			ua:             "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15",
			maxTouchPoints: 5,
			wantIOS:        true,
			// Desktop UA carries no iOS OS token, so version stays zero.
			wantMajor: 0,
			wantMinor: 0,
		},
		{
			name:           "real Mac desktop (no touch)",
			ua:             "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15",
			maxTouchPoints: 0,
			wantIOS:        false,
		},
		{
			name:    "Android Chrome",
			ua:      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0",
			wantIOS: false,
		},
		{
			name:    "Windows Chrome",
			ua:      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0",
			wantIOS: false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			gotIOS, major, minor := DetectIOS(tc.ua, tc.maxTouchPoints)
			if gotIOS != tc.wantIOS {
				t.Fatalf("isIOS = %v, want %v", gotIOS, tc.wantIOS)
			}
			if major != tc.wantMajor || minor != tc.wantMinor {
				t.Fatalf("version = %d.%d, want %d.%d", major, minor, tc.wantMajor, tc.wantMinor)
			}
		})
	}
}

func TestSupportsIOSWebPush(t *testing.T) {
	cases := []struct {
		major, minor int
		want         bool
	}{
		{16, 3, false},
		{16, 4, true},
		{16, 5, true},
		{15, 9, false},
		{17, 0, true},
		{0, 0, false},
	}
	for _, tc := range cases {
		if got := SupportsIOSWebPush(tc.major, tc.minor); got != tc.want {
			t.Errorf("SupportsIOSWebPush(%d,%d) = %v, want %v", tc.major, tc.minor, got, tc.want)
		}
	}
}

func TestEvaluatePushGate(t *testing.T) {
	cases := []struct {
		name  string
		state PlatformState
		want  PushGate
	}{
		{
			name:  "iOS too old",
			state: PlatformState{IsIOS: true, IOSMajor: 16, IOSMinor: 3},
			want:  GateUpgradeIOS,
		},
		{
			name:  "iOS 16.4 not installed",
			state: PlatformState{IsIOS: true, IOSMajor: 16, IOSMinor: 4, Standalone: false},
			want:  GateNeedsInstall,
		},
		{
			name:  "iOS 16.4 installed",
			state: PlatformState{IsIOS: true, IOSMajor: 16, IOSMinor: 4, Standalone: true},
			want:  GateReadyToRequest,
		},
		{
			name:  "iOS 17 installed",
			state: PlatformState{IsIOS: true, IOSMajor: 17, IOSMinor: 0, Standalone: true},
			want:  GateReadyToRequest,
		},
		{
			name:  "desktop with push",
			state: PlatformState{IsIOS: false, PushSupported: true},
			want:  GateReadyToRequest,
		},
		{
			name:  "desktop without push",
			state: PlatformState{IsIOS: false, PushSupported: false},
			want:  GateUnsupported,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := EvaluatePushGate(tc.state); got != tc.want {
				t.Errorf("EvaluatePushGate = %d, want %d", got, tc.want)
			}
		})
	}
}
