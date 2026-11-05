import assert from 'node:assert/strict';
import { join } from 'node:path';

export async function checkLocalFlow({ browser, baseURL, directory, db }) {
  const contexts = [];
  const errors = [];
  const apiRequests = [];
  const serverCount = db.query('SELECT COUNT(*) AS count FROM sheets').get().count;
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
    assert.equal(await page.locator('#import-json').count(), 0);
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
    assert.equal(db.query('SELECT COUNT(*) AS count FROM sheets').get().count, serverCount);
    assert.deepEqual(apiRequests, []);
    assert.deepEqual(errors, []);
    console.log('Local browser passed: full model/PDF, reload/delete, profile isolation, stale tabs, no interview API, retryable opening/create/save/commit failures, draft downloads, validation and atomic revisions.');
  } finally {
    for (const context of contexts) await context.close();
  }
}

// Signed-in offer to move anonymous browser models into the account.
export async function checkSaveLocalFlow({ browser, baseURL, adminKey, db }) {
  const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'];
  const model = (id, fields, createdAt) => ({ id, fields, createdAt, updatedAt: createdAt + 5 });
  const seeded = [
    model(ids[0], { name: 'Browser one', date: '2026-01-01', ind_learn_start: 'Alpha' }, 1000),
    model(ids[1], { name: 'Browser two', date: '2026-01-02', discipline: ['Developer'] }, 2000),
    model(ids[2], { name: 'Browser three', team_why_next: 'Gamma' }, 3000),
    model(ids[3], { name: '', date: '2026-01-04', discipline: [] }, 4000),
  ];
  const sql = (id) => db.query('SELECT * FROM sheets WHERE id = ?').get(id);
  async function session(models) {
    const context = await browser.newContext({ httpCredentials: { username: 'admin', password: adminKey } });
    context.setDefaultTimeout(12000);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${baseURL}/sign-in`);
    await page.evaluate(async (models) => {
      const local = await import('/client/local-db.js');
      for (const model of models) await local.createSheet(model);
    }, models);
    return { context, page, errors };
  }
  const localIds = (page) => page.evaluate(async () => (await (await import('/client/local-db.js')).allSheets()).map((sheet) => sheet.id).sort());
  const status = (page) => page.locator('#save-status');
  const cleanup = () => { for (const id of ids) db.query('DELETE FROM sheets WHERE id = ?').run(id); };
  cleanup();
  try {
    // Save all: 3 filled, 1 blank.
    let { context, page, errors } = await session(seeded);
    await page.reload();
    const dialog = page.locator('#save-local');
    await dialog.waitFor({ state: 'visible' });
    assert.equal(await page.locator('#save-local-title').textContent(), 'Save 3 browser models to your account?');
    await page.locator('#save-local-confirm').click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await status(page).textContent(), 'Saved 3 of 3');
    for (const model of seeded.slice(0, 3)) {
      const row = sql(model.id);
      assert.deepEqual([JSON.parse(row.fields), row.createdAt, row.updatedAt], [model.fields, model.createdAt, model.updatedAt]);
      await page.locator(`#sheet-list a[data-id="${model.id}"]`).waitFor();
    }
    assert.equal(sql(ids[3]), null);
    assert.deepEqual(await localIds(page), [ids[3]]);
    assert.deepEqual(errors, []);
    await context.close();
    cleanup();

    // Not now: nothing uploaded; stays quiet for the session, returns in a new session.
    ({ context, page, errors } = await session(seeded));
    await page.reload();
    await page.locator('#save-local').waitFor({ state: 'visible' });
    await page.locator('#save-local [value="later"]').click();
    await page.reload();
    await page.locator('#sheet-list').waitFor({ state: 'attached' });
    // Let the async IndexedDB read and offer decision settle before asserting absence.
    await page.evaluate(async () => {
      await (await import('/client/local-db.js')).allSheets();
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    assert.equal(await page.locator('#save-local').isVisible(), false);
    assert.equal(db.query('SELECT COUNT(*) AS count FROM sheets WHERE id IN (?, ?, ?)').get(ids[0], ids[1], ids[2]).count, 0);
    assert.deepEqual(await localIds(page), [...ids].sort());
    await context.close();
    // New session (fresh sessionStorage) with the same models: the offer returns.
    ({ context, page, errors } = await session(seeded));
    await page.reload();
    await page.locator('#save-local').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#save-local-title').textContent(), 'Save 3 browser models to your account?');
    await context.close();

    // Partial failure (offline for the 2nd), retry, and 409 with different content.
    ({ context, page, errors } = await session(seeded));
    let blocked = true;
    await page.route('**/api/sheets', (route) => {
      const request = route.request();
      if (blocked && request.method() === 'POST' && request.postData().includes(ids[1])) return route.abort();
      return route.continue();
    });
    await page.reload();
    await page.locator('#save-local').waitFor({ state: 'visible' });
    await page.locator('#save-local-confirm').click();
    await page.waitForFunction(() => document.getElementById('save-status').textContent === 'Saved 1 of 3');
    assert.equal(await page.locator('#save-local').isVisible(), true);
    assert.deepEqual(await localIds(page), [ids[1], ids[2], ids[3]].sort());
    assert.equal(sql(ids[0]) !== null, true);
    blocked = false;
    await page.locator('#save-local-confirm').click();
    await page.locator('#save-local').waitFor({ state: 'hidden' });
    assert.equal(await status(page).textContent(), 'Saved 2 of 2');
    assert.equal(db.query('SELECT COUNT(*) AS count FROM sheets WHERE id IN (?, ?, ?)').get(ids[0], ids[1], ids[2]).count, 3);
    assert.deepEqual(await localIds(page), [ids[3]]);
    assert.deepEqual(errors.filter((message) => !/Failed to fetch/.test(message)), []);
    await context.close();
    cleanup();

    db.query('INSERT INTO sheets (id, fields, createdAt, updatedAt) VALUES (?, ?, ?, ?)').run(ids[1], JSON.stringify({ name: 'Different' }), 1, 1);
    ({ context, page } = await session(seeded));
    await page.reload();
    await page.locator('#save-local').waitFor({ state: 'visible' });
    await page.locator('#save-local-confirm').click();
    await page.waitForFunction(() => document.getElementById('save-status').textContent === 'Saved 2 of 3');
    assert.deepEqual(JSON.parse(sql(ids[1]).fields), { name: 'Different' });
    assert.equal(sql(ids[2]) !== null, true);
    assert.match(await page.locator('#save-local-status').textContent(), /Browser two/);
    assert.deepEqual(await localIds(page), [ids[1], ids[3]].sort());
    await page.locator('#save-local-confirm').click();
    await page.waitForFunction(() => document.getElementById('save-status').textContent === 'Saved 0 of 1');
    assert.deepEqual(await localIds(page), [ids[1], ids[3]].sort());
    await context.close();
    cleanup();

    // 401 on the 2nd upload: stops, keeps the rest, no page error.
    ({ context, page, errors } = await session(seeded));
    await page.route('**/api/sheets', (route) => {
      const request = route.request();
      if (request.method() === 'POST' && request.postData().includes(ids[1])) return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"Unauthorized"}' });
      return route.continue();
    });
    await page.reload();
    await page.locator('#save-local').waitFor({ state: 'visible' });
    await page.locator('#save-local-confirm').click();
    await page.waitForFunction(() => document.getElementById('save-status').textContent === 'Saved 1 of 3');
    assert.deepEqual(await localIds(page), [ids[1], ids[2], ids[3]].sort());
    assert.deepEqual(errors, []);
    await context.close();
    cleanup();

    // IndexedDB unavailable: no dialog, no error.
    ({ context, page, errors } = await session([]));
    await page.addInitScript(() => { indexedDB.open = () => { throw new DOMException('IndexedDB unavailable', 'SecurityError'); }; });
    await page.reload();
    await page.locator('#sheet-list').waitFor({ state: 'attached' });
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.equal(await page.locator('#save-local').isVisible(), false);
    assert.notEqual(await status(page).getAttribute('data-state'), 'error');
    assert.deepEqual(errors, []);
    await context.close();

    // Only blank models: no dialog.
    ({ context, page, errors } = await session([seeded[3]]));
    await page.reload();
    await page.locator('#sheet-list').waitFor({ state: 'attached' });
    // Let the async IndexedDB read and offer decision settle before asserting absence.
    await page.evaluate(async () => {
      await (await import('/client/local-db.js')).allSheets();
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    assert.equal(await page.locator('#save-local').isVisible(), false);
    assert.deepEqual(errors, []);
    await context.close();
    console.log('Save-local passed: save all, Not now, partial failure/retry, 401, 409 skip-and-continue, IndexedDB unavailable, blank-only.');
  } finally {
    cleanup();
  }
}
