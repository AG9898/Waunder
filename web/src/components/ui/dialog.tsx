// Vendored shadcn/ui-style Dialog (UI-02) over the native <dialog> element: focus trapping, Escape,
// and the backdrop come from the browser rather than a Radix runtime dependency. Sheet reuses it.
import { useEffect, useRef, type ReactNode } from "react";

import { cn } from "../../lib/cn";

export type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children?: ReactNode;
  className?: string;
  slot?: string;
};

export function Dialog({
  open,
  onClose,
  title,
  children,
  className,
  slot = "dialog",
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      // jsdom and older engines may lack showModal; fall back to the open attribute.
      if (typeof el.showModal === "function") el.showModal();
      else el.setAttribute("open", "");
    } else if (!open && el.open) {
      if (typeof el.close === "function") el.close();
      else el.removeAttribute("open");
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      data-slot={slot}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className={cn(
        "rounded-lg border border-border bg-surface p-6 font-sans text-ink shadow-md",
        className,
      )}
    >
      <h2 className="text-md font-semibold text-ink">{title}</h2>
      {children}
    </dialog>
  );
}
