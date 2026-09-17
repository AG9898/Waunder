/**
 * The draft review screen (`/applications/:id`), ported from `DraftReview` in
 * `web/components/draft.go` (see docs/GO_MIGRATION.md): one `GET /api/applications/:id` rendered
 * as the generated materials to copy, then a collapsed automation section holding the autofill
 * preview (`autofill-answers.tsx`), the worker's last report, and the approve-and-submit control.
 *
 * ## Submitting is one explicit click, and Rails still decides
 *
 * `POST /api/applications/:id/submit` is the only trusted-submit dispatch in the client, and this
 * screen's button is its only caller. Rails treats that request as the owner's per-application
 * approval (RESOLVED-19) and then runs `ApplicationSubmitDispatcher`'s gates before anything reaches
 * the worker. The client adds two things and nothing more: the button stays disabled until
 * `canSubmit` holds for the answers on screen (ready, complete, no warnings), and a refusal renders
 * Rails' code as a sentence. Nothing here submits on mount, on a refetch, or after a save — the test
 * asserts zero submit and draft writes after a full render — and mutations never retry, so a failed
 * submit cannot re-dispatch on its own.
 *
 * ## A dirty submit saves first and re-checks what Rails stored
 *
 * `approveAndSubmit` in Go: with unsaved edits, the answers are `PATCH`ed first, and the submit is
 * sent only if the draft Rails answers with still passes `canSubmit` — Rails recomputes
 * `autofill_warnings` from the saved answers, so an edit can introduce a warning the client could
 * not have known about. `SubmitPhase` spans both requests, the way Go's `submitState` did, because
 * neither mutation's status alone describes the action.
 *
 * ## Answers follow Rails until the owner edits one
 *
 * Go fetched once and never refetched. The query client refetches on focus, and a draft opened
 * while `GenerateApplicationDraftJob` is still running is empty — so a seed-once form would keep
 * showing "Preparing draft..." after Rails finished. The answers on screen are therefore Rails'
 * until the first edit, and the owner's edits from then until a save succeeds, when Rails' answer
 * is written into the cache and becomes the source again.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useCallback, useState } from "react";
import { Link, useParams } from "react-router";

import {
  fetchApplicationDraft,
  submitApplication,
  updateApplicationDraft,
} from "../../api/endpoints";
import { queryKeys } from "../../api/keys";
import type { ApplicationDraft, StructuredAnswer, SubmitResult } from "../../api/schemas";
import {
  type SubmitPhase,
  canSubmit,
  draftHeading,
  parseApplicationId,
  showWorkerReport,
  submitButtonLabel,
  submitNote,
  submitResultLabel,
  withAnswers,
} from "../../lib/draft-review";
import { externalApplicationURL } from "../../lib/job-detail";
import {
  blockedSubmitMessage,
  draftSaveErrorMessage,
  submitErrorMessage,
} from "../../lib/messages";
import { pipelineStatusLabel } from "../../lib/pipeline";
import { AppChrome } from "../app-chrome";
import { CopyButton } from "../copy-button";
import { LoadError, Loading } from "../load-state";
import { StatusChip } from "../ui/status-chip";
import { AutofillAnswers } from "./autofill-answers";

export function DraftReviewScreen() {
  const id = parseApplicationId(useParams().id);
  const {
    data: draft,
    isError,
    error,
  } = useQuery({
    queryKey: queryKeys.applications.draft(id),
    queryFn: () => fetchApplicationDraft(id),
  });

  return (
    <div className="draft-review">
      <AppChrome />
      <Link className="draft-back" to="/jobs">
        <ArrowLeft aria-hidden="true" size={14} />
        Jobs
      </Link>
      {/* Data first: a failed *refetch* keeps the last draft, and swapping the screen for the
          load error then would discard unsaved answer edits (AGENTS.md 2026-09-13). The key
          resets every edit and submit state when the route moves to another application. */}
      {draft !== undefined ? (
        <DraftBody key={id} id={id} draft={draft} />
      ) : isError ? (
        <LoadError error={error} />
      ) : (
        <Loading />
      )}
    </div>
  );
}

