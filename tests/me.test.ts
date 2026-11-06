import { expect, test } from 'bun:test';
import { RESPONDENT_FIELDS } from '../server/domain/fields';
import { json, setup, sheetForm } from './helpers';

test('My map renders only respondent fields and a name, and opening it stores nothing', async () => {
  const { store, browser } = setup();
  const page = await browser()('/');
  expect(page.status).toBe(200);
  const html = await page.text();
  const form = sheetForm(html);
  expect(form.revision).toBe(0);
  expect(form.names.toSorted()).toEqual([...RESPONDENT_FIELDS, 'name'].toSorted());
  expect(html).toContain('Your name');
  // Interviewer-only fields are not sent at all, rather than hidden.
  for (const name of ['name="interviewer"', 'name="talk_to"', 'name="discipline"']) expect(html).not.toContain(name);
  expect(html).toContain('href="/sign-in"');
  expect(await store.keys('')).toEqual([]);
});

test('a plain form post creates the map, redirects back and sets an HttpOnly browser cookie', async () => {
  const { store, browser } = setup();
  const me = browser();
  const first = await me('/', { method: 'POST', form: { revision: '0', good: 'Synthetic own answer' } });
  expect(first.status).toBe(303);
  expect(first.headers.get('Location')).toBe('/?saved');
  const cookie = first.headers.get('Set-Cookie')!;
  expect(cookie).toMatch(/^am_respondent=[a-f0-9]{64};/);
  for (const flag of ['HttpOnly', 'SameSite=Strict', 'Secure']) expect(cookie).toContain(flag);
  const token = cookie.split(';')[0].split('=')[1];
  const dump = JSON.stringify(await Promise.all((await store.keys('')).map((key) => store.get(key))));
  expect(dump).not.toContain(token);
  const saved = await (await me('/?saved')).text();
  expect(saved).toContain('Saved.');
  expect(sheetForm(saved)).toMatchObject({ revision: 1, fields: { good: 'Synthetic own answer' } });
  // Another browser starts empty.
  expect(sheetForm(await (await browser()('/')).text()).fields.good).toBe('');
});

test('autosave posts the same form for JSON; stale revisions conflict and keep what was typed', async () => {
  const { browser } = setup();
  const me = browser();
  const created = await me('/', { method: 'POST', form: { revision: '0', good: 'First' }, headers: json });
  expect(created.status).toBe(200);
  expect(await created.json()).toEqual({ revision: 1 });
  expect(await (await me('/', { method: 'POST', form: { revision: '1', advice: 'Second' }, headers: json })).json()).toEqual({ revision: 2 });
  const stale = await me('/', { method: 'POST', form: { revision: '1', good: 'Stale draft' }, headers: json });
  expect(stale.status).toBe(409);
  expect((await stale.json()).error).toContain('changed elsewhere');
  // Without JS the conflict re-renders the page with the draft, not the stored text.
  const page = await me('/', { method: 'POST', form: { revision: '1', good: 'Stale draft' } });
  expect(page.status).toBe(409);
  const html = await page.text();
  expect(html).toContain('role="alert"');
  expect(sheetForm(html).fields.good).toBe('Stale draft');
  expect(sheetForm(html).revision).toBe(1);
  expect((await me('/', { method: 'POST', form: { revision: '1', good: 'Stale draft' }, headers: json })).status).toBe(409);
  expect((await me('/', { method: 'POST', form: { revision: '0', good: 'Duplicate' }, headers: json })).status).toBe(409);
  expect(sheetForm(await (await me('/')).text()).fields).toMatchObject({ good: 'First', advice: 'Second' });
});

test('only answer fields are accepted, and cross-site posts are refused', async () => {
  const { store, browser } = setup();
  const me = browser();
  for (const form of [{ revision: '0', interviewer: 'Forbidden' }, { revision: '0', good: ['One', 'Two'] }, { revision: '-1', good: 'x' }, { revision: 'x', good: 'x' }, { good: 'x' }]) {
    expect((await me('/', { method: 'POST', form, headers: json })).status).toBe(422);
  }
  expect((await me('/', { method: 'POST', form: { revision: '0', good: 'x' }, headers: { Origin: 'https://untrusted.example' } })).status).toBe(403);
  expect(await store.keys('')).toEqual([]);
  // A respondent cookie never grants interviewer access.
  await me('/', { method: 'POST', form: { revision: '0', good: 'Synthetic' } });
  expect((await me('/submissions')).status).toBe(303);
});

test('Download JSON returns the answers as a file', async () => {
  const { browser } = setup();
  const me = browser();
  await me('/', { method: 'POST', form: { revision: '0', advice: 'Synthetic advice' } });
  const file = await me('/me.json');
  expect(file.headers.get('Content-Disposition')).toContain('my-agentic-map.json');
  const { fields } = await file.json();
  expect(fields.advice).toBe('Synthetic advice');
  expect(Object.keys(fields).toSorted()).toEqual([...RESPONDENT_FIELDS, 'name'].toSorted());
});

test('an own map keeps the name the respondent registers', async () => {
  const { browser, owner } = setup();
  const me = browser();
  await me('/', { method: 'POST', form: { revision: '0', name: 'Synthetic Respondent', good: 'Synthetic' } });
  expect(sheetForm(await (await me('/')).text()).fields).toMatchObject({ name: 'Synthetic Respondent', good: 'Synthetic' });
  expect((await (await me('/me.json')).json()).fields.name).toBe('Synthetic Respondent');
  // The interviewer's list of self-submitted maps shows it.
  const location = (await owner('/submissions')).headers.get('Location')!;
  expect(await (await owner(location)).text()).toContain('<span class="sheet-name">Synthetic Respondent</span>');
});

test('clearing deletes the map and the cookie', async () => {
  const { store, browser } = setup();
  const me = browser();
  await me('/', { method: 'POST', form: { revision: '0', good: 'Synthetic' } });
  const cleared = await me('/clear', { method: 'POST', form: {} });
  expect(cleared.status).toBe(303);
  expect(cleared.headers.get('Set-Cookie')).toContain('Max-Age=0');
  expect(await store.keys('sheet:')).toEqual([]);
  expect(await store.keys('respondent:')).toEqual([]);
});

test('without an admin key My map still saves on the server, with no interviewer pages', async () => {
  const { store, browser, send } = setup({ admin: false });
  const me = browser();
  const html = await (await me('/')).text();
  expect(html).not.toContain('/sign-in');
  expect((await me('/', { method: 'POST', form: { revision: '0', good: 'Self-only answer' } })).status).toBe(303);
  expect((await store.keys('sheet:')).length).toBe(1);
  for (const path of ['/sign-in', '/submissions', '/interviews', '/participant']) expect((await send(path)).status).toBe(404);
  expect((await send('/sign-in', { method: 'POST', form: { key: 'x' } })).status).toBe(404);
});
