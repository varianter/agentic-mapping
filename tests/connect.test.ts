import { expect, spyOn, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { createApp, sessionToken } from '../server/app';
import { RESPONDENT_FIELDS } from '../server/domain/fields';
import { memoryStore } from '../server/store';
import { adminKey, json, origin, setup as baseSetup, sheetForm, type Send } from './helpers';

const hash = (credential: string) => createHash('sha256').update(credential).digest('hex');

// A private link connects a browser to its interview; My map then edits that interview.
function setup() {
  const base = baseSetup();
  const linkOf = async (path: string, send: Send = base.owner) => /\/connect#([a-f0-9]{64})/.exec(await (await send(path)).text())?.[1];
  const interview = async (fields: Record<string, string> = {}) => {
    const path = (await base.owner('/interviews', { method: 'POST', form: {} })).headers.get('Location')!;
    const id = path.split('/').pop()!;
    if (Object.keys(fields).length) await base.store.set(`sheet:${id}`, { ...await base.store.get(`sheet:${id}`), fields });
    const credential = (await linkOf(path))!;
    return { id, path, credential };
  };
  const connect = (me: Send, credential: string, choice?: string) => me('/connect', { method: 'POST', form: { credential, ...(choice ? { choice } : {}) } });
  const myMap = async (me: Send) => sheetForm(await (await me('/')).text());
  return { ...base, linkOf, interview, connect, myMap };
}

test('only the interviewer sees an interview’s stable link; only its hash is stored', async () => {
  const instance = setup();
  const writes = spyOn(instance.store, 'set');
  const { id, path, credential } = await instance.interview();
  expect(credential).toMatch(/^[a-f0-9]{64}$/);
  expect(writes.mock.calls.filter(([key]) => key.startsWith('link:'))).toHaveLength(1);
  // Showing the link again gives the same one and writes nothing.
  writes.mockClear();
  expect(await instance.linkOf(path)).toBe(credential);
  expect(writes).not.toHaveBeenCalled();
  writes.mockRestore();
  expect(await instance.store.keys('link:')).toEqual([`link:${hash(credential)}`]);
  expect(JSON.stringify(await Promise.all((await instance.store.keys('')).map((key) => instance.store.get(key))))).not.toContain(credential);
  expect((await instance.send(path)).headers.get('Location')).toBe('/sign-in');
  // Each interview has its own link; another admin key gives other links and turns this one off.
  expect((await instance.interview()).credential).not.toBe(credential);
  const rotatedKey = 'rotated-admin-key-0123456789-abcdefgh';
  const rotated = createApp({ store: instance.store, adminKey: rotatedKey, publicOrigin: origin }).app;
  const rotatedPage = await (await rotated.request(`${origin}${path}`, { headers: { Cookie: `am_admin=${sessionToken(rotatedKey)}` } })).text();
  expect(/\/connect#([a-f0-9]{64})/.exec(rotatedPage)?.[1]).not.toBe(credential);
  expect((await instance.connect(instance.browser(), credential)).status).toBe(404);
  expect((await instance.store.get(`sheet:${id}`)).linkHash).not.toBe(hash(credential));
});

test('the connect page carries no credential; old /participant links redirect and keep their fragment', async () => {
  const { send } = setup();
  const page = await send('/connect');
  expect(page.status).toBe(200);
  const html = await page.text();
  expect(html).toContain('id="connect-form"');
  expect(html).toMatch(/<script type="module" src="\/assets\/connect\.[a-z0-9]+\.js">/);
  const old = await send('/participant');
  expect(old.status).toBe(301);
  expect(old.headers.get('Location')).toBe('/connect');
});

test('a link connects the browser to its interview until the interview is deleted', async () => {
  const { browser, owner, interview, connect, myMap, store } = setup();
  const me = browser();
  const { id, path, credential } = await interview({ name: 'Private synthetic name', good: 'Interview answer' });
  const connected = await connect(me, credential);
  expect(connected.status).toBe(303);
  expect(connected.headers.get('Location')).toBe('/');
  const cookie = connected.headers.get('Set-Cookie')!;
  expect(cookie).toMatch(/^am_respondent=[a-f0-9]{64};.*HttpOnly/);
  expect(cookie).not.toContain(credential);
  const page = await (await me('/')).text();
  expect(page).toContain('Your interview');
  expect(page).not.toContain('Private synthetic name');
  expect(page).not.toContain('confirm-clear');
  expect(await myMap(me)).toMatchObject({ revision: 1, fields: { good: 'Interview answer' } });
  await me('/', { method: 'POST', form: { revision: '1', advice: 'Added later' } });
  expect((await store.get(`sheet:${id}`)).fields).toEqual({ name: 'Private synthetic name', good: 'Interview answer', advice: 'Added later' });
  // The name on an interview is the interviewer's: no field for it, and a posted one is refused.
  expect(page).not.toContain('name="name"');
  expect((await me('/', { method: 'POST', form: { revision: '2', name: 'Renamed' }, headers: json })).status).toBe(422);
  expect((await store.get(`sheet:${id}`)).fields.name).toBe('Private synthetic name');
  // Interview answers can't be cleared from My map.
  expect((await me('/clear', { method: 'POST', form: {} })).status).toBe(409);
  // Showing the link again keeps the browser connected.
  await owner(path);
  expect(await (await me('/')).text()).toContain('Your interview');
  // Conflicts keep the newer answers in both directions.
  expect((await owner(path, { method: 'POST', form: { revision: '1', good: 'Interviewer stale' } })).status).toBe(409);
  expect((await owner(path, { method: 'POST', form: { revision: '2', good: 'Interviewer newer' } })).status).toBe(303);
  expect((await me('/', { method: 'POST', form: { revision: '2', good: 'Participant stale' } })).status).toBe(409);
  expect((await store.get(`sheet:${id}`)).fields.good).toBe('Interviewer newer');
  // Deleting the interview disconnects browsers it connected; they fall back to an empty own map.
  expect((await owner(`${path}/delete`, { method: 'POST', form: { revision: '3' } })).status).toBe(303);
  expect(await myMap(me)).toMatchObject({ revision: 0, fields: { good: '', advice: '' } });
  // Recreating the same ID does not bring the link back.
  await store.set(`sheet:${id}`, { id, source: 'interview', fields: {}, createdAt: 1, updatedAt: 1, revision: 1 });
  expect((await connect(browser(), credential)).status).toBe(404);
});

test('missing, malformed, unknown and replaced credentials open nothing', async () => {
  const { browser, store, interview, connect, linkOf } = setup();
  const me = browser();
  const { id, path, credential } = await interview();
  for (const form of [{}, { credential: '' }, { credential: 'invalid' }, { credential: '0'.repeat(64) }, { credential, choice: 'other' }, { credential, extra: 'x' }]) {
    const response = await me('/connect', { method: 'POST', form });
    expect(response.status).toBe(404);
    expect(await response.text()).toContain('Link unavailable');
    expect(response.headers.get('Set-Cookie')).toBeNull();
  }
  // A random link from before links became stable still opens, until the stable one is shown.
  const legacy = crypto.getRandomValues(new Uint8Array(32)).toHex();
  await store.set(`link:${hash(legacy)}`, { sheetId: id }, Date.now() + 60_000);
  await store.set(`sheet:${id}`, { ...await store.get(`sheet:${id}`), linkHash: hash(legacy) });
  expect((await connect(browser(), legacy)).status).toBe(303);
  expect(await linkOf(path)).toBe(credential);
  expect((await connect(browser(), legacy)).status).toBe(404);
  // An expired link key is written again the next time the link is shown.
  await store.set(`link:${hash(credential)}`, { sheetId: id }, Date.now() - 1);
  expect((await connect(browser(), credential)).status).toBe(404);
  expect(await linkOf(path)).toBe(credential);
  expect((await connect(browser(), credential)).status).toBe(303);
});

for (const [choice, expected] of [
  ['merge', { good: 'Interview answer\n\nMy answer', tools: 'Claude Code\nTDD\nCodex', advice: 'My advice', missing: 'Interview only', surprised: 'Same' }],
  ['interview', { good: 'Interview answer', tools: 'Claude Code\nTDD', advice: '', missing: 'Interview only', surprised: 'Same' }],
  ['mine', { good: 'My answer', tools: 'tdd\nCodex', advice: 'My advice', missing: '', surprised: 'Same' }],
] as const) {
  test(`an own map asks first, then "${choice}" sets the interview answers and deletes the own map`, async () => {
    const { store, browser, interview, connect } = setup();
    const me = browser();
    await me('/', { method: 'POST', form: { revision: '0', good: 'My answer', tools: 'tdd\nCodex', advice: 'My advice', surprised: 'Same' } });
    const [ownKey] = await store.keys('sheet:');
    const { id, credential } = await interview({ name: 'Private synthetic name', good: 'Interview answer', tools: 'Claude Code\nTDD', missing: 'Interview only', surprised: 'Same' });
    const asked = await connect(me, credential);
    expect(asked.status).toBe(200);
    const html = await asked.text();
    expect(html).toContain('This browser has your own map with 4 answers. The interview has 4 answers.');
    expect(html).not.toContain('Private synthetic name');
    // Asking changes nothing.
    expect((await store.get(`sheet:${id}`)).revision).toBe(1);
    expect(await store.get(ownKey)).not.toBeNull();
    expect((await connect(me, credential, choice)).status).toBe(303);
    const fields = (await store.get(`sheet:${id}`)).fields;
    expect(fields.name).toBe('Private synthetic name');
    for (const key of RESPONDENT_FIELDS) expect(fields[key] ?? '').toBe((expected as Record<string, string>)[key] ?? '');
    expect(await store.get(ownKey)).toBeNull();
    expect(await (await me('/')).text()).toContain('Your interview');
  });
}

test('an empty own map connects without asking', async () => {
  const { browser, interview, connect } = setup();
  const me = browser();
  await me('/', { method: 'POST', form: { revision: '0', good: '  ' } });
  const { credential } = await interview({ good: 'Interview answer' });
  expect((await connect(me, credential)).status).toBe(303);
});

test('a link never grants interviewer access, and there is no connect without an admin key', async () => {
  const { browser, interview, connect, send } = setup();
  const me = browser();
  const { path, credential } = await interview();
  await connect(me, credential);
  expect((await me(path)).headers.get('Location')).toBe('/sign-in');
  expect((await me(path, { headers: { Authorization: `Bearer ${credential}` } })).headers.get('Location')).toBe('/sign-in');
  expect((await me('/interviews', { method: 'POST', form: { credential } })).status).toBe(401);
  for (const legacyApi of ['/api/participant', '/api/participant/connect', '/api/sheets']) expect((await send(legacyApi, { headers: { Authorization: `Bearer ${credential}` } })).status).not.toBe(200);
  const selfOnly = baseSetup({ admin: false });
  expect((await selfOnly.send('/connect')).status).toBe(404);
  expect((await selfOnly.send('/connect', { method: 'POST', form: { credential } })).status).toBe(404);
});

test('HTTPS is required for remote use', async () => {
  expect(() => createApp({ store: memoryStore(), adminKey, publicOrigin: 'http://mapping.example' })).toThrow('HTTPS');
  const { app } = createApp({ store: memoryStore(), adminKey });
  expect((await app.request('http://mapping.example/connect')).status).toBe(403);
  expect((await app.request('http://localhost/connect')).status).toBe(200);
  expect((await app.request(`${origin}/connect`)).status).toBe(200);
});

test('failed commits keep stored answers and log no credential, answers or request URL', async () => {
  const { browser, store, interview, connect } = setup();
  const { id, credential } = await interview({ good: 'Stored answer' });
  const me = browser();
  await connect(me, credential);
  const logged = spyOn(console, 'error').mockImplementation(() => {});
  try {
    store.failWrites = true;
    const response = await me('/', { method: 'POST', form: { revision: '1', good: 'Secret draft' } });
    expect(response.status).toBe(503);
    const failedConnect = await connect(browser(), credential);
    expect(failedConnect.status).toBe(503);
    expect(await failedConnect.text()).not.toContain(credential);
    const output = JSON.stringify(logged.mock.calls);
    for (const secret of [credential, 'Secret draft', '/connect']) expect(output).not.toContain(secret);
  } finally {
    logged.mockRestore();
    store.failWrites = false;
  }
  expect((await store.get(`sheet:${id}`)).fields.good).toBe('Stored answer');
});
