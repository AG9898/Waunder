import { Check } from "lucide-react";
import { type ChangeEvent, type ReactNode, useCallback } from "react";

import {
  PIPELINE_STATUS_OPTIONS,
  PIPELINE_STAGE_OPTIONS,
  selectValue,
  stageFromSelectValue,
  type PipelineOption,
} from "../../lib/pipeline";
import { statusTone, type TrackerGroupName } from "../../lib/labels";
import { isStatusWrite, NOT_APPLIED_OPTION } from "../../lib/tracker";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "../ui/drawer";

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

export interface StatusDrawerProps {
  status: string;
  stage: string;
  jobTitle: string;
  jobCompany: string;
  tracked: boolean;
  open: boolean;
  disabled: boolean;
  onOpenChange: (open: boolean) => void;
  onStatusChange: (value: string) => void;
  onStageChange: (value: string) => void;
  children: ReactNode;
}

/** The mobile status editor: immediate tile writes plus the tracked row's stage select. */
export function StatusDrawer({
  status,
  stage,
  jobTitle,
  jobCompany,
  tracked,
  open,
  disabled,
  onOpenChange,
  onStatusChange,
  onStageChange,
  children,
}: StatusDrawerProps) {
  const handleStatusSelect = useCallback(
    (value: string) => {
      onOpenChange(false);
      if (value === status || !isStatusWrite(value)) return;
      onStatusChange(value);
    },
    [onOpenChange, onStatusChange, status],
  );

  const handleStageChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const nextStage = stageFromSelectValue(event.target.value);
      onOpenChange(false);
      if (nextStage === stage) return;
      onStageChange(nextStage);
    },
    [onOpenChange, onStageChange, stage],
  );

  return (
    <Drawer open={open} onOpenChange={onOpenChange} shouldScaleBackground={false}>
      <DrawerTrigger asChild>{children}</DrawerTrigger>
      <DrawerContent
        className="status-drawer-content"
        aria-label={`Change application status for ${jobTitle}`}
      >
        <DrawerHeader className="status-drawer-header">
          <p className="status-drawer-eyebrow">Application status</p>
          <DrawerTitle className="status-drawer-title">{jobTitle}</DrawerTitle>
          <DrawerDescription className="status-drawer-company">{jobCompany}</DrawerDescription>
        </DrawerHeader>
        <div className="status-drawer-body">
          <div
            className="status-drawer-groups"
            role="listbox"
            aria-label={`Application statuses for ${jobTitle}`}
          >
            {STATUS_GROUPS.map((group) => {
              const options = statusOptions(group.value, tracked);
              return (
                <section className="status-drawer-group" key={group.value}>
                  <h2 className="status-drawer-group-label">{group.label}</h2>
                  <div className="status-drawer-options">
                    {options.map((option) => {
                      const current = option.value === status;
                      return (
                        <button
                          key={option.value}
                          className="status-drawer-option"
                          type="button"
                          role="option"
                          aria-selected={current}
                          data-current={current ? "true" : "false"}
                          data-value={option.value}
                          disabled={disabled}
                          onClick={() => {
                            handleStatusSelect(option.value);
                          }}
                        >
                          <span>{option.label}</span>
                          {current ? (
                            <Check className="status-drawer-check" aria-hidden="true" size={16} />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
          {tracked ? (
            <label className="status-drawer-stage">
              <span>Pipeline stage</span>
              <select
                className="status-drawer-stage-select"
                value={selectValue(stage)}
                disabled={disabled}
                onChange={handleStageChange}
              >
                {PIPELINE_STAGE_OPTIONS.map((option) => (
                  <option key={selectValue(option.value)} value={selectValue(option.value)}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function statusOptions(group: StatusGroup["value"], tracked: boolean): PipelineOption[] {
  const options = PIPELINE_STATUS_OPTIONS.filter((option) => statusTone(option.value).group === group);
  if (group !== "not_applied" || tracked) return options;
  return [{ value: NOT_APPLIED_OPTION, label: "Not applied" }, ...options];
}
