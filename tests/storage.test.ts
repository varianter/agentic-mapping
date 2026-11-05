import { afterEach, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app';
import { memoryStore, storeFromEnv } from '../server/store';

const directories: string[] = [];
const adminKey = 'test-admin-key-0123456789-abcdefghij';
const origin = 'https://mapping.example';
const sheet = () => ({ id: crypto.randomUUID(), fields: { name: 'Interview', ind_why_next: 'Notes' }, createdAt: 1, updatedAt: 2 });
function setup(file?: string) {
  const store = memoryStore(file);
  return { ...createApp({ store, adminKey }), store };
}
function tempFile() {
  const directory = mkdtempSync(join(tmpdir(), 'mapping-'));
  directories.push(directory);
  return join(directory, 'store.json');
}
function request(app: ReturnType<typeof createApp>['app'], path: string, method = 'GET', body?: unknown, key: string | null = adminKey, requestOrigin = origin) {
  const headers: Record<string, string> = {};
  if (key) headers.Authorization = `Basic ${btoa(`admin:${key}`)}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers.Origin = requestOrigin;
  return app.request(`${origin}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

test('sheets survive a restart with the same store file, including edits and deletion', async () => {
  const file = tempFile();
  const { app } = setup(file);
  const original = sheet();
  const created = await (await request(app, '/api/sheets', 'POST', original)).json();
  expect(created.revision).toBe(1);
  const edited = { ...created, fields: { name: 'Persisted notes' } };
  expect((await request(app, `/api/sheets/${original.id}`, 'PUT', edited)).status).toBe(200);
  const reopened = setup(file);
  const saved = await (await request(reopened.app, `/api/sheets/${original.id}`)).json();
  expect(saved.fields).toEqual(edited.fields);
  expect(saved.revision).toBe(2);
  expect((await request(reopened.app, `/api/sheets/${original.id}`, 'DELETE', { revision: saved.revision })).status).toBe(204);
  expect(await (await request(reopened.app, '/api/sheets')).json()).toEqual([]);
  expect(await (await request(setup(file).app, '/api/sheets')).json()).toEqual([]);
});

test('missing or wrong admin keys cannot access or change sheets', async () => {
  const { app } = setup();
  const original = sheet();
  const created = await (await request(app, '/api/sheets', 'POST', original)).json();
  expect((await request(app, '/api/sheets', 'GET', undefined, null)).status).toBe(401);
  expect((await request(app, '/', 'GET', undefined, null)).status).toBe(200);
  const wrong = 'wrong-admin-key-0123456789-abcdefghij';
  for (const key of [null, wrong]) {
    expect((await request(app, '/api/sheets', 'GET', undefined, key)).status).toBe(401);
    expect((await request(app, '/api/sheets', 'POST', sheet(), key)).status).toBe(401);
    for (const method of ['GET', 'PUT', 'DELETE']) {
      expect((await request(app, `/api/sheets/${original.id}`, method, method === 'GET' ? undefined : { ...created, revision: 1 }, key)).status).toBe(401);
    }
    for (const method of ['POST', 'DELETE']) expect((await request(app, `/api/sheets/${original.id}/access`, method, {}, key)).status).toBe(401);
  }
  expect(await (await request(app, `/api/sheets/${original.id}`)).json()).toEqual(created);
  expect((await request(app, '/api/sheets', 'POST', original, adminKey)).status).toBe(200);
});

test('stale writes/deletes conflict and delayed saves cannot recreate deleted sheets', async () => {
  const { app } = setup();
  const created = await (await request(app, '/api/sheets', 'POST', sheet())).json();
  const path = `/api/sheets/${created.id}`;
  expect((await request(app, path, 'PUT', { ...created, fields: { name: 'First device' } })).status).toBe(200);
  expect((await request(app, path, 'PUT', { ...created, fields: { name: 'Stale device' } })).status).toBe(409);
  expect((await request(app, path, 'DELETE', { revision: 1 })).status).toBe(409);
  expect((await (await request(app, path)).json()).fields.name).toBe('First device');
  expect((await request(app, path, 'DELETE', { revision: 2 })).status).toBe(204);
  expect((await request(app, path, 'PUT', { ...created, revision: 2 })).status).toBe(404);
});

test('legacy import retries do not duplicate or overwrite notes', async () => {
  const { app } = setup();
  const original = sheet();
  expect((await request(app, '/api/sheets', 'POST', original)).status).toBe(201);
  expect((await request(app, '/api/sheets', 'POST', original)).status).toBe(200);
  expect((await request(app, '/api/sheets', 'POST', { ...original, fields: { name: 'Collision' } })).status).toBe(409);
  expect((await (await request(app, `/api/sheets/${original.id}`)).json()).fields).toEqual(original.fields);
});

test('rejects cross-site writes, malformed payloads and unknown API paths', async () => {
  const { app } = setup();
  expect((await request(app, '/api/sheets', 'POST', sheet(), adminKey, 'https://evil.example')).status).toBe(403);
  for (const invalid of [{ ...sheet(), id: '../secret' }, { ...sheet(), fields: [] }, { ...sheet(), fields: { name: {} } }, { ...sheet(), createdAt: 'yesterday' }]) {
    expect((await request(app, '/api/sheets', 'POST', invalid)).status).toBe(400);
  }
  const malformed = await app.request(`${origin}/api/sheets`, { method: 'POST', headers: { Authorization: `Basic ${btoa(`admin:${adminKey}`)}`, Origin: origin, 'Content-Type': 'application/json' }, body: '{' });
  expect(malformed.status).toBe(400);
  expect((await request(app, '/api/unknown')).status).toBe(404);
});

test('serves only public assets, never source, credentials or databases', async () => {
  const { app } = setup();
  for (const path of ['/', '/index.html', '/guide.html', '/styles.css', '/client/app.js', '/client/db.js', '/img/variant-logo-dark.svg', '/legacy.html']) {
    expect((await request(app, path)).status).toBe(200);
  }
  for (const path of ['/server.ts', '/server/app.ts', '/.env', '/interviewers.json', '/secrets/accounts.json', '/tls.key', '/tls.pem', '/package.json', '/data/store.json', '/bun.lock', '/.git/config', '/docs/storage-decision.md']) {
    expect((await request(app, path)).status).toBe(404);
  }
  expect(() => createApp({ store: memoryStore() })).toThrow('ADMIN_KEY');
  expect(() => createApp({ store: memoryStore(), adminKey: 'short' })).toThrow('ADMIN_KEY');
});

test('failed commits return an error and leave stored notes unchanged', async () => {
  const { app, store } = setup();
  const original = sheet();
  const created = await (await request(app, '/api/sheets', 'POST', original)).json();
  store.failWrites = true;
  const response = await request(app, `/api/sheets/${original.id}`, 'PUT', { ...created, fields: { name: 'Must not be acknowledged' } });
  expect(response.status).toBe(503);
  expect((await response.json()).error).toContain('Keep your draft');
  expect((await (await request(app, `/api/sheets/${original.id}`)).json()).fields).toEqual(original.fields);
});

test('requires valid credentials, origin, JSON and a bounded request body', async () => {
  const { app } = setup();
  expect((await request(app, '/api/sheets', 'GET', undefined, 'mallory')).status).toBe(401);
  const headers = { Authorization: `Basic ${btoa(`admin:${adminKey}`)}` };
  expect((await app.request(`${origin}/api/sheets`, { method: 'POST', headers })).status).toBe(403);
  expect((await app.request(`${origin}/api/sheets`, { method: 'POST', headers: { ...headers, Origin: origin, 'Content-Type': 'text/plain' }, body: '{}' })).status).toBe(415);
  expect((await request(app, '/api/sheets', 'POST', { ...sheet(), fields: { name: 'x'.repeat(1024 * 1024) } })).status).toBe(413);
});

test('home selects verified storage modes and sign-in explicitly challenges then returns home', async () => {
  const { app } = setup();
  for (const path of ['/', '/index.html']) {
    const anonymous = await request(app, path, 'GET', undefined, null);
    expect(anonymous.status).toBe(200);
    expect(anonymous.headers.has('WWW-Authenticate')).toBe(false);
    expect(anonymous.headers.get('Cache-Control')).toBe('no-store');
    expect(anonymous.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(anonymous.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(await anonymous.text()).toContain('data-storage-mode="local"');
    expect(await (await request(app, path)).text()).toContain('data-storage-mode="server"');
    expect((await request(app, path, 'GET', undefined, 'mallory')).status).toBe(401);
  }
  const challenge = await request(app, '/sign-in', 'GET', undefined, null);
  expect(challenge.status).toBe(401);
  expect(challenge.headers.get('WWW-Authenticate')).toContain('Basic');
  const signedIn = await request(app, '/sign-in');
  expect(signedIn.status).toBe(303);
  expect(signedIn.headers.get('Location')).toBe('/');
  expect((await request(app, '/client/local-db.js', 'GET', undefined, null)).status).toBe(200);
  expect(await (await request(app, '/participant', 'GET', undefined, null)).text()).toContain('data-storage-mode="participant"');
  const original = sheet();
  await request(app, '/api/sheets', 'POST', original);
  for (const [path, method, body] of [
    ['/api/sheets', 'GET'], ['/api/sheets', 'POST', sheet()],
    [`/api/sheets/${original.id}`, 'GET'], [`/api/sheets/${original.id}`, 'PUT', { ...original, revision: 1 }],
    [`/api/sheets/${original.id}`, 'DELETE', { revision: 1 }],
    [`/api/sheets/${original.id}/access`, 'POST', {}], [`/api/sheets/${original.id}/access`, 'DELETE', {}],
  ]) {
    expect((await request(app, path, method, body, null)).status).toBe(401);
  }
});

test('parallel apps with separate stores never see each other\'s sheets', async () => {
  const [one, two] = [setup(), setup()];
  await request(one.app, '/api/sheets', 'POST', sheet());
  expect(await (await request(two.app, '/api/sheets')).json()).toEqual([]);
});

test('test stores ignore KV variables and never contact Upstash', async () => {
  const saved = { url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN };
  process.env.KV_REST_API_URL = 'https://kv.invalid';
  process.env.KV_REST_API_TOKEN = 'synthetic-token';
  const network = spyOn(globalThis, 'fetch');
  try {
    const { app } = setup();
    expect((await request(app, '/api/sheets', 'POST', sheet())).status).toBe(201);
    expect(network).not.toHaveBeenCalled();
  } finally {
    network.mockRestore();
    for (const [name, value] of [['KV_REST_API_URL', saved.url], ['KV_REST_API_TOKEN', saved.token]] as const) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test('entrypoint store is a local JSON file without KV variables', async () => {
  const file = tempFile();
  const store = storeFromEnv({ LOCAL_STORE_FILE: file });
  await store.set('sheet:x', { id: 'x' });
  expect(existsSync(file)).toBe(true);
  expect(await storeFromEnv({ LOCAL_STORE_FILE: file }).get('sheet:x')).toEqual({ id: 'x' });
});
