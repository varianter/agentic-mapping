import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

test('Git ignores local account files and private key material', () => {
  const paths = ['.env', '.env.production', 'data/interviewers.json', 'interviewers.json', 'secrets/accounts.json', 'tls.key', 'tls.pem', 'tls.p12', 'tls.pfx', 'sheets.sqlite', 'sheets.sqlite-wal', '_site/index.html', 'test-results/trace.zip', 'playwright-report/index.html'];
  const result = Bun.spawnSync(['git', 'check-ignore', '--no-index', '--stdin'], {
    cwd: resolve(import.meta.dir, '..'),
    stdin: Buffer.from(`${paths.join('\n')}\n`),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString().trim().split('\n')).toEqual(paths);
});

test('Pages artifact contains only the exporter assets, excluding private and participant files', async () => {
  const root = resolve(import.meta.dir, '..');
  const directory = mkdtempSync(resolve(tmpdir(), 'mapping-artifact-'));
  try {
    mkdirSync(resolve(directory, 'client'));
    for (const path of ['legacy.html', 'styles.css', 'client/legacy.js']) copyFileSync(resolve(root, path), resolve(directory, path));
    for (const path of ['.env', 'interviewers.json', 'sheets.sqlite', 'server.ts', 'client/private-config.json', 'client/participant.js']) writeFileSync(resolve(directory, path), 'SYNTHETIC_PRIVATE_MARKER');
    const workflow = await Bun.file(resolve(root, '.github/workflows/pages.yml')).text();
    const collect = workflow.match(/run: \|\n((?: {10}.*\n)+)/)?.[1].replace(/^ {10}/gm, '');
    expect(collect).toBeDefined();
    const result = Bun.spawnSync(['bash', '-eu', '-c', collect!], { cwd: directory, stdout: 'pipe', stderr: 'pipe' });
    expect(result.exitCode).toBe(0);
    const files = readdirSync(resolve(directory, '_site'), { recursive: true }).sort();
    expect(files).toEqual(['.nojekyll', 'client', 'client/legacy.js', 'index.html', 'styles.css']);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
