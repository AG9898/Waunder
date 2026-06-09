import type { ApplicationTask, TaskResult } from "./types.js";
import { getHandler, supportedAts } from "./ats/index.js";

/**
 * Process a single approved application task: look up the ATS handler and
 * drive the form fill. Skeleton stub — real browser orchestration (launch,
 * context, screenshots, status reporting to Rails) lands with the handlers.
 */
export async function processTask(task: ApplicationTask): Promise<TaskResult> {
  const base: Pick<TaskResult, "applicationId" | "screenshots" | "logs"> = {
    applicationId: task.applicationId,
    screenshots: [],
    logs: [],
  };

  const handler = getHandler(task.ats);
  if (!handler) {
    return {
      ...base,
      status: "failed",
      reason: `unsupported ATS "${task.ats}" (supported: ${supportedAts().join(", ") || "none"})`,
    };
  }

  // Real implementation: launch Playwright, open task.applyUrl, hand the page
  // to handler.fill(), capture screenshots, and report the result to Rails.
  return {
    ...base,
    status: "paused",
    reason: "handler registered but browser orchestration not implemented (skeleton)",
  };
}
