/**
 * The autofill preview, ported from `renderAutofill` and `renderAutofillWarnings` in
 * `web/components/draft.go`: the ATS and apply URL Rails resolved, the manual-review warnings,
 * and the answers the Playwright worker will type, each editable, with the save control.
 *
 * ## Only the answer values are editable
 *
 * The ATS kind, the apply URL, and the resume reference are Rails-owned parts of the trusted-submit
 * contract (AGENTS.md 2026-06-22), so they render as text — there is no input for any of them, and
 * `updateApplicationDraft` sends `answers` alone. An answer's `field` is not editable either: it is
 * the form label the worker matches, and renaming it would point a value at a different question.
 *
 * ## The apply URL is filtered before it becomes a link
 *
 * Go rendered `apply_url` straight into an `href`. Here it goes through `externalApplicationURL`,
 * the job detail's safety filter, so a `javascript:` or relative URL renders as plain text in the
 * same `.draft-autofill-url` element instead of as a clickable link. The URL is the link's *text*,
 * so `app.css` gives the class `word-break: break-all` — an unbroken URL cannot overflow the panel at
 * phone width, and the element is outside the `p, li, h1, h2, span` wrap reset.
 */
import type { FormEvent } from "react";

import type { AutofillPreview, AutofillWarning, StructuredAnswer } from "../../api/schemas";
import { autofillPresent, previewSaveButtonLabel, warningFor } from "../../lib/draft-review";
import { externalApplicationURL } from "../../lib/job-detail";

export interface AutofillAnswersProps {
  /** Rails' preview. Its `answers` are ignored in favour of `answers` below. */
  autofill: AutofillPreview;
  /** The answers on screen: Rails' until the owner edits one, then the edits. */
  answers: StructuredAnswer[];
  warnings: readonly AutofillWarning[];
  dirty: boolean;
  saveStatus: "idle" | "pending" | "success" | "error";
  /** The save failure sentence, or `""`. */
  saveError: string;
  onAnswer: (index: number, value: string) => void;
  onSave: () => void;
}

export function AutofillAnswers({
  autofill,
  answers,
  warnings,
  dirty,
  saveStatus,
  saveError,
  onAnswer,
  onSave,
}: AutofillAnswersProps) {
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave();
  };
  const preview = { ...autofill, answers };

  return (
    <div className="draft-autofill">
      <h2>Autofill preview</h2>
      {autofillPresent(preview) ? null : (
        <p className="draft-autofill-pending">Preparing draft...</p>
      )}
      {autofill.ats === "" ? null : <p className="draft-autofill-ats">{`ATS: ${autofill.ats}`}</p>}
      <ApplyUrl url={autofill.apply_url} />
      {warnings.length === 0 ? null : (
        <div className="draft-autofill-warnings">
          {warnings.map((warning, index) => (
            <p key={`${warning.field}-${String(index)}`} className="draft-autofill-warning">
              {`${warning.field}: ${warning.message}`}
            </p>
          ))}
        </div>
      )}
      {answers.length === 0 ? null : (
        <form className="draft-autofill-form" onSubmit={onSubmit}>
          <h2>Fields the worker will fill</h2>
          <ul className="draft-autofill-answers">
            {answers.map((answer, index) => {
              const warning = warningFor(warnings, answer.field);
              return (
                // The worker's answers have no id and a field may repeat, so the position is the
                // identity; the client never reorders, adds, or removes an answer.
                <li key={String(index)} className="draft-autofill-answer">
                  <label className="draft-autofill-field">
                    <span className="draft-answer-field">{answer.field}</span>
                    <textarea
                      className="draft-autofill-value"
                      value={answer.value}
                      onChange={(event) => {
                        onAnswer(index, event.target.value);
                      }}
                    />
                  </label>
                  {warning === undefined ? null : (
                    <p className="draft-autofill-warning">{warning.message}</p>
                  )}
                </li>
              );
            })}
          </ul>
          <button
            className="draft-preview-save"
            type="submit"
            disabled={!dirty || saveStatus === "pending"}
          >
            {previewSaveButtonLabel(saveStatus, dirty)}
          </button>
          {saveStatus === "error" ? (
            <p className="draft-preview-error" role="alert">
              {saveError}
            </p>
          ) : null}
          {saveStatus === "success" && !dirty ? (
            <p className="draft-preview-ok" role="status">
              Preview saved.
            </p>
          ) : null}
        </form>
      )}
    </div>
  );
}

/** The apply URL as a new-tab link when it is a real external URL, and as plain text otherwise. */
function ApplyUrl({ url }: { url: string }) {
  if (url === "") return null;
  if (externalApplicationURL(url) === "") {
    return <span className="draft-autofill-url">{url}</span>;
  }
  return (
    <a className="draft-autofill-url" href={url} target="_blank" rel="noopener noreferrer">
      {url}
    </a>
  );
}
