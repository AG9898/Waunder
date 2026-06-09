import type { Page } from "playwright";
import type { ApplicationTask, AtsKind, TaskResult } from "../types.js";

// An AtsHandler drives one ATS platform's application form. Implementations
// will live alongside this file (greenhouse.ts, lever.ts, ...). Each must
// pause/fail safely rather than guess on unknown or sensitive fields.
export interface AtsHandler {
  readonly kind: AtsKind;
  fill(page: Page, task: ApplicationTask): Promise<TaskResult>;
}

// Registry of supported ATS handlers. Empty in the skeleton; handlers get
// registered here as they are implemented.
const handlers = new Map<AtsKind, AtsHandler>();

export function registerHandler(handler: AtsHandler): void {
  handlers.set(handler.kind, handler);
}

export function getHandler(kind: AtsKind): AtsHandler | undefined {
  return handlers.get(kind);
}

export function supportedAts(): AtsKind[] {
  return [...handlers.keys()];
}
