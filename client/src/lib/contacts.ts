/**
 * Pure helpers for the contacts and outreach screen, ported from the non-render half of
 * `web/components/contacts.go` (see docs/GO_MIGRATION.md): `contactRole`,
 * `generateButtonLabel`, and `backHref`. `contactInput` and `canSaveContact` are new with the
 * create form, which the Go screen never had.
 *
 * They live in `lib/` rather than beside the components for the reason `FE-15` recorded:
 * `eslint-plugin-react-refresh` warns when a component module also exports a plain function.
 */
import type { ContactCandidate, ContactCandidateInput } from "../api/schemas";

/** `contactRole`: "Title at Company", omitting whichever half is blank. */
export function contactRole(contact: Pick<ContactCandidate, "title" | "company_name">): string {
  const { title, company_name: company } = contact;
  if (title !== "" && company !== "") return `${title} at ${company}`;
  return title !== "" ? title : company;
}

/**
 * `generateButtonLabel`. "Regenerate" only while a draft is on screen, so the button never hides
 * that it replaces one. A failed attempt falls back to "Generate draft", exactly as Go's
 * `generateError` state did, because the failure left no draft on screen to replace.
 */
export function outreachButtonLabel(pending: boolean, hasDraft: boolean): string {
  if (pending) return "Generating…";
  return hasDraft ? "Regenerate draft" : "Generate draft";
}

/**
 * `backHref`: the posting these contacts belong to, or the feed when the path held no id
 * (`parseJobId` resolves a non-numeric `:id` to `0`, as Go's zero-valued `JobID` did).
 */
export function contactsBackHref(jobId: number): string {
  return jobId > 0 ? `/jobs/${String(jobId)}` : "/jobs";
}

/** The create form's fields exactly as the owner typed them — untrimmed, every one a string. */
export interface ContactFields {
  name: string;
  title: string;
  company_name: string;
  linkedin_url: string;
  relevance_reason: string;
}

/** A blank form: where the screen starts, and where a successful save returns it. */
export const EMPTY_CONTACT_FIELDS: ContactFields = {
  name: "",
  title: "",
  company_name: "",
  linkedin_url: "",
  relevance_reason: "",
};

/**
 * A client hint, not validation. `ContactCandidate` validates `name` and `relevance_reason` for
 * presence and Rails answers 422 `invalid_input` otherwise — that answer is still rendered. The
 * hint only keeps the owner from sending a request whose answer is already known, and a
 * whitespace-only value is blank to Rails' `presence` too.
 */
export function canSaveContact(fields: ContactFields): boolean {
  return fields.name.trim() !== "" && fields.relevance_reason.trim() !== "";
}

/**
 * The request body: every value trimmed, and the three optional fields **omitted** when blank.
 * Rails permits all five and would store `""` for a blank one; omitting it stores `nil`, which is
 * what an untouched field means. Trim-only, as every Go form was — the LinkedIn URL is not parsed
 * here, because Rails owns what counts as a valid record.
 */
export function contactInput(fields: ContactFields): ContactCandidateInput {
  const input: ContactCandidateInput = {
    name: fields.name.trim(),
    relevance_reason: fields.relevance_reason.trim(),
  };
  const title = fields.title.trim();
  const company = fields.company_name.trim();
  const linkedIn = fields.linkedin_url.trim();
  if (title !== "") input.title = title;
  if (company !== "") input.company_name = company;
  if (linkedIn !== "") input.linkedin_url = linkedIn;
  return input;
}
