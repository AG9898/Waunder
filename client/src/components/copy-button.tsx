/**
 * Copy-to-clipboard, ported from `web/components/copy_button.go` (see docs/GO_MIGRATION.md).
 *
 * Waunder hands the owner text to send by hand — a cover letter (`FE-20`), an outreach message
 * (`FE-21`), a reviewed draft answer (`FE-26`) — and never sends any of it itself. This button
 * is the whole mechanism for getting that text out of the app, which is why it exists as a
 * shared component rather than three copies.
 *
 * ## It never fails closed on a missing clipboard
 *
 * `navigator.clipboard` is absent in plenty of real conditions: an insecure origin, an older
 * mobile browser, a permissions policy, and jsdom. The Go version checked `clipboard.Truthy()`
 * before touching it and, when it was falsy, told the owner to select the text and copy it
 * manually instead of doing nothing. That is preserved exactly — the text is on screen either
 * way, so the fallback is a real instruction rather than an apology. `writeText` rejecting
 * (permission denied, document not focused) gets the same treatment with its own sentence.
 *
 * The only thing dropped is go-app's `app.IsClient` guard, which existed because the same code
 * was compiled for server-side prerendering; there is no server render here.
 */
import { useCallback, useState } from "react";

/** Shown when the browser exposes no clipboard at all. */
const NO_CLIPBOARD = "Select the text and copy it manually.";

/** Shown when the clipboard exists but refused the write. */
const COPY_BLOCKED = "Copy was blocked. Select the text and copy it manually.";

/** Shown after a successful write. */
const COPIED = "Copied.";

export interface CopyButtonProps {
  /** The text to put on the clipboard. */
  text: string;
  /** The button's label — "Copy cover letter", "Copy message", and so on. */
  label: string;
}

export function CopyButton({ text, label }: CopyButtonProps) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const onCopy = useCallback(() => {
    if (busy) return;
    // Read through `navigator` each click rather than at render: a page can be loaded before
    // the clipboard is available (an insecure origin the owner later opens over https as an
    // installed app), and a stale capture would keep reporting the fallback forever.
    const clipboard: Clipboard | undefined = navigator.clipboard as Clipboard | undefined;
    if (clipboard === undefined) {
      setMessage(NO_CLIPBOARD);
      return;
    }
    setBusy(true);
    setMessage("");
    clipboard.writeText(text).then(
      () => {
        setBusy(false);
        setMessage(COPIED);
      },
      () => {
        setBusy(false);
        setMessage(COPY_BLOCKED);
      },
    );
  }, [busy, text]);

  return (
    <div className="copy-control">
      <button className="copy-button" type="button" disabled={busy} onClick={onCopy}>
        {label}
      </button>
      {/* Always rendered, empty or not: `role="status"` announces a change to its contents, and
          a node that appears only on success is announced as new content instead. */}
      <span className="copy-status" role="status">
        {message}
      </span>
    </div>
  );
}
