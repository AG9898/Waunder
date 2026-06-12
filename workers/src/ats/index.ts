import "./greenhouse.js";
import "./lever.js";
import "./ashby.js";
import { registerLinkedInEasyApplyIfEnabled } from "./linkedin_easy_apply.js";

// Greenhouse/Lever/Ashby self-register on import (always enabled). LinkedIn
// Easy Apply is feature-flagged (default off) per RESOLVED-15, so it registers
// only when LINKEDIN_EASY_APPLY_ENABLED is on.
registerLinkedInEasyApplyIfEnabled();

export type { AtsHandler } from "./registry.js";
export {
  getHandler,
  registerHandler,
  unregisterHandler,
  supportedAts,
} from "./registry.js";
export { registerLinkedInEasyApplyIfEnabled } from "./linkedin_easy_apply.js";
