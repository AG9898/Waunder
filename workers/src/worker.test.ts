import { test } from "node:test";
import assert from "node:assert/strict";
import type { Page } from "playwright";
import { loadConfig } from "./config.js";
import {
  fetchApprovedTasks,
  processTask,
  reportTaskResult,
  runWorkerLoop,
} from "./worker.js";
import { registerHandler, unregisterHandler } from "./ats/index.js";
import type { ApplicationTask, TaskResult } from "./types.js";

const task: ApplicationTask = {
  applicationId: "42",
  ats: "greenhouse",
  applyUrl: "https://boards.greenhouse.io/acme/jobs/42",
  answers: [{ field: "full_name", value: "Jane Doe" }],
  resumeRef: "resume-doc-1",
};

test("loads worker API configuration from the environment", () => {
  const config = loadConfig({
    API_INTERNAL_URL: "http://localhost:3000",
    WORKER_SERVICE_TOKEN: "worker-token",
    WORKER_POLL_INTERVAL_MS: "250",
    WORKER_HEADLESS: "false",
  });

  assert.deepEqual(config, {
    apiInternalUrl: "http://localhost:3000",
    workerServiceToken: "worker-token",
    pollIntervalMs: 250,
    headless: false,
    linkedInEasyApplyEnabled: false,
  });
});

test("loadConfig enables LinkedIn Easy Apply only when the flag is truthy", () => {
  assert.equal(loadConfig({}).linkedInEasyApplyEnabled, false);
  assert.equal(
    loadConfig({ LINKEDIN_EASY_APPLY_ENABLED: "false" }).linkedInEasyApplyEnabled,
    false,
  );
  assert.equal(
    loadConfig({ LINKEDIN_EASY_APPLY_ENABLED: "true" }).linkedInEasyApplyEnabled,
    true,
  );
});

test("fetches approved tasks with bearer auth", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const fetchFn: typeof fetch = async (input, init) => {
    calls.push({ input: input.toString(), init });
    return new Response(JSON.stringify({ tasks: [task] }), { status: 200 });
  };

  const tasks = await fetchApprovedTasks(
    {
      apiInternalUrl: "http://api.internal",
      workerServiceToken: "worker-token",
      pollIntervalMs: 100,
      headless: true,
      linkedInEasyApplyEnabled: false,
    },
    fetchFn,
  );

  assert.deepEqual(tasks, [task]);
  assert.equal(calls[0].input, "http://api.internal/api/worker_tasks");
  assert.equal(calls[0].init?.method, "GET");
  assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, "Bearer worker-token");
});

test("reports task results to Rails", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const fetchFn: typeof fetch = async (input, init) => {
    calls.push({ input: input.toString(), init });
    return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
  };

  await reportTaskResult(
    {
      apiInternalUrl: "http://api.internal",
      workerServiceToken: "worker-token",
      pollIntervalMs: 100,
      headless: true,
      linkedInEasyApplyEnabled: false,
    },
    {
      applicationId: "42",
      status: "paused",
      reason: "manual review required",
      screenshots: ["screen-1.png"],
      logs: ["opened form"],
    },
    fetchFn,
  );

  assert.equal(calls[0].input, "http://api.internal/api/worker_tasks/42/report");
  assert.equal(calls[0].init?.method, "POST");
  assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, "Bearer worker-token");
  assert.deepEqual(JSON.parse(calls[0].init?.body as string), {
    status: "paused",
    reason: "manual review required",
    screenshots: ["screen-1.png"],
    logs: ["opened form"],
  });
});

test("runWorkerLoop idles cleanly when API_INTERNAL_URL is unset", async () => {
  const logs: string[] = [];

  await runWorkerLoop(
    {
      apiInternalUrl: "",
      workerServiceToken: "",
      pollIntervalMs: 100,
      headless: true,
      linkedInEasyApplyEnabled: false,
    },
    { logger: { log: (message) => logs.push(message), error: () => undefined }, once: true },
  );

  assert.match(logs.join("\n"), /API_INTERNAL_URL not set/);
});

test("runWorkerLoop fetches, processes, and reports one polling cycle", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const fetchFn: typeof fetch = async (input, init) => {
    calls.push({ input: input.toString(), init });
    if (input.toString().endsWith("/api/worker_tasks")) {
      return new Response(JSON.stringify({ tasks: [task] }), { status: 200 });
    }

    return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
  };
  const results: TaskResult[] = [{
    applicationId: "42",
    status: "submitted",
    screenshots: [],
    logs: ["submitted"],
  }];

  await runWorkerLoop(
    {
      apiInternalUrl: "http://api.internal",
      workerServiceToken: "worker-token",
      pollIntervalMs: 100,
      headless: true,
      linkedInEasyApplyEnabled: false,
    },
    {
      fetch: fetchFn,
      once: true,
      logger: { log: () => undefined, error: () => undefined },
      processTask: async (receivedTask) => {
        assert.deepEqual(receivedTask, task);
        return results[0];
      },
    },
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[0].input, "http://api.internal/api/worker_tasks");
  assert.equal(calls[1].input, "http://api.internal/api/worker_tasks/42/report");
});

test("processTask fails safely when no ATS handler is registered", async () => {
  const result = await processTask({ ...task, ats: "linkedin_easy_apply" });

  assert.equal(result.applicationId, "42");
  assert.equal(result.status, "failed");
  assert.match(result.reason ?? "", /unsupported ATS/);
  assert.deepEqual(result.screenshots, []);
  assert.deepEqual(result.logs, []);
});

test("processTask reports browser launch failures instead of crashing the loop", async () => {
  const result = await processTask(task, {
    createPage: async () => {
      throw new Error("browser executable is missing");
    },
  });

  assert.equal(result.applicationId, "42");
  assert.equal(result.status, "failed");
  assert.match(result.reason ?? "", /browser executable is missing/);
  assert.deepEqual(result.screenshots, []);
  assert.deepEqual(result.logs, []);
});

test("processTask reports results even when browser cleanup fails", async () => {
  const ats = "cleanup_probe" as ApplicationTask["ats"];
  registerHandler({
    kind: ats,
    fill: async () => ({
      applicationId: "42",
      status: "submitted",
      screenshots: [],
      logs: ["submitted"],
    }),
  });

  try {
    const result = await processTask({ ...task, ats }, {
      createPage: async () => ({
        page: { goto: async () => undefined } as unknown as Page,
        close: async () => {
          throw new Error("close failed");
        },
      }),
    });

    assert.equal(result.applicationId, "42");
    assert.equal(result.status, "submitted");
    assert.deepEqual(result.screenshots, []);
    assert.deepEqual(result.logs, ["submitted", "browser cleanup failed: close failed"]);
  } finally {
    unregisterHandler(ats);
  }
});
