#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

prefix="waunder-web-smoke-$$"
image="${prefix}:latest"
network="${prefix}-network"
backend="${prefix}-backend"
web="${prefix}-web"

cleanup() {
  docker rm --force "$web" "$backend" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  docker image rm --force "$image" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker build --tag "$image" --file deploy/railway-web.Dockerfile .
docker network create "$network" >/dev/null

docker run --detach --rm --name "$backend" --network "$network" node:22-alpine node -e '
const http = require("node:http");

http
  .createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          method: request.method,
          url: request.url,
          host: request.headers.host ?? "",
          smokeHeader: request.headers["x-smoke-header"] ?? "",
          contentType: request.headers["content-type"] ?? "",
          body: Buffer.concat(chunks).toString(),
        }),
      );
    });
  })
  .listen(3000);
' >/dev/null

docker run --detach --rm --name "$web" --network "$network" \
  --publish 127.0.0.1::8080 \
  --env PORT=8080 \
  --env API_INTERNAL_URL="http://${backend}:3000" \
  "$image" >/dev/null

port_mapping="$(docker port "$web" 8080/tcp)"
port="${port_mapping##*:}"
base_url="http://127.0.0.1:${port}"

for attempt in {1..20}; do
  if curl --silent --show-error --fail "$base_url/" >/dev/null; then
    break
  fi

  if [[ "$attempt" == "20" ]]; then
    docker logs "$web"
    exit 1
  fi

  sleep 1
done

assert_proxy_request() {
  local response="$1"
  local method="$2"
  local path="$3"
  local host="$4"
  local header="$5"
  local body="$6"

  SMOKE_RESPONSE="$response" \
    EXPECTED_METHOD="$method" \
    EXPECTED_PATH="$path" \
    EXPECTED_HOST="$host" \
    EXPECTED_HEADER="$header" \
    EXPECTED_BODY="$body" \
    node -e '
const request = JSON.parse(process.env.SMOKE_RESPONSE);
const expected = {
  method: process.env.EXPECTED_METHOD,
  url: process.env.EXPECTED_PATH,
  host: process.env.EXPECTED_HOST,
  smokeHeader: process.env.EXPECTED_HEADER,
  contentType: "application/json",
  body: process.env.EXPECTED_BODY,
};

for (const [key, value] of Object.entries(expected)) {
  if (request[key] !== value) {
    throw new Error(`${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(request[key])}`);
  }
}
'
}

api_body='{"action":"score"}'
api_response="$(curl --silent --show-error --fail --request PATCH \
  --header 'Host: browser.waunder.test' \
  --header 'Content-Type: application/json' \
  --header 'X-Smoke-Header: api-preserved' \
  --data "$api_body" \
  "$base_url/api/jobs/42?include=body")"
assert_proxy_request "$api_response" "PATCH" "/api/jobs/42?include=body" \
  "browser.waunder.test" "api-preserved" "$api_body"

webhook_body='{"event":"received"}'
webhook_response="$(curl --silent --show-error --fail --request POST \
  --header 'Host: resend.waunder.test' \
  --header 'Content-Type: application/json' \
  --header 'X-Smoke-Header: webhook-preserved' \
  --data "$webhook_body" \
  "$base_url/webhooks/resend/inbound")"
assert_proxy_request "$webhook_response" "POST" "/webhooks/resend/inbound" \
  "resend.waunder.test" "webhook-preserved" "$webhook_body"

app_shell="$(curl --silent --show-error --fail "$base_url/jobs/123")"
if [[ "$app_shell" != *'<div id="root"></div>'* ]]; then
  printf 'SPA deep link did not return the app shell.\n' >&2
  exit 1
fi

legacy_worker="$(curl --silent --show-error --fail "$base_url/app-worker.js")"
if [[ "$legacy_worker" != *"self.skipWaiting"* ]]; then
  printf 'The legacy service worker was not served.\n' >&2
  exit 1
fi

assert_encoding() {
  local encoding="$1"
  local headers

  headers="$(curl --silent --show-error --fail --dump-header - --output /dev/null \
    --header "Accept-Encoding: ${encoding}" "$base_url/app.css")"
  if [[ "${headers,,}" != *"content-encoding: ${encoding}"* ]]; then
    printf 'Expected app.css to be %s compressed.\n' "$encoding" >&2
    exit 1
  fi
}

assert_encoding zstd
assert_encoding gzip

printf 'Caddy container smoke test passed.\n'
