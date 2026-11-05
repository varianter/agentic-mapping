import assert from 'node:assert/strict';
import { join } from 'node:path';

export async function checkLocalFlow({ browser, baseURL, directory, store }) {
  const contexts = [];
  const errors = [];
  const apiRequests = [];
  const serverCount = (await store.keys('sheet:')).length;
  const saved = (page) => page.waitForFunction(() => document.getElementById('save-status').textContent === 'Saved in this browser');
  const failed = (page, text = 'Couldn’t complete') => page.waitForFunction((text) => {
    const status = document.getElementById('save-status');
    return status.dataset.state === 'error' && status.textContent.includes(text);
  }, text);
  const loaded = (page) => page.waitForFunction(() => !document.getElementById('sheet').hidden && !document.getElementById('sheet').inert);
  const snapshot = (page, id) => page.evaluate(async (id) => (await import('/client/local-db.js')).getSheet(id), id);
  async function profile() {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    context.setDefaultTimeout(12000);
    context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
    context.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url());
    });
    contexts.push(context);
    return context;
  }
  async function printDraft(page, value) {
    await page.evaluate(() => {
      window.print = () => {
        window.printedFields = Object.fromEntries(new FormData(document.getElementById('sheet')));
        dispatchEvent(new Event('afterprint'));
      };
      window.printedFields = null;
    });
    await page.locator('[data-action="pdf"]').click();
    await page.waitForFunction(() => window.printedFields !== null);
    assert.equal(await page.evaluate(() => window.printedFields.name), value);
    await loaded(page);
  }
  async function downloadDraft(page, value, filename) {
    const downloading = page.waitForEvent('download');
    await page.locator('[data-action="export"]').click();
    const path = join(directory, filename);
    await (await downloading).saveAs(path);
    assert.equal((await Bun.file(path).json())[0].fields.name, value);
    await loaded(page);
  }
  async function reloadSaved(page) {
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('[data-action="reload"]').click();
    await saved(page);
    await loaded(page);
  }
  async function deleteCurrent(page) {
    await page.locator('[data-action="delete"]').click();
    await page.locator('#confirm-delete [value="delete"]').click();
    await loaded(page);
  }
  try {
    const context = await profile();
    const page = await context.newPage();
    const response = await page.goto(baseURL);
    assert.equal(response.status(), 200);
    assert.equal(response.headers()['www-authenticate'], undefined);
    await loaded(page);
    await saved(page);
    assert.equal(await page.locator('body').getAttribute('data-storage-mode'), 'local');
    assert.equal(await page.locator('#model-list-label').textContent(), 'This browser’s models');
    assert.equal(await page.locator('[data-action="issue-access"]').isHidden(), true);
    assert.equal(await page.locator('[data-action="revoke-access"]').isHidden(), true);
    assert.equal(await page.locator('#import-json').isDisabled(), true);
    assert.equal(await page.locator('#sign-in').isVisible(), true);
    assert.match(await page.locator('#local-storage-note').textContent(), /Clearing browser data removes them/);
    // The entire interviewer model, including all dimensions and private fields, is editable locally.
    await page.locator('[name="name"]').fill('Local model one');
    for (const name of ['interviewer', 'context', 'good', 'surprised', 'missing', 'advice', 'talk_to', 'discipline_other']) {
      await page.locator(`[name="${name}"]`).fill(`Synthetic ${name}`);
    }
    await page.locator('[name="discipline"][value="Developer"]').check();
    for (const dimension of ['ind', 'team', 'org']) {
      await page.locator(`#tab-${dimension}`).click();
      for (const question of ['learn', 'why', 'found']) {
        for (const level of ['start', 'good', 'next']) {
          const name = `${dimension}_${question}_${level}`;
          await page.locator(`[name="${name}"]`).fill(`Synthetic ${name}`);
        }
      }
    }
    await saved(page);
    const firstId = new URL(page.url()).hash.slice(1);
    const first = await snapshot(page, firstId);
    assert.equal(Object.keys(first.fields).filter((key) => /^(ind|team|org)_/.test(key)).length, 27);
    assert.deepEqual(first.fields.discipline, ['Developer']);
    await printDraft(page, 'Local model one');
    assert.equal(await page.evaluate(() => window.printedFields.team_why_next), 'Synthetic team_why_next');
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.locator('.toolbar').isVisible(), false);
    assert.equal(await page.locator('.sidebar').isVisible(), false);
    for (const dimension of ['ind', 'team', 'org']) assert.equal(await page.locator(`#panel-${dimension}`).isVisible(), true);
    const pdf = await page.pdf({ preferCSSPageSize: true });
    assert.ok(pdf.length > 1000 && pdf.subarray(0, 4).toString() === '%PDF');
    await page.emulateMedia({ media: 'screen' });
    await page.reload();
    await loaded(page);
    assert.equal(await page.locator('[name="name"]').inputValue(), 'Local model one');
    assert.equal(await page.locator('[name="org_found_next"]').inputValue(), 'Synthetic org_found_next');
    await page.locator('[data-action="new"]').first().click();
    await loaded(page);
    await page.locator('[name="name"]').fill('Local model two');
    await saved(page);
    const secondId = new URL(page.url()).hash.slice(1);
    assert.notEqual(firstId, secondId);
    await page.reload();
    await loaded(page);
    assert.equal(await page.locator('[name="name"]').inputValue(), 'Local model two');
    assert.equal(await page.locator('#sheet-list a').count(), 2);

    // A separate browser profile sees neither model, including by known ID.
    const isolated = await (await profile()).newPage();
    await isolated.goto(`${baseURL}/#${firstId}`);
    await failed(isolated, 'unavailable');
    assert.equal(await isolated.locator('#sheet').isHidden(), true);
    assert.equal(await isolated.locator('#sheet-list a').count(), 0);
    await isolated.goto(baseURL);
    await saved(isolated);
    assert.equal(await isolated.locator('[name="name"]').inputValue(), '');
    assert.equal(await isolated.locator('#sheet-list a').count(), 1);
    assert.equal(await isolated.locator(`#sheet-list a[data-id="${secondId}"]`).count(), 0);

    await deleteCurrent(page);
    await saved(page);
    assert.equal(await page.locator('#sheet-list a').count(), 1);
    assert.equal(await page.locator('[name="name"]').inputValue(), 'Local model one');
    await page.reload();
    await loaded(page);
    assert.equal(await page.locator(`#sheet-list a[data-id="${secondId}"]`).count(), 0);
    assert.equal(await page.locator('[name="name"]').inputValue(), 'Local model one');

    // Competing tabs cannot overwrite or delete newer values, or resurrect a deleted model.
    const other = await context.newPage();
    await other.goto(`${baseURL}/#${firstId}`);
    await loaded(other);
    await other.locator('[name="name"]').fill('Newer local tab');
    await saved(other);
    await page.locator('[name="name"]').fill('Stale local draft');
    await failed(page, 'Another tab changed');
    assert.equal((await snapshot(other, firstId)).fields.name, 'Newer local tab');
    await printDraft(page, 'Stale local draft');
    await downloadDraft(page, 'Stale local draft', 'local-conflict.json');
    await reloadSaved(page);
    await other.locator('[name="name"]').fill('Newest before deletion');
    await saved(other);
    await deleteCurrent(page);
    await failed(page, 'Another tab changed');
    assert.equal((await snapshot(other, firstId)).fields.name, 'Newest before deletion');
    await page.locator('[data-action="reload"]').click();
    await saved(page);
    await loaded(page);
    await deleteCurrent(other);
    await page.locator('[name="name"]').fill('Draft after tab deletion');
    await failed(page, 'Model unavailable');
    await page.locator('[data-action="retry"]').click();
    await failed(page);
    await downloadDraft(page, 'Draft after tab deletion', 'local-deleted.json');
    assert.equal(await other.evaluate(async (id) => (await (await import('/client/local-db.js')).allSheets()).some((sheet) => sheet.id === id), firstId), false);
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('[data-action="reload"]').click();
    await page.locator('#sheet').waitFor({ state: 'hidden' });
    await page.goto(`${baseURL}/#${crypto.randomUUID()}`);
    await failed(page, 'unavailable');
    assert.equal(await page.locator('#sheet').isHidden(), true);
    assert.equal(await page.locator('#sheet-list a').count(), 1);

    // Inject actual IndexedDB failures, including an abort after request success.
    const recoveryContext = await profile();
    await recoveryContext.addInitScript(() => {
      window.storageFault = 'open';
      const open = IDBFactory.prototype.open;
      IDBFactory.prototype.open = function (...args) {
        if (window.storageFault === 'open') throw new DOMException('Synthetic storage open failure', 'SecurityError');
        return open.apply(this, args);
      };
      const add = IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add = function (...args) {
        if (window.storageFault === 'create') throw new DOMException('Synthetic storage create failure', 'QuotaExceededError');
        return add.apply(this, args);
      };
      const getAll = IDBObjectStore.prototype.getAll;
      IDBObjectStore.prototype.getAll = function (...args) {
        if (window.storageFault === 'list') throw new DOMException('Synthetic storage list failure', 'UnknownError');
        return getAll.apply(this, args);
      };
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        if (window.storageFault === 'save') throw new DOMException('Synthetic storage save failure', 'QuotaExceededError');
        const request = put.apply(this, args);
        if (window.storageFault === 'commit') request.addEventListener('success', () => request.transaction.abort());
        return request;
      };
    });
    const recovery = await recoveryContext.newPage();
    await recovery.goto(baseURL);
    await failed(recovery, 'open failure');
    await loaded(recovery);
    await recovery.locator('[name="name"]').fill('Draft during opening failure');
    await failed(recovery, 'open failure');
    await printDraft(recovery, 'Draft during opening failure');
    await downloadDraft(recovery, 'Draft during opening failure', 'local-open-failure.json');
    await recovery.evaluate(() => { window.storageFault = ''; });
    await recovery.locator('[data-action="retry"]').click();
    await saved(recovery);
    const recoveryId = new URL(recovery.url()).hash.slice(1);
    assert.equal((await snapshot(recovery, recoveryId)).fields.name, 'Draft during opening failure');

    // A failed known-ID open retries the same ID rather than creating a fallback.
    const reopen = await recoveryContext.newPage();
    await reopen.goto(`${baseURL}/#${recoveryId}`);
    await failed(reopen, 'open failure');
    assert.equal(await reopen.locator('#sheet').isHidden(), true);
    await reopen.evaluate(() => { window.storageFault = 'list'; });
    await reopen.locator('[data-action="retry"]').click();
    await failed(reopen, 'list failure');
    await loaded(reopen);
    assert.equal(await reopen.locator('[name="name"]').inputValue(), 'Draft during opening failure');
    await reopen.evaluate(() => { window.storageFault = ''; });
    await reopen.locator('[data-action="retry"]').click();
    await saved(reopen);
    await reopen.close();

    await recovery.evaluate(() => { window.storageFault = 'create'; });
    await recovery.locator('[data-action="new"]').first().click();
    await failed(recovery, 'create failure');
    await loaded(recovery);
    await recovery.locator('[name="name"]').fill('Draft during creation failure');
    await failed(recovery, 'create failure');
    await printDraft(recovery, 'Draft during creation failure');
    await downloadDraft(recovery, 'Draft during creation failure', 'local-create-failure.json');
    const createdId = new URL(recovery.url()).hash.slice(1);
    assert.equal(await recovery.evaluate(async () => (await (await import('/client/local-db.js')).allSheets()).length), 1);
    await recovery.evaluate(() => { window.storageFault = ''; });
    await recovery.locator('[data-action="retry"]').click();
    await saved(recovery);
    for (const fault of ['save', 'commit']) {
      const before = await snapshot(recovery, createdId);
      await recovery.evaluate((fault) => { window.storageFault = fault; }, fault);
      const value = `Draft during ${fault} failure`;
      await recovery.locator('[name="name"]').fill(value);
      await failed(recovery);
      assert.equal(await recovery.locator('[name="name"]').inputValue(), value);
      assert.deepEqual(await snapshot(recovery, createdId), before);
      await printDraft(recovery, value);
      await failed(recovery);
      await downloadDraft(recovery, value, `local-${fault}-failure.json`);
      await recovery.evaluate(() => { window.storageFault = ''; });
      await recovery.locator('[data-action="retry"]').click();
      await saved(recovery);
      assert.equal((await snapshot(recovery, createdId)).fields.name, value);
    }
    await recovery.reload();
    await failed(recovery, 'open failure');
    await recovery.evaluate(() => { window.storageFault = ''; });
    await recovery.locator('[data-action="retry"]').click();
    await loaded(recovery);
    assert.equal(await recovery.locator('[name="name"]').inputValue(), 'Draft during commit failure');
    // Validate records and serialize simultaneous writes inside readwrite transactions.
    const validation = await recovery.evaluate(async (id) => {
      const storage = await import('/client/local-db.js');
      const sheet = await storage.getSheet(id);
      const invalid = [];
      for (const value of [{ ...sheet, id: '../invalid' }, { ...sheet, fields: [] }, { ...sheet, fields: { name: {} } }, { ...sheet, updatedAt: -1 }, { ...sheet, revision: 0 }]) {
        try { await storage.putSheet(value); invalid.push('accepted'); } catch (error) { invalid.push(error.status); }
      }
      let collision;
      try { await storage.createSheet({ ...sheet, fields: { name: 'Collision' } }); }
      catch (error) { collision = error.status; }
      const writes = await Promise.allSettled(['One', 'Two'].map((name) => storage.putSheet({ ...sheet, fields: { name } })));
      return { invalid, collision, writes: writes.map((write) => write.status === 'fulfilled' ? 'saved' : write.reason.status), revision: (await storage.getSheet(id)).revision, previousRevision: sheet.revision };
    }, createdId);
    assert.deepEqual(validation.invalid, [400, 400, 400, 400, 400]);
    assert.equal(validation.collision, 409);
    assert.deepEqual(validation.writes.toSorted(), [409, 'saved'].toSorted());
    assert.equal(validation.revision, validation.previousRevision + 1);
    assert.equal((await store.keys('sheet:')).length, serverCount);
    assert.deepEqual(apiRequests, []);
    assert.deepEqual(errors, []);
    console.log('Local browser passed: full model/PDF, reload/delete, profile isolation, stale tabs, no interview API, retryable opening/create/save/commit failures, draft downloads, validation and atomic revisions.');
  } finally {
    for (const context of contexts) await context.close();
  }
}
