// Toast viewport (UI-05): one polite live region, so every toast is announced to assistive
// technology, and each toast carries its own dismiss button. Rendered by AppChrome.
import { dismissToast, useToasts } from "../../lib/toast";
import { cn } from "../../lib/cn";

const tones = {
  success: "border-success bg-success-soft text-success-ink",
  danger: "border-danger bg-danger-soft text-danger-ink",
} as const;

export function Toaster() {
  const toasts = useToasts();
  return (
    <div
      className="toast-viewport fixed top-3 right-3 left-3 z-50 flex flex-col items-center gap-2 pointer-events-none"
      role="region"
      aria-label="Notifications"
      aria-live="polite"
      aria-relevant="additions"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          data-slot="toast"
          data-tone={toast.tone}
          className={cn(
            "toast pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-md border px-4 py-3 font-sans text-sm shadow-md",
            tones[toast.tone],
          )}
        >
          <p className="m-0 flex-1">{toast.message}</p>
          <button
            type="button"
            className="toast-dismiss rounded-sm px-1 font-semibold"
            aria-label="Dismiss notification"
            onClick={() => {
              dismissToast(toast.id);
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
