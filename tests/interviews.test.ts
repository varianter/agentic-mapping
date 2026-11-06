import { expect, spyOn, test } from 'bun:test';
import { adminCookie, json, setup, sheetForm, type Send } from './helpers';

async function newInterview(owner: Send) {
  const created = await owner('/interviews', { method: 'POST', form: {} });
  expect(created.status).toBe(303);
  const path = created.headers.get('Location')!;
  expect(path).toMatch(/^\/interviews\/[0-9a-f-]{36}$/);
  return { path, id: path.split('/').pop()! };
}

const fields = (extra: Record<string, string | string[]> = {}) => ({ revision: '1', name: 'Synthetic interview', ind_why_next: 'Notes', ...extra });

test('interviewer pages need the admin cookie; respondents and wrong cookies are sent to sign in', async () => {
  const { send, owner } = setup();
  const { path } = await newInterview(owner);
  for (const cookie of [undefined, 'am_admin=forged', 'am_respondent=' + 'a'.repeat(64)]) {
    const headers = cookie ? { Cookie: cookie } : undefined;
    for (const target of ['/interviews', path, `${path}.json`]) {
      const response = await send(target, { headers });
      expect(response.status).toBe(303);
      expect(response.headers.get('Location')).toBe('/sign-in');
    }
    for (const target of ['/interviews', path, `${path}/delete`, '/interviews/import']) {
      expect((await send(target, { method: 'POST', form: fields(), headers })).status).toBe(401);
    }
  }
  // Signed-in interviewers start from their list.
  const home = await owner('/');
  expect(home.status).toBe(303);
  expect(home.headers.get('Location')).toBe('/interviews');
});

