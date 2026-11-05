import assert from 'node:assert/strict';
import { join } from 'node:path';
import { RESPONDENT_FIELDS } from '../client/fields.js';

// My map: one browser-only map with respondent fields, no interviews and no server calls.
export async function checkSelfFlow({ browser, baseURL, directory, store, adminEnabled = true }) {
  const errors = [];
  const apiRequests = [];
  const serverCount = (await store?.keys('sheet:'))?.length;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  context.setDefaultTimeout(12000);
  context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
  context.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/') || ['/client/app.js', '/client/db.js', '/client/participant.js'].includes(url.pathname)) apiRequests.push(url.pathname);
  });
  const saved = (page) => page.waitForFunction(() => document.getElementById('save-status').textContent === 'Saved in this browser');
  const page = await context.newPage();
  try {
    await page.goto(baseURL);
    await page.locator('#sheet').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.pill').textContent(), 'My map');
    assert.equal(await page.locator('#sidebar, [data-action="new"], #sheet-list').count(), 0);
    assert.equal(await page.locator('#self-sign-in').isVisible(), adminEnabled);
    // Only the respondent's own answers are on the page.
    const names = await page.evaluate(() => [...new Set([...document.getElementById('sheet').elements].map((el) => el.name).filter(Boolean))]);
    assert.deepEqual(names.toSorted(), [...RESPONDENT_FIELDS].toSorted());

    await page.locator('[name="ind_learn_start"]').fill('Synthetic self answer');
    await page.locator('#tab-org').click();
    await page.locator('[name="org_found_next"]').fill('Synthetic org answer');
    await page.locator('[name="advice"]').fill('Synthetic self advice');
    await saved(page);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('[name="advice"]').value === 'Synthetic self advice');
    assert.equal(await page.locator('[name="ind_learn_start"]').inputValue(), 'Synthetic self answer');
    assert.equal(await page.locator('[name="org_found_next"]').inputValue(), 'Synthetic org answer');

    // Another browser profile has its own, empty map.
    const other = await (await browser.newContext()).newPage();
    await other.goto(baseURL);
    await other.locator('#sheet').waitFor({ state: 'visible' });
    assert.equal(await other.locator('[name="advice"]').inputValue(), '');
    await other.context().close();

    const downloading = page.waitForEvent('download');
    await page.locator('#self-export').click();
    const path = join(directory, 'my-map.json');
    await (await downloading).saveAs(path);
    assert.equal((await Bun.file(path).json()).fields.advice, 'Synthetic self advice');

    await page.evaluate(() => {
      window.print = () => { window.printed = document.title; dispatchEvent(new Event('afterprint')); };
    });
    await page.locator('#self-pdf').click();
    await page.waitForFunction(() => window.printed);
    assert.match(await page.evaluate(() => window.printed), /^My agentic map - \d{4}-\d{2}-\d{2}$/);
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.locator('.toolbar').isVisible(), false);
    await page.emulateMedia({ media: 'screen' });

    page.once('dialog', (dialog) => dialog.dismiss());
    await page.locator('#self-clear').click();
    assert.equal(await page.locator('[name="advice"]').inputValue(), 'Synthetic self advice');
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#self-clear').click();
    await page.waitForFunction(() => document.getElementById('save-status').textContent === 'Map cleared');
    await page.reload();
    await page.locator('#sheet').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[name="advice"]').inputValue(), '');

    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(apiRequests, []);
    if (store) assert.equal((await store.keys('sheet:')).length, serverCount);
    assert.deepEqual(errors, []);
    console.log(`Self browser passed${adminEnabled ? '' : ' (self-only server)'}: one map, respondent fields only, reload, separate profiles, JSON, PDF, clear, mobile; no server calls.`);
  } finally {
    await context.close();
  }
}
