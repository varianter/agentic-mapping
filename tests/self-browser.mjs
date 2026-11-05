import assert from 'node:assert/strict';
import { join } from 'node:path';
import { RESPONDENT_FIELDS } from '../server/domain/fields.ts';

// My map: one server-rendered map with respondent fields only, autosaved through its own form URL.
export async function checkSelfFlow({ browser, baseURL, directory, store, adminEnabled = true }) {
  const errors = [];
  const interviewerRequests = [];
  const serverCount = (await store?.keys('sheet:'))?.length;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  context.setDefaultTimeout(12000);
  context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
  context.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/interviews') || url.pathname.startsWith('/client/')) interviewerRequests.push(url.pathname);
  });
  const saved = (page) => page.waitForFunction(() => document.getElementById('save-status').textContent === 'Saved to server');
  const page = await context.newPage();
  try {
    await page.goto(baseURL);
    await page.locator('sheet-tabs[data-ready]').waitFor();
    assert.equal(await page.locator('.pill').textContent(), 'My map');
    assert.equal(await page.locator('.sidebar, #sheet-list').count(), 0);
    assert.equal(await page.locator('#self-sign-in').count(), adminEnabled ? 1 : 0);
    assert.match(await page.locator('.toolbar-notice').textContent(), adminEnabled ? /interviewers can read your answers/ : /This browser remembers your map/);
    // Only the respondent's own answers are on the page; the Save button gives way to autosave.
    const names = await page.evaluate(() => [...new Set([...document.getElementById('sheet').elements].map((el) => el.name).filter((name) => name && name !== 'revision'))]);
    assert.deepEqual(names.toSorted(), [...RESPONDENT_FIELDS].toSorted());
    assert.equal(await page.locator('.sheet-actions').isVisible(), false);

    await page.locator('[name="ind_learn_start"]').fill('Synthetic self answer');
    await page.locator('#tab-org').click();
    assert.equal(await page.locator('#panel-ind').isVisible(), false);
    await page.locator('[name="org_found_next"]').fill('Synthetic org answer');
    await page.keyboard.press('Shift+Tab');
    await page.locator('#tab-org').focus();
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.locator('#tab-team').getAttribute('aria-selected'), 'true');
    await page.locator('[name="advice"]').fill('Synthetic self advice');
    await saved(page);
    assert.equal(await page.locator('#tab-ind').getAttribute('data-filled'), '');
    if (store) assert.equal((await store.keys('sheet:')).length, serverCount + 1);
    await page.reload();
    assert.equal(await page.locator('[name="advice"]').inputValue(), 'Synthetic self advice');
    assert.equal(await page.locator('[name="ind_learn_start"]').inputValue(), 'Synthetic self answer');
    assert.equal(await page.locator('[name="org_found_next"]').inputValue(), 'Synthetic org answer');

    // Another browser profile has its own, empty map.
    const other = await (await browser.newContext()).newPage();
    await other.goto(baseURL);
    assert.equal(await other.locator('[name="advice"]').inputValue(), '');
    await other.context().close();

    const downloading = page.waitForEvent('download');
    await page.locator('a[href="/me.json"]').click();
    const path = join(directory, 'my-map.json');
    await (await downloading).saveAs(path);
    assert.equal((await Bun.file(path).json()).fields.advice, 'Synthetic self advice');

    await page.evaluate(() => {
      window.print = () => { window.printed = document.title; dispatchEvent(new Event('afterprint')); };
    });
    await page.locator('print-button button').click();
    await page.waitForFunction(() => window.printed);
    assert.match(await page.evaluate(() => window.printed), /^My agentic map - \d{4}-\d{2}-\d{2}$/);
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.locator('.toolbar').isVisible(), false);
    // Print shows all three grids, whichever tab is open.
    for (const dimension of ['ind', 'team', 'org']) assert.equal(await page.locator(`#panel-${dimension}`).isVisible(), true);
    await page.emulateMedia({ media: 'screen' });

    // Clear opens a native dialog through Invoker Commands; Cancel keeps the map.
    await page.locator('[commandfor="confirm-clear"][command="show-modal"]').click();
    await page.locator('#confirm-clear').waitFor({ state: 'visible' });
    await page.locator('#confirm-clear [command="close"]').click();
    assert.equal(await page.locator('#confirm-clear').isVisible(), false);
    assert.equal(await page.locator('[name="advice"]').inputValue(), 'Synthetic self advice');
    await page.locator('[commandfor="confirm-clear"][command="show-modal"]').click();
    await page.locator('#confirm-clear button[type="submit"]').click();
    await page.waitForURL(`${baseURL}/`);
    assert.equal(await page.locator('[name="advice"]').inputValue(), '');

    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(interviewerRequests, []);
    // Clearing deletes the server copy too.
    if (store) assert.equal((await store.keys('sheet:')).length, serverCount);
    assert.deepEqual(errors, []);
    console.log(`Self browser passed${adminEnabled ? '' : ' (self-only)'}: one map, respondent fields only, autosave, tabs, reload, separate profiles, JSON, PDF, clear dialog, mobile.`);
  } finally {
    await context.close();
  }
}

// Without JavaScript the same page is a plain form: all grids show, Save posts and the server redirects back.
export async function checkSelfWithoutScripts({ browser, baseURL }) {
  const context = await browser.newContext({ javaScriptEnabled: false });
  context.setDefaultTimeout(12000);
  const page = await context.newPage();
  try {
    await page.goto(baseURL);
    for (const dimension of ['ind', 'team', 'org']) assert.equal(await page.locator(`#panel-${dimension}`).isVisible(), true);
    assert.equal(await page.locator('print-button').isVisible(), false);
    await page.locator('[name="team_why_next"]').fill('Typed without scripts');
    await page.locator('.sheet-actions button[type="submit"]').click();
    await page.waitForURL(`${baseURL}/?saved`);
    assert.equal(await page.locator('.sheet-actions [role="status"]').textContent(), 'Saved.');
    await page.goto(baseURL);
    assert.equal(await page.locator('[name="team_why_next"]').inputValue(), 'Typed without scripts');
    console.log('Self browser passed without JavaScript: all grids, Save, redirect, reload.');
  } finally {
    await context.close();
  }
}
