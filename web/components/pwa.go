package components

import (
	"regexp"
	"strconv"
	"strings"
)

// PlatformState describes the install/notification readiness of the current
// browser environment. It is computed deterministically from a small set of
// browser-supplied facts (user agent, standalone display state, and Push API
// availability) so the install/permission gating logic can be unit-tested
// without a real browser.
type PlatformState struct {
	// IsIOS reports whether the user agent is an iOS (or iPadOS) device.
	IsIOS bool

	// IOSVersion is the detected major.minor iOS version (e.g. 16.4). It is
	// zero when the platform is not iOS or the version cannot be parsed.
	IOSMajor int
	IOSMinor int

	// Standalone reports whether the PWA is currently running as an installed,
	// home-screen app (display-mode: standalone, or navigator.standalone on iOS).
	Standalone bool

	// PushSupported reports whether the Push API / service worker notification
	// stack is available in this browser.
	PushSupported bool
}

// iosVersionRe extracts the OS version from an iOS/iPadOS user agent string,
// e.g. "CPU iPhone OS 16_4 like Mac OS X" -> "16", "4".
var iosVersionRe = regexp.MustCompile(`(?:CPU (?:iPhone )?OS|iPhone OS|OS) (\d+)[_.](\d+)`)

// DetectIOS reports whether the user agent denotes an iOS/iPadOS device and,
// when possible, its major/minor OS version. iPadOS 13+ reports a desktop
// Safari user agent, so a Macintosh UA reporting touch points is also treated
// as iOS (the caller passes that signal via maxTouchPoints).
func DetectIOS(userAgent string, maxTouchPoints int) (isIOS bool, major, minor int) {
	ua := userAgent
	lower := strings.ToLower(ua)

	isAppleMobile := strings.Contains(ua, "iPhone") ||
		strings.Contains(ua, "iPad") ||
		strings.Contains(ua, "iPod")

	// iPadOS masquerading as desktop Safari: Macintosh UA with a touch screen.
	isiPadOSDesktop := strings.Contains(ua, "Macintosh") && maxTouchPoints > 1

	if !isAppleMobile && !isiPadOSDesktop {
		return false, 0, 0
	}

	// Exclude in-app browsers that are not Safari-based WebKit only when they
	// are clearly non-Apple engines is unnecessary on iOS, since all iOS
	// browsers use WebKit; we keep the detection permissive.
	_ = lower

	if m := iosVersionRe.FindStringSubmatch(ua); m != nil {
		major, _ = strconv.Atoi(m[1])
		minor, _ = strconv.Atoi(m[2])
	}

	return true, major, minor
}

// SupportsIOSWebPush reports whether the detected iOS version is new enough to
// support Web Push for installed PWAs. Apple shipped Web Push for home-screen
// web apps in iOS/iPadOS 16.4.
func SupportsIOSWebPush(major, minor int) bool {
	if major > 16 {
		return true
	}
	if major == 16 {
		return minor >= 4
	}
	return false
}

// PushGate is the decision the install/permission guide renders for the user.
type PushGate int

const (
	// GateReadyToRequest means the environment can request push permission now.
	GateReadyToRequest PushGate = iota

	// GateNeedsInstall means the user must add the app to their home screen
	// before push can be requested (iOS requirement).
	GateNeedsInstall

	// GateUpgradeIOS means the device's iOS is older than 16.4 and cannot
	// receive Web Push at all.
	GateUpgradeIOS

	// GateUnsupported means the browser exposes no Push API support.
	GateUnsupported
)

// EvaluatePushGate decides whether the push-permission request should be
// offered, and if not, why. On iOS the request is gated behind both a
// supported OS version (16.4+) and the app being installed to the home screen,
// because Safari only exposes the Push API to installed web apps.
func EvaluatePushGate(s PlatformState) PushGate {
	if s.IsIOS {
		if !SupportsIOSWebPush(s.IOSMajor, s.IOSMinor) {
			return GateUpgradeIOS
		}
		if !s.Standalone {
			return GateNeedsInstall
		}
		// Installed iOS PWA on 16.4+: the Push API becomes available.
		return GateReadyToRequest
	}

	if !s.PushSupported {
		return GateUnsupported
	}
	return GateReadyToRequest
}
