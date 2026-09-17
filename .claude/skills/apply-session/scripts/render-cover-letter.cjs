#!/usr/bin/env node
// Render a plain-text cover letter (blank line = paragraph break) to a Letter-size PDF.
// Uses the Playwright package already installed for workers/, so nothing new is added.
//
//   node render-cover-letter.cjs <input.txt> <output.pdf>
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: render-cover-letter.cjs <input.txt> <output.pdf>");
  process.exit(1);
}

const root = execSync("git rev-parse --show-toplevel", { cwd: __dirname }).toString().trim();
const { chromium } = require(path.join(root, "workers", "node_modules", "playwright"));

const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const html = fs
  .readFileSync(input, "utf8")
  .trim()
  .split(/\n\s*\n/)
  .map((p) => `<p>${escape(p).replace(/\n/g, "<br>")}</p>`)
  .join("");

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<html><body style="font:11pt/1.5 Georgia,serif;margin:0">${html}</body></html>`);
    await page.pdf({ path: output, format: "Letter", margin: { top: "1in", bottom: "1in", left: "1in", right: "1in" } });
  } finally {
    await browser.close();
  }
  console.log(`wrote ${output}`);
})();
