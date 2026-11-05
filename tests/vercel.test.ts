import { expect, test } from 'bun:test';
import { memoryStore } from '../server/store';
import { createApp } from '../server/app';

const adminKey = 'vercel-test-admin-key-0123456789-abcd';
const auth = { Authorization: `Basic ${btoa(`a:${adminKey}`)}` };
const sheet = { id: crypto.randomUUID(), fields: {}, createdAt: 1, updatedAt: 1 };

test('Vercel entry serves only allowlisted files and requires credentials', async () => {
  Object.assign(process.env, { ADMIN_KEY: adminKey, VERCEL: '1', VERCEL_ENV: 'preview', KV_REST_API_URL: 'https://kv.invalid', KV_REST_API_TOKEN: 'test', VERCEL_URL: 'x-1.vercel.app' });
  const { default: app } = await import('../api/index');
  const paths = ['/server/app.ts', '/server.ts', '/package.json', '/vercel.json', '/.env', '/data/sheets.sqlite', '/users.json'];
  for (const path of paths) {
    expect((await app.request(`https://x-1.vercel.app${path}`, { headers: auth })).status).toBe(404);
    expect((await app.request(`https://x-1.vercel.app${path}`)).status).toBe(401);
  }
  expect((await app.request('https://x-1.vercel.app/api/sheets')).status).toBe(401);
  expect((await app.request('https://x-1.vercel.app/api/sheets', { headers: { Authorization: `Basic ${btoa('a:wrong')}` } })).status).toBe(401);
  expect((await app.request('https://x-1.vercel.app/participant')).status).toBe(200);
});

test('preview origins may write; other origins are rejected', async () => {
  const { app } = createApp({ store: memoryStore(), adminKey, publicOrigin: 'https://prod.example', allowedOrigins: ['https://x-1.vercel.app', 'https://x-git-b.vercel.app'] });
  const post = (origin: string) => app.request('https://x-1.vercel.app/api/sheets', { method: 'POST', headers: { ...auth, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...sheet, id: crypto.randomUUID() }) });
  expect((await post('https://x-1.vercel.app')).status).toBe(201);
  expect((await post('https://x-git-b.vercel.app')).status).toBe(201);
  expect((await post('https://prod.example')).status).toBe(201);
  expect((await post('https://evil.example')).status).toBe(403);
});
