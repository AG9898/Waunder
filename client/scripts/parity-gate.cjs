#!/usr/bin/env node
// FE-28 visual parity gate: the Go/go-app build versus the Caddy image, route by route.
//
// Both apps are served for real (the Go binary from `make wasm server`, the client from
// `deploy/railway-web.Dockerfile`) and every `/api/*` request is fulfilled in Playwright from ONE
// fixture table, so both screens render from identical data. No Rails, LLM, push, or submit.
//
// Service workers are deliberately left enabled (no `serviceWorkers: 'block'`): blocking them
// bypasses go-app's cache-first worker, so a screenshot could look right while real returning
// browsers see something else (AGENTS.md, 2026-09-08).
//
// Report: $PARITY_REPORT_DIR (default client/parity-report/, gitignored) — index.html plus
// go/, client/, diff/ PNGs and summary.json. Set PARITY_SKIP_BUILD=1 to reuse existing builds.
/* global getComputedStyle, Image, OffscreenCanvas */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../../workers/node_modules/playwright");

const repoRoot = path.resolve(__dirname, "../..");
const webRoot = path.join(repoRoot, "web");
const reportDir = path.resolve(process.env.PARITY_REPORT_DIR || path.join(repoRoot, "client/parity-report"));
const image = `waunder-parity-${process.pid}:latest`;

const ROUTES = ["/", "/login", "/jobs", "/jobs/new", "/jobs/101", "/jobs/101/contacts", "/applications", "/applications/41", "/profile"];
const WIDTHS = { mobile: { width: 390, height: 844 }, desktop: { width: 1440, height: 1000 } };
// A pixel counts as different when any channel moves more than this (absorbs antialiasing noise).
const CHANNEL_TOLERANCE = 24;

// Differences that are explained in docs/GO_MIGRATION.md ("Visual parity gate — FE-28").
// Anything not listed here must render with zero differing pixels or the gate fails.
const EXPLAINED = {
  "/profile": "Sign-out control added by FE-09/FE-25 (deliberate; GO_MIGRATION.md FE-25 notes).",
  "/jobs/101/contacts": "Collapsed \"Add a contact\" form added by FE-21 (deliberate; GO_MIGRATION.md FE-21 notes).",
};

