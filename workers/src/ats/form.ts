import type { Locator, Page } from "playwright";
import { isSensitiveField, partitionBySensitivity } from "../safety.js";
import type { ApplicationTask, FieldAnswer, TaskResult } from "../types.js";

type ControlKind = "text" | "textarea" | "select" | "checkbox" | "radio" | "file";

interface FormControl {
  index: number;
  kind: ControlKind;
  label: string;
  name: string;
  id: string;
  placeholder: string;
  required: boolean;
}

export interface AtsFormOptions {
  atsName: string;
  submitSelector: string;
}

const IGNORED_INPUT_TYPES = new Set(["button", "hidden", "image", "reset", "submit"]);

function normalizeField(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function controlText(control: FormControl): string {
  return [control.label, control.name, control.id, control.placeholder].filter(Boolean).join(" ");
}

function answerMatchesControl(answer: FieldAnswer, control: FormControl): boolean {
  const target = normalizeField(answer.field);
  return [control.label, control.name, control.id, control.placeholder]
    .map(normalizeField)
    .filter(Boolean)
    .some((candidate) => candidate === target || candidate.includes(target) || target.includes(candidate));
}

async function discoverControls(page: Page): Promise<FormControl[]> {
  return page.evaluate(() => {
    const ignoredTypes = new Set(["button", "hidden", "image", "reset", "submit"]);
    const controls = [...document.querySelectorAll("input, textarea, select")]
      .filter((node): node is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement => {
        if (
          !(node instanceof HTMLInputElement) &&
          !(node instanceof HTMLTextAreaElement) &&
          !(node instanceof HTMLSelectElement)
        ) {
          return false;
        }

        if (node instanceof HTMLInputElement && ignoredTypes.has(node.type.toLowerCase())) {
          return false;
        }

        return !node.disabled && node.offsetParent !== null;
      });

    return controls.map((node, index) => {
      node.setAttribute("data-waunder-field-index", String(index));

      const explicitLabels = node.id
        ? [...document.querySelectorAll(`label[for="${CSS.escape(node.id)}"]`)].map((label) => label.textContent ?? "")
        : [];
      const wrappingLabel = node.closest("label")?.textContent ?? "";
      const labelledBy = (node.getAttribute("aria-labelledby") ?? "")
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent ?? "");
      const ariaLabel = node.getAttribute("aria-label") ?? "";
      const placeholder = "placeholder" in node ? node.placeholder : "";
      const type = node instanceof HTMLInputElement ? node.type.toLowerCase() : node.tagName.toLowerCase();

      let kind: "text" | "textarea" | "select" | "checkbox" | "radio" | "file" = "text";
      if (node instanceof HTMLTextAreaElement) kind = "textarea";
      if (node instanceof HTMLSelectElement) kind = "select";
      if (node instanceof HTMLInputElement && node.type.toLowerCase() === "checkbox") kind = "checkbox";
      if (node instanceof HTMLInputElement && node.type.toLowerCase() === "radio") kind = "radio";
      if (node instanceof HTMLInputElement && node.type.toLowerCase() === "file") kind = "file";

      return {
        index,
        kind,
        label: [...explicitLabels, wrappingLabel, ...labelledBy, ariaLabel].join(" ").trim().replace(/\s+/g, " "),
        name: node.getAttribute("name") ?? "",
        id: node.id,
        placeholder,
        required: node.required || node.getAttribute("aria-required") === "true",
        type,
      };
    });
  });
}

function controlLocator(page: Page, control: FormControl): Locator {
  return page.locator(`[data-waunder-field-index="${control.index}"]`);
}

async function fillControl(page: Page, control: FormControl, value: string): Promise<void> {
  const locator = controlLocator(page, control);

  switch (control.kind) {
    case "select":
      await locator.selectOption({ label: value }).catch(async () => locator.selectOption(value));
      return;
    case "checkbox": {
      const checked = /^(1|true|yes|y|checked|on)$/i.test(value.trim());
      if ((await locator.isChecked()) !== checked) {
        await locator.setChecked(checked);
      }
      return;
    }
    case "radio":
      await page.locator(`input[type="radio"][name="${control.name}"]`).filter({ hasText: value }).check().catch(async () => {
        await locator.check();
      });
      return;
    default:
      await locator.fill(value);
  }
}

