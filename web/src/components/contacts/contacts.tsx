/**
 * The contacts screen (`/jobs/:id/contacts`), ported from `ContactsView` in
 * `web/components/contacts.go` (see docs/GO_MIGRATION.md): the saved people worth reaching out to
 * about one posting, each with its own outreach draft panel (`outreach-draft.tsx`), plus a form to
 * save a new one.
 *
 * ## Nothing here contacts anyone
 *
 * The screen reads `GET /api/job_posts/:id/contact_candidates` and makes two kinds of write, each
 * on an explicit click: saving a contact row, and generating a draft for the owner to copy. Neither
 * sends a message — Waunder has no outbound messaging at all — and the note under the title says so
 * in the words `contacts.go` used. `contacts.test.tsx` records every request the screen makes and
 * asserts nothing else ever leaves it.
 *
 * ## Saving a contact is new
 *
 * Rails has always served `POST /api/job_posts/:id/contact_candidates`, but the Go screen only
 * listed, so a contact could only be created against the API by hand. The form sits in a
 * `<details>` that starts collapsed. The fields borrow the profile form's shared field vocabulary
 * (`profile-form`, `profile-field`, `profile-input`, `profile-save`, …) next to contact-scoped
 * `contact-create-*` hooks. A save invalidates the list and awaits the refetch rather than splicing
 * the row in, so the owner sees Rails' order and Rails' copy of what it stored.
 *
 * ## The LinkedIn link is filtered
 *
 * `contacts.go` rendered any non-empty `linkedin_url` as an `href`. That value is free text, so it
 * goes through the same `externalApplicationURL` filter as the job detail's outbound link: only an
 * `http(s)` URL with a host becomes a link, a `javascript:` one becomes nothing, and
 * `rel="noopener noreferrer"` keeps the opened page from reaching back through `window.opener`.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { Link, useParams } from "react-router";

import { createContact, fetchContacts } from "../../api/endpoints";
import { queryKeys } from "../../api/keys";
import type { ContactCandidate, ContactCandidateInput } from "../../api/schemas";
import {
  EMPTY_CONTACT_FIELDS,
  type ContactFields,
  canSaveContact,
  contactInput,
  contactRole,
  contactsBackHref,
} from "../../lib/contacts";
import { externalApplicationURL, parseJobId } from "../../lib/job-detail";
import { contactSaveErrorMessage } from "../../lib/messages";
import { AppChrome } from "../app-chrome";
import { LoadError, Loading } from "../load-state";
import { OutreachDraftPanel } from "./outreach-draft";

export function ContactsScreen() {
  const jobId = parseJobId(useParams().id);
  const {
    data: contacts,
    isPending,
    isError,
    error,
  } = useQuery({
    queryKey: queryKeys.jobs.contacts(jobId),
    queryFn: () => fetchContacts(jobId),
  });

  return (
    <div className="contacts-view">
      <AppChrome />
      <Link className="contacts-back" to={contactsBackHref(jobId)}>
        ← Job
      </Link>
      <h1 className="contacts-title">Contacts</h1>
      <p className="contacts-note">
        Outreach drafts are prefilled for manual sending only. Copy a draft and send it yourself —
        Waunder never sends messages for you.
      </p>
      {isPending ? (
        <Loading />
      ) : isError ? (
        <LoadError error={error} />
      ) : (
        // Keyed by job: a list cached for another posting renders with no pending frame in
        // between, and neither a half-typed contact nor any draft may carry across to it.
        <ContactsBody key={jobId} jobId={jobId} contacts={contacts} />
      )}
    </div>
  );
}

/** The loaded list (or its empty state) and the create form beneath it. */
function ContactsBody({ jobId, contacts }: { jobId: number; contacts: ContactCandidate[] }) {
  return (
    <>
      {contacts.length === 0 ? (
        <p className="contacts-empty">No contacts yet.</p>
      ) : (
        <ul className="contacts-list">
          {contacts.map((contact) => (
            // The key is what keeps each candidate's draft attached to that candidate.
            <ContactItem key={contact.id} contact={contact} />
          ))}
        </ul>
      )}
      <CreateContact jobId={jobId} />
    </>
  );
}

