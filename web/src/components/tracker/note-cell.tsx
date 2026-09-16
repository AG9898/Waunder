import { type ChangeEvent, type FormEvent, type KeyboardEvent, useCallback, useState } from "react";

import type { ApplicationTracker } from "../../api/schemas";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

export interface NoteCellProps {
  /** The latest Application; an absent application makes this cell read-only. */
  application: ApplicationTracker | null;
  /** The job title used in the trigger and editor's accessible names. */
  jobTitle: string;
  /** The row owns this state so every tracker editor shares one open cell. */
  open: boolean;
  /** All tracker editors are disabled while any row write is in flight. */
  disabled: boolean;
  /** The latest validation or save failure for this row, or an empty string. */
  error: string;
  onOpenChange: (open: boolean) => void;
  /** Resolves after Rails has saved and the tracker has refetched. */
  onNoteChange: (value: string) => Promise<void>;
}

/**
 * The tracker's editable note. The draft belongs to the open popover rather than the row data, so
 * Cancel, Escape, and outside dismissal never write. A failed Save leaves the popover and its
 * typed value in place while the parent supplies the inline Rails error.
 */
export function NoteCell({
  application,
  jobTitle,
  open,
  disabled,
  error,
  onOpenChange,
  onNoteChange,
}: NoteCellProps) {
  const note = application?.pipeline_note ?? "";
  const [draft, setDraft] = useState(note);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) setDraft(note);
      onOpenChange(nextOpen);
    },
    [note, onOpenChange],
  );

  const handleTriggerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== "Enter" || disabled) return;
      event.preventDefault();
      handleOpenChange(true);
    },
    [disabled, handleOpenChange],
  );

  const handleDraftChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(event.target.value);
  }, []);

  const handleCancel = useCallback(() => {
    handleOpenChange(false);
  }, [handleOpenChange]);

  const handleSave = useCallback(async () => {
    if (disabled) return;

    try {
      await onNoteChange(draft);
      handleOpenChange(false);
    } catch {
      // The parent keeps the popover open and exposes the Rails error inline.
    }
  }, [disabled, draft, handleOpenChange, onNoteChange]);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void handleSave();
    },
    [handleSave],
  );

  const content = noteContent(note);
  if (application === null) return content;

  return (
    <div className={`status-cell note-cell${open ? " note-cell--open" : ""}`}>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <button
            className="status-cell-trigger note-cell-trigger"
            type="button"
            aria-expanded={open}
            aria-haspopup="dialog"
            aria-label={`Application note for ${jobTitle}`}
            disabled={disabled}
            onKeyDown={handleTriggerKeyDown}
          >
            {content}
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="status-cell-popover note-cell-popover"
          align="start"
          side="bottom"
          sideOffset={6}
          role="dialog"
          aria-label={`Change application note for ${jobTitle}`}
        >
          <form className="note-cell-form" onSubmit={handleSubmit}>
            <textarea
              className="note-cell-textarea"
              aria-label={`Application note for ${jobTitle}`}
              value={draft}
              disabled={disabled}
              onChange={handleDraftChange}
            />
            <div className="note-cell-actions">
              <button className="note-cell-save" type="submit" disabled={disabled}>
                Save
              </button>
              <button
                className="note-cell-cancel"
                type="button"
                disabled={disabled}
                onClick={handleCancel}
              >
                Cancel
              </button>
            </div>
            {error === "" ? null : (
              <p className="note-cell-error" role="alert">
                {error}
              </p>
            )}
          </form>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function noteContent(note: string) {
  return (
    <span className={`tracker-note${note === "" ? " tracker-cell-empty" : ""}`} title={note}>
      {note === "" ? "—" : note}
    </span>
  );
}
