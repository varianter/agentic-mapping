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
  const headers = { Authorization: `Basic ${btoa(`admin:${adminKey}`)}`, Origin: origin, 'Content-Type': 'application/json' };
  const env = { ...process.env, PORT: String(port), APP_ORIGIN: origin, DATABASE_PATH: join(directory, 'sheets.sqlite'), ADMIN_KEY: adminKey };
  const start = () => Bun.spawn([process.execPath, 'server.ts'], { cwd: root, env, stdout: 'pipe', stderr: 'pipe' });
  let child = start();
  async function waitReady() {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error('Server exited before accepting requests.');
      try {
        const response = await fetch(`${origin}/api/sheets`, { headers, signal: AbortSignal.timeout(500) });
        if (response.ok) return;
      } catch {}
      await Bun.sleep(50);
    }
    throw new Error('Server did not become ready.');
  }
  try {
    await waitReady();
    const id = crypto.randomUUID();
    const created = await fetch(`${origin}/api/sheets`, { method: 'POST', headers, body: JSON.stringify({ id, fields: { name: 'Survives process restart' }, createdAt: 1, updatedAt: 2 }) });
    expect(created.status).toBe(201);
    child.kill();
    await child.exited;
    child = start();
    await waitReady();
    const saved = await (await fetch(`${origin}/api/sheets/${id}`, { headers })).json();
    expect(saved.fields.name).toBe('Survives process restart');
    expect(saved.revision).toBe(1);
  } finally {
    child.kill();
    await child.exited;
    rmSync(directory, { recursive: true, force: true });
  }
}, 20000);

test('Bun entrypoint refuses startup without a long enough ADMIN_KEY', () => {
  for (const ADMIN_KEY of ['', 'too-short']) {
    const child = Bun.spawnSync([process.execPath, 'server.ts'], { cwd: root, env: { ...process.env, ADMIN_KEY }, stdout: 'pipe', stderr: 'pipe' });
    expect(child.exitCode).not.toBe(0);
    expect(child.stderr.toString()).toContain('ADMIN_KEY');
  }
});
