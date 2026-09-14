/**
 * The manual import screen (`/jobs/new`), ported from `ManualEntry` in
 * `web/components/manual_entry.go` (see docs/GO_MIGRATION.md): a listing URL and/or pasted
 * posting text, with optional title, company, and external application URL, posted to
 * `POST /api/job_posts`. `import-result.tsx` renders what Rails answered.
 *
 * ## Rails decides everything about the import
 *
 * The request is `{job_post: {url, application_url, text, title, company}}` — all five keys,
 * trimmed, as Go's struct always sent them. Whether a URL is valid, what it normalizes to, whether
 * it matches a posting already tracked, and how the posting is routed and scored are Rails'. The
 * client's one check is the URL-or-text hint, which only spares a round trip Rails would reject.
 *
 * ## `noValidate` is what makes that true
 *
 * Both URL fields are `type="url"` (a phone keyboard then offers `/` and `.com`), and a `<form>`
 * holding such an input runs the browser's own constraint validation before `submit` ever fires.
 * A scheme-less `careers.acme.com/apply` is a `typeMismatch`, so the Go build's browser silently
 * refused to send it — Rails' "URL must be an HTTP or HTTPS URL" never reached the owner, and the
 * client was validating URLs after all. `noValidate` switches that off, so every press reaches
 * Rails and Rails' sentence is what the owner reads. jsdom enforces the same validation, which is
 * how `manual-entry.test.tsx` proves the attribute is load-bearing.
 *
 * ## The Job URL field and its lookup are `lookup.tsx`
 *
 * `JobUrlLookup` renders the URL field and the Look up details control as the form's first two
 * children, and owns `POST /api/job_posts/lookup` (`FE-24`). This screen hands it the form state:
 * the lookup reads the URL and the touched flags and fills fields; the import reads the fields and
 * nothing about the lookup, so a lookup in flight never disables or delays Import.
 *
 * The import is never retried (`query-client.ts`), and it goes through TanStack's mutation cache,
 * so a 401 reaches the sign-in redirect in `lib/auth.ts`.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useCallback, useState } from "react";
import { Link } from "react-router";

import { createJobPost } from "../../api/endpoints";
import { queryKeys } from "../../api/keys";
import type { ManualJobInput } from "../../api/schemas";
import {
  EMPTY_MANUAL_ENTRY_FORM,
  IMPORT_HINT,
  type ManualEntryFields,
  type ManualEntryForm,
  editField,
  entryButtonLabel,
  importInputPresent,
  manualJobInput,
} from "../../lib/manual-entry";
import { importErrorMessage } from "../../lib/messages";
import { AppChrome } from "../app-chrome";
import { ImportResult } from "./import-result";
import { JobUrlLookup } from "./lookup";

export function ManualEntryScreen() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ManualEntryForm>(EMPTY_MANUAL_ENTRY_FORM);
  // Go's `entryError` carrying the hint: an Import press with nothing to import.
  const [hinted, setHinted] = useState(false);

  const importJob = useMutation({
    mutationFn: (input: ManualJobInput) => createJobPost(input),
    onSuccess: () => {
      // Not awaited: nothing on this screen renders a feed page or a batch, so they only need to
      // be stale by the time the owner follows the result link or goes back.
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.root() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.ingestionBatches.root() });
    },
  });

  const onField = useCallback((field: keyof ManualEntryFields, value: string) => {
    setForm((current) => editField(current, field, value));
  }, []);

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (importJob.isPending) return;
      if (!importInputPresent(form.fields)) {
        // Go's state machine had one slot for the outcome, so the hint replaced a shown result.
        importJob.reset();
        setHinted(true);
        return;
      }
      setHinted(false);
      importJob.mutate(manualJobInput(form.fields));
    },
    [form.fields, importJob],
  );

  const { fields } = form;
  const error = hinted ? IMPORT_HINT : importJob.isError ? importErrorMessage(importJob.error) : "";

  return (
    <div className="manual-entry">
      <AppChrome />
      <Link className="manual-entry-back" to="/jobs">
        ← Jobs
      </Link>
      <h1>Import a job</h1>
      <p className="manual-entry-note">
        Paste a listing link and the title, company, and description are read from the posting. Add
        an external application link when you have one.
      </p>
      <form className="manual-entry-form" noValidate onSubmit={onSubmit}>
        <JobUrlLookup form={form} setForm={setForm} />
        <label className="manual-entry-label">
          <span>Title</span>
          <input
            className="manual-entry-title"
            type="text"
            value={fields.title}
            onChange={(event) => {
              onField("title", event.target.value);
            }}
          />
        </label>
        <label className="manual-entry-label">
          <span>Company</span>
          <input
            className="manual-entry-company"
            type="text"
            value={fields.company}
            onChange={(event) => {
              onField("company", event.target.value);
            }}
          />
        </label>
        <label className="manual-entry-label">
          <span>External application URL (optional)</span>
          <input
            className="manual-entry-application-url"
            type="url"
            placeholder="https://careers.example.com/apply"
            value={fields.application_url}
            onChange={(event) => {
              onField("application_url", event.target.value);
            }}
          />
        </label>
        <label className="manual-entry-label">
          <span>Posting text</span>
          <textarea
            className="manual-entry-text"
            placeholder="Paste the job description…"
            value={fields.text}
            onChange={(event) => {
              onField("text", event.target.value);
            }}
          />
        </label>
        <button className="manual-entry-submit" type="submit" disabled={importJob.isPending}>
          {entryButtonLabel(importJob.isPending)}
        </button>
      </form>
      {error === "" ? null : (
        <p className="manual-entry-error" role="alert">
          {error}
        </p>
      )}
      {importJob.data === undefined ? null : <ImportResult result={importJob.data} />}
    </div>
  );
}
