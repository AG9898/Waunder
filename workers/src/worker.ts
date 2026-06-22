import { chromium, type Browser, type Page } from "playwright";
import type { WorkerConfig } from "./config.js";
import type { ApplicationTask, TaskResult, WorkerTaskResponse } from "./types.js";
import { getHandler, supportedAts } from "./ats/index.js";

export interface ProcessTaskOptions {
  headless?: boolean;
  createPage?: () => Promise<{ page: Page; close: () => Promise<void> }>;
}

export interface WorkerLoopOptions {
  fetch?: typeof fetch;
  processTask?: (task: ApplicationTask) => Promise<TaskResult>;
  sleep?: (ms: number) => Promise<void>;
  logger?: Pick<Console, "log" | "error">;
  once?: boolean;
}

const DEFAULT_SLEEP = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function apiUrl(config: WorkerConfig, path: string): URL {
  return new URL(path, config.apiInternalUrl.endsWith("/") ? config.apiInternalUrl : `${config.apiInternalUrl}/`);
}

function authHeaders(config: WorkerConfig): HeadersInit {
  return {
    Authorization: `Bearer ${config.workerServiceToken}`,
    "Content-Type": "application/json",
  };
}

async function createPlaywrightPage(headless: boolean): Promise<{ page: Page; close: () => Promise<void> }> {
  const browser: Browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  const page = await context.newPage();

  return {
    page,
    close: async () => {
      await browser.close();
    },
  };
}

export async function fetchApprovedTasks(
  config: WorkerConfig,
  fetchFn: typeof fetch = fetch,
): Promise<ApplicationTask[]> {
  const response = await fetchFn(apiUrl(config, "api/worker_tasks"), {
    method: "GET",
    headers: authHeaders(config),
  });

  if (!response.ok) {
    throw new Error(`worker task fetch failed: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as WorkerTaskResponse;
  return payload.tasks ?? [];
}

export async function reportTaskResult(
  config: WorkerConfig,
  result: TaskResult,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchFn(apiUrl(config, `api/worker_tasks/${result.applicationId}/report`), {
    method: "POST",
    headers: authHeaders(config),
    body: JSON.stringify({
      status: result.status,
      reason: result.reason,
      screenshots: result.screenshots,
      logs: result.logs,
    }),
  });

  if (!response.ok) {
    throw new Error(`worker task report failed: ${response.status} ${response.statusText}`);
  }
}

/** Process a single approved application task through the registered ATS handler. */
export async function processTask(
  task: ApplicationTask,
  options: ProcessTaskOptions = {},
): Promise<TaskResult> {
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

  const pageFactory = options.createPage ?? (() => createPlaywrightPage(options.headless ?? true));
  let browserPage: { page: Page; close: () => Promise<void> };

  try {
    browserPage = await pageFactory();
  } catch (error) {
    return {
      ...base,
      status: "failed",
      reason: error instanceof Error ? error.message : "failed to launch browser",
    };
  }

  const { page, close } = browserPage;
  let result: TaskResult;

  try {
    await page.goto(task.applyUrl, { waitUntil: "domcontentloaded" });
    result = await handler.fill(page, task);
  } catch (error) {
    result = {
      ...base,
      status: "failed",
      reason: error instanceof Error ? error.message : "unknown worker error",
    };
  }

  try {
    await close();
  } catch (error) {
    result.logs = [
      ...result.logs,
      `browser cleanup failed: ${error instanceof Error ? error.message : "unknown close error"}`,
    ];
  }

  return result;
}

export async function runWorkerLoop(config: WorkerConfig, options: WorkerLoopOptions = {}): Promise<void> {
  const logger = options.logger ?? console;

  if (!config.apiInternalUrl) {
    logger.log("[worker] API_INTERNAL_URL not set; idle (no task source). Exiting.");
    return;
  }

  if (!config.workerServiceToken) {
    throw new Error("WORKER_SERVICE_TOKEN is required when API_INTERNAL_URL is set");
  }

  const fetchFn = options.fetch ?? fetch;
  const sleep = options.sleep ?? DEFAULT_SLEEP;
  const process = options.processTask ?? ((task: ApplicationTask) => processTask(task, { headless: config.headless }));

  do {
    const tasks = await fetchApprovedTasks(config, fetchFn);

    for (const task of tasks) {
      logger.log(`[worker] processing application ${task.applicationId} (${task.ats})`);
      const result = await process(task);
      await reportTaskResult(config, result, fetchFn);
      logger.log(`[worker] reported application ${task.applicationId}: ${result.status}`);
    }

    if (options.once) {
      return;
    }

    await sleep(config.pollIntervalMs);
  } while (true);
}
