/**
 * The landing screen (`/`): everything Waunder has ingested, newest first, grouped into the
 * alert or digest email each posting arrived in. Ported from `DigestView` in
 * `web/components/jobs.go` (see docs/GO_MIGRATION.md).
 *
 * ## This is ingestion history, not a daily digest
 *
 * The screen keeps the `digest` tab id and every `.digest*` class name, but it has not been
 * a "top 5 scored in the last 24 hours" list since 2026-06-23 (AGENTS.md): that version only
 * ever showed yesterday's best and hid everything ingested since. `GET /api/ingestion_batches`
 * answers with batches derived in Rails — postings sharing a source within a three-minute
 * window, because one `ParseInboundEmailJob` materializes a whole digest's postings within
 * seconds while distinct alerts arrive minutes apart. There is no persisted batch row and no
 * link from a posting to its inbound email, so the grouping is Rails' to compute and nothing
 * here re-derives it. `GET /api/digest` still exists and still backs the once-a-day push
 * notification; it is a different concern and this screen does not read it.
 *
 * ## Two reads, one load state
 *
 * `load()` in Go fetched intake and batches together and put the screen into its error state
 * if *either* failed. That is preserved here across two `useQuery` calls, which is worth
 * being explicit about: the intake panel is the control that explains why the batch list may
 * be empty, so a page showing "No ingestions yet." while silently failing to report that
 * intake is paused is the one combination that actively misleads.
 *
 * The two are separate queries rather than one combined fetch because their cache lifetimes
 * differ — `queryKeys.intake()` is written directly by the toggle's mutation, and each page
 * of batches is its own entry, so stepping back a page inside the stale window costs no
 * request where the Go build refetched on every Prev/Next.
 *
 * ## The open batch comes from the URL
 *
 * A posting link carries `?from=digest&batch=<id>`, and the job detail's back link returns
 * here with the same query, so the batch the owner drilled into re-expands. Go re-read that
 * param in `OnMount`, `OnPreRender`, **and** `OnNav` — three hooks for one value, because a
 * client-side navigation back to an already-mounted screen ran none of the first two.
 * `useSearchParams` is reactive, so the same behaviour is one read with no lifecycle to
 * remember.
 *
 * Paging deliberately does **not** clear the target: a batch that is not on this page simply
 * matches nothing, and returning to its page re-expands it.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router";

import { fetchIngestionBatches, fetchIntake } from "../../api/endpoints";
import { queryKeys } from "../../api/keys";
import type { IngestionBatch, PageMeta } from "../../api/schemas";
import { formatBatchDate } from "../../lib/ingestion-batches";
import { pageIndicatorLabel } from "../../lib/job-feed";
import { AppChrome } from "../app-chrome";
import { LoadError, Loading } from "../load-state";
import { Batch } from "./batch";
import { IntakeControl } from "./intake-control";

export function IngestionBatchesScreen() {
  const [pageNum, setPageNum] = useState(1);
  const openBatch = useSearchParams()[0].get("batch") ?? "";

  const intakeQuery = useQuery({ queryKey: queryKeys.intake(), queryFn: () => fetchIntake() });
  const batchesQuery = useQuery({
    queryKey: queryKeys.ingestionBatches.page(pageNum),
    queryFn: () => fetchIngestionBatches(pageNum),
  });

  // Either failure fails the screen, and a failure wins over data already on it — a refetch
  // that starts erroring must not leave a stale page looking live, which is how `applyResult`
  // behaved too.
  const failure = intakeQuery.error ?? batchesQuery.error;
  const intake = intakeQuery.data;
  const batchPage = batchesQuery.data;

  return (
    <div className="digest">
      <AppChrome />
      <h1>Recent ingestions</h1>
      {failure !== null ? (
        <LoadError error={failure} />
      ) : intake === undefined || batchPage === undefined ? (
        <Loading />
      ) : (
        <div className="digest-content">
          <IntakeControl intake={intake} />
          <BatchList
            batches={batchPage.batches}
            page={batchPage.page}
            openBatch={openBatch}
            onPage={setPageNum}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The batches for one page, with a date header emitted each time the day changes.
 *
 * The headers are a running comparison against the previous batch rather than a grouped
 * data structure, which is what Go did and is the right shape for the payload: the batches
 * arrive newest-first and already contiguous by day, so regrouping them would only create a
 * chance to disagree with the server's order.
 */
function BatchList({
  batches,
  page,
  openBatch,
  onPage,
}: {
  batches: readonly IngestionBatch[];
  page: PageMeta;
  openBatch: string;
  onPage: (update: (current: number) => number) => void;
}) {
  if (batches.length === 0) {
    return <p className="digest-empty">No ingestions yet.</p>;
  }
  return (
    <div className="digest-body">
      {batches.map((batch, index) => (
        <div className="digest-batch-group" key={batch.id}>
          {batch.date !== (batches[index - 1]?.date ?? "") ? (
            <p className="digest-date">{formatBatchDate(batch.date)}</p>
          ) : null}
          <Batch batch={batch} open={batch.id === openBatch} />
        </div>
      ))}
      <div className="digest-pagination">
        <button
          className="digest-page-prev"
          disabled={page.number <= 1}
          onClick={() => {
            onPage((current) => (current <= 1 ? current : current - 1));
          }}
        >
          Previous
        </button>
        <span className="digest-page-indicator">{pageIndicatorLabel(page)}</span>
        <button
          className="digest-page-next"
          disabled={!page.has_next}
          onClick={() => {
            onPage((current) => (page.has_next ? Math.max(current, 1) + 1 : current));
          }}
        >
          Next
        </button>
      </div>
    </div>
  );
}
