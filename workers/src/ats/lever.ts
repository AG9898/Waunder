import type { Page } from "playwright";
import type { ApplicationTask, TaskResult } from "../types.js";
import { fillAtsForm } from "./form.js";
import { registerHandler, type AtsHandler } from "./registry.js";

export const leverHandler: AtsHandler = {
  kind: "lever",
  fill(page: Page, task: ApplicationTask): Promise<TaskResult> {
    return fillAtsForm(page, task, {
      atsName: "lever",
      submitSelector: "button.template-btn-submit, button[type='submit'], input[type='submit']",
    });
  },
};

registerHandler(leverHandler);
