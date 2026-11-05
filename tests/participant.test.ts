import { afterEach, expect, spyOn, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, sessionToken } from '../server/app';
import { RESPONDENT_FIELDS } from '../client/fields.js';
import { memoryStore } from '../server/store';

const origin = 'https://mapping.example';
const adminKey = 'test-admin-key-0123456789-abcdefghij';
const approved = RESPONDENT_FIELDS;
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function setup(file?: string) {
  const store = memoryStore(file);
  const instance = { ...createApp({ store, adminKey, publicOrigin: origin }), store };
  const send = (path: string, method = 'GET', body?: unknown, authorization?: string, cookie?: string) => instance.app.request(`${origin}${path}`, {
    method,
    headers: { ...(authorization ? { Authorization: authorization } : {}), ...(cookie ? { Cookie: cookie } : {}), Origin: origin, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const owner = (path: string, method = 'GET', body?: unknown, key = adminKey) => send(path, method, body, undefined, `am_admin=${sessionToken(key)}`);
  const participant = (credential?: string, method = 'GET', body?: unknown, path = '/api/participant') => send(path, method, body, credential ? `Bearer ${credential}` : undefined);
  const issue = async (id: string) => (await owner(`/api/sheets/${id}/access`, 'POST', {})).json();
  return { ...instance, send, owner, participant, issue };
}
async function createSheet(instance: ReturnType<typeof setup>) {
  const fields = { ...Object.fromEntries(approved.map((key) => [key, `Synthetic ${key}`])), name: 'Private synthetic name', context: 'Private context', discipline: ['Private discipline'], talk_to: 'Private contacts', interviewer: 'Private interviewer' };
  return (await instance.owner('/api/sheets', 'POST', { id: crypto.randomUUID(), fields, createdAt: 1, updatedAt: 2 })).json();
}
test('only the admin gets an interview\'s stable link, storing only a 256-bit credential hash', async () => {
  const instance = setup();
  const sheet = await createSheet(instance);
  const writes = spyOn(instance.store, 'set');
  const first = await instance.issue(sheet.id);
  expect(first.credential).toMatch(/^[a-f0-9]{64}$/);
  // Links last until the interview is deleted: no expiry is returned or stored.
  expect(first.expiresAt).toBeUndefined();
  expect(writes.mock.calls.find(([key]) => key.startsWith('link:'))).toHaveLength(2);
  // Showing the link again returns the same one and writes nothing.
  writes.mockClear();
  expect(await instance.issue(sheet.id)).toEqual(first);
  expect(writes).not.toHaveBeenCalled();
  writes.mockRestore();
  const linkKeys = () => instance.store.keys('link:');
  const hash = createHash('sha256').update(first.credential).digest('hex');
  expect(await linkKeys()).toEqual([`link:${hash}`]);
  expect(await instance.store.keys('')).not.toContain(`link:${first.credential}`);
  expect(JSON.stringify(await instance.store.get(`sheet:${sheet.id}`))).not.toContain(first.credential);
  expect((await instance.owner(`/api/sheets/${sheet.id}/access`, 'POST', {}, 'wrong-admin-key-0123456789-abcdefghij')).status).toBe(401);
  expect((await instance.send(`/api/sheets/${sheet.id}/access`, 'POST', {})).status).toBe(401);
  expect((await instance.owner(`/api/sheets/${sheet.id}/access`, 'DELETE', {})).status).toBe(404);
  expect((await instance.participant(first.credential)).status).toBe(200);
  // Each interview has its own link; self-submitted maps have none.
  const other = await createSheet(instance);
  expect((await instance.issue(other.id)).credential).not.toBe(first.credential);
  const own = await (await instance.owner('/api/sheets', 'POST', { id: crypto.randomUUID(), source: 'self', fields: {}, createdAt: 1, updatedAt: 2 })).json();
  expect((await instance.owner(`/api/sheets/${own.id}/access`, 'POST', {})).status).toBe(404);
  // Another admin key gives other links.
  const rotated = { ...createApp({ store: instance.store, adminKey: 'rotated-admin-key-0123456789-abcdefgh', publicOrigin: origin }) };
  const rotatedLink = await (await rotated.app.request(`${origin}/api/sheets/${sheet.id}/access`, { method: 'POST', headers: { Cookie: `am_admin=${sessionToken('rotated-admin-key-0123456789-abcdefgh')}`, Origin: origin, 'Content-Type': 'application/json' }, body: '{}' })).json();
  expect(rotatedLink.credential).not.toBe(first.credential);
  expect((await instance.participant(first.credential)).status).toBe(404);
});

test('participant projection and patch preserve private fields and persist for the interviewer after restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mapping-'));
  directories.push(directory);
  const file = join(directory, 'store.json');
  const instance = setup(file);
  const sheet = await createSheet(instance);
  const { credential } = await instance.issue(sheet.id);
  const view = await (await instance.participant(credential)).json();
  expect(Object.keys(view).sort()).toEqual(['fields', 'revision']);
  expect(Object.keys(view.fields).sort()).toEqual(approved.sort());
  expect(JSON.stringify(view)).not.toContain('Private');
  const response = await instance.participant(credential, 'PUT', { fields: { good: '<script>synthetic inert answer</script>' }, revision: view.revision });
  expect(response.status).toBe(200);
  const saved = await response.json();
  expect(saved.fields.good).toBe('<script>synthetic inert answer</script>');
  expect(Object.keys(saved).sort()).toEqual(['fields', 'revision']);
  expect(saved.revision).toBe(2);
  const reopened = setup(file);
  const ownerResponse = await reopened.app.request(`${origin}/api/sheets/${sheet.id}`, { headers: { Cookie: `am_admin=${sessionToken(adminKey)}` } });
  expect((await ownerResponse.json()).fields).toEqual({ ...sheet.fields, good: saved.fields.good });
  const participantResponse = await reopened.app.request(`${origin}/api/participant`, { headers: { Authorization: `Bearer ${credential}` } });
  expect(await participantResponse.json()).toEqual(saved);
});

