import { expect, test } from 'bun:test';
import { dirname, relative, resolve } from 'node:path';

// Features (server/<feature>/) are loosely coupled: they import only domain/, framework/, shell/ and themselves,
// never another feature or the store's adapters. Shared layers never import features.
const server = resolve(import.meta.dir, '../server');
const SHARED = ['domain', 'framework', 'shell'];
const allowed: Record<string, string[]> = { domain: ['domain'], framework: ['domain', 'framework'], shell: ['domain', 'framework', 'shell'] };

function imports(source: string) {
  return [...source.matchAll(/^import\s+(type\s+)?[^'"]*?from\s+['"](\.[^'"]+)['"]/gm)].map(([, type, path]) => ({ type: Boolean(type), path }));
}

test('features import only shared layers, and shared layers never import features', async () => {
  const problems: string[] = [];
  for (const file of new Bun.Glob('*/**/*.{ts,tsx}').scanSync({ cwd: server })) {
    const area = file.split('/')[0];
    const source = await Bun.file(resolve(server, file)).text();
    for (const { type, path } of imports(source)) {
      const target = relative(server, resolve(server, dirname(file), path));
      const targetArea = target.includes('/') ? target.split('/')[0] : target.replace(/\.tsx?$/, '');
      if (targetArea === 'store') {
        if (!type && area !== 'domain') problems.push(`${file} imports the store adapters`);
        continue;
      }
      const ok = SHARED.includes(area) ? allowed[area].includes(targetArea) : targetArea === area || SHARED.includes(targetArea);
      if (!ok) problems.push(`${file} imports ${target}`);
    }
  }
  expect(problems).toEqual([]);
});
