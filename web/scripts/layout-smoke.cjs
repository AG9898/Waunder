// Run against the local web server on :8094 after `make wasm server`.
// All API traffic is fulfilled with fixtures; no Rails, LLM, or submit worker is used.
const { chromium } = require('../../workers/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'waunder-layout-'));
  const browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH && {executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}),
  });
  try {
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}, serviceWorkers: 'block'});
    const writes = [];
    let failStatus = false;
    const job = {
      id: 7, title: 'Senior Software Engineer, Developer Experience', company: 'Example Systems', source: 'linkedin',
      match_score: 88, scoring_status: 'scored', lifecycle_state: 'active', compensation: '$130,000–$170,000',
      summary: 'Build tools that help product teams deliver reliable software. Work across platform services, internal tooling, and developer workflows.',
      relevant_requirements: ['Go and Ruby backend development', 'Developer tooling and distributed systems'],
      missing_requirements: ['Production Kubernetes experience'], red_flags: ['Confirm on-call expectations'],
      resume_alignment_notes: 'Highlight platform ownership and experience simplifying complex systems.',
      application_strategy: 'Lead with a concrete example of improving developer productivity.',
      posting_url: 'https://example.invalid/apply', route: {route_type: 'unknown', recommended_route: 'manual'},
    };
    const tracker = {application_id: 9, job_post_id: 7, job_title: job.title, company: job.company, pipeline_status: 'interested', automation_status: 'draft'};
    const draft = {application_id: 9, job_title: job.title, company: job.company, status: 'draft', draft_ready: true,
      cover_letter: 'Dear hiring team,\n\nI build tools that make engineering teams more effective.',
      resume_emphasis_notes: 'Highlight platform ownership.', structured_answers: [{field: 'Why this role?', value: 'I enjoy building useful developer tools.'}],
      autofill_payload: {ats: 'manual', apply_url: job.posting_url, answers: []}};
    await context.route('**/api/**', async route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (request.method() !== 'GET') {
        writes.push({path: pathname, body: request.postDataJSON()});
        if (failStatus) return route.fulfill({status: 500, json: {error: {code: 'test_failure'}}});
        Object.assign(tracker, request.postDataJSON().application);
        if (!tracker.pipeline_stage && tracker.pipeline_status === 'applied') tracker.pipeline_stage = 'waiting';
        job.application = tracker;
        return route.fulfill({json: {application: tracker}});
      }
      let data = {};
      if (pathname === '/api/job_posts') data = {job_posts: [job, {...job, id: 8, title: 'Backend Engineer', source: 'glassdoor', match_score: 68}], page: {number: 1, size: 30, total: 2}};
      if (pathname === '/api/job_posts/7') data = {job_post: job};
      if (pathname === '/api/applications') data = {applications: [tracker]};
      if (pathname === '/api/applications/9') data = {application: draft};
      if (pathname === '/api/profile') data = {profile: {full_name: 'Example User', headline: 'Software engineer', summary: 'Building useful tools', contact: {email_present: true}}};
      if (pathname.endsWith('/contact_candidates')) data = {contact_candidates: [{id: 1, name: 'Example Contact', title: 'Engineering Manager', relevance_reason: 'Leads the hiring team'}]};
      if (pathname === '/api/intake') data = {intake: {enabled: true}};
      if (pathname === '/api/ingestion_batches') data = {batches: [{id: 'fixture', source: 'linkedin', date: '2026-09-08', count: 1, jobs: [job]}], page: {number: 1, total: 1}};
      await route.fulfill({json: data});
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const visit = async route => {
      await page.goto('http://localhost:8094' + route);
      await page.waitForFunction(() => document.querySelector('.layout-select') && document.documentElement.dataset.layout);
      await page.waitForFunction(() => !document.querySelector('.load-loading'));
    };
    const navPosition = () => page.locator('.app-tabs').evaluate(el => getComputedStyle(el).position);
    const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `overflow at ${page.url()}`);
    await visit('/jobs');
    assert.equal(await navPosition(), 'static');
    await page.selectOption('.layout-select', 'mobile');
    await page.waitForFunction(() => document.documentElement.dataset.layout === 'mobile');
    assert.equal(Math.round((await page.locator('.job-list').boundingBox()).width), 560);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('.layout-select')?.value === 'mobile');
    await page.locator('.app-tab').filter({hasText: 'Applications'}).click();
    await page.waitForURL('**/applications');
    await page.waitForFunction(() => document.querySelector('.layout-select')?.value === 'mobile');
    assert.equal(await page.locator('.layout-select').inputValue(), 'mobile');
    await page.selectOption('.layout-select', 'auto');
    await page.waitForFunction(() => document.documentElement.dataset.layout === 'auto');
    for (const width of [1440, 960, 768, 390, 320]) {
      await page.setViewportSize({width, height: 900});
      for (const route of ['/jobs', '/jobs/7', '/', '/applications', '/applications/9', '/profile', '/jobs/new', '/jobs/7/contacts']) {
        await visit(route);
        await noOverflow();
        assert.equal(await navPosition(), width >= 960 ? 'static' : 'fixed');
        if (route === '/jobs/7') {
          await page.locator('.job-assessment').waitFor();
          const main = await page.locator('.job-assessment').boundingBox();
          const primary = await page.locator('.manual-application').boundingBox();
          assert.equal(primary.x > main.x, width >= 960, 'assessment and actions layout');
          if (width < 960) {
            assert.ok(primary.y < main.y, 'mobile keeps the application link above the assessment');
            assert.ok((await page.locator('.job-pipeline-status').boundingBox()).y > main.y, 'mobile keeps secondary tracking below the assessment');
          }
        }
        if ([1440, 390].includes(width)) await page.screenshot({path: path.join(artifacts, `${width}-${route.replaceAll('/', '_') || 'intake'}.png`), fullPage: true});
        if (route === '/applications') {
          await page.getByRole('button', {name: 'All jobs', exact: true}).click();
          await page.locator('.jobs-table').waitFor();
          await noOverflow();
        }
      }
    }
    assert.equal(writes.length, 0, 'navigation and layout must never mutate application data');
    await page.setViewportSize({width: 390, height: 844});
    await visit('/jobs/7');
    await page.selectOption('.layout-select', 'desktop');
    await page.waitForFunction(() => document.documentElement.dataset.layout === 'desktop');
    await noOverflow();
    await page.selectOption('.layout-select', 'auto');
    failStatus = true;
    await page.getByRole('button', {name: 'Mark as applied'}).click();
    await page.locator('.job-pipeline-error').waitFor();
    assert.equal(await page.getByRole('button', {name: 'Mark as applied'}).isEnabled(), true);
    failStatus = false;
    await page.getByRole('button', {name: 'Mark as applied'}).click();
    await page.locator('.manual-tracker-current').filter({hasText: 'Applied · Waiting'}).waitFor();
    assert.deepEqual(writes.at(-1), {path: '/api/job_posts/7/application_status', body: {application: {pipeline_status: 'applied', pipeline_stage: 'waiting'}}});
    await page.selectOption('.pipeline-status-select', 'interviewing');
    await page.waitForFunction(() => document.querySelector('.job-tracker-current')?.textContent === 'Interviewing');
    await page.selectOption('.pipeline-stage-select', 'technical');
    await page.waitForFunction(() => document.querySelector('.job-tracker-current')?.textContent === 'Interviewing · Technical');
    await page.selectOption('.pipeline-stage-select', 'none');
    await page.waitForFunction(() => document.querySelector('.job-tracker-current')?.textContent === 'Interviewing');
    assert.equal(writes.at(-1).body.application.pipeline_stage, '');
    await visit('/applications/9');
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: async text => {window.copiedText = text;}}}));
    await page.getByRole('button', {name: 'Copy cover letter'}).click();
    await page.getByText('Copied.', {exact: true}).waitFor();
    assert.equal(await page.evaluate(() => window.copiedText), draft.cover_letter);
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: async () => {throw Error('blocked');}}}));
    await page.getByRole('button', {name: 'Copy cover letter'}).click();
    await page.getByText('Copy was blocked. Select the text and copy it manually.', {exact: true}).waitFor();
    assert.equal(await page.locator('.draft-automation').getAttribute('open'), null);
    assert.equal(writes.some(w => w.path.includes('/submit') || w.path === '/api/applications'), false);
    assert.deepEqual(errors, []);
    console.log(`PASS: layouts across eight screens and five widths; persistence, manual tracking, copy success/failure, and no automatic writes. Screenshots: ${artifacts}`);
  } finally {
    await browser.close();
  }
}
main().catch(error => {console.error(error); process.exitCode = 1;});
