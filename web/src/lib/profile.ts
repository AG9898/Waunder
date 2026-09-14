/**
 * Pure helpers for the profile screen, ported from the non-render half of
 * `web/components/profile.go` (see docs/GO_MIGRATION.md): `editFromProfile`, `presenceLabel`,
 * `resumeFileLabel`, `resumeStatusClass`, and `saveButtonLabel`, plus the field table the Go
 * `Render` spelled out as seven `textField` calls. `showInstallGuide` is new with the profile
 * screen mounting the install guide, which the Go screen never rendered.
 *
 * They live in `lib/` rather than beside the components for the reason `FE-15` recorded:
 * `eslint-plugin-react-refresh` warns when a component module also exports a plain function or a
 * constant.
 */
import type { MutationStatus } from "@tanstack/react-query";

import type { Profile, ProfileEdit, ResumeSummary } from "../api/schemas";
import type { PushGate } from "./platform";

/** One editable text field: the key it writes, its label, and the input's class. */
export interface ProfileFieldSpec {
  field: keyof ProfileEdit;
  label: string;
  /** The input's class. `app.css` styles each field by its own class, not by a shared one. */
  className: string;
}

/**
 * The seven editable fields in `Render`'s order, with Go's labels and input classes. These are
 * the only values the screen can write: the encrypted contact details and the structured resume
 * arrays are sourced from the resume ingest, and `PATCH /api/profile` never carries them.
 */
export const PROFILE_FIELDS: readonly ProfileFieldSpec[] = [
  { field: "full_name", label: "Full name", className: "profile-full-name" },
  { field: "headline", label: "Headline", className: "profile-headline" },
  { field: "summary", label: "Summary", className: "profile-summary" },
  { field: "location", label: "Location", className: "profile-location" },
  { field: "linkedin_url", label: "LinkedIn URL", className: "profile-linkedin" },
  { field: "github_url", label: "GitHub URL", className: "profile-github" },
  { field: "portfolio_url", label: "Portfolio URL", className: "profile-portfolio" },
];

/**
 * `editFromProfile`: the form's values seeded from a profile Rails returned. It copies exactly the
 * seven editable keys, so nothing else a read carries can ride along into the next `PATCH`.
 */
export function editFromProfile(profile: Profile): ProfileEdit {
  return {
    full_name: profile.full_name,
    headline: profile.headline,
    summary: profile.summary,
    location: profile.location,
    linkedin_url: profile.linkedin_url,
    github_url: profile.github_url,
    portfolio_url: profile.portfolio_url,
  };
}

/** `presenceLabel`: an encrypted contact field is only ever reported as set or not set. */
export function presenceLabel(present: boolean): string {
  return present ? "set" : "not set";
}

/**
 * `resumeFileLabel`: the attached file's name, `attached` when Rails stored a file without one,
 * and `not attached` otherwise — a filename on a document with no file attached is not a file.
 */
export function resumeFileLabel(resume: Pick<ResumeSummary, "file_attached" | "filename">): string {
  if (!resume.file_attached) return "not attached";
  return resume.filename !== "" ? resume.filename : "attached";
}

/**
 * `resumeStatusClass`: the quiet status-pill modifier for a `parse_status`. Only `parsed` reads as
 * success; `pending` and any future value stay neutral rather than reading as an error, because
 * `ResumeJsonImporter` has no failure path.
 */
export function resumeStatusClass(parseStatus: string): string {
  return parseStatus === "parsed"
    ? "profile-resume-status-parsed"
    : "profile-resume-status-pending";
}

/**
 * `saveButtonLabel`, keyed on the save mutation's status. Go's four `saveState` values map one to
 * one onto TanStack's `idle` / `pending` / `success` / `error`, and a failed save offers the plain
 * label again, as `saveError` did.
 */
export function saveButtonLabel(status: MutationStatus): string {
  switch (status) {
    case "pending":
      return "Saving…";
    case "success":
      return "Saved";
    default:
      return "Save profile";
  }
}

/**
 * Whether the profile screen mounts the install guide beside the push toggle.
 *
 * Only for the two iOS gates, where the owner's next step is outside the app (add it to the Home
 * Screen, or update iOS) and the toggle can say no more than "not available in this browser". In
 * `ready-to-request` the toggle already owns the subscribe action, and the guide would add a
 * second enable button plus a contradiction: it reports "Notifications are on" from the browser's
 * *permission*, while the toggle reports the *subscription*, so after turning notifications off the
 * two would disagree. In `unsupported` the guide would only restate the toggle's own sentence.
 */
export function showInstallGuide(gate: PushGate): boolean {
  return gate === "needs-install" || gate === "upgrade-ios";
}
