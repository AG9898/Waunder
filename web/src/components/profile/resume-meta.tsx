/**
 * The current primary resume's ingest metadata, ported from `renderResume` in
 * `web/components/profile.go` (see docs/GO_MIGRATION.md).
 *
 * Read-only: the resume is sourced from the portfolio export pipeline (push-on-export to
 * `POST /api/profile/resume`), and this screen only reports what was ingested. The list keeps Go's
 * structure exactly — `ul.profile-resume-meta` holding a title item, a status row whose second
 * `<span>` is the pill, and a file item — because `app.css` styles the title and file items only
 * through the inherited `.profile-resume-meta li` rule, so a changed element or an extra wrapper
 * would silently drop them out of it.
 */
import type { ResumeSummary } from "../../api/schemas";
import { resumeFileLabel, resumeStatusClass } from "../../lib/profile";

export function ResumeMeta({ resume }: { resume: ResumeSummary | null }) {
  return (
    <div className="profile-resume">
      <h2>Resume</h2>
      {resume === null ? (
        <p className="profile-resume-empty">
          No resume ingested yet. It syncs from the portfolio export pipeline.
        </p>
      ) : (
        <ul className="profile-resume-meta">
          <li className="profile-resume-title">{`Title: ${resume.title}`}</li>
          <li className="profile-resume-status-row">
            <span>Parse status: </span>
            <span className={`profile-resume-status ${resumeStatusClass(resume.parse_status)}`}>
              {resume.parse_status}
            </span>
          </li>
          <li className="profile-resume-file">{`File: ${resumeFileLabel(resume)}`}</li>
        </ul>
      )}
    </div>
  );
}
