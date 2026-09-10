/**
 * The passphrase screen, ported from `web/components/login.go` (see docs/GO_MIGRATION.md).
 *
 * Markup, classes, copy, and the three status messages are unchanged. `POST /api/session`
 * exchanges the single shared passphrase for the signed, httponly session cookie Rails sets, and
 * a successful sign-in lands on the ingestion landing at `/`.
 *
 * ## The passphrase is never held anywhere this app owns
 *
 * The Go component kept it in a controlled field (`l.passphrase`) and cleared it after each
 * attempt. This port never puts it in React state at all: the input is **uncontrolled**, so the
 * value lives only in the DOM node the browser already owns, is read once into a local on submit,
 * and the form is reset on both outcomes. Three consequences worth stating, since "never renders,
 * logs, or stores the passphrase" is the requirement:
 *
 * - Nothing renders it. There is no `value` prop, so it never appears in the markup React emits.
 * - Nothing caches it. This is also why the request does **not** go through `useMutation`:
 *   TanStack keeps the last `variables` on the mutation in its cache (and hands them to
 *   devtools), which would park the owner's passphrase in a cache for the life of the tab.
 *   Login has no cached read to invalidate either, so the local `submitting` / `status` pair is
 *   the whole state — the same two fields `login.go` had.
 * - Nothing logs it. A failure branches on `isUnauthorized` alone; the error is never printed,
 *   and the response body is never echoed to the screen.
 *
 * A 401 from *this* request is not the session boundary — it means the passphrase was wrong — so
 * it is deliberately handled here as a status message rather than by the redirect in
 * `src/lib/auth.ts`, which only ever sees TanStack-managed reads and writes.
 */
import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router";

import { login } from "../api/endpoints";
import { isUnauthorized } from "../api/errors";

/** Form field name; also what `POST /api/session` expects as its form key. */
const PASSPHRASE_FIELD = "passphrase";

/** `login.go`'s three status strings, byte for byte. */
const MISSING_PASSPHRASE = "Enter your passphrase.";
const WRONG_PASSPHRASE = "Incorrect passphrase.";
const SIGN_IN_FAILED = "Could not sign in. Please try again.";

/** `loginButtonText`. The ellipsis is one character (U+2026), as in the Go build. */
const SIGN_IN = "Sign in";
const SIGNING_IN = "Signing in…";

export function LoginScreen() {
  const navigate = useNavigate();
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    // Read synchronously: the event's currentTarget is only valid during dispatch.
    const form = event.currentTarget;
    const entry = new FormData(form).get(PASSPHRASE_FIELD);
    const passphrase = typeof entry === "string" ? entry : "";
    if (passphrase === "") {
      setStatus(MISSING_PASSPHRASE);
      return;
    }

    setSubmitting(true);
    setStatus("");
    try {
      await login(passphrase);
    } catch (cause) {
      form.reset();
      setSubmitting(false);
      // `loginErrorStatus`: a 401 is the wrong passphrase, anything else is transient.
      setStatus(isUnauthorized(cause) ? WRONG_PASSPHRASE : SIGN_IN_FAILED);
      return;
    }
    form.reset();
    setSubmitting(false);
    // replace: the login screen must not sit one Back press behind a signed-in session.
    await navigate("/", { replace: true });
  }

  return (
    <div className="login-screen">
      <h1>Waunder</h1>
      <form
        className="login-form"
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <input
          className="login-passphrase"
          type="password"
          name={PASSPHRASE_FIELD}
          placeholder="Passphrase"
          aria-label="Passphrase"
          autoComplete="current-password"
        />
        <button className="login-submit" type="submit" disabled={submitting}>
          {submitting ? SIGNING_IN : SIGN_IN}
        </button>
      </form>
      {status === "" ? null : (
        <p className="login-status" role="status">
          {status}
        </p>
      )}
    </div>
  );
}