/* ------------------------------------------------------------------ fixtures */
const tracker = {
  application_id: 41, job_post_id: 101, job_title: "Senior Backend Engineer", company: "Northwind Robotics",
  status: "draft", automation_status: "draft", pipeline_status: "applied", pipeline_stage: "waiting",
  pipeline_note: "Referred by a former colleague.", last_status_change_at: "2026-09-08T17:20:00Z",
  next_follow_up_on: "2026-09-15", approved_at: "", submitted_at: "", failure_reason: "", draft_ready: true, worker_report: null,
};
const scoredJob = {
  id: 101, title: "Senior Backend Engineer", company: "Northwind Robotics", source: "linkedin", match_score: 82,
  scoring_status: "scored", triage_status: "eligible", triage_score: 7, triage_reasons: ["title match: backend engineer"],
  lifecycle_state: "active", summary: "Rails and Postgres platform team, hybrid in Vancouver.",
  created_at: "2026-09-08T15:04:05Z", application: tracker,
};
const unscoredJob = {
  id: 102, title: "Platform Engineer", company: "Cascadia Analytics", source: "glassdoor", match_score: null,
  scoring_status: "deferred", triage_status: "eligible", triage_score: 5, triage_reasons: [], lifecycle_state: "active",
  summary: "", created_at: "2026-09-08T15:06:11Z", application: null,
};
const jobDetail = {
  ...scoredJob, posting_url: "https://www.linkedin.com/jobs/view/4100000001", compensation: "$150,000–$180,000",
  relevant_requirements: ["Rails", "PostgreSQL"], missing_requirements: ["Kubernetes"], red_flags: [],
  resume_alignment_notes: "Lead with the Rails ingestion pipeline work.", application_strategy: "Apply directly.",
  cover_letter_draft: { id: 9, job_post_id: 101, body: "Dear hiring team,\n\nI build Rails platforms.", generated_at: "2026-09-09T12:00:00Z" },
  route: { route_type: "greenhouse", recommended_route: "direct_ats", application_url: "https://boards.greenhouse.io/northwind/jobs/1" },
};
const FIXTURES = {
  "/api/intake": { intake: { enabled: true, paused_at: "", resumed_at: "2026-09-09T08:00:00Z", held_count: 0, processing_count: 0, queued_count: 0 } },
  "/api/job_posts": {
    job_posts: [scoredJob, unscoredJob], page: { number: 1, size: 30, total: 2, has_next: false },
    application_counts: { all: 2, not_applied: 1, applied: 1, in_progress: 0, closed: 0 },
  },
  "/api/job_posts/101": { job_post: jobDetail },
  "/api/job_posts/101/cover_letter_draft": { cover_letter_draft: jobDetail.cover_letter_draft },
  "/api/job_posts/101/contact_candidates": {
    contact_candidates: [{ id: 7, job_post_id: 101, name: "Priya Raman", title: "Engineering Manager", company_name: "Northwind Robotics", linkedin_url: "https://www.linkedin.com/in/example", relevance_reason: "Hiring manager for the team." }],
  },
  "/api/ingestion_batches": {
    batches: [{ id: "linkedin-1757343845", source: "linkedin", ingested_at: "2026-09-08T15:04:05Z", date: "2026-09-08", count: 2, jobs: [scoredJob, unscoredJob] }],
    page: { number: 1, size: 10, total: 1, has_next: false },
  },
  "/api/applications/41": {
    application: {
      ...tracker, resume_emphasis_notes: "Lead with the pipeline work.", cover_letter: "Dear hiring team,\n\nI build Rails platforms.",
      structured_answers: [{ field: "Why this role?", value: "The platform scope fits." }],
      autofill_payload: { ats: "greenhouse", apply_url: "https://boards.greenhouse.io/northwind/jobs/1", answers: [{ field: "full_name", value: "Owner Name" }], resume_ref: "resume-primary" },
      autofill_warnings: [],
    },
  },
  "/api/profile": {
    profile: {
      full_name: "Owner Name", headline: "Backend engineer", summary: "Builds Rails services.", location: "Vancouver, BC",
      linkedin_url: "https://www.linkedin.com/in/example", github_url: "https://github.com/example", portfolio_url: "https://example.com",
      contact: { email_present: true, phone_present: true, street_address_present: false },
      resume: { title: "Owner Name — CV", parse_status: "parsed", file_attached: true, filename: "cv.pdf" },
    },
  },
  "/api/push/vapid_public_key": { vapid_public_key: "BFakePublicVapidKeyForTestsOnly0000000000000000000000000000000000000000000000" },
};

/* ------------------------------------------------------------------ process helpers */
function run(cmd, args, cwd = repoRoot) {
  const env = { ...process.env, PATH: `/usr/local/go/bin:${process.env.PATH}` };
  const r = spawnSync(cmd, args, { cwd, env, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed\n${r.stdout}${r.stderr}`);
}
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer().once("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}
async function waitForHttp(url) {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(url)).ok) return; } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for ${url}`);
}

/* ------------------------------------------------------------------ capture */
async function capture(browser, origin, label, writes) {
  const shots = {};
  for (const [widthName, viewport] of Object.entries(WIDTHS)) {
    const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
    await context.route("**/api/**", (route) => {
      const req = route.request();
      const { pathname } = new URL(req.url());
      if (req.method() !== "GET") {
        writes.push(`${label} ${req.method()} ${pathname}`);
        return route.fulfill({ status: 204 });
      }
      const body = FIXTURES[pathname];
      if (!body) return route.fulfill({ status: 404, json: { error: { code: "not_found" } } });
      return route.fulfill({ json: body });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    for (const route of ROUTES) {
      await page.goto(origin + route, { waitUntil: "networkidle" });
      await page.waitForFunction(() => document.querySelector(".app-tabs, .login-screen"), undefined, { timeout: 30_000 });
      await page.waitForFunction(() => !document.querySelector(".load-loading, .loading"));
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400);
      shots[`${widthName}${route}`] = await page.screenshot({ fullPage: true, animations: "disabled", caret: "hide" });
    }
    assert.deepEqual(errors, [], `${label} page errors`);
    await context.close();
  }
  return shots;
}

// Tab-walk focus check: press Tab until the sage primary button holds focus, wait past the 140ms
// box-shadow transition, then read the computed ring (never a same-frame screenshot after focus()).
async function focusRing(browser, origin, route, selector, fill) {
  const context = await browser.newContext({ viewport: WIDTHS.desktop });
  await context.route("**/api/**", (r) => r.fulfill({ json: FIXTURES[new URL(r.request().url()).pathname] ?? {} }));
  const page = await context.newPage();
  await page.goto(origin + route, { waitUntil: "networkidle" });
  await page.locator(selector).waitFor();
  if (fill) await page.locator(fill).fill("https://example.com/job");
  let reached = false;
  for (let i = 0; i < 40 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await page.evaluate((sel) => document.activeElement?.matches(sel) ?? false, selector);
  }
  assert.ok(reached, `Tab never reached ${selector} at ${origin}${route}`);
  await page.waitForTimeout(400);
  const ring = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return { focusVisible: el.matches(":focus-visible"), boxShadow: getComputedStyle(el).boxShadow };
  }, selector);
  await context.close();
  return ring;
}

