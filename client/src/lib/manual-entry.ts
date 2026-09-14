/**
 * Pure helpers for the manual import screen, ported from the non-render half of
 * `web/components/manual_entry.go` (see docs/GO_MIGRATION.md): `input` / `inputPresent`, the
 * `startLookup` guards, `applyLookupResult`, `joinFields`, the two button labels,
 * `lookupNoteClass`, and the outcome copy in `importMessage` / `importLinkLabel`.
 *
 * They live in `lib/` rather than beside the components for the reason `FE-15` recorded:
 * `eslint-plugin-react-refresh` warns when a component module also exports a plain function.
 *
 * ## Trim-only, and nothing more
 *
 * Rails owns what a valid import is: `ManualJobPostImporter` requires a URL or text, checks that
 * both URLs are HTTP(S), derives identity keys, and `ApplicationRouteResolver` routes the result.
 * The one client-side check is `importInputPresent`, a hint that saves a round trip whose answer
 * is already known — exactly `inputPresent` in Go. No URL is parsed, prefixed, or normalized here.
 */
import type { ManualJobInput, ManualJobResult, PostingLookup } from "../api/schemas";
import { POSTING_UNREADABLE } from "./messages";

/** The five fields as the owner typed them (or a lookup filled them) — untrimmed, wire-named. */
export type ManualEntryFields = ManualJobInput;

/** The line under the URL field after a lookup. `failed` selects the warning style. */
export interface LookupOutcome {
  failed: boolean;
  note: string;
}

/**
 * Everything the form holds apart from its two in-flight flags, which belong to the mutations.
 *
 * `*Touched` records that the owner typed into a prefillable field, so a later lookup never
 * overwrites it. `lookedUpUrl` is the URL the last lookup ran against, so leaving the field again
 * without changing it does not refetch. Both mirror fields on Go's `ManualEntry`.
 */
export interface ManualEntryForm {
  fields: ManualEntryFields;
  titleTouched: boolean;
  companyTouched: boolean;
  textTouched: boolean;
  lookedUpUrl: string;
  lookup: LookupOutcome | null;
}

export const EMPTY_MANUAL_ENTRY_FORM: ManualEntryForm = {
  fields: { url: "", application_url: "", text: "", title: "", company: "" },
  titleTouched: false,
  companyTouched: false,
  textTouched: false,
  lookedUpUrl: "",
  lookup: null,
};

/** Shown for an Import press with neither a job URL nor posting text. */
export const IMPORT_HINT = "Enter a job URL or paste the posting text.";

/**
 * One keystroke into one field. Only the three fields a lookup can prefill are marked touched —
 * the two URLs are never prefilled, so there is nothing to protect them from.
 */
export function editField(
  form: ManualEntryForm,
  field: keyof ManualEntryFields,
  value: string,
): ManualEntryForm {
  return {
    ...form,
    fields: { ...form.fields, [field]: value },
    titleTouched: form.titleTouched || field === "title",
    companyTouched: form.companyTouched || field === "company",
    textTouched: form.textTouched || field === "text",
  };
}

/**
 * The request body: all five keys, every one trimmed and none omitted, as Go's `input()` built
 * `ManualJobInput` (a struct with no `omitempty`). Trimming is the only transformation.
 */
export function manualJobInput(fields: ManualEntryFields): ManualJobInput {
  return {
    url: fields.url.trim(),
    application_url: fields.application_url.trim(),
    text: fields.text.trim(),
    title: fields.title.trim(),
    company: fields.company.trim(),
  };
}

/**
 * `inputPresent`: a job URL or posting text, the minimum Rails requires. A hint, not validation —
 * a title, company, or application URL alone does not count, because Rails rejects that import.
 */
export function importInputPresent(fields: ManualEntryFields): boolean {
  const input = manualJobInput(fields);
  return input.url !== "" || input.text !== "";
}

/**
 * The URL a lookup should read, or `""` when it should not run: there is no URL, or — unless the
 * owner pressed Look up details — it is the URL the last lookup already read. `startLookup`'s
 * guards; the "already running" guard is the mutation's `isPending`.
 */
export function lookupTarget(form: ManualEntryForm, forced: boolean): string {
  const url = form.fields.url.trim();
  if (url === "") return "";
  if (!forced && url === form.lookedUpUrl) return "";
  return url;
}

/**
 * `applyLookupResult`: prefill the fields the owner has not typed into. Applied as a functional
 * state update against the form *as it is when the answer lands*, so a field typed into while the
 * request was in flight is kept.
 *
 * A posting Rails could not read (`unsupported` or `unavailable`) is not an error state for the
 * form — the fields stay as they were and the owner fills them in. Note the posting text also
 * requires a blank field, not just an untouched one: a second lookup replaces a title a first one
 * filled, but never pastes over a description that is already there.
 */
