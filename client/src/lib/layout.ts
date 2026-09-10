/**
 * The device-local layout preference, ported from `web/components/chrome.go`
 * (see docs/GO_MIGRATION.md).
 *
 * The owner picks Auto, Desktop, or Mobile once per browser. The choice is stored under
 * `waunder.layout` and applied as `data-layout` on the document root; everything else is
 * CSS. `app.css` declares the desktop variable overrides twice — once for
 * `:root[data-layout="desktop"]` and once inside `@media (min-width: 960px)` for
 * `:root:not([data-layout="mobile"])` — so Auto resolves from the usable window width with
 * **no resize listener, no `matchMedia`, and no re-render**. That is why this module only
 * ever writes one attribute: adding a JS breakpoint here would make Auto and Desktop drift
 * apart on a resize, which is exactly what the duplicated CSS block avoids.
 *
 * ## The stored value is a preserved contract
 *
 * go-app's `BrowserStorage` JSON-encodes everything it writes (`storage.go`
 * `jsStorage.Set` → `json.Marshal`), so a Go string lands in `localStorage` **quoted**:
 * the owner's browser holds `"desktop"`, not `desktop`. `writeLayout` therefore writes
 * `JSON.stringify` and produces byte-identical values, and `readLayout` accepts the quoted
 * form as well as a bare one. Anything else silently resets the preference the first time
 * the ported app loads — and, until the `FE-30` cutover, the Go build is still production
 * and reads the same key on the same devices, so the two must agree in both directions.
 *
 * ## Storage is allowed to fail
 *
 * Every read and write is total. `localStorage` can be missing, can be present and throw
 * on access (a browser configured to block site data), and can throw on write (private
 * mode, quota). A read failure degrades to Auto, which renders correctly; a write failure
 * is reported to the caller so the chrome can say the preference was not saved rather than
 * pretending it was.
 */

/** The `localStorage` key. Same key as `chrome.go`'s `layoutStorageKey`. */
export const LAYOUT_STORAGE_KEY = "waunder.layout";

/** The three stored values, unchanged from `chrome.go`'s `normalizeLayout`. */
export type LayoutPreference = "auto" | "desktop" | "mobile";

/** The selector's options, in `chrome.go`'s order, with its labels. */
export const LAYOUT_OPTIONS: ReadonlyArray<{ value: LayoutPreference; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "desktop", label: "Desktop" },
  { value: "mobile", label: "Mobile" },
];

/**
 * Resolves any input to a stored value, defaulting to Auto.
 *
 * Ported from `normalizeLayout` and deliberately just as strict: only the exact lowercase
 * `"desktop"` and `"mobile"` are honored, so `"Desktop"`, a stale value from an older
 * build, or a hand-edited storage entry all fall back to Auto rather than producing a
 * `data-layout` no CSS rule matches.
 */
export function normalizeLayout(value: unknown): LayoutPreference {
  return value === "desktop" || value === "mobile" ? value : "auto";
}

/**
 * The browser's `localStorage`, or `null` where it cannot be used.
 *
 * The DOM types declare `localStorage` as always present, but the property *getter* itself
 * throws when a browser is configured to block site data, and the global is absent outside
 * a document. Both are the same answer here: no storage.
 */
function browserStorage(): Storage | null {
  try {
    const storage: Storage | undefined = globalThis.localStorage;
    return storage ?? null;
  } catch {
    return null;
  }
}

/**
 * go-app wrote JSON, so the stored value is normally a quoted string. A bare value is
 * accepted too — it is what a hand-edit or any future non-JSON writer would leave — and a
 * non-string JSON value resolves to Auto through `normalizeLayout`.
 */
function decodeStoredLayout(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Reads the saved preference, defaulting to Auto when nothing is stored or storage is
 * unavailable.
 *
 * `storage` is injectable so tests can drive a stub that throws, mirroring the seam
 * `restoreFilters(app.BrowserStorage)` used in the Go build.
 */
export function readLayout(storage: Storage | null = browserStorage()): LayoutPreference {
  try {
    const raw = storage?.getItem(LAYOUT_STORAGE_KEY);
    if (raw === null || raw === undefined) {
      return "auto";
    }
    return normalizeLayout(decodeStoredLayout(raw));
  } catch {
    return "auto";
  }
}

/**
 * Saves the preference, returning whether it was actually stored.
 *
 * The boolean is the point: a browser that cannot persist this still has to honor the
 * choice for the current session, so the caller applies the layout either way and only
 * uses the `false` to tell the owner it will not survive a reload.
 */
export function writeLayout(
  layout: LayoutPreference,
  storage: Storage | null = browserStorage(),
): boolean {
  if (!storage) {
    return false;
  }
  try {
    storage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
    return true;
  } catch {
    return false;
  }
}

/**
 * Applies the preference as `data-layout` on the document root, where `app.css` reads it.
 *
 * Auto is written out as `data-layout="auto"` rather than removing the attribute, exactly
 * as `chrome.go` did: the CSS keys off `[data-layout="desktop"]` and
 * `:not([data-layout="mobile"])`, so an explicit `auto` and a missing attribute are
 * equivalent to the stylesheet, and writing it keeps the resolved preference inspectable
 * in the DOM.
 */
export function applyLayout(
  layout: LayoutPreference,
  root: Element | null = globalThis.document?.documentElement ?? null,
): void {
  root?.setAttribute("data-layout", normalizeLayout(layout));
}
