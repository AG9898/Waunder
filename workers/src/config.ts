// Worker configuration sourced from the environment.
export interface WorkerConfig {
  /** Base URL of the Rails API the worker pulls tasks from / reports to. */
  apiInternalUrl: string;
  /** Poll interval in milliseconds for fetching approved tasks. */
  pollIntervalMs: number;
  /** Run browsers headless (always true in deployment). */
  headless: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return {
    apiInternalUrl: env.API_INTERNAL_URL ?? "",
    pollIntervalMs: Number(env.WORKER_POLL_INTERVAL_MS ?? 15000),
    headless: env.WORKER_HEADLESS !== "false",
  };
}
