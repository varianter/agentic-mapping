import { chromium } from 'playwright';
import { createApp } from '../server/app.ts';
import { memoryStore } from '../server/store.ts';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { checkParticipantFlow } from './participant-browser.mjs';
import { checkSelfFlow } from './self-browser.mjs';

const directory = mkdtempSync(join(tmpdir(), 'mapping-browser-'));
const adminKey = 'browser-admin-key-0123456789-abcdefgh';
// Always in-memory: never reads KV variables or contacts Upstash.
const store = memoryStore();
const { app } = createApp({ store, adminKey });
const server = Bun.serve({ port: 0, fetch: app.fetch });
const baseURL = `http://localhost:${server.port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true });
const errors = [];
// Interviewers sign in through the form, which sets the HttpOnly admin cookie.
async function signIn(page) {
  await page.goto(`${baseURL}/sign-in`);
  await page.locator('#key').fill(adminKey);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(`${baseURL}/`);
}
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
context.setDefaultTimeout(12000);
const page = await context.newPage();
page.on('pageerror', (error) => errors.push(error.message));
const status = page.locator('#save-status');
const waitSaved = () => page.waitForFunction(() => document.getElementById('save-status').textContent === 'Saved to server');
try {
  // A wrong key keeps the visitor in self mode.
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
  await page.locator('[data-action="new"]').first().click();
  await page.waitForFunction(() => !document.getElementById('sheet').inert);
  await page.locator('[name="name"]').fill('Cross-device interview');
  await page.locator('[name="ind_learn_start"]').fill('First saved notes');
  await waitSaved();
  const id = new URL(page.url()).hash.slice(1);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('[name="name"]').value === 'Cross-device interview');
  await page.locator('#tab-team').click();
  await page.locator('[name="team_why_next"]').fill('Team notes');
  await waitSaved();
  await page.locator('#tab-org').click();
  await page.locator('[name="org_found_good"]').fill('Organization notes');
  await waitSaved();

  console.log('Basic create/reload/dimensions passed');
  // A separate browser context sees persisted notes with the same interviewer identity.
  const secondContext = await browser.newContext();
  secondContext.setDefaultTimeout(12000);
  const second = await secondContext.newPage();
  await signIn(second);
  await second.goto(`${baseURL}/#${id}`);
  await second.waitForFunction(() => document.querySelector('[name="name"]').value === 'Cross-device interview');
  await page.locator('[name="name"]').fill('Newer from first device');
  await waitSaved();
  await second.locator('[name="name"]').fill('Stale device draft');
  await second.waitForFunction(() => document.getElementById('save-status').textContent.includes('Another device changed'));
  assert.equal(await second.locator('[name="name"]').inputValue(), 'Stale device draft');
  await second.locator('[name="name"]').fill('Stale draft after conflict');
  assert.equal(await second.locator('#save-status').getAttribute('data-state'), 'error');
  const draftDownload = second.waitForEvent('download');
  await second.locator('[data-action="export"]').click();
  const draftPath = join(directory, 'conflict-draft.json');
  await (await draftDownload).saveAs(draftPath);
  assert.equal((await Bun.file(draftPath).json())[0].fields.name, 'Stale draft after conflict');
  second.once('dialog', (dialog) => dialog.accept());
  await second.locator('[data-action="reload"]').click();
  await second.waitForFunction(() => document.querySelector('[name="name"]').value === 'Newer from first device');
  await secondContext.close();

  console.log('Cross-device conflict passed');
  // Network failure leaves the draft in place and offers an explicit retry.
  await context.setOffline(true);
  await page.locator('[name="name"]').fill('Recovered after offline');
  await page.waitForFunction(() => document.getElementById('save-status').dataset.state === 'error');
  assert.equal(await page.locator('[name="name"]').inputValue(), 'Recovered after offline');
  await context.setOffline(false);
  await page.locator('[data-action="retry"]').click();
  await waitSaved();

  console.log('Offline retry passed');
  // Typing during an in-flight save must submit a second snapshot and revision.
  let delayed = true;
  let firstWrite;
  const writeStarted = new Promise((resolve) => { firstWrite = resolve; });
  await page.route('**/api/sheets/*', async (route) => {
    if (route.request().method() === 'PUT' && delayed) {
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
  await page.unroute('**/api/sheets/*');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('[name="name"]').value === 'Latest snapshot');

  console.log('Overlapping edits passed');
  for (const path of ['/legacy.html', '/client/legacy.js']) assert.equal((await page.request.get(`${baseURL}${path}`)).status(), 404);
  assert.equal(await page.locator('#import-json').count(), 0);
  assert.equal(await page.locator('a[href="legacy.html"]').count(), 0);
  // Unknown hashes never open an unrelated interview.
  await page.goto(`${baseURL}/#${crypto.randomUUID()}`);
  await page.waitForFunction(() => document.getElementById('save-status').textContent.includes('Interview unavailable'));
  assert.equal(await page.locator('#sheet').isHidden(), true);
  await page.waitForFunction(() => !document.getElementById('sheet').inert);
  await page.locator(`#sheet-list a[data-id="${id}"]`).click();
  await page.waitForFunction(() => document.querySelector('[name="name"]').value === 'Latest snapshot');
  await page.waitForFunction(() => !document.getElementById('sheet').inert);
  if (process.env.UPDATE_EVIDENCE === '1') {
    const evidence = join(import.meta.dir, '../docs/evidence');
    mkdirSync(evidence, { recursive: true });
    await page.screenshot({ path: join(evidence, 'persistent-storage.png'), fullPage: true });
  }
  await page.emulateMedia({ media: 'print' });
  assert.equal(await page.locator('.sidebar').isVisible(), false);
  assert.equal(await page.locator('.toolbar').isVisible(), false);
  assert.equal(await page.locator('#panel-team').isVisible(), true);
  await page.emulateMedia({ media: 'screen' });
  // A sheet removed on another device leaves its unsaved draft recoverable.
  const removed = await page.evaluate(async (id) => {
    const saved = await (await fetch(`api/sheets/${id}`)).json();
    return (await fetch(`api/sheets/${id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: saved.revision }) })).status;
  }, id);
  assert.equal(removed, 204);
  await page.locator('[name="name"]').fill('Draft after remote deletion');
  await page.waitForFunction(() => document.getElementById('save-status').textContent.includes('Sheet unavailable'));
  const recoveryDownload = page.waitForEvent('download');
  await page.locator('[data-action="export"]').click();
  const recoveryPath = join(directory, 'deleted-draft.json');
  await (await recoveryDownload).saveAs(recoveryPath);
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('[data-action="reload"]').click();
  await page.locator('#sheet').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => !document.getElementById('sheet').inert);
  assert.match(await status.textContent(), /Interview unavailable\. Create a new interview or use your downloaded draft\.$/);
  assert.equal(await page.locator('[data-action="export"]').count() > 0, true);
  await page.locator('[data-action="new"]:visible').first().click();
  await page.waitForFunction(() => !document.getElementById('sheet').hidden && !document.getElementById('sheet').inert);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.locator('#toggle-sidebar').click();
  await page.locator('[data-action="upload"]').waitFor({ state: 'visible' });
  await page.locator('[data-action="upload"]').press('Escape');
  await page.locator('[data-action="delete"]').click();
  await page.locator('#confirm-delete [value="delete"]').click();
  await page.waitForFunction((id) => !document.querySelector(`#sheet-list a[data-id="${id}"]`), id);
  assert.deepEqual(errors, []);
  await checkParticipantFlow({ browser, context, baseURL, directory, store });

  // Self-submitted maps are listed on the admin-only /submissions page, not among interviews.
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  await visitor.goto(baseURL);
  await visitor.waitForFunction(() => !document.getElementById('sheet').hidden);
  await visitor.locator('[name="advice"]').fill('Synthetic submitted advice');
  await visitor.waitForFunction(() => document.getElementById('save-status').textContent === 'Saved to server');
  await visitor.goto(`${baseURL}/submissions`);
  await visitor.waitForURL(`${baseURL}/sign-in`);
  await visitorContext.close();
  const submittedId = (await Promise.all((await store.keys('sheet:')).map((key) => store.get(key)))).find((sheet) => sheet.source === 'self').id;
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(baseURL);
  await page.waitForFunction(() => !document.getElementById('sheet').inert && document.querySelectorAll('#sheet-list a').length > 0);
  assert.equal(await page.locator(`#sheet-list a[data-id="${submittedId}"]`).count(), 0);
  await page.locator('#view-switch').click();
  await page.waitForURL(`${baseURL}/submissions#${submittedId}`);
  await page.waitForFunction(() => document.querySelector('[name="advice"]').value === 'Synthetic submitted advice');
  assert.equal(await page.locator('#model-list-label').textContent(), 'Self-submitted maps');
  assert.equal(await page.locator('[data-action="new"]').count(), 0);
  assert.equal(await page.locator(`#sheet-list a[data-id="${submittedId}"]`).count(), 1);
  await page.locator('[data-action="delete"]').click();
  await page.locator('#confirm-delete [value="delete"]').click();
  await page.locator('#empty').waitFor({ state: 'visible' });
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
  await page.goto(baseURL);
  await page.waitForFunction(() => !document.querySelector('[data-action="upload"]').disabled);
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-action="upload"]').click();
  await (await chooser).setFiles(dumpPath);
  await page.waitForFunction(() => document.getElementById('save-status').textContent.startsWith('Uploaded 2 of 2 sheets.'));
  assert.match(await status.textContent(), /1 belong in Self-submitted maps\.$/);
  await page.locator(`#sheet-list a[data-id="${uploaded.id}"]`).click();
  await page.waitForFunction(() => document.querySelector('[name="ind_learn_start"]').value === 'Synthetic uploaded notes');
  assert.equal((await store.get(`sheet:${uploadedSelf.id}`)).source, 'self');
  // A second upload of a changed copy skips it rather than overwriting.
  await Bun.write(dumpPath, JSON.stringify([{ ...uploaded, fields: { name: 'Changed copy' } }]));
  await page.locator('#upload-file').setInputFiles(dumpPath);
  await page.waitForFunction(() => document.getElementById('save-status').dataset.state === 'error');
  assert.match(await status.textContent(), /Uploaded 0 of 1 sheets\. 1 skipped: a different sheet with that ID exists\./);
  assert.equal((await store.get(`sheet:${uploaded.id}`)).fields.name, 'Uploaded interview');
  await Bun.write(dumpPath, 'not json');
  await page.locator('#upload-file').setInputFiles(dumpPath);
  await page.waitForFunction(() => document.getElementById('save-status').textContent.includes('isn’t a store or Download JSON file'));
  console.log('Upload passed');

  // Signing out returns to My map; the interview list is gone.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(baseURL);
  await page.locator('#sign-out').click();
  await page.waitForURL(`${baseURL}/`);
  await page.locator('#self-clear').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#sidebar').count(), 0);
  assert.equal((await context.cookies()).length, 0);
  assert.equal((await page.request.get(`${baseURL}/api/sheets`)).status(), 401);

  await checkSelfFlow({ browser, baseURL, directory, store });
  const selfOnly = Bun.serve({ port: 0, fetch: createApp({}).app.fetch });
  try {
    const selfOnlyURL = `http://localhost:${selfOnly.port}`;
    await checkSelfFlow({ browser, baseURL: selfOnlyURL, directory, adminEnabled: false });
    for (const path of ['/sign-in', '/participant', '/api/sheets']) assert.equal((await fetch(`${selfOnlyURL}${path}`)).status, 404);
  } finally {
    selfOnly.stop(true);
  }
  assert.deepEqual(errors, []);
  console.log('Browser passed: cookie sign-in, create, autosave/reload, dimensions, cross-device access/conflicts, offline retry, overlapping edits, missing hashes, PDF layout, mobile width, delete, sign-out, self mode; no page errors.');
} catch (error) {
  console.log('Browser failure status:', await status.textContent({ timeout: 1000 }).catch(() => '(page unavailable)'), errors);
  throw error;
} finally {
  await browser.close();
  server.stop(true);
  rmSync(directory, { recursive: true, force: true });
}
