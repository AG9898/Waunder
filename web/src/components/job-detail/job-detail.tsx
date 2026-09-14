/**
 * The job detail screen (`/jobs/:id`), ported from `JobDetailView` in
 * `web/components/jobs.go` (see docs/GO_MIGRATION.md): one `GET /api/job_posts/:id` rendered
 * as a header, an assessment column (`requirements.tsx`), and a workspace aside holding the
 * route out to the employer, the optional draft actions, and the intake controls.
 *
 * The two remaining panels arrived with `FE-20`: the tracker quick action (`tracker-action.tsx`,
 * split between `.manual-application` and the sibling `.job-pipeline-status` block) and the
 * cover letter (`cover-letter.tsx`, in `JobAssessment`'s children slot). One `useTrackerWrite`
 * is shared by both tracker blocks, so a single in-flight write disables all of them — the
 * single `statusSaving` flag Go had.
 *
 * ## Nothing on this screen applies to a job
 *
 * Opening a posting is a read. The five writes it offers — prepare a draft, move the posting
 * between intake bins, record that the owner applied by hand, edit the tracker, and generate a
 * cover letter — are all explicit clicks, and none of them submits anything: `POST
 * /api/applications` creates a draft Application and generates materials for review, and the
 * approve-and-submit step lives on `/applications/:id` behind its own button. That is CLAUDE.md's
 * "never auto-submit without explicit per-application approval" as it applies here, and
 * `job-detail.test.tsx`, `tracker-action.test.tsx`, and `cover-letter.test.tsx` pin it by
 * asserting zero create-application, lifecycle, tracker, and cover-letter writes after a render.
 *
 * ## The aside's order is CSS, not markup
 *
 * `.job-workspace-actions` is `display: contents` at phone width, so its children become
 * direct flex children of `.job-workspace` and `app.css` orders them around the assessment
 * column (`.manual-application` 0, `.job-assessment` 1, `.job-pipeline-status` 2,
 * `.job-optional-actions` 3, `.job-lifecycle` 4). Above the 800px container query the aside
 * becomes a real sticky sidebar again. Both layouts read the same class names, so reordering
 * or unwrapping anything here changes the phone layout silently — the markup below is the
 * Go markup, element for element.
 *
 * ## A write invalidates; it never patches the job in place
 *
 * Go's `applyLifecycleResult` wrote the new state onto its local copy of the job. Here the
 * lifecycle mutation invalidates the same three prefixes the feed does (`FE-17`), because the
 * feed, the ingestion landing, and this screen all render the same posting's bin and a local
 * patch would leave the other two showing a state the server no longer reports.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";

import { createApplication, fetchJob, setJobLifecycle } from "../../api/endpoints";
import { queryKeys } from "../../api/keys";
import type { JobDetail, JobRoute } from "../../api/schemas";
import {
  applyButtonLabel,
  backLink,
  externalApplicationURL,
  parseJobId,
  routeLabel,
} from "../../lib/job-detail";
import type { FeedBin } from "../../lib/job-filters";
import { matchScoreBand, matchScoreLabel, sourceLabel } from "../../lib/labels";
import { applicationErrorMessage, lifecycleErrorMessage } from "../../lib/messages";
import { type TrackerWrite, useTrackerWrite } from "../../lib/pipeline";
import { AppChrome } from "../app-chrome";
import { SourceMarker } from "../jobs/job-row";
import { LoadError, Loading } from "../load-state";
import { CoverLetterPanel } from "./cover-letter";
import { JobAssessment } from "./requirements";
import { MarkAppliedControl, PipelineStatusPanel, TrackerStatusLine } from "./tracker-action";

export function JobDetailScreen() {
  const jobId = parseJobId(useParams().id);
  const back = backLink(useLocation().search);
  const {
    data: job,
    isPending,
    isError,
    error,
  } = useQuery({
    queryKey: queryKeys.jobs.detail(jobId),
    queryFn: () => fetchJob(jobId),
  });

  return (
    <div className="job-detail">
      <AppChrome />
      <Link className="job-detail-back" to={back.href}>
        {back.label}
      </Link>
      {isPending ? <Loading /> : isError ? <LoadError error={error} /> : <JobBody job={job} />}
    </div>
  );
}

/** The loaded posting: header, workspace aside, assessment column. */
function JobBody({ job }: { job: JobDetail }) {
  // One write for both tracker blocks: they are separate nodes only because `app.css` orders
  // them separately, and a second mutation would let two edits race on one Application.
  const write = useTrackerWrite(job.id);
  return (
    <div className="job-detail-body">
      <h1 className="job-title">{job.title}</h1>
      <p className="job-company">{job.company}</p>
      <SourceLine source={job.source} />
      {job.compensation === "" ? null : <p className="job-compensation">{job.compensation}</p>}
      <p className={`job-score job-score--${matchScoreBand(job.match_score)}`}>
        Match: {matchScoreLabel(job.match_score, job.scoring_status)}
      </p>
      <div className="job-workspace">
        <aside className="job-workspace-actions" aria-label="Application workspace">
          <ManualApplication job={job} write={write} />
          <PipelineStatusPanel application={job.application} write={write} />
          <details className="job-optional-actions">
            <summary>Drafts &amp; outreach</summary>
            <ApplyAction jobId={job.id} />
            <Link className="job-contacts-link" to={`/jobs/${String(job.id)}/contacts`}>
              View contacts and outreach
            </Link>
          </details>
          <LifecycleControls jobId={job.id} state={job.lifecycle_state} />
        </aside>
        <JobAssessment job={job}>
          <CoverLetterPanel jobId={job.id} />
        </JobAssessment>
      </div>
    </div>
  );
}