/** `renderContact`: one candidate, then its outreach panel. There is no send control here. */
function ContactItem({ contact }: { contact: ContactCandidate }) {
  const role = contactRole(contact);
  const linkedIn = externalApplicationURL(contact.linkedin_url);
  return (
    <li className="contact">
      <p className="contact-name">{contact.name}</p>
      {role === "" ? null : <p className="contact-role">{role}</p>}
      {contact.relevance_reason === "" ? null : (
        <p className="contact-relevance">{contact.relevance_reason}</p>
      )}
      {linkedIn === "" ? null : (
        <a className="contact-linkedin" href={linkedIn} target="_blank" rel="noopener noreferrer">
          LinkedIn profile
        </a>
      )}
      <OutreachDraftPanel candidateId={contact.id} />
    </li>
  );
}

/**
 * Saves a new contact for the posting. Deliberately not a `<form>`: with no form and every button
 * typed `button`, nothing on this screen can be submitted, implicitly or otherwise, and the
 * no-send test can assert exactly that. The write never retries (`query-client.ts`), and it
 * creates a row — it messages no one.
 */
function CreateContact({ jobId }: { jobId: number }) {
  const queryClient = useQueryClient();
  const [fields, setFields] = useState<ContactFields>(EMPTY_CONTACT_FIELDS);
  const save = useMutation({
    mutationFn: (input: ContactCandidateInput) => createContact(jobId, input),
    // Awaited, so Save stays disabled until the refetched list shows the new contact.
    onSuccess: async () => {
      setFields(EMPTY_CONTACT_FIELDS);
      await queryClient.invalidateQueries({ queryKey: queryKeys.jobs.contacts(jobId) });
    },
  });

  const onField = useCallback((field: keyof ContactFields, value: string) => {
    setFields((current) => ({ ...current, [field]: value }));
  }, []);

  const ready = canSaveContact(fields);
  const onSave = useCallback(() => {
    if (save.isPending || !ready) return;
    save.mutate(contactInput(fields));
  }, [fields, ready, save]);

  return (
    <details className="contact-create">
      <summary>Add a contact</summary>
      <div className="profile-form contact-create-form">
        <ContactField label="Name" field="name" value={fields.name} onChange={onField} />
        <ContactField label="Title" field="title" value={fields.title} onChange={onField} />
        <ContactField
          label="Company"
          field="company_name"
          value={fields.company_name}
          onChange={onField}
        />
        <ContactField
          label="LinkedIn URL"
          field="linkedin_url"
          type="url"
          value={fields.linkedin_url}
          onChange={onField}
        />
        <ContactField
          label="Why they are relevant"
          field="relevance_reason"
          value={fields.relevance_reason}
          onChange={onField}
        />
        <button
          className="profile-save contact-create-save"
          type="button"
          disabled={save.isPending || !ready}
          onClick={onSave}
        >
          {save.isPending ? "Saving…" : "Save contact"}
        </button>
        {save.isError ? (
          <p className="profile-save-error contact-create-error" role="alert">
            {contactSaveErrorMessage(save.error)}
          </p>
        ) : null}
        {save.isSuccess ? (
          <p className="profile-save-ok contact-create-ok" role="status">
            Contact saved.
          </p>
        ) : null}
      </div>
    </details>
  );
}

interface ContactFieldProps {
  label: string;
  field: keyof ContactFields;
  value: string;
  type?: "text" | "url";
  onChange: (field: keyof ContactFields, value: string) => void;
}

/** One labelled input; its `contact-create-<field>` class is the test and styling hook. */
function ContactField({ label, field, value, type = "text", onChange }: ContactFieldProps) {
  return (
    <label className="profile-field contact-create-field">
      <span className="profile-field-label">{label}</span>
      <input
        className={`profile-input contact-create-${field.replace(/_/g, "-")}`}
        type={type}
        value={value}
        onChange={(event) => {
          onChange(field, event.target.value);
        }}
      />
    </label>
  );
}