function DraftBody({ id, draft }: { id: number; draft: ApplicationDraft }) {
  const queryClient = useQueryClient();
  /** The owner's unsaved answers, or `null` while the screen shows Rails' own. */
  const [edits, setEdits] = useState<StructuredAnswer[] | null>(null);
  const [phase, setPhase] = useState<SubmitPhase>("idle");
  const [submitError, setSubmitError] = useState("");
  const [result, setResult] = useState<SubmitResult | null>(null);

  const answers = edits ?? draft.autofill_payload.answers;
  const dirty = edits !== null;
  const current = withAnswers(draft, answers);
  const ready = canSubmit(current);

  const save = useMutation({
    mutationFn: (reviewed: StructuredAnswer[]) => updateApplicationDraft(id, { answers: reviewed }),
    onSuccess: async (saved) => {
      // The response is the refreshed draft, so it becomes the cached read directly.
      queryClient.setQueryData(queryKeys.applications.draft(id), saved);
      setEdits(null);
      // A tracker row carries `draft_ready`, which the saved answers can change.
      await queryClient.invalidateQueries({ queryKey: queryKeys.jobs.root() });
    },
  });

  const submit = useMutation({
    mutationFn: () => submitApplication(id),
  });

  const onAnswer = useCallback(
    (index: number, value: string) => {
      setEdits((prior) =>
        (prior ?? answers).map((answer, at) => (at === index ? { ...answer, value } : answer)),
      );
      // Go's `answerValueSetter` returned the save control to idle on every keystroke.
      save.reset();
    },
    [answers, save],
  );

  const onSave = useCallback(() => {
    if (edits === null || save.isPending) return;
    save.mutate(edits);
  }, [edits, save]);

  // A plain function rather than a `useCallback`: it reads the whole render's state, and the
  // React Compiler rejects memoizing it over the mutation objects.
  const onSubmit = async () => {
    if (phase === "sending" || phase === "done" || !ready) return;
    setPhase("sending");
    setSubmitError("");

    if (edits !== null) {
      let saved: ApplicationDraft;
      try {
        saved = await save.mutateAsync(edits);
      } catch (cause) {
        setPhase("error");
        setSubmitError(draftSaveErrorMessage(cause));
        return;
      }
      if (!canSubmit(saved)) {
        setPhase("error");
        setSubmitError(blockedSubmitMessage(saved.autofill_warnings.length > 0));
        return;
      }
    }

    let dispatched: SubmitResult;
    try {
      dispatched = await submit.mutateAsync();
    } catch (cause) {
      setPhase("error");
      setSubmitError(submitErrorMessage(cause));
      return;
    }
    setResult(dispatched);
    setPhase("done");
    // Rails moved the application to approved and the tracker to applied/waiting; re-read both
    // rather than patching them locally the way Go's `applySubmitResult` did.
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.applications.draft(id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs.root() }),
    ]);
  };

  const applyLink = externalApplicationURL(draft.autofill_payload.apply_url);
  const applicationLabel = pipelineStatusLabel(draft.pipeline_status, draft.pipeline_stage);
  const statusLabel = pipelineStatusLabel(draft.pipeline_status, "");
  const pipelineStage = applicationLabel.startsWith(`${statusLabel} · `)
    ? applicationLabel.slice(statusLabel.length + 3)
    : "";

  return (
    <div className="draft-body">
      <h1 className="draft-title">{draftHeading(draft)}</h1>
      {draft.status === "" ? null : <p className="draft-status">{`Status: ${draft.status}`}</p>}
      {draft.pipeline_status === "" ? null : (
        <p className="draft-pipeline-status">
          <span className="draft-pipeline-label">Application:</span>{" "}
          <StatusChip status={draft.pipeline_status} size="touch" />
          {pipelineStage === "" ? null : (
            <span className="draft-pipeline-stage">{` · ${pipelineStage}`}</span>
          )}
        </p>
      )}
      <div className="draft-manual-intro">
        <p>
          Review these materials, then copy them into your application. Update your application
          status from the job page when finished.
        </p>
        {applyLink === "" ? null : (
          <a className="job-route-link" href={applyLink} target="_blank" rel="noopener noreferrer">
            Open application
          </a>
        )}
      </div>
      <div className="draft-materials">
        {draft.resume_emphasis_notes === "" ? null : (
          <div className="draft-resume-emphasis">
            <h2>Resume emphasis</h2>
            <p>{draft.resume_emphasis_notes}</p>
          </div>
        )}
        {draft.cover_letter === "" ? null : (
          <div className="draft-cover-letter">
            <h2>Cover letter</h2>
            <p>{draft.cover_letter}</p>
            <CopyButton text={draft.cover_letter} label="Copy cover letter" />
          </div>
        )}
        <AnswerList answers={draft.structured_answers} />
      </div>
      <details className="draft-automation">
        <summary>Automation &amp; autofill</summary>
        <AutofillAnswers
          autofill={draft.autofill_payload}
          answers={answers}
          warnings={draft.autofill_warnings}
          dirty={dirty}
          saveStatus={save.status}
          saveError={save.isError ? draftSaveErrorMessage(save.error) : ""}
          onAnswer={onAnswer}
          onSave={onSave}
        />
        <WorkerReport draft={draft} />
        <div className="draft-submit">
          <h2>Approve and submit</h2>
          <p className="draft-submit-note">{submitNote(current)}</p>
          <button
            className="draft-submit-button"
            type="button"
            disabled={!ready || phase === "sending" || phase === "done"}
            onClick={() => {
              void onSubmit();
            }}
          >
            {submitButtonLabel(phase, current, dirty)}
          </button>
          {phase === "error" ? (
            <p className="draft-submit-error" role="alert">
              {submitError}
            </p>
          ) : null}
          {phase === "done" && result !== null ? (
            <p className="draft-submit-result" role="status">
              {submitResultLabel(result)}
            </p>
          ) : null}
        </div>
      </details>
    </div>
  );
}