async function uploadResume(page: Page, control: FormControl, task: ApplicationTask, logs: string[]): Promise<string | undefined> {
  if (!task.resumeRef) {
    return `${controlText(control) || "resume upload"} requires a resume file`;
  }

  if (/^https?:\/\//i.test(task.resumeRef)) {
    return "resume upload requires a local file path; URL resume references are not uploadable by Playwright";
  }

  await controlLocator(page, control).setInputFiles(task.resumeRef);
  logs.push(`uploaded resume for ${controlText(control) || "file input"}`);
  return undefined;
}

async function captureAuditScreenshot(page: Page, task: ApplicationTask, atsName: string): Promise<string[]> {
  const safeId = task.applicationId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const path = `/tmp/waunder-worker-${safeId}-${atsName}-${Date.now()}.png`;
  await page.screenshot({ path, fullPage: true });
  return [path];
}

function matchedAnswer(control: FormControl, answers: FieldAnswer[]): FieldAnswer | undefined {
  return answers.find((answer) => answerMatchesControl(answer, control));
}

export async function fillAtsForm(page: Page, task: ApplicationTask, options: AtsFormOptions): Promise<TaskResult> {
  const logs: string[] = [`opened ${options.atsName} form for application ${task.applicationId}`];
  const base = {
    applicationId: task.applicationId,
    logs,
  };
  const { safe, sensitive } = partitionBySensitivity(task.answers);

  if (sensitive.length > 0) {
    const screenshots = await captureAuditScreenshot(page, task, options.atsName);
    return {
      ...base,
      status: "paused",
      reason: `sensitive approved payload fields require manual review: ${sensitive.map((answer) => answer.field).join(", ")}`,
      screenshots,
    };
  }

  const controls = await discoverControls(page);
  const sensitiveControls = controls.filter((control) => isSensitiveField(controlText(control)));
  if (sensitiveControls.length > 0) {
    const screenshots = await captureAuditScreenshot(page, task, options.atsName);
    return {
      ...base,
      status: "paused",
      reason: `sensitive form fields require manual review: ${sensitiveControls.map(controlText).join(", ")}`,
      screenshots,
    };
  }

  const unknownRequired = controls.filter((control) => {
    if (!control.required) return false;
    if (control.kind === "file") return !task.resumeRef;
    return matchedAnswer(control, safe) === undefined;
  });
  if (unknownRequired.length > 0) {
    const screenshots = await captureAuditScreenshot(page, task, options.atsName);
    return {
      ...base,
      status: "paused",
      reason: `unknown required fields require manual review: ${unknownRequired.map(controlText).join(", ")}`,
      screenshots,
    };
  }

  for (const control of controls) {
    if (control.kind === "file") {
      if (control.required || task.resumeRef) {
        const reason = await uploadResume(page, control, task, logs);
        if (reason) {
          const screenshots = await captureAuditScreenshot(page, task, options.atsName);
          return { ...base, status: "paused", reason, screenshots };
        }
      }
      continue;
    }

    const answer = matchedAnswer(control, safe);
    if (!answer) continue;

    await fillControl(page, control, answer.value);
    logs.push(`filled ${controlText(control) || answer.field}`);
  }

  const submit = page.locator(options.submitSelector).first();
  if ((await submit.count()) === 0) {
    const screenshots = await captureAuditScreenshot(page, task, options.atsName);
    return {
      ...base,
      status: "paused",
      reason: "known submit control was not found after filling",
      screenshots,
    };
  }

  await submit.click();
  logs.push(`clicked ${options.atsName} submit control`);

  return {
    ...base,
    status: "submitted",
    screenshots: await captureAuditScreenshot(page, task, options.atsName),
  };
}