async function diff(browser, a, b) {
  const page = await browser.newPage();
  const result = await page.evaluate(async ({ a, b, tol }) => {
    const load = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = src; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const w = Math.max(ia.width, ib.width), h = Math.max(ia.height, ib.height);
    const pixels = (img) => { const c = new OffscreenCanvas(w, h); const x = c.getContext("2d"); x.fillStyle = "#f0f"; x.fillRect(0, 0, w, h); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h).data; };
    const pa = pixels(ia), pb = pixels(ib);
    const out = new OffscreenCanvas(w, h), ctx = out.getContext("2d"), od = ctx.createImageData(w, h);
    let changed = 0;
    for (let p = 0; p < pa.length; p += 4) {
      const d = Math.abs(pa[p] - pb[p]) > tol || Math.abs(pa[p + 1] - pb[p + 1]) > tol || Math.abs(pa[p + 2] - pb[p + 2]) > tol;
      if (d) changed++;
      const g = (pa[p] + pa[p + 1] + pa[p + 2]) / 12 + 190;
      od.data.set(d ? [230, 20, 60, 255] : [g, g, g, 255], p);
    }
    ctx.putImageData(od, 0, 0);
    const blob = await out.convertToBlob({ type: "image/png" });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = ""; for (const byte of bytes) bin += String.fromCharCode(byte);
    return { changed, total: w * h, sizeA: [ia.width, ia.height], sizeB: [ib.width, ib.height], png: btoa(bin) };
  }, { a: `data:image/png;base64,${a.toString("base64")}`, b: `data:image/png;base64,${b.toString("base64")}`, tol: CHANNEL_TOLERANCE });
  await page.close();
  return result;
}

