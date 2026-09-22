# Job Brief — fill one approved application

You are filling ONE job application in a headed Playwright browser the owner is watching. The owner
already approved this job. Your job ends with the form filled and parked **before** its final
submit button. The orchestrator gives you: the job JSON from `waunder-api.sh job ID`, the path to
`.apply-session/answers.local.json`, and the batch number.

## Hard rules

- **Never click the final Submit / Send / Apply-now button.** The owner submits. Stopping one step
  early is correct; "Continue"/"Next" between pages is fine up to the final review page.
- Never solve or click CAPTCHAs ("I'm not a robot", reCAPTCHA, hCaptcha). Leave them for the owner.
- Never call the Waunder API and never change Rails data. You only report back.
- Only claim what the resume supports. Never inflate years of experience, titles, or scope. If an
  honest answer to a screener is weak (e.g. "0 years of negotiation"), give it and flag it.
- Never type passwords or create accounts. If a site needs a login you do not have, stop: `blocked`.
- Keep context small: save snapshots to files (`browser_snapshot` with `filename` under
  `.playwright-mcp/`) and search them with `grep`, instead of reading whole pages inline.

## Inputs you read

- `.apply-session/answers.local.json` — contact details come from the resume; demographics, work
  authorization, salary rule, relocation, work arrangement, start date, referral source, writing
  style, and cover-letter policy come from here. These are owner-approved: fill them without asking.
- `.apply-session/Aden_Guo_Resume.pdf` — the CV to upload. The Playwright MCP can only upload files
  under the repo root, which is why it lives there.
- The resume content: `../My_Portfolio/src/data/resume.json` (JSON Resume) when present, otherwise
  the text of the PDF. Use it for contact fields and for grounding anything you write.

## Steps

1. **Open the posting in a new tab** (`browser_tabs` action `new`) so earlier parked forms stay
   open for the owner. Use `application_url`, else `posting_url`.
2. **Reach the real form.**
   - LinkedIn: the Apply control is a link through `linkedin.com/safety/go/?url=<encoded>`. Decode
     `url` and navigate straight to it (usually Ashby/Greenhouse/Lever/Workday). If it is
     LinkedIn Easy Apply instead, work through the modal.
   - Glassdoor "Easy Apply" / "Apply" hands off to **Indeed Apply** (`smartapply.indeed.com`). The
     Indeed account may already hold a CV; if its upload date matches the current CV, keep it.
   - Cloudflare "Just a moment…" pages clear on their own: wait ~8 seconds.
   - If the posting says it is closed / no longer accepting applications: return `closed`.
3. **Read the job description** from the live page or the ATS public API (Ashby:
   `https://api.ashbyhq.com/posting-api/job-board/<org>`, Greenhouse:
   `https://boards-api.greenhouse.io/v1/boards/<org>/jobs/<id>`). Note location/remote rules,
   salary range, and one requirement that genuinely matches the resume.
4. **Upload the CV** to the resume field, and to any "autofill from resume" control.
5. **Verify every field yourself.** ATS autofill is unreliable — Ashby reported "Autofill
   completed" while leaving every field empty. Read values back (snapshot or `browser_evaluate`,
   ignoring hidden inputs such as CAPTCHA tokens) and fill anything empty or wrong.
6. **Answer questions** using `answers.local.json`:
   - Salary: no range → baseline; range whose lower end ≥ baseline → lower end; range whose lower
     end < baseline → midpoint. Apply the rule to hourly ranges in hourly terms.
   - Start date / notice: the configured offset from today, as a date or "2 months" as the field wants.
   - "How did you hear about us": the value for this job's `source`.
   - A question neither the answers file nor the resume can answer truthfully: pick the most honest
     option and list it under `flags`. Do not stop the fill for it.
   - **Exception: sensitive questions** (legal, criminal/background, government employment,
     employment restrictions, demographic/self-ID, religion, gender identity, disability,
     sponsorship, salary) are answered only from `answers.local.json`. If it has no answer, leave
     the question blank and flag it. Do not guess, and do not pick "Prefer not to say" for the
     owner. Leave required terms/consent checkboxes for the owner too.
   - Indeed Apply appears to hold one in-progress application per account. If another Indeed
     review page is already parked in this session, do not start a new Indeed flow: return
     `blocked` with `Indeed Apply pending`.
7. **Written answers and cover letters** follow `writing_style`: casual, short sentences, one
   specific posting requirement tied to real resume work, then growth (owner's and the company's),
   a team that shares the passion, and agentic development. No buzzwords, no polished-LLM cadence.
   - Cover letter as a file: write `.apply-session/<id>-<company-slug>-cover.txt`, then
     `node .agents/skills/apply-session/scripts/render-cover-letter.cjs <txt> .apply-session/Aden_Guo_Cover_Letter_<Company>.pdf`
     and upload the PDF.
   - Cover letter as a text box (Indeed): paste the same text.
   - Re-read the letter against the resume before attaching; fix any claim it does not support.
8. **Park before submit.** Advance to the final review page (or leave a single-page form filled).
   Take a full-page screenshot to `.apply-session/<id>-<company-slug>.png` and view it to confirm
   it shows the filled form, not a spinner.

## Return exactly this (and nothing else)

```json
{
  "job_post_id": 0,
  "result": "ready | closed | blocked",
  "tab": "browser tab index and title holding the parked form",
  "final_url": "",
  "ats": "ashby | greenhouse | lever | workday | indeed | linkedin_easy_apply | other",
  "filled": ["short list of fields/questions and the values used, sensitive ones summarized"],
  "written": {"why_interested": "full text if any", "cover_letter": "path or 'pasted'"},
  "flags": ["anything the owner should look at before submitting"],
  "blocked_reason": "",
  "screenshot": ".apply-session/<file>.png"
}
```
