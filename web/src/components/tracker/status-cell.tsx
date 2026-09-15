import { Check } from "lucide-react";
import { type KeyboardEvent, useCallback } from "react";

import { PIPELINE_STATUS_OPTIONS, type PipelineOption } from "../../lib/pipeline";
import { statusTone, type TrackerGroupName } from "../../lib/labels";
import { isStatusWrite, NOT_APPLIED_OPTION } from "../../lib/tracker";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { StatusChip } from "../ui/status-chip";

interface StatusGroup {
  value: TrackerGroupName;
  label: string;
}

const STATUS_GROUPS: readonly StatusGroup[] = [
  { value: "not_applied", label: "Not applied" },
  { value: "applied", label: "Applied" },
  { value: "in_progress", label: "In progress" },
  { value: "closed", label: "Closed" },
];

export interface StatusCellProps {
  /** The current Rails pipeline status, or the inert tracker placeholder. */
  status: string;
  /** The job title used in the trigger's accessible name. */
  jobTitle: string;
  /** Whether this row has an Application; tracked rows cannot be untracked here. */
  tracked: boolean;
  /** The row owns this state so other cell editors can share it later. */
  open: boolean;
  /** All tracker editors are disabled while any row write is in flight. */
  disabled: boolean;
  onOpenChange: (open: boolean) => void;
  onStatusChange: (value: string) => void;
}

/**
 * The tracker's editable status chip. The command menu is deliberately a popover, not a dialog:
 * it stays anchored to the cell on both desktop and mobile until the mobile drawer lands in UI-21.
 */
export function StatusCell({
  status,
  jobTitle,
  tracked,
  open,
  disabled,
  onOpenChange,
  onStatusChange,
}: StatusCellProps) {
  const handleTriggerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== "Enter" || disabled) return;
      event.preventDefault();
      onOpenChange(true);
    },
    [disabled, onOpenChange],
  );

  const handleSelect = useCallback(
    (value: string) => {
      onOpenChange(false);
      if (value === status || !isStatusWrite(value)) return;
      onStatusChange(value);
    },
    [onOpenChange, onStatusChange, status],
  );

  return (
    <div className={`status-cell${open ? " status-cell--open" : ""}`}>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <button
            className="status-cell-trigger"
            type="button"
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-label={`Application status for ${jobTitle}`}
            disabled={disabled}
            onKeyDown={handleTriggerKeyDown}
          >
            <StatusChip status={status} size="touch" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="status-cell-popover"
          align="start"
          side="bottom"
          sideOffset={6}
          aria-label={`Change application status for ${jobTitle}`}
        >
          <Command
            className="status-cell-command"
            defaultValue={status}
            label={`Application status for ${jobTitle}`}
            loop
          >
            <CommandInput placeholder="Search statuses" disabled={disabled} />
            <CommandList>
              <CommandEmpty>No matching statuses.</CommandEmpty>
              {STATUS_GROUPS.map((group) => {
                const options = statusOptions(group.value, tracked);
                if (options.length === 0) return null;
                return (
                  <CommandGroup
                    key={group.value}
                    className="status-cell-group"
                    heading={group.label}
                  >
                    {options.map((option) => (
                      <CommandItem
                        key={option.value}
                        className="status-cell-option"
                        value={option.value}
                        disabled={disabled}
                        data-current={option.value === status ? "true" : "false"}
                        onSelect={handleSelect}
                      >
                        <span>{option.label}</span>
                        {option.value === status ? (
                          <Check className="status-cell-check" aria-hidden="true" size={16} />
                        ) : null}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                );
              })}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function statusOptions(group: TrackerGroupName, tracked: boolean): PipelineOption[] {
  const options = PIPELINE_STATUS_OPTIONS.filter(
    (option) => statusTone(option.value).group === group,
  );
  if (group !== "not_applied" || tracked) return options;
  return [{ value: NOT_APPLIED_OPTION, label: "Not applied" }, ...options];
}
