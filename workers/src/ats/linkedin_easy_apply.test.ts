import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
import {
  linkedInEasyApplyHandler,
  registerLinkedInEasyApplyIfEnabled,
} from "./linkedin_easy_apply.js";
import { getHandler, supportedAts, unregisterHandler } from "./registry.js";
import type { ApplicationTask } from "../types.js";

const submitScript = `
  <script>
    document.querySelector("form").addEventListener("submit", (event) => {
      event.preventDefault();
      document.body.dataset.submitted = "true";
    });
  </script>
`;

function fixtureHtml(extra = ""): string {
  return `
    <form>
      <label for="full_name">Full name</label>
      <input id="full_name" name="full_name" required />
      <label for="email">Email</label>
      <input id="email" name="email" required />
      <label for="why">Why this company?</label>
      <textarea id="why" name="why"></textarea>
      ${extra}
      <button aria-label="Submit application" type="submit">Submit application</button>
    </form>
    ${submitScript}
  `;
}

function task(): ApplicationTask {
  return {
    applicationId: "linkedin_easy_apply-42",
    ats: "linkedin_easy_apply",
    applyUrl: "https://example.test/linkedin",
    answers: [
      { field: "full_name", value: "Jane Doe" },
      { field: "email", value: "jane@example.test" },
      { field: "why", value: "The role matches my background." },
    ],
  };
}

async function withPage(run: (page: Page) => Promise<void>): Promise<void> {
  const browser: Browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await run(page);
  } finally {
    await browser.close();
  }
}

test("LinkedIn Easy Apply handler is inactive when the flag is off", () => {
  // Ensure a clean baseline regardless of import-time registration.
  unregisterHandler("linkedin_easy_apply");

  for (const value of [undefined, "", "false", "0", "no", "off"]) {
    const active = registerLinkedInEasyApplyIfEnabled({
      LINKEDIN_EASY_APPLY_ENABLED: value,
    } as NodeJS.ProcessEnv);
    assert.equal(active, false);
    assert.equal(getHandler("linkedin_easy_apply"), undefined);
    assert.equal(supportedAts().includes("linkedin_easy_apply"), false);
  }
});

test("LinkedIn Easy Apply handler is active when the flag is on", () => {
  try {
    for (const value of ["true", "1", "yes", "on", "TRUE"]) {
      unregisterHandler("linkedin_easy_apply");
      const active = registerLinkedInEasyApplyIfEnabled({
        LINKEDIN_EASY_APPLY_ENABLED: value,
      } as NodeJS.ProcessEnv);
      assert.equal(active, true);
      assert.equal(getHandler("linkedin_easy_apply"), linkedInEasyApplyHandler);
      assert.equal(supportedAts().includes("linkedin_easy_apply"), true);
    }
  } finally {
    unregisterHandler("linkedin_easy_apply");
  }
});

test("enabled handler fills approved answers and clicks the known submit", async () => {
  registerLinkedInEasyApplyIfEnabled({
    LINKEDIN_EASY_APPLY_ENABLED: "true",
  } as NodeJS.ProcessEnv);

  try {
    await withPage(async (page) => {
      await page.setContent(fixtureHtml());

      const result = await getHandler("linkedin_easy_apply")?.fill(page, task());

      assert.equal(result?.status, "submitted");
      assert.equal(await page.locator("#full_name").inputValue(), "Jane Doe");
      assert.equal(await page.evaluate(() => document.body.dataset.submitted), "true");
      assert.ok(result?.screenshots[0].startsWith("/tmp/waunder-worker-"));
    });
  } finally {
    unregisterHandler("linkedin_easy_apply");
  }
});

test("enabled handler enforces the same sensitive-field gating", async () => {
  registerLinkedInEasyApplyIfEnabled({
    LINKEDIN_EASY_APPLY_ENABLED: "true",
  } as NodeJS.ProcessEnv);

  try {
    await withPage(async (page) => {
      await page.setContent(
        fixtureHtml(`
          <label for="salary">Salary expectation</label>
          <input id="salary" name="salary" />
        `),
      );

      const result = await getHandler("linkedin_easy_apply")?.fill(page, task());

      assert.equal(result?.status, "paused");
      assert.match(result?.reason ?? "", /sensitive form fields/);
      assert.match(result?.reason ?? "", /Salary expectation/);
      assert.ok(result?.screenshots.length);
    });
  } finally {
    unregisterHandler("linkedin_easy_apply");
  }
});