test('participant credentials cannot list, create, delete, manage links or request another interview', async () => {
  const instance = setup();
  const first = await createSheet(instance);
  const other = await createSheet(instance);
  const { credential } = await instance.issue(first.id);
  for (const [path, methods] of [
    ['/api/sheets', ['GET', 'POST']],
    [`/api/sheets/${first.id}`, ['GET', 'PUT', 'DELETE']],
    [`/api/sheets/${other.id}`, ['GET', 'PUT', 'DELETE']],
    [`/api/sheets/${first.id}/access`, ['POST']],
    [`/api/sheets/${other.id}/access`, ['POST']],
    [`/api/participant/${other.id}`, ['GET', 'PUT', 'DELETE']],
    ['/api/participant', ['POST', 'DELETE', 'PATCH']],
  ] as [string, string[]][]) {
    for (const method of methods) {
      const response = await instance.participant(credential, method, method === 'GET' ? undefined : { ...other, fields: { good: 'Unauthorized' } }, path);
      expect([403, 404]).toContain(response.status);
      expect(JSON.stringify(await response.json())).not.toContain('Private');
      expect(response.headers.get('WWW-Authenticate')).toBeNull();
    }
  }
  for (const target of [first, other]) expect(await (await instance.owner(`/api/sheets/${target.id}`)).json()).toEqual(target);
  const lowerCase = await instance.send('/api/sheets', 'GET', undefined, `bearer ${credential}`);
  expect(lowerCase.status).toBe(403);
  expect(lowerCase.headers.get('WWW-Authenticate')).toBeNull();
});

