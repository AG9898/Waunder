/**
 * Transient feedback (UI-05): a tiny module-level toast store read through
 * `useSyncExternalStore`, so any mutation callback can report "saved" or "that write failed"
 * without threading state through the screen.
 *
 * Toasts are for **transient mutation feedback only**. Permanent states — draft warnings, the
 * draft submit gating, scoring failures, validation errors — stay inline on the screen they
 * describe (docs/STYLE_GUIDE.md), because a toast disappears and those must not.
 */
import { useSyncExternalStore } from "react";

export type ToastTone = "success" | "danger";

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

/** How long a toast stays before dismissing itself. Long enough to read a sentence. */
export const TOAST_DURATION_MS = 6000;

let toasts: readonly Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit() {
  for (const listener of listeners) listener();
}

/** Shows a toast and returns its id. An identical message already on screen is not stacked. */
export function showToast(message: string, tone: ToastTone = "success"): number {
  const existing = toasts.find((toast) => toast.message === message && toast.tone === tone);
  if (existing) return existing.id;
  const id = nextId++;
  toasts = [...toasts, { id, message, tone }];
  timers.set(
    id,
    setTimeout(() => {
      dismissToast(id);
    }, TOAST_DURATION_MS),
  );
  emit();
  return id;
}

export function dismissToast(id: number): void {
  const timer = timers.get(id);
  if (timer !== undefined) clearTimeout(timer);
  timers.delete(id);
  if (!toasts.some((toast) => toast.id === id)) return;
  toasts = toasts.filter((toast) => toast.id !== id);
  emit();
}

/** Drops every toast; tests call it between cases so one case's toast never leaks into the next. */
export function clearToasts(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  if (toasts.length === 0) return;
  toasts = [];
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot() {
  return toasts;
}

export function useToasts(): readonly Toast[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
