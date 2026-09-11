#!/usr/bin/env node

const assert = require("node:assert/strict");
const nodeCrypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { chromium, webkit } = require("../../workers/node_modules/playwright");

const repoRoot = path.resolve(__dirname, "../..");
const apiRoot = path.join(repoRoot, "api");
const webRoot = path.join(repoRoot, "web");
// Test-only Svix signing material; never use a production Resend webhook secret here.
const webhookSecret = "whsec_d2F1bmRlci1oYW5kb2ZmLXRlc3Qtc2VjcmV0";
const prefix = `waunder-handoff-${process.pid}`;
const image = `${prefix}:latest`;

function command(commandName, args, options = {}) {
  const result = spawnSync(commandName, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    env: { ...process.env, ...options.env },
  });

  if (result.status !== 0) {
    throw new Error(
      `${commandName} ${args.join(" ")} failed.\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }

  return result.stdout ?? "";
}

function start(commandName, args, options = {}) {
  const output = [];
  const child = spawn(commandName, args, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...options.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));

  return { child, output };
}

async function stop(process) {
  if (process.child.exitCode !== null || process.child.signalCode !== null) return;

  process.child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => process.child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);

  if (process.child.exitCode === null && process.child.signalCode === null) {
    process.child.kill("SIGKILL");
    await new Promise((resolve) => process.child.once("exit", resolve));
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not allocate a local port."));
        return;
      }

      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function waitForHttp(url, process) {
  const deadline = Date.now() + 30_000;
  let lastError;

  while (Date.now() < deadline) {
    if (process && process.child.exitCode !== null) {
      throw new Error(`Server exited while starting.\n${process.output.join("")}`);
    }

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for ${url}: ${lastError?.message ?? "no response"}`);
}

function request(port, method, pathname, headers = {}, body = "") {
  return new Promise((resolve, reject) => {
    const requestHeaders = {
      ...headers,
      "content-length": Buffer.byteLength(body),
    };
    const req = http.request(
      { hostname: "127.0.0.1", port, method, path: pathname, headers: requestHeaders },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            status: response.statusCode,
            body: Buffer.concat(chunks).toString(),
          });
        });
      },
    );
    req.once("error", reject);
    req.end(body);
  });
}

function signedEvent(label) {
  const eventID = `${prefix}-${label}-${Date.now()}`;
  const timestamp = Math.floor(Date.now() / 1_000).toString();
  const body = `{"data":{"email_id":"${eventID}","from":"handoff@example.test","subject":"Caddy raw-byte check"},"type":"email.received"}`;
  const signature = nodeCrypto
    .createHmac("sha256", Buffer.from(webhookSecret.slice("whsec_".length), "base64"))
    .update(`${eventID}.${timestamp}.${body}`)
    .digest("base64");

  return {
    eventID,
    body,
    headers: {
      "content-type": "application/json",
      "svix-id": eventID,
      "svix-timestamp": timestamp,
      "svix-signature": `v1,${signature}`,
    },
  };
}

async function startProxy(port, apiInternalURL) {
  const name = `${prefix}-caddy-${port}`;
  command("docker", [
    "run",
    "--detach",
    "--rm",
    "--name",
    name,
    "--network",
    "host",
    "--env",
    `PORT=${port}`,
    "--env",
    `API_INTERNAL_URL=${apiInternalURL}`,
    image,
  ]);

  try {
    await waitForHttp(`http://127.0.0.1:${port}/`);
  } catch (error) {
    const logs = spawnSync("docker", ["logs", name], { encoding: "utf8" });
    throw new Error(`${error.message}\n${logs.stdout ?? ""}${logs.stderr ?? ""}`, { cause: error });
  }

  return {
    async stop() {
      spawnSync("docker", ["rm", "--force", name], { stdio: "ignore" });
    },
  };
}