test('forbidden fields, types, metadata and malformed writes change no answers', async () => {
  const instance = setup();
  const sheet = await createSheet(instance);
  const { credential } = await instance.issue(sheet.id);
  for (const body of [
    { fields: { good: 'Allowed', name: 'Forbidden' }, revision: 1 },
    { fields: { talk_to: 'Forbidden' }, revision: 1 },
    { fields: { good: ['Wrong type'] }, revision: 1 },
    { fields: { good: {} }, revision: 1 },
    { fields: [], revision: 1 },
    { fields: { good: 'Allowed' }, revision: 1, id: crypto.randomUUID() },
    { fields: { good: 'Allowed' }, revision: 1, createdAt: 1 },
    { fields: { good: 'Allowed' }, revision: 0 },
    { fields: { good: 'Allowed' } },
    null,
  ]) expect((await instance.participant(credential, 'PUT', body)).status).toBe(400);
  expect(await (await instance.owner(`/api/sheets/${sheet.id}`)).json()).toEqual(sheet);
  expect((await instance.participant(credential, 'PUT', { fields: { good: 'x'.repeat(1024 * 1024) }, revision: 1 })).status).toBe(413);
  for (const [requestOrigin, contentType, expected] of [
    ['https://untrusted.example', 'application/json', 403],
    [origin, 'text/plain', 415],
  ] as const) {
    const response = await instance.app.request(`${origin}/api/participant`, { method: 'PUT', headers: { Authorization: `Bearer ${credential}`, Origin: requestOrigin, 'Content-Type': contentType }, body: JSON.stringify({ fields: { good: 'Rejected' }, revision: 1 }) });
    expect(response.status).toBe(expected);
  }
  expect(await (await instance.owner(`/api/sheets/${sheet.id}`)).json()).toEqual(sheet);
});

test('missing, invalid, expired and replaced credentials cannot read or save from an open form', async () => {
  const instance = setup();
  const sheet = await createSheet(instance);
  const unavailable = async (credential?: string) => {
    for (const method of ['GET', 'PUT']) {
      const response = await instance.participant(credential, method, method === 'PUT' ? { fields: { good: 'Rejected draft' }, revision: 1 } : undefined);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'Link unavailable.' });
    }
  };
  await unavailable();
  await unavailable('invalid');
  await unavailable(crypto.getRandomValues(new Uint8Array(32)).toHex());
  // A random link issued before links became stable, with the seven-day TTL older links kept.
  const legacy = crypto.getRandomValues(new Uint8Array(32)).toHex();
  const legacyHash = createHash('sha256').update(legacy).digest('hex');
  await instance.store.set(`link:${legacyHash}`, { sheetId: sheet.id }, Date.now() + 60_000);
  await instance.store.set(`sheet:${sheet.id}`, { ...await instance.store.get(`sheet:${sheet.id}`), linkHash: legacyHash });
  expect((await instance.participant(legacy)).status).toBe(200);
  // Showing the stable link replaces it.
  const stable = await instance.issue(sheet.id);
  await unavailable(legacy);
  expect((await instance.participant(stable.credential)).status).toBe(200);
  // An expired link key is written again the next time the link is shown.
  await instance.store.set(`link:${(await instance.store.get(`sheet:${sheet.id}`)).linkHash}`, { sheetId: sheet.id }, Date.now() - 1);
  await unavailable(stable.credential);
  expect(await instance.issue(sheet.id)).toEqual(stable);
  expect((await instance.participant(stable.credential)).status).toBe(200);
  expect(await (await instance.owner(`/api/sheets/${sheet.id}`)).json()).toEqual(sheet);
});

test('revision conflicts preserve newer answers in both interviewer and participant directions', async () => {
  const instance = setup();
  const sheet = await createSheet(instance);
  const { credential } = await instance.issue(sheet.id);
  const saved = await (await instance.participant(credential, 'PUT', { fields: { good: 'Participant first' }, revision: 1 })).json();
  expect((await instance.owner(`/api/sheets/${sheet.id}`, 'PUT', { ...sheet, fields: { good: 'Interviewer stale' } })).status).toBe(409);
  const newer = await (await instance.owner(`/api/sheets/${sheet.id}`, 'PUT', { ...sheet, revision: saved.revision, fields: { ...sheet.fields, good: 'Interviewer newer' } })).json();
  const stale = await instance.participant(credential, 'PUT', { fields: { good: 'Participant stale' }, revision: saved.revision });
  expect(stale.status).toBe(409);
  expect((await stale.json()).error).toContain('Newer answers');
  expect(await (await instance.owner(`/api/sheets/${sheet.id}`)).json()).toEqual(newer);
});

