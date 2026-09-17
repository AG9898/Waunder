#!/usr/bin/env bash
# Deterministic Rails API helper for supervised local apply sessions.
#
#   waunder-api.sh login                 sign in with APP_SHARED_SECRET from api/.env (never printed)
#   waunder-api.sh queue [N]             next N (default 5) un-applied open jobs, oldest intake first,
#                                        excluding ids in .apply-session/skipped.txt
#   waunder-api.sh job ID                one job's detail (URLs, compensation, description excerpt)
#   waunder-api.sh applied ID            mark applied / waiting (only after the owner submitted)
#   waunder-api.sh remove ID             owner declined: lifecycle_state -> removed
#   waunder-api.sh skip ID               leave untouched in Rails; exclude from later queues locally
#   waunder-api.sh cleanup               owner ended the session: delete .apply-session/ contents
#                                        (except answers.local.json and the CV) and .playwright-mcp/
#
# Writes are sent exactly once and never retried: a replayed write is never safe to assume.
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
SESSION_DIR="$ROOT/.apply-session"
JAR="$SESSION_DIR/.cookies"
SKIPPED="$SESSION_DIR/skipped.txt"
LOG="$SESSION_DIR/log.jsonl"
BASE="${WAUNDER_BASE_URL:-https://web-production-9b240.up.railway.app}"
mkdir -p "$SESSION_DIR"

die() { echo "error: $*" >&2; exit 1; }
need_id() { [[ "${1:-}" =~ ^[0-9]+$ ]] || die "numeric job id required"; }
log() { jq -nc --arg a "$1" --argjson id "$2" --arg at "$(date -Iseconds)" '{at:$at, action:$a, job_post_id:$id}' >> "$LOG"; }

api_get() {
  local code body
  body="$(curl -sS -b "$JAR" -w $'\n%{http_code}' "$BASE$1")"
  code="${body##*$'\n'}"; body="${body%$'\n'*}"
  [[ "$code" == 401 ]] && die "session expired: run '$0 login'"
  [[ "$code" == 2* ]] || die "GET $1 -> HTTP $code"
  printf '%s' "$body"
}

api_patch() {
  local code
  code="$(curl -sS -b "$JAR" -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' \
    -X PATCH "$BASE$1" --data "$2")"
  [[ "$code" == 401 ]] && die "session expired: run '$0 login', then check the job in the PWA before re-sending"
  [[ "$code" == 2* ]] || die "PATCH $1 -> HTTP $code (not retried)"
}

case "${1:-}" in
  login)
    secret="$(grep -E '^APP_SHARED_SECRET=' "$ROOT/api/.env" | head -1 | cut -d= -f2- | sed 's/^"//;s/"$//')"
    [[ -n "$secret" ]] || die "APP_SHARED_SECRET missing from api/.env"
    code="$(jq -n --arg p "$secret" '{passphrase:$p}' | curl -sS -o /dev/null -w '%{http_code}' -c "$JAR" \
      -H 'Content-Type: application/json' -X POST "$BASE/api/session" --data @-)"
    chmod 600 "$JAR"
    [[ "$code" == 2* ]] || die "login -> HTTP $code"
    echo "logged in"
    ;;
  queue)
    want="${2:-5}"; page=1; ids=()
    while (( ${#ids[@]} < want )); do
      resp="$(api_get "/api/job_posts?status=all&state=open&application=not_applied&sort=oldest&page=$page")"
      while read -r id; do
        [[ -z "$id" ]] && continue
        [[ -f "$SKIPPED" ]] && grep -qx "$id" "$SKIPPED" && continue
        ids+=("$id"); (( ${#ids[@]} >= want )) && break
      done < <(jq -r '.job_posts[].id' <<<"$resp")
      [[ "$(jq -r '.page.has_next' <<<"$resp")" == true ]] || break
      page=$((page + 1))
    done
    for id in "${ids[@]}"; do "$0" job "$id"; done
    ;;
  job)
    need_id "${2:-}"
    api_get "/api/job_posts/$2" | jq -c '.job_post | {
      id, title, company, location, source, lifecycle_state, match_score, compensation,
      posting_url, application_url, source_url,
      description: ((.description // "") | .[0:400])
    }'
    ;;
  applied)
    need_id "${2:-}"
    api_patch "/api/job_posts/$2/application_status" \
      '{"application":{"pipeline_status":"applied","pipeline_stage":"waiting","pipeline_note":"Applied via supervised local apply session"}}'
    log applied "$2"; echo "job $2 marked applied/waiting"
    ;;
  remove)
    need_id "${2:-}"
    api_patch "/api/job_posts/$2/lifecycle" '{"job_post":{"lifecycle_state":"removed"}}'
    log removed "$2"; echo "job $2 set to removed"
    ;;
  skip)
    need_id "${2:-}"
    grep -qxs "$2" "$SKIPPED" || echo "$2" >> "$SKIPPED"
    log skipped "$2"; echo "job $2 skipped locally"
    ;;
  cleanup)
    find "$SESSION_DIR" -mindepth 1 -maxdepth 1 \
      ! -name answers.local.json ! -name Aden_Guo_Resume.pdf -exec rm -rf {} +
    rm -rf "$ROOT/.playwright-mcp"
    echo "session files removed (kept answers.local.json and Aden_Guo_Resume.pdf)"
    ;;
  *)
    sed -n '2,14p' "$0"; exit 1
    ;;
esac
