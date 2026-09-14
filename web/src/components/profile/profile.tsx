/**
 * The profile screen (`/profile`), ported from `ProfileView` in `web/components/profile.go` (see
 * docs/GO_MIGRATION.md): the owner's editable text and URL fields, the encrypted contact details as
 * presence flags, the resume's ingest metadata (`resume-meta.tsx`), and the push toggle.
 *
 * ## Presence flags are all this screen can know
 *
 * `GET /api/profile` never serializes the encrypted email, phone, or street address — only
 * `email_present`, `phone_present`, and `street_address_present` — and `ProfileSchema` strips any
 * key it does not declare, so even a serializer that leaked one would put nothing on screen. The
 * other direction matters as much: Rails' `profile_params` *permits* `email`, `phone`, and
 * `street_address`, so the write is safe only because the client never sends them. The form's state
 * is a `ProfileEdit` built by `editFromProfile`, which copies exactly the seven editable keys, and
 * there is no input for any sensitive field. `profile.test.tsx` asserts the exact `PATCH` body.
 *
 * ## Typing survives a background refetch
 *
 * The query client refetches on window focus, which Go never did. The form is therefore seeded once,
 * when the profile first loads, and reseeded only from a save's own answer: a refetch updates the
 * contact and resume sections without discarding what the owner is typing. For the same reason a
 * failed *refetch* keeps the form on screen — TanStack v5 flips `isError` while retaining the last
 * data, and swapping the form for the load error would lose the owner's edits over a hiccup they did
 * not cause. Only a first load that failed shows the error panel.
 *
 * A save writes Rails' answer into the `profile()` cache entry instead of invalidating it. The
 * `PATCH` response *is* the refreshed profile — Go's `applySaveResult` rendered it directly — so a
 * second `GET` would fetch the same document again.
 *
 * ## Three things Go did not render
 *
 * - **Sign out** (`useSignOut`, `FE-09`). Go had no way to end a session short of the cookie's
 *   90-day expiry. `app.css` has no rule for the control until `UI-01`, so it borrows the outline
 *   button from `.manual-entry-lookup-button` (which, unlike the push toggle's outline button, also
 *   styles `:disabled`) and the save error pill, next to `profile-sign-out` hooks of its own.
 * - **The install guide** (`FE-14`), mounted after the toggle for the two iOS gates only — see
 *   `showInstallGuide` for why it stays hidden where the toggle already answers.
 * - **Rails' 422 sentence** on a failed save (`profileSaveErrorMessage`).
 *
 * The first two are deliberate differences from the Go build for the `FE-28` parity gate. Nothing on
 * the screen writes on render: the only request a mount makes is the profile read.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useCallback, useMemo, useState } from "react";

import { fetchProfile, updateProfile } from "../../api/endpoints";
import { queryKeys } from "../../api/keys";
import type { Profile, ProfileContact, ProfileEdit } from "../../api/schemas";
import { useSignOut } from "../../lib/auth";
import { profileSaveErrorMessage } from "../../lib/messages";
import { showToast } from "../../lib/toast";
import { evaluatePushGate, platformState, readPlatformSignals } from "../../lib/platform";
import type { PlatformSignals } from "../../lib/platform";
import {
  PROFILE_FIELDS,
  editFromProfile,
  presenceLabel,
  saveButtonLabel,
  showInstallGuide,
} from "../../lib/profile";
import type { PushSubscriber } from "../../lib/push";
import { AppChrome } from "../app-chrome";
import { InstallGuide } from "../install-guide";
import { LoadError, Loading } from "../load-state";
import { PushToggle } from "../push-toggle";
import { ResumeMeta } from "./resume-meta";

export interface ProfileScreenProps {
  /** The browser Push API, forwarded to the toggle and the guide. Tests inject a mock. */
  subscriber?: PushSubscriber;
  /** Browser facts for the install-guide gate. Defaults to the live browser. */
  signals?: PlatformSignals;
}

