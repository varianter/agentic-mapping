import { expect, test } from 'bun:test';
import { createApp, sessionToken } from '../server/app';
import { RESPONDENT_FIELDS } from '../client/fields.js';
import { memoryStore } from '../server/store';

const origin = 'https://mapping.example';
const adminKey = 'test-admin-key-0123456789-abcdefghij';
const adminCookie = `am_admin=${sessionToken(adminKey)}`;
function setup() {
  const store = memoryStore();
  const { app } = createApp({ store, adminKey, publicOrigin: origin });
  const send = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => app.request(`${origin}${path}`, {
    method,
    headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // One browser: keeps the respondent cookie the server sets, like a real cookie jar.
  const browser = () => {
    let cookie = '';
    return async (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => {
      const response = await send(path, method, body, { ...(cookie ? { Cookie: cookie } : {}), ...headers });
      const set = response.headers.get('Set-Cookie');
      if (set?.startsWith('am_respondent=')) cookie = /Max-Age=0/.test(set) ? '' : set.split(';')[0];
      return response;
    };
  };
  const owner = (path: string, method = 'GET', body?: unknown) => send(path, method, body, { Cookie: adminCookie });
  const interview = async (fields: Record<string, unknown>) => {
    const sheet = await (await owner('/api/sheets', 'POST', { id: crypto.randomUUID(), fields, createdAt: 1, updatedAt: 2 })).json();
    const { credential } = await (await owner(`/api/sheets/${sheet.id}/access`, 'POST', {})).json();
    return { sheet, credential };
  };
  return { store, send, browser, owner, interview };
}

test('the first save creates a self map that only this browser reads and updates', async () => {
  const { store, browser, owner } = setup();
  const me = browser();
  expect(await (await me('/api/me')).json()).toEqual({ fields: {}, revision: 0, source: 'self' });
  // Opening the page stores nothing.
  expect(await store.keys('')).toEqual([]);
  const first = await me('/api/me', 'PUT', { fields: { good: 'Synthetic own answer' }, revision: 0 });
  expect(first.status).toBe(201);
  const cookie = first.headers.get('Set-Cookie')!;
  expect(cookie).toMatch(/^am_respondent=[a-f0-9]{64};/);
  expect(cookie).toContain('HttpOnly');
  expect(cookie).toContain('SameSite=Strict');
  expect(cookie).toContain('Secure');
  const token = cookie.split(';')[0].split('=')[1];
  expect(JSON.stringify(Object.fromEntries(await Promise.all((await store.keys('')).map(async (key) => [key, await store.get(key)]))))).not.toContain(token);
  expect(await first.json()).toEqual({ fields: { good: 'Synthetic own answer' }, revision: 1, source: 'self' });
  const updated = await (await me('/api/me', 'PUT', { fields: { advice: 'Synthetic advice' }, revision: 1 })).json();
  expect(updated).toEqual({ fields: { good: 'Synthetic own answer', advice: 'Synthetic advice' }, revision: 2, source: 'self' });
  expect((await me('/api/me', 'PUT', { fields: { good: 'Stale' }, revision: 1 })).status).toBe(409);
  expect((await me('/api/me', 'PUT', { fields: { good: 'Duplicate' }, revision: 0 })).status).toBe(409);
  // Another browser has nothing.
  expect(await (await browser()('/api/me')).json()).toEqual({ fields: {}, revision: 0, source: 'self' });
  // The admin sees it among self-submitted maps only, and keeps private notes on it.
  const [submitted] = await (await owner('/api/sheets?source=self')).json();
  expect(submitted.fields).toEqual(updated.fields);
  expect(await (await owner('/api/sheets?source=interview')).json()).toEqual([]);
  const noted = await (await owner(`/api/sheets/${submitted.id}`, 'PUT', { ...submitted, fields: { ...submitted.fields, name: 'Private synthetic name' } })).json();
  const after = await (await me('/api/me', 'PUT', { fields: { good: 'Edited after notes' }, revision: noted.revision })).json();
  expect(after.fields).not.toHaveProperty('name');
  expect((await (await owner(`/api/sheets/${submitted.id}`)).json()).fields.name).toBe('Private synthetic name');
});

test('only answer fields are accepted and no credential, cross-site or admin route works through /api/me', async () => {
  const { store, browser, send } = setup();
  const me = browser();
  for (const body of [
    { fields: { name: 'Forbidden' }, revision: 0 },
    { fields: { good: ['Wrong type'] }, revision: 0 },
    { fields: { good: 'Allowed' }, revision: -1 },
    { fields: { good: 'Allowed' }, revision: 0, source: 'interview' },
    { fields: { good: 'Allowed' } },
    null,
  ]) expect((await me('/api/me', 'PUT', body)).status).toBe(400);
  expect((await me('/api/me', 'PUT', { fields: { good: 'Synthetic' }, revision: 0 }, { Origin: 'https://untrusted.example' })).status).toBe(403);
  expect((await me('/api/me', 'GET', undefined, { Authorization: `Bearer ${'a'.repeat(64)}` })).status).toBe(403);
  expect(await store.keys('')).toEqual([]);
  // A respondent cookie never grants interviewer access.
  await me('/api/me', 'PUT', { fields: { good: 'Synthetic' }, revision: 0 });
  expect((await me('/api/sheets')).status).toBe(401);
  expect((await me('/submissions')).status).toBe(303);
  expect((await send('/submissions', 'GET', undefined, { Cookie: adminCookie })).status).toBe(200);
  expect(await (await send('/submissions', 'GET', undefined, { Cookie: adminCookie })).text()).toContain('data-mode="interviewer" data-view="submissions"');
});

test('clearing deletes the self map; interview-bound browsers cannot clear', async () => {
  const { store, browser, interview } = setup();
  const me = browser();
  await me('/api/me', 'PUT', { fields: { good: 'Synthetic' }, revision: 0 });
  const cleared = await me('/api/me', 'DELETE', {});
  expect(cleared.status).toBe(204);
  expect(cleared.headers.get('Set-Cookie')).toContain('Max-Age=0');
  expect(await store.keys('sheet:')).toEqual([]);
  expect(await store.keys('respondent:')).toEqual([]);
  const { credential } = await interview({ good: 'Interview answer' });
  await me('/api/participant/connect', 'POST', {}, { Authorization: `Bearer ${credential}` });
  expect((await me('/api/me', 'DELETE', {})).status).toBe(409);
});

test('a link connects the browser to its interview until the interview is deleted', async () => {
  const { browser, owner, interview } = setup();
  const me = browser();
  const { sheet, credential } = await interview({ name: 'Private synthetic name', good: 'Interview answer' });
  expect((await me('/api/participant/connect', 'POST', {}, { Authorization: `Bearer ${'0'.repeat(64)}` })).status).toBe(404);
  expect((await me('/api/participant/connect', 'POST', { choice: 'other' }, { Authorization: `Bearer ${credential}` })).status).toBe(400);
  expect(await (await me('/api/participant/connect', 'POST', {}, { Authorization: `Bearer ${credential}` })).json()).toEqual({ connected: true });
  const view = await (await me('/api/me')).json();
  expect(view).toEqual({ fields: { good: 'Interview answer' }, revision: 1, source: 'interview' });
  await me('/api/me', 'PUT', { fields: { advice: 'Added later' }, revision: 1 });
  const stored = await (await owner(`/api/sheets/${sheet.id}`)).json();
  expect(stored.fields).toEqual({ name: 'Private synthetic name', good: 'Interview answer', advice: 'Added later' });
  // Showing the link again keeps the browser connected.
  await owner(`/api/sheets/${sheet.id}/access`, 'POST', {});
  expect((await (await me('/api/me')).json()).source).toBe('interview');
  // Deleting the interview disconnects browsers it connected; they fall back to an empty own map.
  expect((await owner(`/api/sheets/${sheet.id}`, 'DELETE', { revision: 2 })).status).toBe(204);
  expect(await (await me('/api/me')).json()).toEqual({ fields: {}, revision: 0, source: 'self' });
  expect((await me('/api/me', 'PUT', { fields: { good: 'Stale' }, revision: 2 })).status).toBe(409);
});

for (const [choice, expected] of [
  ['merge', { good: 'Interview answer\n\nMy answer', advice: 'My advice', missing: 'Interview only', surprised: 'Same' }],
  ['interview', { good: 'Interview answer', advice: '', missing: 'Interview only', surprised: 'Same' }],
  ['mine', { good: 'My answer', advice: 'My advice', missing: '', surprised: 'Same' }],
] as const) {
  test(`an own map asks first, then "${choice}" sets the interview answers and deletes the own map`, async () => {
    const { store, browser, owner, interview } = setup();
    const me = browser();
    await me('/api/me', 'PUT', { fields: { good: 'My answer', advice: 'My advice', surprised: 'Same' }, revision: 0 });
    const [own] = await (await owner('/api/sheets?source=self')).json();
    const { sheet, credential } = await interview({ name: 'Private synthetic name', good: 'Interview answer', missing: 'Interview only', surprised: 'Same' });
    const asked = await (await me('/api/participant/connect', 'POST', {}, { Authorization: `Bearer ${credential}` })).json();
    expect(asked.needsChoice).toBe(true);
    expect(asked.mine.good).toBe('My answer');
    expect(asked.interview).not.toHaveProperty('name');
    // Asking changes nothing.
    expect((await (await owner(`/api/sheets/${sheet.id}`)).json()).revision).toBe(1);
    expect(await store.get(`sheet:${own.id}`)).not.toBeNull();
    expect((await me('/api/participant/connect', 'POST', { choice }, { Authorization: `Bearer ${credential}` })).status).toBe(200);
    const fields = (await (await owner(`/api/sheets/${sheet.id}`)).json()).fields;
    expect(fields.name).toBe('Private synthetic name');
    for (const key of RESPONDENT_FIELDS) expect(fields[key] ?? '').toBe((expected as Record<string, string>)[key] ?? '');
    expect(await store.get(`sheet:${own.id}`)).toBeNull();
    expect((await me('/api/me')).status).toBe(200);
    expect((await (await me('/api/me')).json()).source).toBe('interview');
  });
}

test('an empty own map connects without asking; self-only mode has no /api/me', async () => {
  const { browser, interview } = setup();
  const me = browser();
  await me('/api/me', 'PUT', { fields: { good: '  ' }, revision: 0 });
  const { credential } = await interview({ good: 'Interview answer' });
  expect(await (await me('/api/participant/connect', 'POST', {}, { Authorization: `Bearer ${credential}` })).json()).toEqual({ connected: true });
  const { app } = createApp({});
  expect((await app.request('http://localhost/api/me')).status).toBe(404);
  expect((await app.request('http://localhost/submissions')).status).toBe(404);
});
