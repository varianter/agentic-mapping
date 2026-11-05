import { chromium } from 'playwright';
import { createApp } from '../server/app.ts';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { checkParticipantFlow } from './participant-browser.mjs';
import { checkLocalFlow } from './local-browser.mjs';

const directory = mkdtempSync(join(tmpdir(), 'mapping-browser-'));
const adminKey = 'browser-admin-key-0123456789-abcdefgh';
const { app, db } = createApp({ databasePath: join(directory, 'sheets.sqlite'), adminKey });
const server = Bun.serve({ port: 0, fetch: app.fetch });
const baseURL = `http://localhost:${server.port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true });
const errors = [];
const context = await browser.newContext({ httpCredentials: { username: 'admin', password: adminKey }, viewport: { width: 1440, height: 1000 } });
context.setDefaultTimeout(12000);
const page = await context.newPage();
page.on('pageerror', (error) => errors.push(error.message));
const status = page.locator('#save-status');
const waitSaved = () => page.waitForFunction(() => document.getElementById('save-status').textContent === 'Saved to server');
try {
  await page.goto(`${baseURL}/sign-in`);
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
  const secondContext = await browser.newContext({ httpCredentials: { username: 'admin', password: adminKey } });
  secondContext.setDefaultTimeout(12000);
  const second = await secondContext.newPage();
  await second.goto(`${baseURL}/sign-in`);
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
  // Old-origin notes can be exported without deletion and imported idempotently.
  const legacyId = crypto.randomUUID();
  await page.evaluate(async ({ legacyId }) => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('agentic-mapping', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('sheets', { keyPath: 'id' });
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction('sheets', 'readwrite');
        transaction.objectStore('sheets').put({ id: legacyId, fields: { name: 'Legacy interview', learn_start: 'Preserved legacy grid' }, createdAt: 1, updatedAt: 2 });
        transaction.oncomplete = () => { db.close(); resolve(); };
      };
    });
  }, { legacyId });
  await page.goto(`${baseURL}/legacy.html`);
  const downloading = page.waitForEvent('download');
  await page.locator('#export-legacy').click();
  const download = await downloading;
  const exportPath = join(directory, 'legacy.json');
  await download.saveAs(exportPath);
  await page.goto(baseURL);
  await page.waitForFunction(() => !document.getElementById('import-json').disabled);
  await page.locator('#import-json').setInputFiles(exportPath);
  await page.waitForFunction(() => document.getElementById('save-status').textContent.includes('Imported 1 sheets'));
  await page.waitForFunction(() => !document.getElementById('import-json').disabled);
  await page.locator('#import-json').setInputFiles(exportPath);
  await page.waitForFunction(() => document.getElementById('save-status').textContent.includes('Imported 1 sheets'));
  assert.equal(await page.locator(`#sheet-list a[data-id="${legacyId}"]`).count(), 1);
  await page.waitForFunction(() => !document.getElementById('import-json').disabled);
  await page.locator(`#sheet-list a[data-id="${legacyId}"]`).click();
  await page.waitForFunction(() => document.querySelector('[name="ind_learn_start"]').value === 'Preserved legacy grid');

  await page.waitForFunction(() => !document.getElementById('sheet').inert);
  console.log('Migration passed');
  // Unknown hashes never open an unrelated interview.
  await page.goto(`${baseURL}/#${crypto.randomUUID()}`);
  await page.waitForFunction(() => document.getElementById('save-status').textContent.includes('Sheet unavailable'));
  assert.equal(await page.locator('#sheet').isHidden(), true);
  await page.waitForFunction(() => !document.getElementById('import-json').disabled);
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
  await page.waitForFunction(() => !document.getElementById('import-json').disabled);
  await page.locator('#import-json').setInputFiles(recoveryPath);
  await page.waitForFunction(() => document.querySelector('[name="name"]').value === 'Draft after remote deletion' && !document.getElementById('sheet').inert);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.locator('#toggle-sidebar').click();
  await page.locator('[data-action="retry"]').waitFor({ state: 'visible' });
  await page.locator('[data-action="retry"]').press('Escape');
  await page.locator('[data-action="delete"]').click();
  await page.locator('#confirm-delete [value="delete"]').click();
  await page.waitForFunction((id) => !document.querySelector(`#sheet-list a[data-id="${id}"]`), id);
  assert.deepEqual(errors, []);
  await checkParticipantFlow({ browser, context, baseURL, directory, db });
  await checkLocalFlow({ browser, baseURL, directory, db });
  console.log('Browser passed: create, autosave/reload, dimensions, cross-device access/conflicts, offline retry, overlapping edits, legacy export/import, missing hashes, PDF layout, mobile width, delete; no page errors.');
} catch (error) {
  console.log('Browser failure status:', await status.textContent(), errors);
  throw error;
} finally {
  await browser.close();
  server.stop(true);
  db.close();
  rmSync(directory, { recursive: true, force: true });
}
