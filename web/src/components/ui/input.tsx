// Vendored shadcn/ui-style Input (UI-02), themed from Waunder tokens.
import type { InputHTMLAttributes } from "react";

import { cn } from "../../lib/cn";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      data-slot="input"
      className={cn(
        "w-full rounded-md border border-border bg-surface px-3 py-2 font-sans text-base text-ink placeholder:text-ink-faint focus:border-accent",
        className,
      )}
      {...props}
    />
  );
}
