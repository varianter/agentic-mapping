import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export async function checkParticipantFlow({ browser, context, baseURL, directory, store }) {
  const credentials = new Set();
  const participantContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  participantContext.setDefaultTimeout(12000);
  const owner = await context.newPage();
  const participant = await participantContext.newPage();
  const violations = [];
  const errors = [];
  const apiRequests = [];
  const privateValues = ['Synthetic private identity', 'Synthetic private context', 'Synthetic private contacts'];
  participantContext.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
  participant.on('pageerror', (error) => errors.push(error.message));
  participantContext.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/')) apiRequests.push({ path: url.pathname, method: request.method() });
    if (url.pathname.startsWith('/api/sheets') || ['/client/app.js', '/client/db.js'].includes(url.pathname)) violations.push('Interviewer code or data requested');
    if ([...credentials].some((credential) => request.url().includes(credential))) violations.push('Credential in HTTP URL');
    if (request.headers().referer) violations.push('Referrer sent');
    if (url.pathname !== '/api/participant' && request.headers().authorization) violations.push('Credential sent outside participant API');
  });
  await participantContext.addInitScript(() => {
    window.privateStorageAccess = 0;
    for (const key of ['getItem', 'setItem']) {
      const original = Storage.prototype[key];
      Storage.prototype[key] = function (...args) { window.privateStorageAccess++; return original.apply(this, args); };
    }
    const original = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (...args) { window.privateStorageAccess++; return original.apply(this, args); };
  });
  const saved = (page) => page.waitForFunction(() => document.getElementById('save-status').textContent === 'Saved to server');
  const loaded = (page) => page.waitForFunction(() => !document.getElementById('sheet').hidden && !document.getElementById('sheet').inert);
  const unavailable = async (page) => {
    await page.locator('#participant-unavailable').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#sheet').isHidden(), true);
    assert.equal(await page.locator('#sheet-list').count(), 0);
  };
  async function issueLink() {
    await owner.locator('[data-action="issue-access"]').click();
    await owner.locator('#private-link').waitFor({ state: 'visible' });
    const link = await owner.locator('#private-link-value').inputValue();
    credentials.add(new URL(link).hash.slice(1));
    await owner.locator('#private-link [value="close"]').click();
    await owner.waitForFunction(() => document.getElementById('private-link-value').value === '');
    assert.equal(await owner.locator('#private-link-value').inputValue(), '');
    return link;
  }
  try {
    await owner.goto(baseURL);
    await owner.locator('[data-action="new"]').first().click();
    await loaded(owner);
    await owner.locator('[name="name"]').fill(privateValues[0]);
    await owner.locator('[name="context"]').fill(privateValues[1]);
    await owner.locator('[name="talk_to"]').fill(privateValues[2]);
    await owner.locator('[name="ind_learn_start"]').fill('Synthetic initial answer');
    const inertAnswer = '<script>window.participantScriptExecuted = true</script>';
    await owner.locator('[name="good"]').fill(inertAnswer);
    await saved(owner);
    const id = new URL(owner.url()).hash.slice(1);
    const stored = async () => (await store.get(`sheet:${id}`)).fields;

    // Issuance/copy is intentional credential delivery; never print the link.
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL });
    await owner.locator('[data-action="issue-access"]').click();
    await owner.locator('#private-link').waitFor({ state: 'visible' });
    const link = await owner.locator('#private-link-value').inputValue();
    credentials.add(new URL(link).hash.slice(1));
    await owner.locator('#copy-private-link').click();
    await owner.waitForFunction(() => document.getElementById('private-link-copy-status').textContent === 'Private link copied.');
    assert.ok(await owner.evaluate(async (expected) => (await navigator.clipboard.readText()) === expected, link), 'Clipboard must contain the issued link');
    await owner.locator('#private-link [value="close"]').click();

    // Fresh context: no HTTP Basic credentials, existing storage or interviewer imports.
    await participant.goto(link);
    await loaded(participant);
    assert.equal(await participant.locator('[name="good"]').inputValue(), inertAnswer);
    assert.equal(await participant.evaluate(() => window.participantScriptExecuted), undefined);
    assert.equal(await participant.locator('#sheet [name]').count(), 31);
    for (const name of ['name', 'context', 'interviewer', 'discipline', 'talk_to']) assert.equal(await participant.locator(`[name="${name}"]`).count(), 0);
    await participant.locator('[name="ind_learn_start"]').fill('Participant completed the answer');
    await participant.locator('[name="good"]').fill('Clear feedback improves the handoff');
    assert.equal((await stored()).ind_learn_start, 'Synthetic initial answer');
    await participant.locator('#participant-save').click();
    await saved(participant);
    await participant.reload();
    await loaded(participant);
    assert.equal(await participant.locator('[name="ind_learn_start"]').inputValue(), 'Participant completed the answer');
    await owner.reload();
    await loaded(owner);
    assert.equal(await owner.locator('[name="ind_learn_start"]').inputValue(), 'Participant completed the answer');
    for (const [key, value] of [['name', privateValues[0]], ['context', privateValues[1]], ['talk_to', privateValues[2]]]) assert.equal((await stored())[key], value);
    const participantMarkup = await participant.content();
    assert.ok(!privateValues.some((value) => participantMarkup.includes(value)), 'Private answers must not enter the participant document');

    if (process.env.UPDATE_EVIDENCE === '1') {
      const evidence = join(import.meta.dir, '../docs/evidence');
      mkdirSync(evidence, { recursive: true });
      await participant.screenshot({ path: join(evidence, 'participant-completion.png'), fullPage: true });
    }
    await participant.emulateMedia({ media: 'print' });
    assert.equal(await participant.locator('#panel-team').isVisible(), true);
    assert.equal(await participant.locator('[name="context"]').count(), 0);
    await participant.emulateMedia({ media: 'screen' });

    // Offline errors retain drafts; typing and visibility changes cannot retry.
    await participantContext.setOffline(true);
    await participant.locator('[name="good"]').fill('Offline participant draft');
    await participant.locator('#participant-save').click();
    await participant.waitForFunction(() => document.getElementById('save-status').dataset.state === 'error');
    assert.equal(await participant.locator('[name="good"]').inputValue(), 'Offline participant draft');
    await participantContext.setOffline(false);
    const beforeRetry = apiRequests.length;
    await participant.locator('[name="good"]').fill('Explicitly retried draft');
    await participant.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await participant.waitForTimeout(500);
    assert.equal(apiRequests.length, beforeRetry);
    await participant.locator('#participant-save').click();
    await saved(participant);

    // Interviewer/participant overlap: conflict retains input and newer storage.
    await owner.reload();
    await loaded(owner);
    await owner.locator('[name="good"]').fill('Newer interviewer answer');
    await saved(owner);
    await participant.locator('[name="good"]').fill('Stale participant answer');
    await participant.locator('#participant-save').click();
    await participant.waitForFunction(() => document.getElementById('save-status').textContent.includes('Newer answers'));
    assert.equal(await participant.locator('[name="good"]').inputValue(), 'Stale participant answer');
    assert.equal((await stored()).good, 'Newer interviewer answer');
    assert.equal(await participant.locator('#participant-save').isDisabled(), true);
    const exporting = participant.waitForEvent('download');
    await participant.locator('#participant-export').click();
    const draftPath = join(directory, 'participant-draft.json');
    await (await exporting).saveAs(draftPath);
    const draft = await Bun.file(draftPath).json();
    assert.equal(draft.fields.good, 'Stale participant answer');
    assert.deepEqual(Object.keys(draft).sort(), ['fields', 'revision']);
    assert.ok(![...credentials, ...privateValues].some((value) => JSON.stringify(draft).includes(value)), 'Draft must exclude credentials and private fields');
    participant.once('dialog', (dialog) => dialog.accept());
    await participant.locator('#participant-reload').click();
    await participant.waitForFunction(() => document.querySelector('[name="good"]').value === 'Newer interviewer answer');

    // A pending save cannot overlap another; later typing stays unsaved.
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    let started;
    const writing = new Promise((resolve) => { started = resolve; });
    await participant.route('**/api/participant', async (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      const response = await route.fetch();
      started();
      await held;
      await route.fulfill({ response });
    });
    await participant.locator('[name="good"]').fill('First participant snapshot');
    await participant.locator('#participant-save').click();
    await writing;
    await participant.locator('[name="good"]').fill('Later participant input');
    assert.equal(await participant.locator('#participant-save').isDisabled(), true);
    release();
    await participant.waitForFunction(() => document.getElementById('save-status').textContent === 'Unsaved changes. Choose Save answers again.');
    assert.equal((await stored()).good, 'First participant snapshot');
    await participant.unroute('**/api/participant');
    await participant.locator('#participant-save').click();
    await saved(participant);
    assert.equal((await stored()).good, 'Later participant input');

    // Replacement invalidates already-open saves and fresh visits.
    const replacement = await issueLink();
    await participant.locator('[name="good"]').fill('Draft after replacement');
    await participant.locator('#participant-save').click();
    await unavailable(participant);
    assert.equal((await stored()).good, 'Later participant input');
    const fresh = await participantContext.newPage();
    await fresh.goto(link);
    await unavailable(fresh);
    await fresh.goto(replacement);
    await loaded(fresh);
    await owner.locator('[data-action="revoke-access"]').click();
    await owner.waitForFunction(() => document.getElementById('save-status').textContent.includes('Private link revoked'));
    await fresh.locator('#participant-reload').click();
    await unavailable(fresh);
    await fresh.reload();
    await unavailable(fresh);

    // Links issued before links stopped expiring keep their TTL; expiry denies open forms and new visits.
    const expiring = await issueLink();
    await fresh.goto(expiring);
    await loaded(fresh);
    await store.set(`link:${(await store.get(`sheet:${id}`)).linkHash}`, { sheetId: id }, Date.now() - 1);
    await fresh.locator('[name="good"]').fill('Draft after expiry');
    await fresh.locator('#participant-save').click();
    await unavailable(fresh);
    // Explicitly discard the draft only for this test's navigation.
    fresh.once('dialog', (dialog) => dialog.accept());
    await fresh.reload();
    await unavailable(fresh);
    await fresh.goto(`${baseURL}/participant#invalid`);
    await unavailable(fresh);
    await fresh.goto(`${baseURL}/participant`);
    await unavailable(fresh);

    // Missing participant credentials never load the signed-in owner's list.
    const signedIn = await context.newPage();
    const ownerDataRequests = [];
    signedIn.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/api/')) ownerDataRequests.push('API requested'); });
    await signedIn.goto(`${baseURL}/participant`);
    await unavailable(signedIn);
    assert.deepEqual(ownerDataRequests, []);
    await signedIn.close();

    // Initial load failures remain retryable, without an automatic retry loop.
    const retryLink = await issueLink();
    await fresh.route('**/api/participant', (route) => route.abort());
    await fresh.goto(retryLink);
    await fresh.waitForFunction(() => document.getElementById('save-status').dataset.state === 'error');
    assert.equal(await fresh.locator('#participant-reload').isEnabled(), true);
    await fresh.locator('#participant-reload').click();
    await fresh.waitForFunction(() => !document.getElementById('participant-reload').disabled);
    await fresh.unroute('**/api/participant');
    await fresh.locator('#participant-reload').click();
    await loaded(fresh);
    await fresh.setViewportSize({ width: 390, height: 844 });
    assert.equal(await fresh.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await fresh.evaluate(() => window.privateStorageAccess), 0);
    assert.deepEqual(violations, []);
    assert.deepEqual(errors, []);
    console.log('Participant browser passed: private copy/handoff, approved fields, reload, inert answers, explicit retry, conflicts, overlapping edits, replacement/revocation/expiry, missing/invalid links, isolated storage, referrers, print and mobile.');
  } catch (error) {
    // A failing Playwright action can include its navigation URL in the error.
    let message = error.stack ?? String(error);
    for (const credential of credentials) message = message.replaceAll(credential, '[REDACTED]');
    throw new Error(message);
  } finally {
    await owner.close({ runBeforeUnload: false });
    await participantContext.close();
  }
}
