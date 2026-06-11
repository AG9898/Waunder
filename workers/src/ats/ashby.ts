import type { Page } from "playwright";
import type { ApplicationTask, TaskResult } from "../types.js";
import { fillAtsForm } from "./form.js";
import { registerHandler, type AtsHandler } from "./registry.js";

export const ashbyHandler: AtsHandler = {
  kind: "ashby",
  fill(page: Page, task: ApplicationTask): Promise<TaskResult> {
    return fillAtsForm(page, task, {
      atsName: "ashby",
      submitSelector: "button.ashby-application-form-submit-button, button[type='submit'], input[type='submit']",
    });
  },
};

registerHandler(ashbyHandler);
