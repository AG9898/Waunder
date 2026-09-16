import { Check } from "lucide-react";
import { type KeyboardEvent, useCallback } from "react";

import {
  PIPELINE_STAGE_OPTIONS,
  selectValue,
  stageFromSelectValue,
} from "../../lib/pipeline";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

export interface StageCellProps {
  /** The stored Rails pipeline stage, with an empty string meaning no stage. */
  stage: string;
  /** The job title used in the trigger's accessible name. */
  jobTitle: string;
  /** Only tracked rows have an editable Application stage. */
  tracked: boolean;
  /** The row owns this state so other cell editors can share it later. */
  open: boolean;
  /** All tracker editors are disabled while any row write is in flight. */
  disabled: boolean;
  onOpenChange: (open: boolean) => void;
  onStageChange: (value: string) => void;
}

/**
 * The tracker's editable stage. The empty stage uses the existing `none` DOM sentinel because
 * command items need a non-empty value; `stageFromSelectValue` maps it back before Rails sees it.
 * Untracked rows keep the same display text but have no trigger or write affordance.
 */
export function StageCell({
  stage,
  jobTitle,
  tracked,
  open,
  disabled,
  onOpenChange,
  onStageChange,
}: StageCellProps) {
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
      const nextStage = stageFromSelectValue(value);
      onOpenChange(false);
      if (nextStage === stage) return;
      onStageChange(nextStage);
    },
    [onOpenChange, onStageChange, stage],
  );

  const content = stageContent(stage);
  if (!tracked) return content;

  return (
    <div className={`status-cell stage-cell${open ? " stage-cell--open" : ""}`}>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <button
            className="status-cell-trigger stage-cell-trigger"
            type="button"
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-label={`Application stage for ${jobTitle}`}
            disabled={disabled}
            onKeyDown={handleTriggerKeyDown}
          >
            {content}
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="status-cell-popover stage-cell-popover"
          align="start"
          side="bottom"
          sideOffset={6}
          aria-label={`Change application stage for ${jobTitle}`}
        >
          <Command
            className="status-cell-command stage-cell-command"
            defaultValue={selectValue(stage)}
            label={`Application stage for ${jobTitle}`}
            loop
          >
            <CommandInput placeholder="Search stages" disabled={disabled} />
            <CommandList>
              <CommandEmpty>No matching stages.</CommandEmpty>
              <CommandGroup className="status-cell-group" heading="Pipeline stage">
                {PIPELINE_STAGE_OPTIONS.map((option) => {
                  const value = selectValue(option.value);
                  return (
                    <CommandItem
                      key={value}
                      className="status-cell-option stage-cell-option"
                      value={value}
                      disabled={disabled}
                      data-current={option.value === stage ? "true" : "false"}
                      onSelect={handleSelect}
                    >
                      <span>{option.label}</span>
                      {option.value === stage ? (
                        <Check
                          className="status-cell-check stage-cell-check"
                          aria-hidden="true"
                          size={16}
                        />
                      ) : null}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function stageContent(stage: string) {
  if (stage === "") return <span className="tracker-cell-empty">—</span>;

  const label = PIPELINE_STAGE_OPTIONS.find((option) => option.value === stage)?.label ?? "";
  return label === "" ? (
    <span className="tracker-cell-empty">—</span>
  ) : (
    <span className="tracker-stage">{label}</span>
  );
}
