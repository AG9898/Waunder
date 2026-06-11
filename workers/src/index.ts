import { loadConfig } from "./config.js";
import { supportedAts } from "./ats/index.js";
import { runWorkerLoop } from "./worker.js";

async function main(): Promise<void> {
  const config = loadConfig();

  console.log("[worker] Waunder automation worker starting");
  console.log(`[worker] api: ${config.apiInternalUrl || "(API_INTERNAL_URL unset)"}`);
  console.log(`[worker] poll interval: ${config.pollIntervalMs}ms, headless: ${config.headless}`);
  console.log(`[worker] supported ATS: ${supportedAts().join(", ") || "none"}`);

  await runWorkerLoop(config);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
