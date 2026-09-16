import { type KeyboardEvent, useCallback } from "react";

import type { ApplicationTracker } from "../../api/schemas";
import { trackerFollowUpState, type TrackerFollowUpState } from "../../lib/tracker";
import { Calendar } from "../ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface FollowUpCellProps {
  /** The latest Application; an absent application makes this cell read-only. */
  application: ApplicationTracker | null;
  /** The job title used in the trigger's accessible name. */
  jobTitle: string;
  /** The row owns this state so every tracker editor shares one open cell. */
  open: boolean;
  /** All tracker editors are disabled while any row write is in flight. */
  disabled: boolean;
  onOpenChange: (open: boolean) => void;
  onFollowUpChange: (value: string) => void;
}

/**
 * The tracker's editable follow-up date. Calendar owns the date-only boundary and returns the
 * literal local calendar value Rails stores, so selecting a day never crosses a timezone boundary.
 * Clearing is an explicit empty value; omitting the field would preserve the old date instead.
 */
export function FollowUpCell({
  application,
  jobTitle,
  open,
  disabled,
  onOpenChange,
  onFollowUpChange,
}: FollowUpCellProps) {
  const date = application?.next_follow_up_on ?? "";
  const content = followUpContent(trackerFollowUpState(application));

  const handleTriggerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== "Enter" || disabled) return;
      event.preventDefault();
      onOpenChange(true);
    },
    [disabled, onOpenChange],
  );

  const handleChange = useCallback(
    (value: string | undefined) => {
      const nextDate = value ?? "";
      onOpenChange(false);
      if (nextDate === date) return;
      onFollowUpChange(nextDate);
    },
    [date, onFollowUpChange, onOpenChange],
  );

  const handleClear = useCallback(() => {
    onOpenChange(false);
    onFollowUpChange("");
  }, [onFollowUpChange, onOpenChange]);

  if (application === null) return content;

  return (
    <div className={`status-cell follow-up-cell${open ? " follow-up-cell--open" : ""}`}>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <button
            className="status-cell-trigger follow-up-cell-trigger"
            type="button"
            aria-expanded={open}
            aria-haspopup="dialog"
            aria-label={`Application follow-up for ${jobTitle}`}
            disabled={disabled}
            onKeyDown={handleTriggerKeyDown}
          >
            {content}
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="status-cell-popover follow-up-cell-popover"
          align="start"
          side="bottom"
          sideOffset={6}
          role="dialog"
          aria-label={`Change application follow-up for ${jobTitle}`}
        >
          <Calendar
            value={date}
            defaultMonth={calendarMonth(date)}
            onChange={handleChange}
            disabled={disabled}
          />
          <button
            className="follow-up-cell-clear"
            type="button"
            disabled={disabled}
            onClick={handleClear}
          >
            Clear
          </button>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function followUpContent(followUp: TrackerFollowUpState) {
  if (followUp.tone === null) {
    return <span className="tracker-cell-empty">{followUp.label}</span>;
  }

  return (
    <span className={`tracker-follow-up tracker-follow-up--${followUp.tone}`}>
      {followUp.label}
    </span>
  );
}

/** Keep a stored date's month visible without parsing it as a UTC timestamp. */
function calendarMonth(value: string): Date | undefined {
  const match = DATE_ONLY.exec(value);
  if (match === null) return undefined;

  const month = Number(match[2]);
  if (month < 1 || month > 12) return undefined;

  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(Number(match[1]), month - 1, 1);
  return date;
}
