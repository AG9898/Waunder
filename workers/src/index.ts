import { loadConfig } from "./config.js";
import { supportedAts } from "./ats/index.js";

// Entry point for the Waunder automation worker. In the skeleton it only
// validates configuration and logs readiness; the polling loop that pulls
// approved tasks from Rails and dispatches them to processTask() is wired up
// once the API task endpoints and ATS handlers exist.
function main(): void {
  const config = loadConfig();

  console.log("[worker] Waunder automation worker starting");
  console.log(`[worker] api: ${config.apiInternalUrl || "(API_INTERNAL_URL unset)"}`);
  console.log(`[worker] poll interval: ${config.pollIntervalMs}ms, headless: ${config.headless}`);
  console.log(`[worker] supported ATS: ${supportedAts().join(", ") || "none (skeleton)"}`);

  if (!config.apiInternalUrl) {
    console.log("[worker] API_INTERNAL_URL not set; idle (no task source). Exiting.");
    return;
  }

  // TODO: start poll loop -> fetch approved tasks -> processTask -> report.
  console.log("[worker] poll loop not implemented yet (skeleton); exiting.");
}

main();
