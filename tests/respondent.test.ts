import { expect, test } from 'bun:test';
import { RESPONDENT_FIELDS } from '../server/domain/fields';
import { setup as baseSetup, sheetForm, type Send } from './helpers';

// A private link connects a browser to its interview; My map then edits that interview.
function setup() {
  const base = baseSetup();
  const interview = async (fields: Record<string, unknown>) => {
    const sheet = await (await base.owner('/api/sheets', { method: 'POST', json: { id: crypto.randomUUID(), fields, createdAt: 1, updatedAt: 2 } })).json();
    const { credential } = await (await base.owner(`/api/sheets/${sheet.id}/access`, { method: 'POST', json: {} })).json();
    return { sheet, credential };
  };
  const connect = (me: Send, credential: string, body: unknown = {}) => me('/api/participant/connect', { method: 'POST', json: body, headers: { Authorization: `Bearer ${credential}` } });
  const myMap = async (me: Send) => sheetForm(await (await me('/')).text());
  return { ...base, interview, connect, myMap };
}

test('clearing is refused for interview-bound browsers', async () => {
  const { browser, interview, connect } = setup();
  const me = browser();
  const { credential } = await interview({ good: 'Interview answer' });
  await connect(me, credential);
  expect(await (await me('/')).text()).not.toContain('confirm-clear');
  expect((await me('/clear', { method: 'POST', form: {} })).status).toBe(409);
});

test('a link connects the browser to its interview until the interview is deleted', async () => {
  const { browser, owner, interview, connect, myMap } = setup();
  const me = browser();
  const { sheet, credential } = await interview({ name: 'Private synthetic name', good: 'Interview answer' });
  expect((await connect(me, '0'.repeat(64))).status).toBe(404);
  expect((await connect(me, credential, { choice: 'other' })).status).toBe(400);
  expect(await (await connect(me, credential)).json()).toEqual({ connected: true });
  const page = await (await me('/')).text();
  expect(page).toContain('Your interview');
  expect(page).not.toContain('Private synthetic name');
  expect(await myMap(me)).toMatchObject({ revision: 1, fields: { good: 'Interview answer' } });
  await me('/', { method: 'POST', form: { revision: '1', advice: 'Added later' } });
  const stored = await (await owner(`/api/sheets/${sheet.id}`)).json();
  expect(stored.fields).toEqual({ name: 'Private synthetic name', good: 'Interview answer', advice: 'Added later' });
  // Showing the link again keeps the browser connected.
  await owner(`/api/sheets/${sheet.id}/access`, { method: 'POST', json: {} });
  expect(await (await me('/')).text()).toContain('Your interview');
  // Deleting the interview disconnects browsers it connected; they fall back to an empty own map.
  expect((await owner(`/api/sheets/${sheet.id}`, { method: 'DELETE', json: { revision: 2 } })).status).toBe(204);
  expect(await myMap(me)).toMatchObject({ revision: 0, fields: { good: '', advice: '' } });
  expect((await me('/', { method: 'POST', form: { revision: '2', good: 'Stale' } })).status).toBe(409);
});

for (const [choice, expected] of [
  ['merge', { good: 'Interview answer\n\nMy answer', advice: 'My advice', missing: 'Interview only', surprised: 'Same' }],
  ['interview', { good: 'Interview answer', advice: '', missing: 'Interview only', surprised: 'Same' }],
  ['mine', { good: 'My answer', advice: 'My advice', missing: '', surprised: 'Same' }],
] as const) {
  test(`an own map asks first, then "${choice}" sets the interview answers and deletes the own map`, async () => {
    const { store, browser, owner, interview, connect } = setup();
    const me = browser();
    await me('/', { method: 'POST', form: { revision: '0', good: 'My answer', advice: 'My advice', surprised: 'Same' } });
    const [own] = await (await owner('/api/sheets?source=self')).json();
    const { sheet, credential } = await interview({ name: 'Private synthetic name', good: 'Interview answer', missing: 'Interview only', surprised: 'Same' });
    const asked = await (await connect(me, credential)).json();
    expect(asked.needsChoice).toBe(true);
    expect(asked.mine.good).toBe('My answer');
    expect(asked.interview).not.toHaveProperty('name');
    // Asking changes nothing.
    expect((await (await owner(`/api/sheets/${sheet.id}`)).json()).revision).toBe(1);
    expect(await store.get(`sheet:${own.id}`)).not.toBeNull();
    expect((await connect(me, credential, { choice })).status).toBe(200);
    const fields = (await (await owner(`/api/sheets/${sheet.id}`)).json()).fields;
    expect(fields.name).toBe('Private synthetic name');
    for (const key of RESPONDENT_FIELDS) expect(fields[key] ?? '').toBe((expected as Record<string, string>)[key] ?? '');
    expect(await store.get(`sheet:${own.id}`)).toBeNull();
    expect(await (await me('/')).text()).toContain('Your interview');
  });
}

test('an empty own map connects without asking', async () => {
  const { browser, interview, connect } = setup();
  const me = browser();
  await me('/', { method: 'POST', form: { revision: '0', good: '  ' } });
  const { credential } = await interview({ good: 'Interview answer' });
  expect(await (await connect(me, credential)).json()).toEqual({ connected: true });
});
