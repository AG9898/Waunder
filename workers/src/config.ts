// Worker configuration sourced from the environment.
export interface WorkerConfig {
  /** Base URL of the Rails API the worker pulls tasks from / reports to. */
  apiInternalUrl: string;
  /** Static bearer token shared with Rails worker-only endpoints. */
  workerServiceToken: string;
  /** Poll interval in milliseconds for fetching approved tasks. */
  pollIntervalMs: number;
  /** Run browsers headless (always true in deployment). */
  headless: boolean;
  /**
   * Feature flag gating the higher-risk LinkedIn Easy Apply trusted-submit
   * handler. Default false: when off, the handler is not registered/active.
   * See RESOLVED-15.
   */
  linkedInEasyApplyEnabled: boolean;
}

/** Parses a boolean env flag; only an explicit truthy value enables it. */
export function isFlagEnabled(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test((value ?? "").trim());
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return {
    apiInternalUrl: env.API_INTERNAL_URL ?? "",
    workerServiceToken: env.WORKER_SERVICE_TOKEN ?? "",
    pollIntervalMs: Number(env.WORKER_POLL_INTERVAL_MS ?? 15000),
    headless: env.WORKER_HEADLESS !== "false",
    linkedInEasyApplyEnabled: isFlagEnabled(env.LINKEDIN_EASY_APPLY_ENABLED),
  };
}
