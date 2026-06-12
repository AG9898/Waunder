import type { Page } from "playwright";
import { isFlagEnabled } from "../config.js";
import type { ApplicationTask, TaskResult } from "../types.js";
import { fillAtsForm } from "./form.js";
import { registerHandler, unregisterHandler, type AtsHandler } from "./registry.js";

// LinkedIn Easy Apply is a higher-risk trusted-submit path, so it ships behind
// the LINKEDIN_EASY_APPLY_ENABLED feature flag (default off) per RESOLVED-15.
// Unlike the Greenhouse/Lever/Ashby handlers, this module does NOT self-register
// on import — registration is gated through registerLinkedInEasyApplyIfEnabled.
export const linkedInEasyApplyHandler: AtsHandler = {
  kind: "linkedin_easy_apply",
  fill(page: Page, task: ApplicationTask): Promise<TaskResult> {
    return fillAtsForm(page, task, {
      atsName: "linkedin_easy_apply",
      submitSelector:
        "button[aria-label='Submit application'], button[aria-label='Submit'], button[type='submit'], input[type='submit']",
    });
  },
};

/**
 * Registers the LinkedIn Easy Apply handler only when the feature flag is on,
 * and removes any prior registration when it is off. Returns whether the
 * handler is active after the call. The same safety gating and auditable
 * TaskResult contract as the other handlers applies via fillAtsForm.
 */
export function registerLinkedInEasyApplyIfEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isFlagEnabled(env.LINKEDIN_EASY_APPLY_ENABLED)) {
    registerHandler(linkedInEasyApplyHandler);
    return true;
  }
  unregisterHandler(linkedInEasyApplyHandler.kind);
  return false;
}
