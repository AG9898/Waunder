// Vendored shadcn/ui-style Select (UI-02). A native <select> instead of Radix, so phones keep the
// OS picker and nothing is added to the runtime bundle. An empty-string option renders value="".
import type { SelectHTMLAttributes } from "react";

import { cn } from "../../lib/cn";

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      data-slot="select"
      className={cn(
        "w-full rounded-md border border-border bg-surface px-3 py-2 font-sans text-base text-ink focus:border-accent",
        className,
      )}
      {...props}
    />
  );
}