export function ProfileScreen({ subscriber, signals }: ProfileScreenProps = {}) {
  const {
    data: profile,
    isError,
    error,
  } = useQuery({
    queryKey: queryKeys.profile(),
    queryFn: () => fetchProfile(),
  });

  return (
    <div className="profile">
      <AppChrome />
      <h1>Profile</h1>
      {profile !== undefined ? (
        <ProfileBody profile={profile} subscriber={subscriber} signals={signals} />
      ) : isError ? (
        <LoadError error={error} />
      ) : (
        <Loading />
      )}
    </div>
  );
}

interface ProfileBodyProps {
  profile: Profile;
  subscriber: PushSubscriber | undefined;
  signals: PlatformSignals | undefined;
}

/** Go's `.profile-body`: the form, then contact, resume, push, and the additions after them. */
function ProfileBody({ profile, subscriber, signals }: ProfileBodyProps) {
  const gate = useMemo(
    () => evaluatePushGate(platformState(signals ?? readPlatformSignals())),
    [signals],
  );

  return (
    <div className="profile-body">
      <ProfileForm profile={profile} />
      <ContactPresence contact={profile.contact} />
      <ResumeMeta resume={profile.resume} />
      <PushToggle subscriber={subscriber} />
      {showInstallGuide(gate) ? <InstallGuide signals={signals} subscriber={subscriber} /> : null}
      <SignOut />
    </div>
  );
}

/**
 * The editable fields and the save. The write is never retried (`query-client.ts`), and it goes
 * through TanStack's mutation cache, so a 401 reaches the sign-in redirect in `lib/auth.ts`.
 */
function ProfileForm({ profile }: { profile: Profile }) {
  const queryClient = useQueryClient();
  // Seeded once from the profile that loaded; see the module comment.
  const [edit, setEdit] = useState<ProfileEdit>(() => editFromProfile(profile));

  const save = useMutation({
    mutationFn: (fields: ProfileEdit) => updateProfile(fields),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.profile(), saved);
      // `applySaveResult` reseeded the form, so the fields show what Rails stored.
      setEdit(editFromProfile(saved));
      showToast("Profile saved.");
    },
  });

  const onField = useCallback((field: keyof ProfileEdit, value: string) => {
    setEdit((current) => ({ ...current, [field]: value }));
  }, []);

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (save.isPending) return;
      save.mutate(edit);
    },
    [edit, save],
  );

  return (
    <form className="profile-form" onSubmit={onSubmit}>
      {PROFILE_FIELDS.map(({ field, label, className }) => (
        <label key={field} className="profile-field">
          <span className="profile-field-label">{label}</span>
          <input
            className={className}
            type="text"
            value={edit[field]}
            onChange={(event) => {
              onField(field, event.target.value);
            }}
          />
        </label>
      ))}
      <button className="profile-save" type="submit" disabled={save.isPending}>
        {saveButtonLabel(save.status)}
      </button>
      {save.isError ? (
        <p className="profile-save-error" role="alert">
          {profileSaveErrorMessage(save.error)}
        </p>
      ) : null}
    </form>
  );
}

/** `renderContact`: the encrypted contact fields as set / not set, never as values. */
function ContactPresence({ contact }: { contact: ProfileContact }) {
  return (
    <div className="profile-contact">
      <h2>Contact details</h2>
      <p className="profile-contact-note">
        Contact details are encrypted at rest and shown only as set/not set.
      </p>
      <ul>
        <li className="profile-contact-row">{`Email: ${presenceLabel(contact.email_present)}`}</li>
        <li className="profile-contact-row">{`Phone: ${presenceLabel(contact.phone_present)}`}</li>
        <li className="profile-contact-row">
          {`Street address: ${presenceLabel(contact.street_address_present)}`}
        </li>
      </ul>
    </div>
  );
}

/** Ends the session (`DELETE /api/session`) and returns to the login screen. */
function SignOut() {
  const { signOut, pending, error } = useSignOut();
  return (
    <div className="profile-session">
      <button
        type="button"
        className="manual-entry-lookup-button profile-sign-out"
        disabled={pending}
        onClick={signOut}
      >
        {pending ? "Signing out…" : "Sign out"}
      </button>
      {error === "" ? null : (
        <p className="profile-save-error profile-sign-out-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
