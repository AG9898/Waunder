/**
 * The intake pause/resume panel at the top of the landing. Ported from
 * `renderIntakeControl`, `toggleIntake`, and `applyIntakeResult` in `web/components/jobs.go`
 * (see docs/GO_MIGRATION.md).
 *
 * ## What the toggle actually does
 *
 * Pausing stops Rails from hydrating, parsing, scoring, and LLM-extracting inbound alerts;
 * the webhooks still arrive and are kept as lightweight references, and resuming requeues
 * them (AGENTS.md 2026-07-13). That is why the panel reports a held count and why a resume
 * says how many it queued: the owner is being told the cost of the thing they just turned
 * back on, not congratulated. It is also why the pause sentence promises the alerts are
 * held — "paused" on its own reads as "alerts are being dropped".
 *
 * ## Nothing here toggles on render
 *
 * The panel reflects `GET /api/intake` and writes only from the button. Go pinned this with
 * a `setIntakeCalls != 0` assertion after a full render and the test here does the same,
 * because an intake write on mount would silently resume a paused pipeline — spending
 * OpenRouter budget on a backlog the owner deliberately held — every time the landing
 * loaded.
 *
 * ## State lives in the mutation, not beside it
 *
 * Go carried `intakeBusy`, `intakeErr`, and `intakeMessage` as three fields it had to keep
 * consistent by hand in `applyIntakeResult`. Here they are `isPending`, `error`, and `data`
 * on one mutation, so the three cannot disagree: a new click clears the previous outcome by
 * construction rather than by remembering to blank two strings first. The mutation never
 * retries (`query-client.ts`), so a failed toggle is reported once and left alone.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { setIntake } from "../../api/endpoints";
import { queryKeys } from "../../api/keys";
import type { IntakeStatus } from "../../api/schemas";
import { intakeResultMessage } from "../../lib/ingestion-batches";
import { intakeErrorMessage } from "../../lib/messages";

export function IntakeControl({ intake }: { intake: IntakeStatus }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (enabled: boolean) => setIntake(enabled),
    // Rails answers with the authoritative new status, so it is written straight into the
    // cache: an invalidate would spend a second round trip to learn what this response
    // already said, and would flicker the panel through its old state on the way.
    onSuccess: (status) => {
      queryClient.setQueryData(queryKeys.intake(), status);
    },
  });

  // `mutation.data` is the answered status; `intake` is the cached read. They agree after a
  // successful toggle (the cache was just written), so reading the prop keeps one source.
  const running = intake.enabled;
  const message = mutation.isSuccess ? intakeResultMessage(mutation.data) : "";
  const failure = mutation.isError ? intakeErrorMessage(mutation.error) : "";

  return (
    <section className="intake-control">
      <div className="intake-control-heading">
        <div>
          <h2>Job alert intake</h2>
          <p className="intake-control-note">
            Pause new parsing and scoring while keeping saved jobs available.
          </p>
        </div>
        <span className={`intake-status intake-status--${running ? "on" : "paused"}`}>
          {running ? "Running" : "Paused"}
        </span>
      </div>
      {intake.held_count > 0 ? (
        // Go phrased this with a bare `%d alerts`, plural at any count. Kept verbatim: the
        // parity gate compares the rendered sentence, and a lone held alert is a transient
        // state the owner sees for seconds.
        <p className="intake-held-count">{intake.held_count} alerts held for later.</p>
      ) : null}
      <button
        className="intake-toggle"
        disabled={mutation.isPending}
        onClick={() => {
          if (mutation.isPending) return;
          mutation.mutate(!running);
        }}
      >
        {mutation.isPending ? "Updating…" : running ? "Pause intake" : "Resume intake"}
      </button>
      {failure === "" ? null : <p className="intake-error">{failure}</p>}
      {message === "" ? null : <p className="intake-message">{message}</p>}
    </section>
  );
}