test('deletion during a request body read is checked again before committing', async () => {
  const instance = setup();
  const sheet = await createSheet(instance);
  const { credential } = await instance.issue(sheet.id);
  let release!: () => void;
  const reading = new Promise<void>((resolve) => { release = resolve; });
  let finish!: (value: Uint8Array) => void;
  const chunk = new Promise<Uint8Array>((resolve) => { finish = resolve; });
  const body = new ReadableStream({ async pull(controller) { release(); controller.enqueue(await chunk); controller.close(); } });
  const pending = instance.app.request(`${origin}/api/participant`, { method: 'PUT', headers: { Authorization: `Bearer ${credential}`, Origin: origin, 'Content-Type': 'application/json' }, body, duplex: 'half' } as RequestInit);
  await reading;
  await instance.owner(`/api/sheets/${sheet.id}`, 'DELETE', { revision: 1 });
  finish(new TextEncoder().encode(JSON.stringify({ fields: { good: 'Must not commit' }, revision: 1 })));
  expect((await pending).status).toBe(404);
  expect(await instance.store.get(`sheet:${sheet.id}`)).toBeNull();
});

test('deletion removes link access, including after recreating the same interview ID', async () => {
  const instance = setup();
  const sheet = await createSheet(instance);
  const { credential } = await instance.issue(sheet.id);
  expect((await instance.owner(`/api/sheets/${sheet.id}`, 'DELETE', { revision: 1 })).status).toBe(204);
  await instance.owner('/api/sheets', 'POST', sheet);
  expect((await instance.participant(credential)).status).toBe(404);
});

test('private responses suppress caching/referrers; participant shell needs no interviewer sign-in', async () => {
  const instance = setup();
  const sheet = await createSheet(instance);
  const { credential } = await instance.issue(sheet.id);
  for (const response of [
    await instance.send('/participant'),
    await instance.send('/client/participant.js'),
    await instance.participant(credential),
    await instance.participant(),
    await instance.owner(`/api/sheets/${sheet.id}/access`, 'POST', {}),
    await instance.send('/api/sheets'),
  ]) {
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Referrer-Policy')).toBe('same-origin');
    expect(response.headers.get('Strict-Transport-Security')).toContain('max-age=');
  }
  expect((await instance.send('/participant')).status).toBe(200);
  expect((await instance.send('/participant')).headers.get('Content-Type')).toContain('text/html');
  expect((await instance.send('/participant')).headers.get('WWW-Authenticate')).toBeNull();
  for (const path of ['/data/store.json', '/secrets/accounts.json', '/.env', '/server/app.tsx', '/.git/config']) {
    const response = await instance.participant(credential, 'GET', undefined, path);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain(credential);
  }
});

test('HTTPS is required for remote use and configured external origins', async () => {
  expect(() => createApp({ store: memoryStore(), adminKey, publicOrigin: 'http://mapping.example' })).toThrow('HTTPS');
  const { app } = createApp({ store: memoryStore(), adminKey });
  expect((await app.request('http://mapping.example/participant')).status).toBe(403);
  expect((await app.request('http://localhost/participant')).status).toBe(200);
  expect((await app.request(`${origin}/participant`)).status).toBe(200);
});

test('failed commits keep stored answers intact and log no credential, answers or request URL', async () => {
  const instance = setup();
  const sheet = await createSheet(instance);
  const { credential } = await instance.issue(sheet.id);
  const logged = spyOn(console, 'error').mockImplementation(() => {});
  try {
    instance.store.failWrites = true;
    const response = await instance.participant(credential, 'PUT', { fields: { good: 'Synthetic unsaved draft' }, revision: 1 });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Storage unavailable. Keep your draft and retry.' });
    expect(logged.mock.calls).toEqual([['Storage request failed.']]);
    expect(JSON.stringify(logged.mock.calls)).not.toContain(credential);
    expect(await (await instance.owner(`/api/sheets/${sheet.id}`)).json()).toEqual(sheet);
  } finally {
    logged.mockRestore();
  }
});
