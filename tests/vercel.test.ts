import { expect, test } from 'bun:test';
import { memoryStore } from '../server/store';
import { createApp } from '../server/app';
import { adminCookie, adminKey } from './helpers';

test('Vercel entry serves pages and hashed assets only, and requires credentials', async () => {
  const keys = ['ADMIN_KEY', 'VERCEL', 'VERCEL_ENV', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'VERCEL_URL'];
  const saved = keys.map((key) => process.env[key]);
  try {
    Object.assign(process.env, {
      ADMIN_KEY: adminKey,
      VERCEL: '1',
      VERCEL_ENV: 'preview',
      KV_REST_API_URL: 'https://kv.invalid',
      KV_REST_API_TOKEN: 'test',
      VERCEL_URL: 'x-1.vercel.app',
    });
    const { default: app } = await import('../api/index');
    for (const path of ['/server/app.tsx', '/server.ts', '/package.json', '/vercel.json', '/.env', '/data/sheets.sqlite', '/users.json', '/public/styles.css', '/api/sheets']) {
      expect((await app.request(`https://x-1.vercel.app${path}`, { headers: { Cookie: adminCookie } })).status).toBe(404);
      expect((await app.request(`https://x-1.vercel.app${path}`)).status).toBe(404);
    }
    expect((await app.request('https://x-1.vercel.app/interviews')).headers.get('Location')).toBe('/sign-in');
    expect((await app.request('https://x-1.vercel.app/interviews', { headers: { Cookie: 'am_admin=wrong' } })).headers.get('Location')).toBe('/sign-in');
    expect((await app.request('https://x-1.vercel.app/connect')).status).toBe(200);
  } finally {
    keys.forEach((key, i) => (saved[i] === undefined ? delete process.env[key] : (process.env[key] = saved[i])));
  }
});

test('preview origins may post; other origins are rejected', async () => {
  const { app } = createApp({ store: memoryStore(), adminKey, publicOrigin: 'https://prod.example', allowedOrigins: ['https://x-1.vercel.app', 'https://x-git-b.vercel.app'] });
  const post = (origin: string) => app.request('https://x-1.vercel.app/interviews', {
    method: 'POST',
    headers: { Cookie: adminCookie, Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  for (const origin of ['https://x-1.vercel.app', 'https://x-git-b.vercel.app', 'https://prod.example']) expect((await post(origin)).status).toBe(303);
  expect((await post('https://evil.example')).status).toBe(403);
});

test('vercel.json sends every request to the function and bundles the server and every public file', async () => {
  const config = await Bun.file(new URL('../vercel.json', import.meta.url)).json();
  // `routes` without a filesystem handle runs before static files, so repo files are never served as-is.
  expect(config.rewrites).toBeUndefined();
  expect(config.routes).toEqual([{ src: '/(.*)', dest: '/api' }]);
  const include = new Bun.Glob(config.functions['api/index.ts'].includeFiles);
  const root = new URL('..', import.meta.url).pathname;
  for (const pattern of ['public/**/*', 'server/**/*']) {
    for (const file of new Bun.Glob(pattern).scanSync(root)) expect(include.match(file) ? file : `missing ${file}`).toBe(file);
  }
});