/* ------------------------------------------------------------------ main */
async function main() {
  if (!process.env.PARITY_SKIP_BUILD) {
    run("make", ["wasm", "server"], webRoot);
    run("docker", ["build", "--tag", image, "--file", "deploy/railway-web.Dockerfile", "."]);
  }
  const tag = process.env.PARITY_SKIP_BUILD ? process.env.PARITY_IMAGE : image;
  assert.ok(tag, "PARITY_SKIP_BUILD needs PARITY_IMAGE=<built client image>");
  const [goPort, clientPort] = await Promise.all([freePort(), freePort()]);
  const goServer = spawn("./bin/server", [], { cwd: webRoot, env: { ...process.env, PORT: `${goPort}`, API_INTERNAL_URL: "" }, stdio: "ignore" });
  const container = `waunder-parity-${process.pid}`;
  // API_INTERNAL_URL points nowhere: every /api request is fulfilled by Playwright before it leaves the browser.
  run("docker", ["run", "--detach", "--rm", "--name", container, "--network", "host", "--env", `PORT=${clientPort}`, "--env", "API_INTERNAL_URL=http://127.0.0.1:9", tag]);
  const browser = await chromium.launch();
  try {
    const goOrigin = `http://127.0.0.1:${goPort}`, clientOrigin = `http://127.0.0.1:${clientPort}`;
    await Promise.all([waitForHttp(goOrigin), waitForHttp(clientOrigin)]);
    const writes = [];
    const goShots = await capture(browser, goOrigin, "go", writes);
    const clientShots = await capture(browser, clientOrigin, "client", writes);
    assert.deepEqual(writes, [], "rendering a screen must never write to Rails");

    fs.rmSync(reportDir, { recursive: true, force: true });
    for (const d of ["go", "client", "diff"]) fs.mkdirSync(path.join(reportDir, d), { recursive: true });
    const rows = [], failures = [];
    for (const key of Object.keys(goShots)) {
      const file = `${key.replace(/\//g, "_")}.png`.replace(/_\.png$/, "_root.png");
      const r = await diff(browser, goShots[key], clientShots[key]);
      fs.writeFileSync(path.join(reportDir, "go", file), goShots[key]);
      fs.writeFileSync(path.join(reportDir, "client", file), clientShots[key]);
      fs.writeFileSync(path.join(reportDir, "diff", file), Buffer.from(r.png, "base64"));
      const route = key.slice(key.indexOf("/"));
      const explanation = r.changed === 0 ? "" : EXPLAINED[route] ?? "";
      if (r.changed > 0 && !explanation) failures.push(`${key}: ${r.changed} px differ (go ${r.sizeA}, client ${r.sizeB})`);
      rows.push({ key, file, changed: r.changed, ratio: r.changed / r.total, sizeGo: r.sizeA, sizeClient: r.sizeB, explanation });
    }

    const focus = {};
    for (const [route, sel, fill] of [["/login", ".login-submit"], ["/jobs/new", ".manual-entry-submit", ".manual-entry-url"]]) {
      const [go, client] = [await focusRing(browser, goOrigin, route, sel, fill), await focusRing(browser, clientOrigin, route, sel, fill)];
      focus[sel] = { go, client };
      if (!go.focusVisible || !client.focusVisible || client.boxShadow === "none" || go.boxShadow !== client.boxShadow)
        failures.push(`focus ring ${sel}: go ${JSON.stringify(go)} client ${JSON.stringify(client)}`);
    }

    fs.writeFileSync(path.join(reportDir, "summary.json"), JSON.stringify({ rows, focus, failures }, null, 2));
    fs.writeFileSync(path.join(reportDir, "index.html"), `<!doctype html><title>Waunder parity report</title>
<style>body{font:14px system-ui;margin:16px}section{margin:24px 0}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}img{width:100%;border:1px solid #ccc}.bad{color:#b00020}</style>
<h1>Go vs client visual parity</h1><p>Channel tolerance ${CHANNEL_TOLERANCE}. Focus rings: <code>${JSON.stringify(focus)}</code></p>
${rows.map((r) => `<section><h2 class="${r.changed && !r.explanation ? "bad" : ""}">${r.key} — ${r.changed} px (${(r.ratio * 100).toFixed(3)}%)</h2>${r.explanation ? `<p>Explained: ${r.explanation}</p>` : ""}
<div class="g"><figure><figcaption>Go</figcaption><img src="go/${r.file}"></figure><figure><figcaption>Client</figcaption><img src="client/${r.file}"></figure><figure><figcaption>Diff</figcaption><img src="diff/${r.file}"></figure></div></section>`).join("")}`);

    for (const r of rows) console.log(`${r.changed === 0 ? "same" : r.explanation ? "expl" : "DIFF"}  ${r.key.padEnd(28)} ${r.changed} px`);
    console.log(`report: ${path.join(reportDir, "index.html")}`);
    if (failures.length) throw new Error(`parity gate failed:\n${failures.join("\n")}`);
    console.log("PASS: 9 routes x 2 widths match the Go app (or are explained); focus rings verified by Tab walk.");
  } finally {
    await browser.close();
    goServer.kill("SIGTERM");
    spawnSync("docker", ["rm", "--force", container], { stdio: "ignore" });
    if (!process.env.PARITY_SKIP_BUILD) spawnSync("docker", ["image", "rm", "--force", image], { stdio: "ignore" });
  }
}
main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; });
