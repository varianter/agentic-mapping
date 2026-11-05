import assert from 'node:assert/strict';

export async function checkPreviewFlow({ browser, baseURL }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  context.setDefaultTimeout(12000);
  const page = await context.newPage();
  const errors = [];
  const violations = [];
  page.on('pageerror', (error) => errors.push(error.message));
  context.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith('/api/') || ['/client/app.js', '/client/db.js'].includes(pathname)) violations.push(pathname);
  });
  try {
    await page.goto(`${baseURL}/preview`);
    await page.locator('#sheet').waitFor({ state: 'visible' });
    assert.match(await page.locator('.preview-notice').innerText(), /Preview: your answers stay in this browser only and are never sent to the server/);
    assert.equal(await page.locator('.pill').textContent(), 'Preview');
    assert.equal(await page.locator('#sheet-list').count(), 0);
    assert.equal(await page.locator('[data-action="delete"]').count(), 0);
    await page.locator('[name="ind_learn_start"]').fill('Synthetic preview answer');
    await page.locator('[name="advice"]').fill('Synthetic preview advice');
    await page.reload();
    await page.locator('#sheet').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[name="ind_learn_start"]').inputValue(), 'Synthetic preview answer');
    assert.equal(await page.locator('[name="advice"]').inputValue(), 'Synthetic preview advice');
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.locator('#preview-clear').click();
    assert.equal(await page.locator('[name="advice"]').inputValue(), 'Synthetic preview advice');
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#preview-clear').click();
    assert.equal(await page.locator('[name="advice"]').inputValue(), '');
    await page.reload();
    await page.locator('#sheet').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[name="ind_learn_start"]').inputValue(), '');
    assert.deepEqual(violations, []);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}
