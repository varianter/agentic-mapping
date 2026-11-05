import { afterEach, expect, spyOn, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, sessionToken } from '../server/app';
import { memoryStore, storeFromEnv, upstashStore, type Store } from '../server/store';
import { adminCookie, adminKey, encode, origin, sheetForm } from './helpers';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function tempFile() {
  const directory = mkdtempSync(join(tmpdir(), 'mapping-'));
  directories.push(directory);
  return join(directory, 'store.json');
}
function owner(store: Store, key = adminKey) {
  const { app } = createApp({ store, adminKey: key });
  return (path: string, form?: Record<string, string>) => app.request(`${origin}${path}`, {
    method: form ? 'POST' : 'GET',
    headers: { Cookie: `am_admin=${sessionToken(key)}`, Origin: origin, ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: form ? encode(form) : undefined,
  });
}
async function newInterview(send: ReturnType<typeof owner>) {
  return (await send('/interviews', {})).headers.get('Location')!;
}

test('interviews survive a restart with the same store file, including edits and deletion', async () => {
  const file = tempFile();
  const first = owner(memoryStore(file));
  const path = await newInterview(first);
  await first(path, { revision: '1', name: 'Persisted notes' });
  const reopened = owner(memoryStore(file));
  const saved = sheetForm(await (await reopened(path)).text());
  expect(saved).toMatchObject({ revision: 2, fields: { name: 'Persisted notes' } });
  expect((await reopened(`${path}/delete`, { revision: '2' })).status).toBe(303);
  expect((await owner(memoryStore(file))(path)).status).toBe(404);
});

function signIn(app: ReturnType<typeof createApp>['app'], key: string, requestOrigin = origin, headers: Record<string, string> = {}) {
  return app.request(`${origin}/sign-in`, { method: 'POST', headers: { Origin: requestOrigin, 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams({ key }) });
}

test('sign-in sets an HttpOnly key-derived cookie; wrong keys, other origins and stale cookies get nothing', async () => {
  const { app } = createApp({ store: memoryStore(), adminKey });
  const form = await app.request(`${origin}/sign-in`);
  expect(form.status).toBe(200);
  expect(await form.text()).toContain('type="password"');
  expect((await app.request(`${origin}/sign-in`, { headers: { Cookie: adminCookie } })).headers.get('Location')).toBe('/');

  const wrong = await signIn(app, 'wrong-admin-key-0123456789-abcdefghij');
  expect(wrong.status).toBe(401);
  expect(await wrong.text()).toContain('role="alert"');
  expect(wrong.headers.get('Set-Cookie')).toBeNull();
  for (const [requestOrigin, headers] of [['https://evil.example', {}], ['null', {}], ['null', { 'Sec-Fetch-Site': 'cross-site' }]] as const) {
    const refused = await signIn(app, adminKey, requestOrigin, headers);
    expect(refused.status).toBe(403);
    expect(refused.headers.get('Set-Cookie')).toBeNull();
  }
  // Fetch Metadata still proves a same-origin form post when a browser sends no usable Origin.
  expect((await signIn(app, adminKey, 'null', { 'Sec-Fetch-Site': 'same-origin' })).status).toBe(303);

  const signedIn = await signIn(app, adminKey);
  expect(signedIn.status).toBe(303);
  expect(signedIn.headers.get('Location')).toBe('/');
  const cookie = signedIn.headers.get('Set-Cookie') ?? '';
  expect(cookie).toContain(`am_admin=${sessionToken(adminKey)}`);
  expect(cookie).not.toContain(adminKey);
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=']) expect(cookie).toContain(flag);
  const session = cookie.split(';')[0];
  expect((await app.request(`${origin}/interviews`, { headers: { Cookie: session } })).status).toBe(200);

  // A cookie made with a previous key stops working once ADMIN_KEY rotates.
  const rotated = createApp({ store: memoryStore(), adminKey: 'rotated-admin-key-0123456789-abcdefgh' }).app;
  expect((await rotated.request(`${origin}/interviews`, { headers: { Cookie: session } })).status).toBe(303);
});

test('sign-out clears the cookie and refuses cross-site requests', async () => {
  const { app } = createApp({ store: memoryStore(), adminKey });
  const signOut = (requestOrigin: string) => app.request(`${origin}/sign-out`, { method: 'POST', headers: { Origin: requestOrigin, Cookie: adminCookie, 'Content-Type': 'application/x-www-form-urlencoded' } });
  expect((await signOut('https://evil.example')).status).toBe(403);
  const response = await signOut(origin);
  expect(response.status).toBe(303);
  expect(response.headers.get('Location')).toBe('/');
  expect(response.headers.get('Set-Cookie')).toMatch(/^am_admin=;.*Max-Age=0/);
});

test('serves only pages and hashed assets, never source, credentials or databases', async () => {
  const { app } = createApp({ store: memoryStore(), adminKey });
  for (const path of ['/', '/guide', '/sign-in']) expect((await app.request(`${origin}${path}`)).status).toBe(200);
  for (const path of ['/server.ts', '/server/app.tsx', '/.env', '/interviewers.json', '/secrets/accounts.json', '/tls.key', '/tls.pem', '/package.json', '/data/store.json', '/bun.lock', '/.git/config', '/docs/storage-decision.md', '/public/styles.css', '/assets/', '/client/legacy.js']) {
    expect((await app.request(`${origin}${path}`, { headers: { Cookie: adminCookie } })).status).toBe(404);
  }
  expect(() => createApp({ store: memoryStore(), adminKey: 'short' })).toThrow('ADMIN_KEY');
  expect(() => createApp({ adminKey } as any)).toThrow('store');
});

test('parallel apps with separate stores never see each other\'s interviews', async () => {
  const [one, two] = [owner(memoryStore()), owner(memoryStore())];
  await newInterview(one);
  expect(await (await two('/interviews')).text()).toContain('No interviews yet');
});

test('test stores ignore KV variables and never contact Upstash', async () => {
  const saved = { url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN };
  process.env.KV_REST_API_URL = 'https://kv.invalid';
  process.env.KV_REST_API_TOKEN = 'synthetic-token';
  const network = spyOn(globalThis, 'fetch');
  try {
    expect((await owner(memoryStore())('/interviews', {})).status).toBe(303);
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

test('upstashStore saves, lists and reloads interviews through the Upstash REST API (local stub)', async () => {
  const data = new Map<string, string>();
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const run = (command: string[]) => {
        const [cmd, ...args] = command;
        const name = String(cmd).toLowerCase();
        if (name === 'set') {
          data.set(args[0], args[1]);
          return 'OK';
        }
        if (name === 'get') return data.get(args[0]) ?? null;
        if (name === 'del') return args.filter((key) => data.delete(key)).length;
        if (name === 'scan') {
          const pattern = args[args.findIndex((a) => a.toLowerCase() === 'match') + 1];
          return ['0', [...data.keys()].filter((key) => key.startsWith(pattern.replace(/\*$/, '')))];
        }
        throw new Error(`unexpected command ${name}`);
      };
      const body = await req.json();
      if (new URL(req.url).pathname.includes('pipeline')) return Response.json((body as string[][]).map((command) => ({ result: run(command) })));
      return Response.json({ result: run(body as string[]) });
    },
  });
  try {
    const url = `http://localhost:${server.port}`;
    const first = owner(upstashStore(url, 'stub-token'));
    const path = await newInterview(first);
    await first(path, { revision: '1', name: 'Remote notes' });
    const second = owner(upstashStore(url, 'stub-token'));
    expect(sheetForm(await (await second(path)).text())).toMatchObject({ revision: 2, fields: { name: 'Remote notes' } });
    expect((await second('/interviews')).headers.get('Location')).toBe(path);
  } finally {
    server.stop(true);
  }
});
