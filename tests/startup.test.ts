import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');

test('configured Bun process retains notes across a server restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mapping-process-'));
  const adminKey = 'process-test-admin-key-0123456789-abcd';
  const reservation = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = reservation.port;
  reservation.stop(true);
  const origin = `http://localhost:${port}`;
  const { sessionToken } = await import('../server/app');
  const headers = { Cookie: `am_admin=${sessionToken(adminKey)}`, Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' };
  const env: Record<string, string | undefined> = { ...process.env, PORT: String(port), APP_ORIGIN: origin, LOCAL_STORE_FILE: join(directory, 'store.json'), ADMIN_KEY: adminKey };
  delete env.KV_REST_API_URL;
  delete env.KV_REST_API_TOKEN;
  const start = () => Bun.spawn([process.execPath, 'server.ts'], { cwd: root, env, stdout: 'pipe', stderr: 'pipe' });
  let child = start();
  async function waitReady() {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error('Server exited before accepting requests.');
      try {
        const response = await fetch(`${origin}/guide`, { signal: AbortSignal.timeout(500) });
        if (response.ok) return;
      } catch {}
      await Bun.sleep(50);
    }
    throw new Error('Server did not become ready.');
  }
  try {
    await waitReady();
    const created = await fetch(`${origin}/interviews`, { method: 'POST', headers, redirect: 'manual' });
    expect(created.status).toBe(303);
    const path = created.headers.get('Location')!;
    expect((await fetch(`${origin}${path}`, { method: 'POST', headers, body: 'revision=1&name=Survives+process+restart', redirect: 'manual' })).status).toBe(303);
    child.kill();
    await child.exited;
    child = start();
    await waitReady();
    const [saved] = await (await fetch(`${origin}${path}.json`, { headers })).json();
    expect(saved.fields.name).toBe('Survives process restart');
    expect(saved.revision).toBe(2);
  } finally {
    child.kill();
    await child.exited;
    rmSync(directory, { recursive: true, force: true });
  }
}, 20000);

test('Bun entrypoint refuses startup with a too short ADMIN_KEY', () => {
  const child = Bun.spawnSync([process.execPath, 'server.ts'], { cwd: root, env: { ...process.env, ADMIN_KEY: 'too-short' }, stdout: 'pipe', stderr: 'pipe' });
  expect(child.exitCode).not.toBe(0);
  expect(child.stderr.toString()).toContain('ADMIN_KEY');
});

test('loadConfig fails clearly without storage on Vercel and adds preview origins', async () => {
  const { loadConfig } = await import('../server/config');
  const base = { ADMIN_KEY: 'x'.repeat(32) };
  expect(() => loadConfig({ ...base, VERCEL: '1' })).toThrow('Config error: set KV_REST_API_URL');
  expect(() => loadConfig({ ADMIN_KEY: 'too-short' })).toThrow('ADMIN_KEY');
  // Without ADMIN_KEY the app is self-only, but My map still needs storage: KV on Vercel, a local file elsewhere.
  expect(() => loadConfig({ VERCEL: '1' })).toThrow('Config error: set KV_REST_API_URL');
  const directory = mkdtempSync(join(tmpdir(), 'mapping-config-'));
  try {
    for (const env of [{}, { ADMIN_KEY: '' }]) {
      const config = loadConfig({ ...env, LOCAL_STORE_FILE: join(directory, 'store.json') });
      expect(config.adminKey).toBeUndefined();
      expect(config.store).toBeDefined();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  const preview = loadConfig({ ...base, VERCEL: '1', VERCEL_ENV: 'preview', KV_REST_API_URL: 'https://kv.example', KV_REST_API_TOKEN: 't', APP_ORIGIN: 'https://prod.example', VERCEL_URL: 'a-1.vercel.app', VERCEL_BRANCH_URL: 'a-git-b.vercel.app' });
  expect(preview.allowedOrigins).toEqual(['https://prod.example', 'https://a-1.vercel.app', 'https://a-git-b.vercel.app']);
  expect(loadConfig({ ...base, VERCEL_ENV: 'production', VERCEL_URL: 'a-1.vercel.app' }).allowedOrigins).toEqual([]);
});
