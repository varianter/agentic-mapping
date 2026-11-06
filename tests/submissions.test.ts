import { expect, test } from 'bun:test';
import { json, setup, sheetForm } from './helpers';

test('self-submitted maps are listed at /submissions only, and private notes survive the respondent’s saves', async () => {
  const { owner, browser, store } = setup();
  const me = browser();
  await me('/', { method: 'POST', form: { revision: '0', advice: 'Synthetic submitted advice' } });
  const [key] = await store.keys('sheet:');
  const id = key.slice('sheet:'.length);
  expect(await (await owner('/interviews')).text()).toContain('No interviews yet');
  const list = await owner('/submissions');
  expect(list.headers.get('Location')).toBe(`/submissions/${id}`);
  const html = await (await owner(`/submissions/${id}`)).text();
  expect(sheetForm(html)).toMatchObject({ revision: 1, fields: { advice: 'Synthetic submitted advice' } });
  expect(html).toContain('Self-submitted map');
  expect(html).not.toContain('Connect URL');
  expect((await owner(`/interviews/${id}`)).status).toBe(404);

  // The interviewer adds a private name; the respondent's next save keeps it and never shows it.
  expect(await (await owner(`/submissions/${id}`, { method: 'POST', form: { revision: '1', name: 'Private synthetic name', advice: 'Synthetic submitted advice' }, headers: json })).json()).toEqual({ revision: 2 });
  await me('/', { method: 'POST', form: { revision: '2', good: 'Edited after notes' } });
  expect(await (await me('/')).text()).not.toContain('Private synthetic name');
  expect((await store.get(key)).fields).toMatchObject({ name: 'Private synthetic name', good: 'Edited after notes' });

  expect((await owner(`/submissions/${id}/delete`, { method: 'POST', form: { revision: '3' } })).headers.get('Location')).toBe('/submissions');
  expect(await (await owner('/submissions')).text()).toContain('No self-submitted maps yet');
});

test('submissions need the admin cookie and do not exist without an admin key', async () => {
  expect((await setup().browser()('/submissions')).headers.get('Location')).toBe('/sign-in');
  expect((await setup({ admin: false }).send('/submissions')).status).toBe(404);
});
