import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";
import { statusTone } from "../../lib/labels";

export type StatusChipSize = "desktop" | "touch";

export interface StatusChipProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  /** Rails' pipeline status, or `not_applied` for an untracked tracker row. */
  status: string;
  /** Desktop chips are 22px high; touch chips are 24px high. */
  size?: StatusChipSize;
}

/** A read-only pipeline status marker. Status changes belong to the owning screen. */
export function StatusChip({ status, size = "desktop", className, ...props }: StatusChipProps) {
  const definition = statusTone(status);

  return (
    <span
      data-slot="status-chip"
      data-status={status}
      data-tone={definition.tone}
      className={cn(
        "status-chip",
        `status-chip--${definition.tone}`,
        `status-chip--${size}`,
        className,
      )}
      {...props}
    >
      <span className="status-chip-dot" aria-hidden="true" />
      {definition.label}
    </span>
  );
}
