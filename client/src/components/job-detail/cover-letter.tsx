/**
 * The job detail's cover-letter panel, ported from `renderCoverLetter`, `generateCoverLetter`,
 * and `applyCoverLetterResult` in `web/components/jobs.go` (see docs/GO_MIGRATION.md). It fills
 * the `children` slot `FE-19` left at the bottom of the assessment column.
 *
 * ## Generating is a click, and it is the only thing that spends LLM budget here
 *
 * `POST /api/job_posts/:id/cover_letter_draft` runs `CoverLetterGenerator` against OpenRouter.
 * Opening a posting must therefore never trigger it — `cover-letter.test.tsx` asserts zero
 * `POST`s after a full render, the same way the apply and lifecycle controls are pinned. The
 * endpoint also creates no Application and dispatches no worker task: this is copy the owner
 * sends by hand, which is why the empty state says so in as many words.
 *
 * ## Three failure states, because Rails distinguishes three
 *
 * `CoverLetterDraftsController#create` answers 201 with the draft, **503** `llm_unavailable`
 * when the generator was skipped (no `OPENROUTER_API_KEY`), and **502** `generation_failed`
 * when it ran and failed. Collapsing those would tell an owner whose key is missing to try
 * again forever, so `coverLetterErrorMessage` keeps them apart (plus 401, which every screen
 * reports as an expired session).
 *
 * ## Why this panel does its own `GET`
 *
 * `GET /api/job_posts/:id` already embeds `cover_letter_draft`, and Go rendered that copy.
 * Here the letter is its own cache entry under `jobs.coverLetter(id)`, read from the endpoint
 * that owns it, for one reason: generating replaces the letter, and with two copies of it in
 * the cache the detail's embedded one keeps rendering the old text until the *whole posting* is
 * refetched. The read is a single row and starts nothing.
 *
 * ## Generate is disabled until the current letter is on screen
 *
 * The `POST` **replaces** whatever letter exists. While the read is pending or has failed, the
 * panel cannot show what would be replaced, so it does not offer to replace it — a button that
 * silently discards a letter the owner cannot see is worse than one they have to wait a beat
 * for. A read failure is reported with the shared load copy and recovers on the next refetch.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { fetchCoverLetter, generateCoverLetter } from "../../api/endpoints";
import { queryKeys } from "../../api/keys";
import { coverLetterErrorMessage, loadErrorMessage } from "../../lib/messages";
import { CopyButton } from "../copy-button";

/** The empty state. It names the inputs and the limit, both of which are the point. */
const EMPTY_NOTE =
  "Generate a tailored letter from this posting and your synced resume. It will never submit an application.";

/** Shown while the saved letter is being read, in place of the empty note. */
const LOADING_NOTE = "Checking for a saved letter…";

export function CoverLetterPanel({ jobId }: { jobId: number }) {
  const queryClient = useQueryClient();
  const letter = useQuery({
    queryKey: queryKeys.jobs.coverLetter(jobId),
    queryFn: () => fetchCoverLetter(jobId),
  });

  const generate = useMutation({
    mutationFn: () => generateCoverLetter(jobId),
    // The response *is* the new letter, so it is written straight into the cache rather than
    // invalidated: a refetch would ask Rails for the row it just sent back.
    onSuccess: (draft) => {
      queryClient.setQueryData(queryKeys.jobs.coverLetter(jobId), draft);
    },
  });

  const onGenerate = useCallback(() => {
    if (generate.isPending) return;
    generate.mutate();
  }, [generate]);

  const draft = letter.data ?? null;
  const readable = !letter.isPending && !letter.isError;

  return (
    <section className="job-cover-letter">
      <h2>Cover letter</h2>
      {draft === null ? (
        <p className="job-cover-letter-empty">{letter.isPending ? LOADING_NOTE : EMPTY_NOTE}</p>
      ) : (
        <div className="job-cover-letter-draft">
          {/* A `<p>` because `app.css`'s `overflow-wrap: break-word` reset covers exactly
              p/li/h1/h2/span, and this is model-written text of arbitrary shape. */}
          <p className="job-cover-letter-body">{draft.body}</p>
          <CopyButton text={draft.body} label="Copy cover letter" />
        </div>
      )}
      <button
        className="job-cover-letter-generate"
        type="button"
        disabled={generate.isPending || !readable}
        onClick={onGenerate}
      >
        {generateLabel(draft !== null, generate.isPending)}
      </button>
      {letter.isError ? (
        <p className="job-cover-letter-error" role="alert">
          {loadErrorMessage(letter.error)}
        </p>
      ) : null}
      {generate.isError ? (
        <p className="job-cover-letter-error" role="alert">
          {coverLetterErrorMessage(generate.error)}
        </p>
      ) : null}
    </section>
  );
}

/** "Regenerate" once a letter exists, so the button never hides that it replaces one. */
function generateLabel(hasDraft: boolean, pending: boolean): string {
  if (pending) return "Generating…";
  return hasDraft ? "Regenerate cover letter" : "Generate cover letter";
}