/** `answerList("Application answers", "draft-answers", ...)`: generated answers to copy by hand. */
function AnswerList({ answers }: { answers: StructuredAnswer[] }) {
  if (answers.length === 0) return null;
  return (
    <div className="draft-answers">
      <h2>Application answers</h2>
      <ul>
        {answers.map((answer, index) => (
          <li key={String(index)} className="draft-answer">
            <span className="draft-answer-field">{answer.field}</span>
            <span className="draft-answer-value">{answer.value}</span>
            <CopyButton text={answer.value} label="Copy answer" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** `renderWorkerReport`: why the worker paused or failed, with its logs and screenshot refs. */
function WorkerReport({ draft }: { draft: ApplicationDraft }) {
  if (!showWorkerReport(draft)) return null;
  const report = draft.worker_report;
  return (
    <div className="draft-worker-report">
      <h2>Submit result</h2>
      {draft.failure_reason === "" ? null : (
        <p className="draft-worker-reason">{draft.failure_reason}</p>
      )}
      {report !== null && report.reason !== "" && report.reason !== draft.failure_reason ? (
        <p className="draft-worker-reason">{report.reason}</p>
      ) : null}
      {report !== null && report.logs.length > 0 ? (
        <ul className="draft-worker-logs">
          {report.logs.map((line, index) => (
            <li key={String(index)}>{line}</li>
          ))}
        </ul>
      ) : null}
      {report !== null && report.screenshots.length > 0 ? (
        <ul className="draft-worker-screenshots">
          {report.screenshots.map((ref, index) => (
            <li key={String(index)}>{ref}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
