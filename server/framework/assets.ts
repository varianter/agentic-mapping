import { Hono } from 'hono';
import { extname, resolve } from 'node:path';

// Everything under public/ gets a content-hashed URL, computed once at startup without a build step.
// The manifest is the allowlist: only these exact paths are ever served, and they are cached as immutable.
const root = resolve(import.meta.dir, '../../public');
const TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const byPath = new Map<string, string>();
const byUrl = new Map<string, { file: string; type: string }>();
for (const path of new Bun.Glob('**/*').scanSync({ cwd: root })) {
  const ext = extname(path);
  if (!TYPES[ext]) continue;
  const file = resolve(root, path);
  const hash = Bun.hash(await Bun.file(file).bytes()).toString(36).slice(0, 10);
  const url = `/assets/${path.slice(0, -ext.length)}.${hash}${ext}`;
  byPath.set(path, url);
  byUrl.set(url, { file, type: TYPES[ext] });
}

// The hashed URL for a file in public/, e.g. asset('styles.css').
export function asset(path: string) {
  const url = byPath.get(path);
  if (!url) throw new Error(`No public asset ${path}.`);
  return url;
}

export const assets = new Hono().get('/*', (c) => {
  const found = byUrl.get(c.req.path);
  if (!found) return c.notFound();
  return new Response(Bun.file(found.file), {
    headers: { 'Content-Type': found.type, 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
});
