import { expect, test } from 'bun:test';
import { createGroup, renameGroup, slugify, validSlug } from '../server/domain/groups';
import { memoryStore } from '../server/store';
import { adminCookie, origin, setup, sheetForm, type Send } from './helpers';

// A group made through the Groups page, as an interviewer does.
async function newGroup(owner: Send, name: string, slug?: string) {
  const created = await owner('/groups', { method: 'POST', form: { name, ...(slug !== undefined ? { slug } : {}) } });
  expect(created.status).toBe(303);
  return created.headers.get('Location')!;
}
const linkOf = async (owner: Send, path: string) => /\/connect#([a-f0-9]{64})/.exec(await (await owner(path)).text())![1];

test('ids come from names, stay readable and never take a page’s path or an existing id', async () => {
  expect(slugify('  Company Å / Ærlig Øl ')).toBe('company-a-aerlig-ol');
  expect(slugify('https://mapping.example/x')).toBe('https-mapping-example-x');
  for (const slug of ['company-a', 'a1']) expect(validSlug(slug)).toBe(true);
  for (const slug of ['a', '-a', 'a-', 'Company', 'a.json', 'interviews', 'map', 'groups', 'x'.repeat(41)]) expect(validSlug(slug)).toBe(false);
  const store = memoryStore();
  expect(await createGroup(store, { name: 'Company A' })).toMatchObject({ ok: true, group: { slug: 'company-a', name: 'Company A' } });
  expect(await createGroup(store, { name: 'Company A again', slug: 'Company A' })).toMatchObject({ ok: false, field: 'slug' });
  expect(await createGroup(store, { name: 'Interviews' })).toMatchObject({ ok: false, field: 'slug' });
  expect(await createGroup(store, { name: '!!' })).toMatchObject({ ok: false, field: 'slug' });
  expect(await createGroup(store, { name: '  ' })).toMatchObject({ ok: false, field: 'name' });
  const renamed = await renameGroup(store, (await store.get('group:company-a'))!, 'Company A AS');
  expect(renamed).toMatchObject({ ok: true, group: { slug: 'company-a', name: 'Company A AS' } });
});

test('interviewers create and rename groups on the Groups page; nobody else can', async () => {
  const { send, owner, store } = setup();
  expect((await send('/groups')).headers.get('Location')).toBe('/sign-in');
  expect((await send('/groups', { method: 'POST', form: { name: 'Forged' } })).status).toBe(401);
  expect(await newGroup(owner, 'Company A')).toBe('/company-a/interviews');
  expect(await newGroup(owner, 'Second', 'beta-co')).toBe('/beta-co/interviews');
  const taken = await owner('/groups', { method: 'POST', form: { name: 'Again', slug: 'company-a' } });
  expect(taken.status).toBe(422);
  const html = await taken.text();
  expect(html).toContain('already exists');
  expect(html).toContain('value="Again"');
  const page = await (await owner('/groups')).text();
  expect(page).toContain(`value="${origin}/company-a"`);
  expect(page).toContain(`value="${origin}/map"`);
  expect(page).toContain('href="/beta-co/submissions"');
  expect((await owner('/groups/company-a', { method: 'POST', form: { name: 'Company A AS' } })).headers.get('Location')).toBe('/groups');
  expect(await store.get('group:company-a')).toMatchObject({ slug: 'company-a', name: 'Company A AS' });
  expect((await owner('/groups/company-a', { method: 'POST', form: { name: ' ' } })).status).toBe(422);
  expect((await owner('/groups/nope', { method: 'POST', form: { name: 'X' } })).status).toBe(404);
});

test('the start page takes a group id, as typed or pasted, and never creates a group', async () => {
  const { send, owner, store } = setup();
  await newGroup(owner, 'Company A');
  const start = await (await send('/')).text();
  expect(start).toContain('name="group"');
  expect(start).toContain('href="/map"');
  for (const typed of ['company-a', ' Company A ', `${origin}/company-a`]) {
    const joined = await send(`/?group=${encodeURIComponent(typed)}`);
    expect(joined.status).toBe(303);
    expect(joined.headers.get('Location')).toBe('/company-a');
  }
  const unknown = await send('/?group=Company%20X');
  expect(unknown.status).toBe(404);
  expect(await unknown.text()).toContain('No group called “company-x”');
  expect((await send('/?group=%20')).status).toBe(422);
  const direct = await send('/company-x');
  expect(direct.status).toBe(404);
  expect(await direct.text()).toContain('name="group"');
  expect((await send('/package.json')).status).toBe(404);
  expect(await store.keys('group:')).toEqual(['group:company-a']);
  // Interviewers go to the group's interviews instead.
  expect((await owner('/company-a')).headers.get('Location')).toBe('/company-a/interviews');
  expect((await owner('/company-x')).status).toBe(404);
  // Without interviewers there are no groups: straight to the map.
  const selfOnly = setup({ admin: false });
  expect((await selfOnly.send('/')).headers.get('Location')).toBe('/map');
  expect((await selfOnly.send('/company-a')).status).toBe(404);
});

