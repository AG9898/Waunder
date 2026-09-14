/**
 * The Job URL field and the posting lookup its commit starts (`FE-24`), ported from `onURLChange`,
 * `lookup`, `startLookup`, `applyLookupResult`, and `renderLookup` in
 * `web/components/manual_entry.go` (see docs/GO_MIGRATION.md). `manual-entry.tsx` renders it as the
 * first two children of its form.
 *
 * ## The URL field lives here because committing it is what starts a lookup
 *
 * With the input in the parent, its blur would have to reach a request owned by a child, or the
 * request would have to live in the parent and this file would be a button. The component returns
 * a fragment, so the form's children are still Go's `label, .manual-entry-lookup, label, …` in the
 * same order, and nothing `app.css` selects has moved.
 *
 * ## Commit, not keystroke
 *
 * Go started the lookup on the native `change` event: blur, or Enter. React's `onChange` is the
 * per-keystroke `input` event, so the commit here is `onBlur`; Enter keeps doing what Enter does in
 * a form, which is import. Leaving the field again on a URL already read does not refetch
 * (`lookupTarget`); Look up details forces a reread.
 *
 * ## The prefill lands in the fields under the control
 *
 * An `ok` answer is folded in with a *functional* update (`applyLookupResult`) against the form as
 * it stands when the answer lands, so only fields the owner has not typed into are filled — a title
 * typed while the request was in flight included. The filled title and company appear in the Title
 * and Company inputs the form renders directly below this control, and the note beside the button
 * names what was filled. That is Go's layout: there is no separate read-only display of the listing,
 * which `app.css` has no rule for and the `FE-28` parity gate would read as a regression.
 *
 * ## Never in the way of an import
 *
 * `unsupported` and `unavailable` are 200 answers, not errors: they leave a warning and the fields as
 * they were. A failed request does the same. Nothing here touches the Import button, so a slow lookup
 * and an import can be in flight together — Rails' `EnrichJobPostJob` reads a URL-only import in the
 * background anyway. The request is a mutation, so it is never retried and a 401 reaches the sign-in
 * redirect in `lib/auth.ts`; it persists and invalidates nothing.
 */
import { useMutation } from "@tanstack/react-query";
import { type ChangeEvent, type Dispatch, type SetStateAction, useCallback } from "react";

import { lookupPosting } from "../../api/endpoints";
import {
  type ManualEntryForm,
  applyLookupFailure,
  applyLookupResult,
  editField,
  lookupButtonLabel,
  lookupNoteClass,
  lookupTarget,
} from "../../lib/manual-entry";
import { lookupErrorMessage } from "../../lib/messages";

export interface JobUrlLookupProps {
  /** The whole form: the lookup reads the URL and the touched flags, and fills the fields. */
  form: ManualEntryForm;
  setForm: Dispatch<SetStateAction<ManualEntryForm>>;
}

export function JobUrlLookup({ form, setForm }: JobUrlLookupProps) {
  const { isPending, mutate } = useMutation({ mutationFn: (url: string) => lookupPosting(url) });

  const startLookup = useCallback(
    (forced: boolean) => {
      if (isPending) return;
      const url = lookupTarget(form, forced);
      if (url === "") return;
      setForm((current) => ({ ...current, lookup: null }));
      mutate(url, {
        onSuccess: (result) => {
          setForm((current) => applyLookupResult(current, url, result));
        },
        onError: (error) => {
          setForm((current) => applyLookupFailure(current, url, lookupErrorMessage(error)));
        },
      });
    },
    [form, isPending, mutate, setForm],
  );

  const onUrlChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const { value } = event.target;
      setForm((current) => editField(current, "url", value));
    },
    [setForm],
  );

  const onUrlBlur = useCallback(() => {
    startLookup(false);
  }, [startLookup]);

  const onLookUp = useCallback(() => {
    startLookup(true);
  }, [startLookup]);

  const { url } = form.fields;

  return (
    <>
      <label className="manual-entry-label">
        <span>Job URL</span>
        <input
          className="manual-entry-url"
          type="url"
          placeholder="https://…"
          value={url}
          onChange={onUrlChange}
          onBlur={onUrlBlur}
        />
      </label>
      <div className="manual-entry-lookup">
        <button
          className="manual-entry-lookup-button"
          type="button"
          disabled={isPending || url.trim() === ""}
          onClick={onLookUp}
        >
          {lookupButtonLabel(isPending)}
        </button>
        {form.lookup === null ? null : (
          <p className={lookupNoteClass(form.lookup.failed)} role="status">
            {form.lookup.note}
          </p>
        )}
      </div>
    </>
  );
}
