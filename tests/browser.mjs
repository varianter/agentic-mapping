import { chromium } from 'playwright';
import { createApp } from '../server/app.tsx';
import { memoryStore } from '../server/store.ts';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { checkParticipantFlow } from './participant-browser.mjs';
import { checkSelfFlow, checkSelfWithoutScripts } from './self-browser.mjs';

const directory = mkdtempSync(join(tmpdir(), 'mapping-browser-'));
const adminKey = 'browser-admin-key-0123456789-abcdefgh';
// Always in-memory: never reads KV variables or contacts Upstash.
const store = memoryStore();
const { app } = createApp({ store, adminKey });
const server = Bun.serve({ port: 0, fetch: app.fetch });
const baseURL = `http://localhost:${server.port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true });
const errors = [];
const interviewURL = /\/interviews\/[0-9a-f-]{36}$/;
// Interviewers sign in through the form, which sets the HttpOnly admin cookie.
async function signIn(page) {
  await page.goto(`${baseURL}/sign-in`);
  await page.locator('#key').fill(adminKey);
  await page.locator('button[type="submit"]').click();
  // The list opens the most recent interview, if there is one.
  await page.waitForURL(/\/interviews(\/[0-9a-f-]{36})?$/);
}
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
context.setDefaultTimeout(12000);
const page = await context.newPage();
// Until the legacy participant page opts in too, leaving a view-transition page for it aborts the transition.
page.on('pageerror', (error) => { if (!error.message.includes('ViewTransition opt-in disabled')) errors.push(error.message); });
const status = page.locator('#save-status');
const waitSaved = (target = page) => target.waitForFunction(() => document.getElementById('save-status').textContent === 'Saved to server');
const ready = (target = page) => target.locator('autosave-form[data-ready]').waitFor();
try {
  // A wrong key keeps the visitor out.
  await page.goto(`${baseURL}/sign-in`);
  await page.locator('#key').fill('wrong-admin-key-0123456789-abcdefgh');
  await page.locator('button[type="submit"]').click();
  await page.locator('[role="alert"]').waitFor();
  assert.equal((await context.cookies()).length, 0);
  await signIn(page);
  const [cookie] = await context.cookies();
  assert.equal(cookie.name, 'am_admin');
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, 'Strict');
  assert.notEqual(cookie.value, adminKey);
  assert.equal(await page.evaluate(() => document.cookie), '');
  await page.locator('#empty').waitFor({ state: 'visible' });
  await page.locator('#empty button[type="submit"]').click();
  await page.waitForURL(interviewURL);
  await ready();
  const id = new URL(page.url()).pathname.split('/').pop();
  await page.locator('[name="name"]').fill('Cross-device interview');
  await page.locator('[name="ind_learn_start"]').fill('First saved notes');
  await waitSaved();
  await page.reload();
  assert.equal(await page.locator('[name="name"]').inputValue(), 'Cross-device interview');
  assert.equal(await page.locator(`#sheet-list a[data-id="${id}"]`).getAttribute('aria-current'), 'page');
  assert.equal(await page.locator(`#sheet-list a[data-id="${id}"] .sheet-name`).textContent(), 'Cross-device interview');
  await page.locator('#tab-team').click();
  await page.locator('[name="team_why_next"]').fill('Team notes');
  await page.locator('label.chip', { hasText: 'UX' }).click();
  await waitSaved();
  await page.locator('#tab-org').click();
  await page.locator('[name="org_found_good"]').fill('Organization notes');
  await waitSaved();
  assert.deepEqual((await store.get(`sheet:${id}`)).fields.discipline, ['UX']);
  console.log('Basic create/reload/dimensions passed');

  // A second browser sees the persisted notes; its stale edit conflicts and keeps the typed draft.
  const secondContext = await browser.newContext();
  secondContext.setDefaultTimeout(12000);
  const second = await secondContext.newPage();
  await signIn(second);
  await second.goto(`${baseURL}/interviews/${id}`);
  await ready(second);
  assert.equal(await second.locator('[name="name"]').inputValue(), 'Cross-device interview');
  await page.locator('[name="name"]').fill('Newer from first device');
  await waitSaved();
  await second.locator('[name="name"]').fill('Stale device draft');
  await second.waitForFunction(() => document.getElementById('save-status').textContent.includes('Another device changed'));
  assert.equal(await second.locator('[name="name"]').inputValue(), 'Stale device draft');
  assert.equal(await second.locator('#save-status').getAttribute('data-state'), 'error');
  second.once('dialog', (dialog) => dialog.accept());
  await second.reload();
  assert.equal(await second.locator('[name="name"]').inputValue(), 'Newer from first device');
  await secondContext.close();
  console.log('Cross-device conflict passed');

  // A network failure leaves the draft in place; coming back online saves it.
  await context.setOffline(true);
  await page.locator('[name="name"]').fill('Recovered after offline');
  await page.waitForFunction(() => document.getElementById('save-status').dataset.state === 'error');
  assert.equal(await page.locator('[name="name"]').inputValue(), 'Recovered after offline');
  await context.setOffline(false);
  await page.locator('[name="name"]').press('End');
  await page.keyboard.type('!');
  await waitSaved();
  assert.equal((await store.get(`sheet:${id}`)).fields.name, 'Recovered after offline!');
  console.log('Offline retry passed');

  // Typing during an in-flight save must submit a second snapshot and revision.
  let delayed = true;
  let firstWrite;
  const writeStarted = new Promise((resolve) => { firstWrite = resolve; });
  await page.route(`**/interviews/${id}`, async (route) => {
    if (route.request().method() === 'POST' && delayed) {
      delayed = false;
      const response = await route.fetch();
      firstWrite();
      await new Promise((resolve) => setTimeout(resolve, 700));
      await route.fulfill({ response });
    } else await route.continue();
  });
  await page.locator('[name="name"]').fill('Older snapshot');
  await writeStarted;
  await page.locator('[name="name"]').fill('Latest snapshot');
  await waitSaved();
  await page.unroute(`**/interviews/${id}`);
  await page.reload();
  assert.equal(await page.locator('[name="name"]').inputValue(), 'Latest snapshot');
  console.log('Overlapping edits passed');

  // Unknown IDs never open an unrelated interview.
  const missing = await page.goto(`${baseURL}/interviews/${crypto.randomUUID()}`);
  assert.equal(missing.status(), 404);
  assert.equal(await page.locator('#sheet').count(), 0);
  await page.locator(`#sheet-list a[data-id="${id}"]`).click();
  await page.waitForURL(`${baseURL}/interviews/${id}`);
  assert.equal(await page.locator('[name="name"]').inputValue(), 'Latest snapshot');
  if (process.env.UPDATE_EVIDENCE === '1') {
    const evidence = join(import.meta.dir, '../docs/evidence');
    mkdirSync(evidence, { recursive: true });
    await page.screenshot({ path: join(evidence, 'persistent-storage.png'), fullPage: true });
  }
  await page.emulateMedia({ media: 'print' });
  assert.equal(await page.locator('.sidebar').isVisible(), false);
  assert.equal(await page.locator('.toolbar').isVisible(), false);
  assert.equal(await page.locator('#connect-link').isVisible(), false);
  for (const dimension of ['ind', 'team', 'org']) assert.equal(await page.locator(`#panel-${dimension}`).isVisible(), true);
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => {
    window.print = () => { window.printed = document.title; dispatchEvent(new Event('afterprint')); };
  });
  await page.locator('print-button button').click();
  await page.waitForFunction(() => window.printed);
  assert.match(await page.evaluate(() => window.printed), /^Interview - Latest snapshot - \d{4}-\d{2}-\d{2}$/);

  // A sheet removed on another device leaves its unsaved draft on the page.
  const revision = (await store.get(`sheet:${id}`)).revision;
  const removed = await page.request.post(`${baseURL}/interviews/${id}/delete`, { form: { revision: String(revision) }, headers: { Origin: baseURL } });
  assert.equal(removed.status(), 200);
  assert.equal(await store.get(`sheet:${id}`), null);
  await page.locator('[name="name"]').fill('Draft after remote deletion');
  await page.waitForFunction(() => document.getElementById('save-status').textContent.includes('deleted on another device'));
  assert.equal(await page.locator('[name="name"]').inputValue(), 'Draft after remote deletion');
  page.once('dialog', (dialog) => dialog.accept());
  await page.goto(`${baseURL}/interviews`);
  await page.locator('#empty').waitFor({ state: 'visible' });

  // Phones: the list is a popover from the toolbar; deleting goes through a native dialog.
  await page.locator('#empty button[type="submit"]').click();
  await page.waitForURL(interviewURL);
  await ready();
  const phoneId = new URL(page.url()).pathname.split('/').pop();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.equal(await page.locator('#sidebar').isVisible(), false);
  await page.locator('.sidebar-toggle').click();
  await page.locator('#upload-file').waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#sidebar').isVisible(), false);
  await page.locator('[commandfor="confirm-delete"][command="show-modal"]').click();
  await page.locator('#confirm-delete').waitFor({ state: 'visible' });
  await page.locator('#confirm-delete [command="close"]').click();
  assert.equal(await store.get(`sheet:${phoneId}`) !== null, true);
  await page.locator('[name="name"]').fill('Deleted from the dialog');
  await page.locator('[commandfor="confirm-delete"][command="show-modal"]').click();
  await page.locator('#confirm-delete button[type="submit"]').click();
  await page.waitForURL(`${baseURL}/interviews`);
  assert.equal(await store.get(`sheet:${phoneId}`), null);
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.deepEqual(errors, []);
  await checkParticipantFlow({ browser, context, baseURL, directory, store });

  // Self-submitted maps are listed on the admin-only /submissions page, not among interviews.
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  await visitor.goto(baseURL);
  await visitor.locator('autosave-form[data-ready]').waitFor();
  await visitor.locator('[name="advice"]').fill('Synthetic submitted advice');
  await waitSaved(visitor);
  await visitor.goto(`${baseURL}/submissions`);
  await visitor.waitForURL(`${baseURL}/sign-in`);
  await visitorContext.close();
  const submittedId = (await Promise.all((await store.keys('sheet:')).map((key) => store.get(key)))).find((sheet) => sheet.source === 'self').id;
  await page.goto(`${baseURL}/interviews`);
  assert.equal(await page.locator(`#sheet-list a[data-id="${submittedId}"]`).count(), 0);
  await page.locator('#view-switch').click();
  await page.waitForURL(`${baseURL}/submissions/${submittedId}`);
  assert.equal(await page.locator('[name="advice"]').inputValue(), 'Synthetic submitted advice');
  assert.equal(await page.locator('#sheet-list-label').textContent(), 'Self-submitted maps');
  assert.equal(await page.locator('#sidebar form[action="/interviews"]').count(), 0);
  await ready();
  await page.locator('[commandfor="confirm-delete"][command="show-modal"]').click();
  await page.locator('#confirm-delete button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname.startsWith('/submissions') && !url.pathname.endsWith(submittedId));
  assert.equal(await store.get(`sheet:${submittedId}`), null);
  console.log('Submissions page passed');

  // Uploading a store dump adds its interviews and self-submitted maps without overwriting anything.
  const uploaded = { id: crypto.randomUUID(), fields: { name: 'Uploaded interview', ind_learn_start: 'Synthetic uploaded notes' }, createdAt: 1, updatedAt: 2, revision: 9 };
  const uploadedSelf = { ...uploaded, id: crypto.randomUUID(), source: 'self', fields: { advice: 'Synthetic uploaded advice' } };
  const dumpPath = join(directory, 'store.json');
  await Bun.write(dumpPath, JSON.stringify({
    [`sheet:${uploaded.id}`]: { value: JSON.stringify(uploaded) },
    [`sheet:${uploadedSelf.id}`]: { value: JSON.stringify(uploadedSelf) },
    [`link:${'a'.repeat(64)}`]: { value: JSON.stringify({ sheetId: uploaded.id }) },
  }));
  await page.goto(`${baseURL}/interviews`);
  await page.locator('#upload-file').setInputFiles(dumpPath);
  await page.locator('#upload-file ~ button[type="submit"]').click();
  assert.equal(await page.locator('#notice-text').textContent(), 'Uploaded 2 of 2 sheets. 1 of them are self-submitted maps.');
  await page.locator(`#sheet-list a[data-id="${uploaded.id}"]`).click();
  assert.equal(await page.locator('[name="ind_learn_start"]').inputValue(), 'Synthetic uploaded notes');
  assert.equal((await store.get(`sheet:${uploadedSelf.id}`)).source, 'self');
  // A second upload of a changed copy skips it rather than overwriting.
  await Bun.write(dumpPath, JSON.stringify([{ ...uploaded, fields: { name: 'Changed copy' } }]));
  await page.locator('#upload-file').setInputFiles(dumpPath);
  await page.locator('#upload-file ~ button[type="submit"]').click();
  assert.match(await page.locator('#notice-text').textContent(), /Uploaded 0 of 1 sheets\. 1 skipped: a different sheet with that ID exists\./);
  assert.equal((await store.get(`sheet:${uploaded.id}`)).fields.name, 'Uploaded interview');
  await Bun.write(dumpPath, 'not json');
  await page.locator('#upload-file').setInputFiles(dumpPath);
  await page.locator('#upload-file ~ button[type="submit"]').click();
  assert.match(await page.locator('#notice-text').textContent(), /isn’t a store or Download JSON file/);
  console.log('Upload passed');

  // Signing out returns to My map; the interview list is gone.
  await page.goto(`${baseURL}/interviews`);
  await page.locator('#sign-out').click();
  await page.waitForURL(`${baseURL}/`);
  await page.locator('[commandfor="confirm-clear"][command="show-modal"]').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#sidebar').count(), 0);
  assert.equal((await context.cookies()).length, 0);
  assert.equal((await page.request.get(`${baseURL}/interviews`, { maxRedirects: 0 })).status(), 303);

  await checkSelfFlow({ browser, baseURL, directory, store });
  const selfOnly = Bun.serve({ port: 0, fetch: createApp({ store: memoryStore() }).app.fetch });
  try {
    const selfOnlyURL = `http://localhost:${selfOnly.port}`;
    await checkSelfFlow({ browser, baseURL: selfOnlyURL, directory, adminEnabled: false });
    await checkSelfWithoutScripts({ browser, baseURL: selfOnlyURL });
    for (const path of ['/sign-in', '/participant', '/interviews', '/submissions']) assert.equal((await fetch(`${selfOnlyURL}${path}`)).status, 404);
  } finally {
    selfOnly.stop(true);
  }
  assert.deepEqual(errors, []);
  console.log('Browser passed: cookie sign-in, create, autosave/reload, dimensions, cross-device conflicts, offline retry, overlapping edits, missing IDs, print, remote deletion, phone popover, delete dialog, submissions, upload, sign-out, self mode; no page errors.');
} catch (error) {
  console.log('Browser failure status:', await status.textContent({ timeout: 1000 }).catch(() => '(page unavailable)'), errors);
  throw error;
} finally {
  await browser.close();
  server.stop(true);
  rmSync(directory, { recursive: true, force: true });
}