test('a browser keeps one map per group, each listed on the start page and saved in its group', async () => {
  const { owner, browser, store } = setup();
  await newGroup(owner, 'Company A');
  await newGroup(owner, 'Company B');
  const me = browser();
  const saved = await me('/company-a', { method: 'POST', form: { revision: '0', good: 'In A' } });
  expect(saved.headers.get('Location')).toBe('/company-a?saved');
  await me('/map', { method: 'POST', form: { revision: '0', good: 'Without a group' } });
  const pageA = await (await me('/company-a')).text();
  expect(sheetForm(pageA)).toMatchObject({ revision: 1, fields: { good: 'In A' } });
  expect(pageA).toContain('Company A');
  expect(sheetForm(await (await me('/map')).text()).fields.good).toBe('Without a group');
  expect(sheetForm(await (await me('/company-b')).text())).toMatchObject({ revision: 0, fields: { good: '' } });
  const start = await (await me('/')).text();
  expect(start).toContain('href="/company-a"');
  expect(start).toContain('href="/map"');
  expect(start).not.toContain('href="/company-b"');
  const sheets = await Promise.all((await store.keys('sheet:')).map((key) => store.get(key)));
  expect(sheets.map((sheet) => sheet.group ?? null).toSorted()).toEqual(['company-a', null]);
  // Clearing one group's map leaves the others.
  await me('/company-a/clear', { method: 'POST', form: {} });
  expect(sheetForm(await (await me('/company-a')).text()).revision).toBe(0);
  expect(sheetForm(await (await me('/map')).text()).fields.good).toBe('Without a group');
  expect((await (await me('/map/me.json')).json()).fields.good).toBe('Without a group');
});

test('interviewers work inside one group: its lists, its new interviews and uploads, nothing from others', async () => {
  const { owner, browser, app } = setup();
  await newGroup(owner, 'Company A');
  const created = await owner('/company-a/interviews', { method: 'POST', form: {} });
  const path = created.headers.get('Location')!;
  expect(path).toMatch(/^\/company-a\/interviews\/[0-9a-f-]{36}$/);
  const id = path.split('/').pop()!;
  const ungrouped = (await owner('/interviews', { method: 'POST', form: {} })).headers.get('Location')!;
  const page = await (await owner(path)).text();
  expect(page).toContain('action="/company-a/interviews/');
  expect(page).toContain(`href="/company-a/interviews/${id}"`);
  expect(page).not.toContain(`href="${ungrouped}"`);
  expect(page).toContain('href="/company-a/submissions"');
  expect(page).toContain('href="/groups"');
  // A sheet is only found in its own group.
  expect((await owner(`/interviews/${id}`)).status).toBe(404);
  expect((await owner(`/company-a${ungrouped}`)).status).toBe(404);
  expect((await owner('/company-x/interviews')).status).toBe(404);
  const saved = await owner(path, { method: 'POST', form: { revision: '1', name: 'Synthetic A' } });
  expect(saved.headers.get('Location')).toBe(`${path}?saved`);
  // Self-submitted maps show up in their group only.
  await browser()('/company-a', { method: 'POST', form: { revision: '0', advice: 'Synthetic advice' } });
  expect((await owner('/company-a/submissions')).headers.get('Location')).toMatch(/^\/company-a\/submissions\/[0-9a-f-]{36}$/);
  expect((await owner('/submissions')).status).toBe(200);
  // Uploads go into the group uploaded from, whatever group the file names.
  const body = new FormData();
  const sheet = { id: crypto.randomUUID(), group: 'company-b', fields: { name: 'Uploaded' }, createdAt: 1, updatedAt: 2 };
  body.append('file', new File([JSON.stringify([sheet])], 'dump.json', { type: 'application/json' }));
  const uploaded = await app.request(`${origin}/company-a/interviews/import`, { method: 'POST', headers: { Cookie: adminCookie, Origin: origin }, body });
  expect(uploaded.status).toBe(200);
  const list = await (await owner(`/company-a/interviews/${sheet.id}`)).text();
  expect(list).toContain('Uploaded');
  const download = await (await owner(`/company-a/interviews/${sheet.id}.json`)).json();
  expect(download[0].group).toBe('company-a');
});

test('respondents get tool suggestions from their own group only', async () => {
  const { owner, browser } = setup();
  await newGroup(owner, 'Company A');
  await newGroup(owner, 'Company B');
  for (const group of ['company-a', 'company-a', 'company-b', 'company-b']) {
    await browser()(`/${group}`, { method: 'POST', form: { revision: '0', tools: group === 'company-a' ? 'Alpha tool' : 'Beta tool' } });
  }
  const suggestions = (html: string) => [...html.matchAll(/<option value="([^"]+)"/g)].map(([, value]) => value);
  expect(suggestions(await (await browser()('/company-a')).text())).toEqual(['Alpha tool']);
  expect(suggestions(await (await browser()('/company-b')).text())).toEqual(['Beta tool']);
  expect(suggestions(await (await browser()('/map')).text())).toEqual([]);
});

test('a connect link opens its interview in its group, merging only with the browser’s map there', async () => {
  const { owner, browser, store } = setup();
  await newGroup(owner, 'Company A');
  const path = (await owner('/company-a/interviews', { method: 'POST', form: {} })).headers.get('Location')!;
  const credential = await linkOf(owner, path);
  const me = browser();
  await me('/map', { method: 'POST', form: { revision: '0', good: 'Ungrouped answer' } });
  // The map without a group isn't offered: nothing to choose.
  const connected = await me('/connect', { method: 'POST', form: { credential } });
  expect(connected.status).toBe(303);
  expect(connected.headers.get('Location')).toBe('/company-a');
  expect(await (await me('/company-a')).text()).toContain('Your interview');
  expect(sheetForm(await (await me('/map')).text()).fields.good).toBe('Ungrouped answer');
  // A map in the same group is.
  const other = browser();
  await other('/company-a', { method: 'POST', form: { revision: '0', good: 'Own answer in A' } });
  const asked = await other('/connect', { method: 'POST', form: { credential } });
  expect(asked.status).toBe(200);
  expect(await asked.text()).toContain('You already have a map');
  expect((await other('/connect', { method: 'POST', form: { credential, choice: 'merge' } })).headers.get('Location')).toBe('/company-a');
  expect((await store.keys('sheet:')).length).toBe(2);
});
