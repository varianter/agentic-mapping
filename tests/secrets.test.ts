import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

test('Git ignores local account files and private key material', () => {
  const paths = ['.env', '.env.production', 'data/interviewers.json', 'interviewers.json', 'secrets/accounts.json', 'tls.key', 'tls.pem', 'tls.p12', 'tls.pfx', 'sheets.sqlite', 'sheets.sqlite-wal', '_site/index.html'];
  const result = Bun.spawnSync(['git', 'check-ignore', '--no-index', '--stdin'], {
    cwd: resolve(import.meta.dir, '..'),
    stdin: Buffer.from(`${paths.join('\n')}\n`),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString().trim().split('\n')).toEqual(paths);
});