/**
 * Where the posting was ingested from. Unlike the feed's pill this is a sentence, so it keeps
 * the Go build's `Source: ` prefix and its own `<p className="job-source">` — the marker
 * itself (brand logo or emoji) is shared with the feed row rather than transcribed again.
 *
 * An empty source renders nothing at all: "Source: " with no value would read as a bug.
 */
function SourceLine({ source }: { source: string }) {
  const label = sourceLabel(source);
  if (label === "") {
    return null;
  }
  return (
    <p className="job-source">
      <SourceMarker source={source} />
      Source: {label}
    </p>
  );
}

/**
 * The manual route out: how Rails resolved the application route, the link that opens it in a
 * new tab, where the posting currently stands, and the one-tap way to record that the owner
 * applied. This is the whole loop the app is built around — Waunder finds the posting, the
 * owner applies on the employer's site, and the tracker line closes it.
 *
 * The link is the resolved `application_url`, falling back to the posting URL — so a posting
 * whose route never resolved still opens the original listing instead of dead-ending. Both go
 * through `externalApplicationURL`, which is the safety filter, not a formatter: a
 * `javascript:` URL or a relative path yields no link and the note changes to say so.
 *
 * The children are flat rather than grouped because `app.css` styles them as siblings of
 * `.manual-application`, in Go's order: route, status line, note, button, error.
 */
function ManualApplication({ job, write }: { job: JobDetail; write: TrackerWrite }) {
  const applicationUrl = externalApplicationURL(job.route.application_url, job.posting_url);
  return (
    <section className="manual-application">
      <RouteBlock route={job.route} applicationUrl={applicationUrl} />
      <TrackerStatusLine application={job.application} className="manual-tracker-current" />
      <p className="manual-application-note">
        {applicationUrl === ""
          ? "No application link is available. Use the original alert to find the posting."
          : "Apply on the employer or job-board site in a new tab. When finished, record it here."}
      </p>
      <MarkAppliedControl application={job.application} write={write} />
    </section>
  );
}

/**
 * `renderRoute`: the resolved route and its outbound link, shown only when Rails resolved
 * something. `rel="noopener noreferrer"` is not boilerplate — without it the opened page gets
 * a handle on this one through `window.opener`.
 */