export function applyLookupResult(
  form: ManualEntryForm,
  url: string,
  lookup: PostingLookup,
): ManualEntryForm {
  if (lookup.status !== "ok") return applyLookupFailure(form, url, POSTING_UNREADABLE);

  const fields = { ...form.fields };
  const filled: string[] = [];
  if (lookup.title !== "" && !form.titleTouched) {
    fields.title = lookup.title;
    filled.push("title");
  }
  if (lookup.company !== "" && !form.companyTouched) {
    fields.company = lookup.company;
    filled.push("company");
  }
  if (lookup.description !== "" && !form.textTouched && form.fields.text.trim() === "") {
    fields.text = lookup.description;
    filled.push("posting text");
  }

  const note =
    filled.length === 0
      ? "Read the listing; your entries were kept."
      : `Filled in ${joinFields(filled)} from the listing.`;
  return { ...form, fields, lookedUpUrl: url, lookup: { failed: false, note } };
}

/** A lookup that failed outright. The URL still counts as read, as `applyLookupResult` did in Go. */
export function applyLookupFailure(
  form: ManualEntryForm,
  url: string,
  note: string,
): ManualEntryForm {
  return { ...form, lookedUpUrl: url, lookup: { failed: true, note } };
}

/** `joinFields`: a short list as prose — "title", "title and company", "a, b, and c". */
export function joinFields(fields: readonly string[]): string {
  const [first = "", second = ""] = fields;
  if (fields.length <= 1) return first;
  if (fields.length === 2) return `${first} and ${second}`;
  return `${fields.slice(0, -1).join(", ")}, and ${fields.at(-1) ?? ""}`;
}

/** `entryButtonLabel`. */
export function entryButtonLabel(pending: boolean): string {
  return pending ? "Importing…" : "Import job";
}

/** `lookupButtonLabel`. */
export function lookupButtonLabel(pending: boolean): string {
  return pending ? "Reading posting…" : "Look up details";
}

/** `lookupNoteClass`: the two classes `app.css` styles under `.manual-entry-lookup`. */
export function lookupNoteClass(failed: boolean): string {
  return failed ? "manual-entry-lookup-warning" : "manual-entry-lookup-note";
}

/**
 * Rails' import outcomes. `possible_match` is not sent today; Go supported it as a non-blocking
 * review state should Rails surface one, and so does this.
 */
export type ImportOutcome = "new" | "already_tracked" | "already_submitted" | "possible_match";

const IMPORT_OUTCOMES: readonly ImportOutcome[] = [
  "new",
  "already_tracked",
  "already_submitted",
  "possible_match",
];

/**
 * The outcome Rails reported in the top-level `import` key. An absent or unknown status reads as
 * a new import, which is where Go's `switch` fell through to. The client never infers a duplicate.
 */
export function importOutcome(result: ManualJobResult): ImportOutcome {
  const { status } = result.import;
  return IMPORT_OUTCOMES.find((outcome) => outcome === status) ?? "new";
}

/** `importMessage`: the sentence naming the posting and what Rails did with it. */
export function importMessage(result: ManualJobResult): string {
  const { id, title, company, scoring_status: scoringStatus } = result.job_post;
  let label = title;
  if (title !== "" && company !== "") label = `${title} — ${company}`;
  if (label === "") label = `Job #${String(id)}`;

  switch (importOutcome(result)) {
    case "already_tracked": {
      const status = result.import.application_status;
      return status === ""
        ? `Already tracked: ${label}.`
        : `Already tracked: ${label}. Current application status: ${status}.`;
    }
    case "already_submitted":
      return `Already submitted: ${label}.`;
    case "possible_match":
      return `Possible match: ${label}. Review the existing job before importing another.`;
    case "new":
      return scoringStatus === "pending" || scoringStatus === ""
        ? `Imported ${label}. It is being scored and will appear in your feed.`
        : `Imported ${label}.`;
  }
}

/** `importLinkLabel`: what following the result link will show. */
export function importLinkLabel(result: ManualJobResult): string {
  switch (importOutcome(result)) {
    case "already_tracked":
      return "View tracked job";
    case "already_submitted":
      return "View submitted job";
    case "possible_match":
      return "Review possible match";
    case "new":
      return "View job";
  }
}

/** The posting Rails returned — the new one, or the existing one an import matched. */
export function importResultHref(result: ManualJobResult): string {
  return `/jobs/${String(result.job_post.id)}`;
}

/**
 * A modifier class per outcome, e.g. `manual-entry-result--already-tracked`. `app.css` has no rule
 * for it yet (it is frozen until `UI-01`), so today it only makes the outcome inspectable.
 */
export function importResultClass(outcome: ImportOutcome): string {
  return `manual-entry-result--${outcome.replace(/_/g, "-")}`;
}
