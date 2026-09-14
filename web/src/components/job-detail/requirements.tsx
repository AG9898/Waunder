/**
 * The job detail's assessment column: everything the scorer wrote about one posting. Ported
 * from the `.job-assessment` half of `JobDetailView.Render` and the shared `requirementList`
 * helper in `web/components/jobs.go` (see docs/GO_MIGRATION.md).
 *
 * ## Every block here is LLM-generated text, and that shapes the markup
 *
 * `JobScorer` fills `summary`, the three requirement lists, `resume_alignment_notes`, and
 * `application_strategy` from a model's answer, so this column renders text nobody reviewed:
 * arbitrary length, arbitrary content, and — the case that actually broke the layout — a
 * single unbroken token such as a bare URL. `public/app.css` protects against that with one
 * base reset, `p, li, h1, h2, span { overflow-wrap: break-word; }` (AGENTS.md 2026-06-18), so
 * **every** block below must render into one of those five tags. A `<div>` holding the text
 * directly would sit outside the reset and overflow the card at phone width, which is why the
 * alignment and strategy blocks put their prose in a `<p>` inside their wrapper rather than
 * styling the wrapper as the paragraph.
 *
 * ## An absent block renders nothing; an unscored posting says so
 *
 * Each optional field is omitted entirely when Rails sent `""` or an empty list — a heading
 * with nothing under it reads as a failure rather than as "the scorer had nothing to add".
 * The one exception is the summary, which falls back to a sentence, because a detail screen
 * with no prose at all looks broken and because the fallback is what tells the owner the
 * posting is still worth opening manually: triage leaves most inbound postings unscored
 * (AGENTS.md 2026-06-23), so this is the common case, not an edge one.
 */
import type { ReactNode } from "react";

import type { JobDetail } from "../../api/schemas";

/** Shown in place of the summary when the scorer has not run, or returned nothing. */
const NO_ASSESSMENT =
  "No assessment yet. You can still review the original posting and apply manually.";

/**
 * The assessment column. `children` is the slot the cover letter panel fills (`FE-20`); it
 * sits after the strategy block, exactly where `renderCoverLetter()` was called in Go.
 */
export function JobAssessment({ job, children }: { job: JobDetail; children?: ReactNode }) {
  return (
    <div className="job-assessment">
      <h2>Job assessment</h2>
      <p className="job-summary">{job.summary === "" ? NO_ASSESSMENT : job.summary}</p>
      <RequirementList
        heading="Relevant requirements"
        className="job-relevant"
        items={job.relevant_requirements}
      />
      <RequirementList
        heading="Missing requirements"
        className="job-missing"
        items={job.missing_requirements}
      />
      <RequirementList heading="Red flags" className="job-red-flags" items={job.red_flags} />
      <ProseBlock
        className="job-alignment"
        heading="Resume alignment"
        text={job.resume_alignment_notes}
      />
      <ProseBlock
        className="job-strategy"
        heading="Application approach"
        text={job.application_strategy}
      />
      {children}
    </div>
  );
}

/**
 * One bulleted list of scorer output.
 *
 * The class is a parameter because it is what `app.css` colours the bullets with —
 * `.job-relevant li::before` is sage, `.job-missing` grey, `.job-red-flags` red — so the three
 * lists are one component with three class names rather than three near-identical components.
 */
export function RequirementList({
  heading,
  className,
  items,
}: {
  heading: string;
  className: string;
  items: readonly string[];
}) {
  if (items.length === 0) {
    return null;
  }
  return (
    <div className={className}>
      <h2>{heading}</h2>
      <ul>
        {items.map((item, index) => (
          // Scorer output has no id and can legitimately repeat a phrase across two lists, so
          // the index is the only stable key available. The list is never reordered or edited,
          // which is the condition that makes an index key safe.
          <li key={`${item}-${String(index)}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

/** A headed paragraph of scorer prose, rendered only when there is prose to show. */
function ProseBlock({
  className,
  heading,
  text,
}: {
  className: string;
  heading: string;
  text: string;
}) {
  if (text === "") {
    return null;
  }
  return (
    <div className={className}>
      <h2>{heading}</h2>
      <p>{text}</p>
    </div>
  );
}
