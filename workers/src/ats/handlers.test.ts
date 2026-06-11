import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
import { getHandler, supportedAts } from "./index.js";
import type { ApplicationTask, AtsKind } from "../types.js";

const submitScript = `
  <script>
    document.querySelector("form").addEventListener("submit", (event) => {
      event.preventDefault();
      document.body.dataset.submitted = "true";
    });
  </script>
`;

function fixtureHtml(ats: AtsKind, extra = ""): string {
  const submitClass = ats === "lever" ? "template-btn-submit" : ats === "ashby" ? "ashby-application-form-submit-button" : "";
  return `
    <form>
      <label for="full_name">Full name</label>
      <input id="full_name" name="full_name" required />
      <label for="email">Email</label>
      <input id="email" name="email" required />
      <label for="why">Why this company?</label>
      <textarea id="why" name="why"></textarea>
      ${extra}
      <button class="${submitClass}" id="submit_app" type="submit">Submit</button>
    </form>
    ${submitScript}
  `;
}

function task(ats: AtsKind): ApplicationTask {
  return {
    applicationId: `${ats}-42`,
    ats,
    applyUrl: `https://example.test/${ats}`,
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

test("registers Greenhouse, Lever, and Ashby handlers", () => {
  assert.deepEqual(supportedAts().sort(), ["ashby", "greenhouse", "lever"]);
});

for (const ats of ["greenhouse", "lever", "ashby"] as const) {
  test(`${ats} handler fills approved answers and clicks known submit`, async () => {
    await withPage(async (page) => {
      await page.setContent(fixtureHtml(ats));

      const result = await getHandler(ats)?.fill(page, task(ats));

      assert.equal(result?.status, "submitted");
      assert.equal(await page.locator("#full_name").inputValue(), "Jane Doe");
      assert.equal(await page.locator("#email").inputValue(), "jane@example.test");
      assert.equal(await page.locator("#why").inputValue(), "The role matches my background.");
      assert.equal(await page.evaluate(() => document.body.dataset.submitted), "true");
      assert.ok(result?.screenshots[0].startsWith("/tmp/waunder-worker-"));
      assert.match(result?.logs.join("\n") ?? "", /filled Full name/);
    });
  });
}

test("handler pauses on unknown required fields", async () => {
  await withPage(async (page) => {
    await page.setContent(fixtureHtml("greenhouse", `
      <label for="portfolio">Portfolio</label>
      <input id="portfolio" name="portfolio" required />
    `));

    const result = await getHandler("greenhouse")?.fill(page, task("greenhouse"));

    assert.equal(result?.status, "paused");
    assert.match(result?.reason ?? "", /unknown required fields/);
    assert.match(result?.reason ?? "", /Portfolio/);
    assert.ok(result?.screenshots.length);
  });
});

test("handler pauses on sensitive fields instead of guessing", async () => {
  await withPage(async (page) => {
    await page.setContent(fixtureHtml("lever", `
      <label for="salary">Salary expectation</label>
      <input id="salary" name="salary" />
    `));

    const result = await getHandler("lever")?.fill(page, task("lever"));

    assert.equal(result?.status, "paused");
    assert.match(result?.reason ?? "", /sensitive form fields/);
    assert.match(result?.reason ?? "", /Salary expectation/);
    assert.ok(result?.screenshots.length);
  });
});
