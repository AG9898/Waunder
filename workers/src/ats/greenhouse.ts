import type { Page } from "playwright";
import type { ApplicationTask, TaskResult } from "../types.js";
import { fillAtsForm } from "./form.js";
import { registerHandler, type AtsHandler } from "./registry.js";

export const greenhouseHandler: AtsHandler = {
  kind: "greenhouse",
  fill(page: Page, task: ApplicationTask): Promise<TaskResult> {
    return fillAtsForm(page, task, {
      atsName: "greenhouse",
      submitSelector: "#submit_app, input[type='submit'], button[type='submit']",
    });
  },
};

registerHandler(greenhouseHandler);
