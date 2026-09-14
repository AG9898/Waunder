// Vendored shadcn/ui-style Button (UI-02): no Radix/cva runtime dependency, themed from Waunder tokens.
import type { ButtonHTMLAttributes } from "react";

import { cn } from "../../lib/cn";

const variants = {
  primary: "bg-accent text-surface hover:bg-accent-strong",
  secondary: "border border-border-strong bg-surface text-ink hover:bg-surface-sunken",
  ghost: "bg-surface text-ink-soft hover:bg-surface-sunken hover:text-ink",
  danger: "bg-danger text-surface hover:bg-danger-ink",
} as const;

export type ButtonVariant = keyof typeof variants;

export function Button({
  variant = "primary",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type={type}
      data-slot="button"
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 font-sans text-sm font-semibold shadow-sm disabled:opacity-50",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
