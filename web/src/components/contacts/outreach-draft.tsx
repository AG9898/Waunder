/**
 * One candidate's outreach controls, ported from `renderOutreach`, `generate`, and
 * `applyGenerateResult` in `web/components/contacts.go` (see docs/GO_MIGRATION.md): a loose
 * template the owner types, the explicit generate button, and — once Rails answers — the drafted
 * message in a read-only textarea with a copy control.
 *
 * ## Prefilled for manual sending only
 *
 * `POST /api/contact_candidates/:id/outreach_drafts` runs `OutreachDraftGenerator` and returns
 * text. That is everything this panel does with a contact: there is no send control, no
 * `mailto:` or messaging link, and no form that could submit anything, and `contacts.test.tsx`
 * asserts all three over the rendered output (CLAUDE.md "Never auto-send LinkedIn messages").
 * Generating is also the one click on the screen that spends OpenRouter budget, so it never
 * happens on render.
 *
 * ## State is keyed by candidate id
 *
 * Go kept a `map[int]*outreachGen` on the screen, keyed by candidate id. Here each candidate owns
 * one instance of this component, mounted under `key={contact.id}`, so React keys the typed
 * template and the mutation's draft and error to the id the same way. They survive a refetch that
 * reorders the list — Rails lists newest first, so saving a contact moves every existing one down
 * a slot — which state kept by index would not.
 *
 * ## Three failure states, because Rails distinguishes three
 *
 * Rails answers 201 with the draft, 503 `llm_unavailable` when the generator was skipped (no
 * `OPENROUTER_API_KEY`), and 502 `generation_failed` when it ran and failed.
 * `outreachErrorMessage` keeps those apart (plus 401), because "not configured" and "try again"
 * are different instructions.
 *
 * ## The textarea's class is load-bearing
 *
 * The drafted text renders into a `<textarea>`, which `app.css`'s `p, li, h1, h2, span` wrap reset
 * does not reach. `.contact-outreach-message` and `.contact-outreach-template` carry their own
 * `overflow-wrap: break-word` (AGENTS.md 2026-06-18), so dropping the class lets a model-written
 * URL overflow the card at phone width.
 */
import { useMutation } from "@tanstack/react-query";
import { type ChangeEvent, useCallback, useState } from "react";

import { generateOutreach } from "../../api/endpoints";
import { outreachButtonLabel } from "../../lib/contacts";
import { outreachErrorMessage } from "../../lib/messages";
import { CopyButton } from "../copy-button";

export function OutreachDraftPanel({ candidateId }: { candidateId: number }) {
  const [template, setTemplate] = useState("");
  // Nothing is invalidated: Rails stores the draft, but no read serializes drafts (there is no
  // list-drafts endpoint and a candidate row carries none), so the response is the only copy.
  const generate = useMutation({
    mutationFn: (looseTemplate: string) => generateOutreach(candidateId, looseTemplate),
  });

  const onTemplate = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    setTemplate(event.target.value);
  }, []);

  const onGenerate = useCallback(() => {
    if (generate.isPending) return;
    generate.mutate(template);
  }, [generate, template]);

  // A new attempt starts a new mutation, so `data` is absent while one is in flight or has
  // failed — the draft is hidden in exactly the states Go hid it (`state != generateDone`).
  const draft = generate.data;
  return (
    <div className="contact-outreach">
      <textarea
        className="contact-outreach-template"
        aria-label="Notes for the outreach draft"
        placeholder="Optional: notes or a loose template for the draft"
        value={template}
        onChange={onTemplate}
      />
      <button
        className="contact-outreach-generate"
        type="button"
        disabled={generate.isPending}
        onClick={onGenerate}
      >
        {outreachButtonLabel(generate.isPending, draft !== undefined)}
      </button>
      {generate.isError ? (
        <p className="contact-outreach-error" role="alert">
          {outreachErrorMessage(generate.error)}
        </p>
      ) : null}
      {draft === undefined ? null : (
        <div className="contact-outreach-draft">
          <p className="contact-outreach-manual">
            Copy this draft and send it manually. Waunder does not send it.
          </p>
          <textarea
            className="contact-outreach-message"
            aria-label="Drafted outreach message"
            readOnly
            value={draft.message}
          />
          <CopyButton
            text={draft.message}
            label="Copy draft"
            buttonClassName="contact-outreach-copy"
          />
        </div>
      )}
    </div>
  );
}
