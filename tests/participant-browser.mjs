import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// A private link connects a browser to its interview, which it then edits as My map at /.
export async function checkParticipantFlow({ browser, context, baseURL, store }) {
  const credentials = new Set();
  const contexts = [];
  const violations = [];
  const errors = [];
  const privateValues = ['Synthetic private identity', 'Synthetic private context', 'Synthetic private contacts'];
  const owner = await context.newPage();
  async function newBrowser() {
    const created = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    created.setDefaultTimeout(12000);
    created.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
    created.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/sheets') || ['/client/app.js', '/client/db.js'].includes(url.pathname)) violations.push('Interviewer code or data requested');
      if ([...credentials].some((credential) => request.url().includes(credential))) violations.push('Credential in HTTP URL');
      // Referrer-Policy: same-origin. Referrers never carry the fragment, and never leave the app's origin.
      const referer = request.headers().referer;
      if (referer && ([...credentials].some((credential) => referer.includes(credential)) || new URL(referer).origin !== url.origin)) violations.push('Referrer leaked');
      if (url.pathname !== '/api/participant/connect' && request.headers().authorization) violations.push('Credential sent outside the connect request');
    });
    contexts.push(created);
    return created.newPage();
  }
  const saved = (page) => page.waitForFunction(() => document.getElementById('save-status').textContent === 'Saved to server');
  const loaded = (page) => page.waitForFunction(() => !document.getElementById('sheet').hidden && !document.getElementById('sheet').inert);
  const connected = async (page) => {
    await page.waitForURL(`${baseURL}/`);
    await loaded(page);
  };
  const unavailable = async (page) => {
    await page.locator('#participant-unavailable').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#sheet').isHidden(), true);
    assert.equal(await page.locator('#sheet-list').count(), 0);
  };
  try {
    await owner.goto(`${baseURL}/interviews`);
    await owner.locator('#sidebar button[type="submit"]').first().click();
    await owner.waitForURL(/\/interviews\/[0-9a-f-]{36}$/);
    await loaded(owner);
    await owner.locator('[name="name"]').fill(privateValues[0]);
    await owner.locator('[name="context"]').fill(privateValues[1]);
    await owner.locator('[name="talk_to"]').fill(privateValues[2]);
    await owner.locator('[name="ind_learn_start"]').fill('Synthetic initial answer');
    const inertAnswer = '<script>window.participantScriptExecuted = true</script>';
    await owner.locator('[name="good"]').fill(inertAnswer);
    await saved(owner);
    const id = new URL(owner.url()).pathname.split('/').pop();
    const stored = async () => (await store.get(`sheet:${id}`)).fields;

    // The open interview always shows its connect URL; copying is intentional credential delivery, so never print it.
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL });
    await owner.locator('#connect-link').waitFor({ state: 'visible' });
    assert.equal(await owner.locator('#connect-link-value').getAttribute('readonly'), '');
    const link = await owner.locator('#connect-link-value').inputValue();
    credentials.add(new URL(link).hash.slice(1));
    await owner.locator('copy-button button').click();
    await owner.locator('#connect-link [role="status"]', { hasText: 'Connect URL copied.' }).waitFor();
    assert.ok(await owner.evaluate(async (expected) => (await navigator.clipboard.readText()) === expected, link), 'Clipboard must contain the connect URL');
    assert.equal(await owner.locator('[data-action="issue-access"], [data-action="revoke-access"]').count(), 0);

    // A fresh browser opens the link, gets connected and lands on / without the credential in the address bar.
    const participant = await newBrowser();
    await participant.goto(link);
    await connected(participant);
    assert.equal(await participant.locator('.pill').textContent(), 'Your interview');
    assert.match(await participant.locator('.toolbar-notice').textContent(), /Your interviewer can read your answers/);
    assert.equal(await participant.locator('#confirm-clear').count(), 0);
    assert.equal(await participant.locator('[name="good"]').inputValue(), inertAnswer);
    assert.equal(await participant.evaluate(() => window.participantScriptExecuted), undefined);
    assert.equal(await participant.locator('#sheet [name]:not([name="revision"])').count(), 31);
    for (const name of ['name', 'context', 'interviewer', 'discipline', 'talk_to']) assert.equal(await participant.locator(`[name="${name}"]`).count(), 0);
    const [cookie] = (await participant.context().cookies()).filter((item) => item.name === 'am_respondent');
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.sameSite, 'Strict');
    assert.ok(![...credentials].includes(cookie.value), 'Cookie must not be the link credential');

    // Answers autosave into the interview; private interviewer fields stay intact and out of the page.
    await participant.locator('[name="ind_learn_start"]').fill('Participant completed the answer');
    await saved(participant);
    assert.equal((await stored()).ind_learn_start, 'Participant completed the answer');
    for (const [key, value] of [['name', privateValues[0]], ['context', privateValues[1]], ['talk_to', privateValues[2]]]) assert.equal((await stored())[key], value);
    assert.ok(!privateValues.some((value) => participant.url().includes(value)));
    const markup = await participant.content();
    assert.ok(!privateValues.some((value) => markup.includes(value)), 'Private answers must not enter the participant document');
    // The browser stays connected without the link.
    await participant.goto(baseURL);
    await loaded(participant);
    assert.equal(await participant.locator('[name="ind_learn_start"]').inputValue(), 'Participant completed the answer');
    if (process.env.UPDATE_EVIDENCE === '1') {
      const evidence = join(import.meta.dir, '../docs/evidence');
      mkdirSync(evidence, { recursive: true });
      await participant.screenshot({ path: join(evidence, 'participant-completion.png'), fullPage: true });
    }

    // Interviewer/participant overlap: the stale save is refused and keeps the draft.
    await owner.reload();
    await loaded(owner);
    await owner.locator('[name="good"]').fill('Newer interviewer answer');
    await saved(owner);
    await participant.locator('[name="good"]').fill('Stale participant answer');
    await participant.waitForFunction(() => document.getElementById('save-status').textContent.includes('changed elsewhere'));
    assert.equal(await participant.locator('[name="good"]').inputValue(), 'Stale participant answer');
    assert.equal((await stored()).good, 'Newer interviewer answer');
    participant.once('dialog', (dialog) => dialog.accept());
    await participant.reload();
    await loaded(participant);
    assert.equal(await participant.locator('[name="good"]').inputValue(), 'Newer interviewer answer');

    // A browser with its own map chooses how to combine; Merge keeps both and deletes the own map.
    const local = await newBrowser();
    await local.goto(baseURL);
    await loaded(local);
    await local.locator('[name="good"]').fill('My own answer');
    await local.locator('[name="advice"]').fill('My own advice');
    await saved(local);
    const ownIds = async () => (await Promise.all((await store.keys('sheet:')).map((key) => store.get(key)))).filter((sheet) => sheet.source === 'self').map((sheet) => sheet.id);
    assert.equal((await ownIds()).length, 1);
    await local.goto(link);
    await local.locator('#connect-choice').waitFor({ state: 'visible' });
    assert.match(await local.locator('#connect-choice-text').textContent(), /2 answers/);
    await local.keyboard.press('Escape');
    await local.locator('#connect-choice').waitFor({ state: 'visible' });
    await local.locator('#connect-choice [value="merge"]').click();
    await connected(local);
    assert.equal(await local.locator('[name="good"]').inputValue(), 'Newer interviewer answer\n\nMy own answer');
    assert.equal(await local.locator('[name="advice"]').inputValue(), 'My own advice');
    assert.equal((await stored()).good, 'Newer interviewer answer\n\nMy own answer');
    assert.deepEqual(await ownIds(), []);

    // The same URL shows after a reload, and the browser stays connected.
    await owner.reload();
    await loaded(owner);
    await owner.locator('#connect-link').waitFor({ state: 'visible' });
    assert.equal(await owner.locator('#connect-link-value').inputValue(), link);
    await participant.reload();
    await loaded(participant);
    assert.equal(await participant.locator('.pill').textContent(), 'Your interview');
    await participant.goto(`${baseURL}/participant#invalid`);
    await unavailable(participant);
    await participant.goto(`${baseURL}/participant`);
    await unavailable(participant);

    // Missing participant credentials never load the signed-in owner's list.
    const signedIn = await context.newPage();
    const ownerDataRequests = [];
    signedIn.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/api/')) ownerDataRequests.push('API requested'); });
    await signedIn.goto(`${baseURL}/participant`);
    await unavailable(signedIn);
    assert.deepEqual(ownerDataRequests, []);
    await signedIn.close();

    await participant.setViewportSize({ width: 390, height: 844 });
    await participant.goto(baseURL);
    await loaded(participant);
    assert.equal(await participant.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(violations, []);
    assert.deepEqual(errors, []);
    console.log('Participant browser passed: private copy/handoff, connect and land on /, approved fields, autosave, stays connected, inert answers, conflicts, merge choice, stable connect URL, missing/invalid links, referrers and mobile.');
  } catch (error) {
    // A failing Playwright action can include its navigation URL in the error.
    let message = error.stack ?? String(error);
    for (const credential of credentials) message = message.replaceAll(credential, '[REDACTED]');
    throw new Error(message);
  } finally {
    await owner.close({ runBeforeUnload: false });
    for (const created of contexts) await created.close();
  }
}