function RouteBlock({ route, applicationUrl }: { route: JobRoute; applicationUrl: string }) {
  if (route.route_type === "" && route.recommended_route === "" && applicationUrl === "") {
    return null;
  }
  return (
    <div className="job-route">
      <h2>How to apply</h2>
      <p className="job-route-type">{routeLabel(route)}</p>
      {applicationUrl === "" ? null : (
        <a
          className="job-route-link"
          href={applicationUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open application
        </a>
      )}
    </div>
  );
}

/**
 * The explicit "prepare a draft" action: `POST /api/applications` creates (or reuses) a draft
 * Application, Rails generates the materials in the background, and the owner lands on
 * `/applications/:id` to review them. It approves nothing and submits nothing.
 *
 * Rails is idempotent here — it reuses the latest draft/approved application for the job — but
 * the button is still disabled while the request is in flight, because two creates in flight
 * would race to generate the same draft twice and spend OpenRouter budget on the loser.
 * Mutations never retry (`query-client.ts`), so a failure is reported and left alone.
 */
function ApplyAction({ jobId }: { jobId: number }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => createApplication(jobId),
    onSuccess: (result) => {
      // Not awaited: the screen is about to unmount, so these only need to be marked stale for
      // whenever the owner comes back. The navigation is the point of the click.
      void queryClient.invalidateQueries({ queryKey: queryKeys.applications.root() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.root() });
      void navigate(`/applications/${String(result.application_id)}`);
    },
  });

  const onApply = useCallback(() => {
    if (mutation.isPending) return;
    mutation.mutate();
  }, [mutation]);

  return (
    <div className="job-apply">
      <button
        className="job-apply-button"
        type="button"
        disabled={mutation.isPending}
        onClick={onApply}
      >
        {applyButtonLabel(mutation.isPending)}
      </button>
      <p className="job-apply-note">
        Optional: generate tailored materials to review and use in your application.
      </p>
      {mutation.isError ? (
        <p className="job-apply-error">{applicationErrorMessage(mutation.error)}</p>
      ) : null}
    </div>
  );
}

/**
 * The intake controls: the same backlog / remove / restore transitions the feed offers
 * (`FE-17`), for the posting being read.
 *
 * Which buttons exist depends on the bin, as in the feed: an active posting offers Backlog and
 * Remove, one already in Backlog or Removed offers Restore. `"removed"` is a soft delete Rails
 * owns — no row is destroyed — and an empty `lifecycle_state` counts as active, matching the
 * `job_posts.lifecycle_state` column default.
 */
function LifecycleControls({ jobId, state }: { jobId: number; state: string }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (next: FeedBin) => setJobLifecycle([jobId], next),
    // Awaited, unlike the apply action's: this screen stays on the transitioned posting, so
    // the controls must not re-enable until the refetched job says which bin it is in now.
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.jobs.root() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.digest() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.ingestionBatches.root() }),
      ]);
    },
  });

  const onSet = useCallback(
    (next: FeedBin) => {
      if (mutation.isPending) return;
      mutation.mutate(next);
    },
    [mutation],
  );

  const bin = state === "" ? "active" : state;
  return (
    <div className="job-lifecycle">
      <h2>Intake</h2>
      {bin === "active" ? (
        <div className="job-lifecycle-buttons">
          <button
            className="job-lifecycle-backlog"
            type="button"
            disabled={mutation.isPending}
            onClick={() => {
              onSet("backlog");
            }}
          >
            Move to backlog
          </button>
          <button
            className="job-lifecycle-remove"
            type="button"
            disabled={mutation.isPending}
            onClick={() => {
              onSet("removed");
            }}
          >
            Remove
          </button>
        </div>
      ) : (
        <button
          className="job-lifecycle-restore"
          type="button"
          disabled={mutation.isPending}
          onClick={() => {
            onSet("active");
          }}
        >
          Restore to active
        </button>
      )}
      {mutation.isError ? (
        <p className="job-lifecycle-error">{lifecycleErrorMessage(mutation.error)}</p>
      ) : null}
    </div>
  );
}
