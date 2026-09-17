---
name: apply-session
description: Run a supervised, local, headed-browser job application session over Waunder's un-applied queue (oldest intake first) — batch approval, one browser job at a time, forms parked before submit for the owner, then status written back to Rails. Use when the owner asks to apply to jobs, start/continue an apply session, or work through the application queue.
version: 1.0.0
---

# Apply Session

A supervised application session that runs **on the owner's machine** in a headed Playwright
browser. Railway is touched only to read the queue and write the final status. This path does not
use the Rails trusted-submit dispatcher or the `workers/` service (see RESOLVED-27 in
`docs/DECISIONS.md`).

## Non-negotiables

- **The owner clicks every final Submit and every CAPTCHA.** Agents fill and park; they never submit.
- **Nothing is filled without batch approval** of that specific job in this session.
- **Rails writes only through `scripts/waunder-api.sh`**, only `applied` (after the owner confirms a
  submit) or `remove` (owner declined). Never `POST /api/applications/:id/submit`, never draft
  creation, never scoring. Never retry a write.
- Personal answers live in `.apply-session/answers.local.json` (gitignored). Never copy them into
  the repo, docs, commits, memory, or chat beyond what the owner is reviewing.
- Never print `APP_SHARED_SECRET`; the helper reads it from `api/.env`.

## Setup (once per session)

1. Confirm `.apply-session/answers.local.json` and `.apply-session/Aden_Guo_Resume.pdf` exist. If the
   CV is missing or older than `../My_Portfolio/public/cv.pdf`, copy that file to it. If the answers
   file is missing, stop and ask the owner for their standing answers.
2. `.agents/skills/apply-session/scripts/waunder-api.sh login`
3. The browser must be a **headed Playwright MCP with persisted logins**. Codex's configured
   `playwright` server runs with `--extension`, which drives the owner's own Chrome through the
   Playwright MCP Bridge extension (install it if the first call fails). If a site shows a sign-in
   wall, ask the owner to log in in that browser. File uploads must come from inside the repo, so
   keep the CV and cover letters under `.apply-session/`.

## Loop

Batch size is **5** unless the owner says otherwise. Start point is always the oldest un-applied
open job (the helper's `queue` order).

1. **Queue:** `waunder-api.sh queue <N>`.
2. **Batch approval:** show one compact line per job — id, title, company, source, lifecycle
   (`backlog` is included), compensation, score — and ask per job: **Approve** (fill),
   **Decline** (set removed), or **Skip** (untouched, excluded from later queues this machine).
   Ask in one message as a numbered list and accept a compact reply such as
   `1 approve, 2 decline, 3 skip, 4 approve, 5 approve`. Do not act on a job the reply omits.
3. **Apply decisions:** `waunder-api.sh remove ID` for declines, `waunder-api.sh skip ID` for skips.
4. **Fill approved jobs one at a time** (see Delegation). Each ends `ready`, `closed`, or `blocked`.
   - `closed` → tell the owner and suggest `remove`; do not remove without their word.
   - `blocked` → relay the reason; if the owner resolves it (e.g. logs in), resume the same job.
5. **Review handoff:** after each `ready` job, post a short summary to the owner: tab, ATS, anything
   written (quote short answers), and every `flag`. Keep filling the next approved job while the
   owner reviews — do not wait on them.
6. **Confirm submits:** when the owner says a job was submitted, run `waunder-api.sh applied ID`.
   If they abandon it, ask whether to `remove` or `skip` it.
7. When the batch is done, report counts (applied / removed / skipped / pending review) and offer
   the next batch.

## Delegation (context preservation)

Browser snapshots are the main context cost, so the orchestrator should not drive the browser itself
when subagents are available.

- If this Codex session can spawn subagents, start **one** worker per approved job with the
  instruction: "Read `.agents/skills/apply-session/references/job-brief.md` and follow it exactly for
  this job:" followed by the job JSON and batch position. Wait for it to finish before spawning the next.
- **Strictly sequential.** One browser is shared; parallel browser workers collide, and pre-fetching
  work for jobs the owner may still decline wastes usage.
- Keep only the worker's returned JSON block and relay it to the owner.
- If a worker returns `blocked` for something the owner can fix, send the follow-up to that same
  worker rather than starting a new one, so it keeps its place in the form.
- Without subagents, follow the brief inline and save every snapshot to a file (`filename` under
  `.playwright-mcp/`), searching it with `grep`/`rg` instead of reading pages in full.

## Files

| Path | Purpose |
|---|---|
| `scripts/waunder-api.sh` | login / queue / job / applied / remove / skip |
| `scripts/render-cover-letter.cjs` | text → PDF via the `workers/` Playwright install |
| `references/job-brief.md` | per-job fill instructions and return contract |
| `.apply-session/` (repo root, gitignored) | answers, CV, cover letters, screenshots, cookies, `log.jsonl`, `skipped.txt` |
| `.playwright-mcp/` (repo root, gitignored) | saved browser snapshots |
