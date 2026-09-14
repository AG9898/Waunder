// Vendored replacement for shadcn/ui's `cn` (clsx + tailwind-merge) with no runtime dependency (UI-02).
// It only joins truthy class names; primitives avoid conflicting utilities instead of merging them.
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
