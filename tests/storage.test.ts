import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app';

const directories: string[] = [];
const databases: { close: () => void }[] = [];
const users = { alice: Bun.password.hashSync('alice-password'), bob: Bun.password.hashSync('bob-password') };
const origin = 'https://mapping.example';
const sheet = () => ({ id: crypto.randomUUID(), fields: { name: 'Interview', ind_why_next: 'Notes' }, createdAt: 1, updatedAt: 2 });
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'mapping-'));
  directories.push(directory);
  const databasePath = join(directory, 'notes.sqlite');
  const instance = createApp({ databasePath, users });
  databases.push(instance.db);
  return { ...instance, databasePath };
}
function request(app: ReturnType<typeof createApp>['app'], path: string, method = 'GET', body?: unknown, user: string | null = 'alice', requestOrigin = origin) {
  const headers: Record<string, string> = {};
  if (user) headers.Authorization = `Basic ${btoa(`${user}:${user}-password`)}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers.Origin = requestOrigin;
  return app.request(`${origin}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

test('sheets survive database close and reopen, including edits and deletion', async () => {
  const { app, db, databasePath } = setup();
  const original = sheet();
  const created = await (await request(app, '/api/sheets', 'POST', original)).json();
  expect(created.revision).toBe(1);
  const edited = { ...created, fields: { name: 'Persisted notes' } };
  expect((await request(app, `/api/sheets/${original.id}`, 'PUT', edited)).status).toBe(200);
  db.close();
  databases.pop();
  const reopened = createApp({ databasePath, users });
  databases.push(reopened.db);
  const saved = await (await request(reopened.app, `/api/sheets/${original.id}`)).json();
  expect(saved.fields).toEqual(edited.fields);
  expect(saved.revision).toBe(2);
  expect((await request(reopened.app, `/api/sheets/${original.id}`, 'DELETE', { revision: saved.revision })).status).toBe(204);
  expect((await request(reopened.app, '/api/sheets')).status).toBe(200);
  expect(await (await request(reopened.app, '/api/sheets')).json()).toEqual([]);
});

test('anonymous users and other interviewers cannot access sheets or forge ownership', async () => {
  const { app } = setup();
  const original = sheet();
  const created = await (await request(app, '/api/sheets', 'POST', { ...original, owner: 'bob' })).json();
  expect((await request(app, '/api/sheets', 'GET', undefined, null)).status).toBe(401);
  expect((await request(app, '/', 'GET', undefined, null)).status).toBe(401);
  expect(await (await request(app, '/api/sheets', 'GET', undefined, 'bob')).json()).toEqual([]);
  for (const method of ['GET', 'PUT', 'DELETE']) {
    expect((await request(app, `/api/sheets/${original.id}`, method, method === 'GET' ? undefined : created, 'bob')).status).toBe(404);
  }
  expect((await request(app, '/api/sheets', 'POST', original, 'bob')).status).toBe(409);
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
  expect((await request(app, '/api/sheets', 'POST', sheet(), 'alice', 'https://evil.example')).status).toBe(403);
  for (const invalid of [{ ...sheet(), id: '../secret' }, { ...sheet(), fields: [] }, { ...sheet(), fields: { name: {} } }, { ...sheet(), createdAt: 'yesterday' }]) {
    expect((await request(app, '/api/sheets', 'POST', invalid)).status).toBe(400);
  }
  const malformed = await app.request(`${origin}/api/sheets`, { method: 'POST', headers: { Authorization: `Basic ${btoa('alice:alice-password')}`, Origin: origin, 'Content-Type': 'application/json' }, body: '{' });
  expect(malformed.status).toBe(400);
  expect((await request(app, '/api/unknown')).status).toBe(404);
});

test('serves only public assets, never source, credentials or databases', async () => {
  const { app } = setup();
  for (const path of ['/', '/index.html', '/guide.html', '/styles.css', '/client/app.js', '/client/db.js', '/img/variant-logo-dark.svg', '/legacy.html']) {
    expect((await request(app, path)).status).toBe(200);
  }
  for (const path of ['/server.ts', '/server/app.ts', '/.env', '/package.json', '/data/sheets.sqlite', '/bun.lock', '/.git/config', '/docs/storage-decision.md']) {
    expect((await request(app, path)).status).toBe(404);
  }
  expect(() => createApp({ databasePath: ':memory:', users: {} })).toThrow();
});

test('an online backup restores notes and ownership into an isolated database', async () => {
  const { backupDatabase } = await import('../scripts/backup');
  const { app, databasePath } = setup();
  const original = sheet();
  await request(app, '/api/sheets', 'POST', original);
  const destination = join(databasePath, '..', 'backup.sqlite');
  backupDatabase(databasePath, destination);
  const restored = createApp({ databasePath: destination, users });
  databases.push(restored.db);
  expect((await (await request(restored.app, `/api/sheets/${original.id}`)).json()).fields).toEqual(original.fields);
  expect((await request(restored.app, `/api/sheets/${original.id}`, 'GET', undefined, 'bob')).status).toBe(404);
});

test('failed commits return an error and leave stored notes unchanged', async () => {
  const { app, db } = setup();
  const original = sheet();
  const created = await (await request(app, '/api/sheets', 'POST', original)).json();
  db.exec('PRAGMA query_only = ON');
  const response = await request(app, `/api/sheets/${original.id}`, 'PUT', { ...created, fields: { name: 'Must not be acknowledged' } });
  expect(response.status).toBe(503);
  expect((await response.json()).error).toContain('Keep your draft');
  expect((await (await request(app, `/api/sheets/${original.id}`)).json()).fields).toEqual(original.fields);
});

test('requires valid credentials, origin, JSON and a bounded request body', async () => {
  const { app } = setup();
  expect((await request(app, '/api/sheets', 'GET', undefined, 'mallory')).status).toBe(401);
  const headers = { Authorization: `Basic ${btoa('alice:alice-password')}` };
  expect((await app.request(`${origin}/api/sheets`, { method: 'POST', headers })).status).toBe(403);
  expect((await app.request(`${origin}/api/sheets`, { method: 'POST', headers: { ...headers, Origin: origin, 'Content-Type': 'text/plain' }, body: '{}' })).status).toBe(415);
  expect((await request(app, '/api/sheets', 'POST', { ...sheet(), fields: { name: 'x'.repeat(1024 * 1024) } })).status).toBe(413);
});