test('a new interview opens with today’s date, the full sheet and its connect URL', async () => {
  const { owner } = setup();
  const empty = await owner('/interviews');
  expect(empty.status).toBe(200);
  expect(await empty.text()).toContain('No interviews yet');
  const { path, id } = await newInterview(owner);
  expect((await owner('/interviews')).headers.get('Location')).toBe(path);
  const html = await (await owner(path)).text();
  const form = sheetForm(html);
  expect(form.revision).toBe(1);
  expect(form.fields.date).toBe(new Date().toISOString().slice(0, 10));
  for (const name of ['name', 'interviewer', 'context', 'talk_to', 'good', 'org_found_good']) expect(form.names).toContain(name);
  expect(html).toContain('name="discipline"');
  expect(html).toMatch(/\/connect#[a-f0-9]{64}/);
  expect(html).toContain(`href="/interviews/${id}" data-id="${id}" aria-current="page"`);
});

test('saving without JS redirects; autosave gets JSON; stale revisions conflict and keep the draft', async () => {
  const { owner } = setup();
  const { path } = await newInterview(owner);
  const saved = await owner(path, { method: 'POST', form: fields({ discipline: ['UX', 'Developer'] }) });
  expect(saved.status).toBe(303);
  expect(saved.headers.get('Location')).toBe(`${path}?saved`);
  const html = await (await owner(`${path}?saved`)).text();
  expect(sheetForm(html)).toMatchObject({ revision: 2, fields: { name: 'Synthetic interview', ind_why_next: 'Notes' } });
  expect(html).toMatch(/value="UX" checked/);
  expect(html).toContain('Saved to server');
  const autosaved = await owner(path, { method: 'POST', form: fields({ revision: '2', name: 'Renamed' }), headers: json });
  expect(await autosaved.json()).toEqual({ revision: 3 });
  const stale = await owner(path, { method: 'POST', form: fields({ revision: '2', name: 'Stale device' }) });
  expect(stale.status).toBe(409);
  const draft = await stale.text();
  expect(draft).toContain('Another device changed this sheet');
  expect(sheetForm(draft).fields.name).toBe('Stale device');
  expect(sheetForm(draft).revision).toBe(2);
  expect((await owner(path, { method: 'POST', form: fields({ revision: '2' }), headers: json })).status).toBe(409);
  // The sidebar lists it by name, with its details.
  expect(await (await owner(path)).text()).toContain('<span class="sheet-name">Renamed</span><span class="sheet-meta">');
});

test('validation errors name invalid fields and preserve omitted discipline selections as empty', async () => {
  const { owner } = setup();
  const { path } = await newInterview(owner);
  await owner(path, { method: 'POST', form: fields({ discipline: ['UX', 'Developer'] }) });
  const invalid = fields({ revision: '2', name: 'x'.repeat(100_001) });

  const page = await owner(path, { method: 'POST', form: invalid });
  expect(page.status).toBe(422);
  const html = await page.text();
  expect(html).toContain('name:');
  expect(html).toContain('100000');
  expect(html).not.toMatch(/value="(?:UX|Developer)" checked/);

  const response = await owner(path, { method: 'POST', form: invalid, headers: json });
  const body = await response.json();
  expect(response.status).toBe(422);
  expect(body.error).toContain('name:');
  expect(body.error).toContain('100000');
  expect(body.fieldErrors.name[0]).toContain('100000');
});

test('autosave reads and writes only its sheet; opening one reads it once, beside the list and link', async () => {
  const { owner, store } = setup();
  const { path, id } = await newInterview(owner);
  await owner(path);
  const calls = (['get', 'set', 'keys'] as const).map((method) => [method, spyOn(store, method)] as const);
  const made = () => Object.fromEntries(calls.map(([method, spy]) => [method, spy.mock.calls.map(([key]) => key)]));
  await owner(path, { method: 'POST', form: fields(), headers: json });
  expect(made()).toEqual({ get: [`sheet:${id}`], set: [`sheet:${id}`], keys: [] });
  for (const [, spy] of calls) spy.mockClear();
  await owner(path);
  const { get, keys } = made();
  expect(keys).toEqual(['sheet:']);
  // Once to open it, once in the list.
  expect(get.filter((key: string) => key === `sheet:${id}`)).toHaveLength(2);
  for (const [, spy] of calls) spy.mockRestore();
});

test('tampered fields are refused; nothing changes', async () => {
  const { owner, store } = setup();
  const { path, id } = await newInterview(owner);
  for (const form of [fields({ unknown: 'x' }), fields({ revision: '0' }), fields({ name: ['a', 'b'] }), { name: 'No revision' }]) {
    expect((await owner(path, { method: 'POST', form, headers: json })).status).toBe(422);
  }
  expect((await store.get(`sheet:${id}`)).revision).toBe(1);
  expect((await owner('/interviews/not-a-sheet')).status).toBe(404);
  expect((await owner(`/interviews/${crypto.randomUUID()}`)).status).toBe(404);
});

test('deleting checks the revision; deleted interviews cannot be saved again', async () => {
  const { owner, store } = setup();
  const { path, id } = await newInterview(owner);
  await owner(path, { method: 'POST', form: fields() });
  expect((await owner(`${path}/delete`, { method: 'POST', form: { revision: '1' } })).status).toBe(409);
  const deleted = await owner(`${path}/delete`, { method: 'POST', form: fields({ revision: '2' }) });
  expect(deleted.status).toBe(303);
  expect(deleted.headers.get('Location')).toBe('/interviews');
  expect(await store.get(`sheet:${id}`)).toBeNull();
  expect(await store.keys('link:')).toEqual([]);
  const late = await owner(path, { method: 'POST', form: fields({ revision: '2' }), headers: json });
  expect(late.status).toBe(404);
  expect(await store.get(`sheet:${id}`)).toBeNull();
});

test('Download JSON gives the interview without its link hash', async () => {
  const { owner } = setup();
  const { path, id } = await newInterview(owner);
  await owner(path, { method: 'POST', form: fields() });
  const file = await owner(`${path}.json`);
  expect(file.headers.get('Content-Disposition')).toContain("filename*=UTF-8''Interview%20-%20Synthetic%20interview");
  const [sheet] = await file.json();
  expect(sheet).toMatchObject({ id, source: 'interview', revision: 2, fields: { name: 'Synthetic interview' } });
  expect(sheet).not.toHaveProperty('linkHash');
});

test('failed writes show an error page and leave the stored sheet unchanged', async () => {
  const { owner, store } = setup();
  const { path, id } = await newInterview(owner);
  await owner(path);
  store.failWrites = true;
  const page = await owner(path, { method: 'POST', form: fields() });
  expect(page.status).toBe(503);
  expect(await page.text()).toContain('Storage unavailable');
  const autosave = await owner(path, { method: 'POST', form: fields(), headers: json });
  expect(autosave.status).toBe(503);
  expect((await autosave.json()).error).toContain('Keep your draft');
  store.failWrites = false;
  expect((await store.get(`sheet:${id}`)).fields).not.toHaveProperty('name');
});

test('cross-site posts and oversized bodies are refused', async () => {
  const { owner } = setup();
  const { path } = await newInterview(owner);
  expect((await owner(path, { method: 'POST', form: fields(), headers: { Origin: 'https://evil.example', Cookie: adminCookie } })).status).toBe(403);
  expect((await owner(path, { method: 'POST', form: fields({ context: 'x'.repeat(1024 * 1024) }) })).status).toBe(413);
});

test('interviewers get every tool others listed as suggestions, most used first, not the open sheet’s own', async () => {
  const { owner, browser } = setup();
  await browser()('/', { method: 'POST', form: { revision: '0', tools: 'TDD\nSynthetic self tool' } });
  await browser()('/', { method: 'POST', form: { revision: '0', tools: 'TDD' } });
  const other = await newInterview(owner);
  await owner(other.path, { method: 'POST', form: fields({ tools: 'tdd\nPairing' }) });
  const { path } = await newInterview(owner);
  await owner(path, { method: 'POST', form: fields({ tools: 'Own tool' }) });
  const html = await (await owner(path)).text();
  expect([...html.matchAll(/<option value="([^"]+)"/g)].map(([, value]) => value)).toEqual(['TDD', 'Pairing', 'Synthetic self tool']);
});