async function withCaptureServer(callback) {
  let resolveRequest;
  const received = new Promise((resolve) => {
    resolveRequest = resolve;
  });
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      resolveRequest({ headers: request.headers, body: Buffer.concat(chunks) });
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"status":"captured"}');
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address !== "string", "capture server must have a TCP port");
  try {
    return await callback(address.port, received);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function railsRunner(source, env = {}) {
  return command("bin/rails", ["runner", "-e", "test", source], {
    cwd: apiRoot,
    env: { RAILS_ENV: "test", ...env },
  });
}

function pauseIntake() {
  const output = railsRunner(`
    existing = IntakeControl.find_by(id: 1)
    puts "HANDOFF_INTAKE=#{existing ? existing.enabled? : "none"}"
    (existing || IntakeControl.create!(id: 1)).update!(enabled: false)
  `);
  const state = output.match(/HANDOFF_INTAKE=(true|false|none)/)?.[1];
  if (!state) throw new Error(`Could not read intake state.\n${output}`);
  return state;
}

function restoreIntake(state) {
  const source =
    state === "none"
      ? "IntakeControl.find_by(id: 1)&.destroy!"
      : `IntakeControl.current.update!(enabled: ${state})`;
  railsRunner(source);
}

function assertInboundEmail(event) {
  railsRunner(
    `
      row = InboundEmail.find_by!(event_id: ENV.fetch("HANDOFF_EVENT_ID"))
      expected = JSON.parse(ENV.fetch("HANDOFF_PAYLOAD"))
      raise "raw payload changed" unless row.raw_payload == expected
      raise "expected held intake state" unless row.intake_state == "held"
      puts "HANDOFF_INBOUND_EMAIL=#{row.id}"
    `,
    { HANDOFF_EVENT_ID: event.eventID, HANDOFF_PAYLOAD: event.body },
  );
}

function deleteInboundEmail(eventID) {
  railsRunner("InboundEmail.where(event_id: ENV.fetch(\"HANDOFF_EVENT_ID\")).delete_all", {
    HANDOFF_EVENT_ID: eventID,
  });
}

async function verifyWebhookHandoff() {
  await withCaptureServer(async (capturePort, received) => {
    const proxyPort = await freePort();
    const proxy = await startProxy(proxyPort, `http://127.0.0.1:${capturePort}`);
    const event = signedEvent("capture");

    try {
      const response = await request(proxyPort, "POST", "/webhooks/resend/inbound", event.headers, event.body);
      assert.equal(response.status, 200, "Caddy must proxy the capture request");

      const captured = await received;
      assert.deepEqual(captured.body, Buffer.from(event.body), "Caddy must not rewrite the raw webhook body");
      for (const [header, value] of Object.entries(event.headers)) {
        assert.equal(captured.headers[header], value, `Caddy must preserve ${header}`);
      }
    } finally {
      await proxy.stop();
    }
  });

  const event = signedEvent("rails");
  const priorIntakeState = pauseIntake();
  const railsPort = await freePort();
  const proxyPort = await freePort();
  const rails = start("bin/rails", ["server", "-e", "test", "-b", "0.0.0.0", "-p", `${railsPort}`], {
    cwd: apiRoot,
    env: { RAILS_ENV: "test", RESEND_WEBHOOK_SECRET: webhookSecret },
  });
  let proxy;

  try {
    await waitForHttp(`http://127.0.0.1:${railsPort}/api/health`, rails);
    proxy = await startProxy(proxyPort, `http://127.0.0.1:${railsPort}`);
    const response = await request(proxyPort, "POST", "/webhooks/resend/inbound", event.headers, event.body);

    assert.equal(response.status, 200, `Signed Resend replay was rejected: ${response.body}`);
    assert.deepEqual(JSON.parse(response.body), { status: "held" });
    assertInboundEmail(event);
  } finally {
    if (proxy) await proxy.stop();
    await stop(rails);
    try {
      deleteInboundEmail(event.eventID);
      restoreIntake(priorIntakeState);
    } catch (error) {
      console.error(`Webhook fixture cleanup failed: ${error.message}`);
    }
  }
}

async function verifyWorkerHandoff(browserName, browserType) {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `waunder-handoff-${browserName}-`));
  const legacy = start("./bin/server", [], {
    cwd: webRoot,
    env: { PORT: `${port}`, API_INTERNAL_URL: "" },
  });
  let context;
  let proxy;

  try {
    await waitForHttp(origin, legacy);
    context = await browserType.launchPersistentContext(profile, { headless: true });
    const page = await context.newPage();
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      async () => (await navigator.serviceWorker.getRegistration())?.active?.scriptURL.endsWith("/app-worker.js") ?? false,
      undefined,
      { timeout: 30_000 },
    );
    const legacyCacheKeys = await page.waitForFunction(
      async () => {
        const keys = await caches.keys();
        return keys.length > 0 ? keys : false;
      },
      undefined,
      { timeout: 30_000 },
    );
    const legacyCaches = await legacyCacheKeys.jsonValue();

    await stop(legacy);
    proxy = await startProxy(port, "http://127.0.0.1:1");

    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) throw new Error("Legacy worker registration disappeared before update");
      await registration.update();
    });
    await page.waitForFunction(
      async (oldCaches) => {
        const registration = await navigator.serviceWorker.getRegistration();
        const cacheKeys = await caches.keys();
        return (
          !registration?.active?.scriptURL.endsWith("/app-worker.js") &&
          oldCaches.every((cacheKey) => !cacheKeys.includes(cacheKey))
        );
      },
      legacyCaches,
      { timeout: 30_000 },
    );
    await page.waitForFunction(
      () => Array.from(document.scripts).some((script) => script.src.includes("/assets/")),
      undefined,
      { timeout: 30_000 },
    );
  } finally {
    if (proxy) await proxy.stop();
    await stop(legacy);
    if (context) await context.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

async function main() {
  command("docker", ["build", "--tag", image, "--file", "deploy/railway-web.Dockerfile", "."]);
  command("make", ["wasm", "server"], { cwd: webRoot });

  try {
    await verifyWebhookHandoff();
    await verifyWorkerHandoff("chromium", chromium);
    await verifyWorkerHandoff("webkit", webkit);
    console.log(
      "PASS: Caddy preserved a signed Resend replay into Rails; Chromium and WebKit retired the legacy worker and its caches.",
    );
  } finally {
    spawnSync("docker", ["image", "rm", "--force", image], { stdio: "ignore" });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
