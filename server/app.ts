import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const PUBLIC_FILES = new Map([
  ['/', 'index.html'],
  ...['index.html', 'guide.html', 'styles.css', 'legacy.html', 'client/app.js', 'client/db.js', 'client/legacy.js', 'img/variant-logo-dark.svg', 'img/variant-logo-light.svg'].map((path) => [`/${path}`, path]),
]);
const root = resolve(import.meta.dir, '..');
const validId = (id: unknown) => typeof id === 'string' && /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id);
const validRevision = (revision: unknown) => Number.isSafeInteger(revision) && Number(revision) > 0;
function validSheet(sheet: any) {
  return sheet && validId(sheet.id) && sheet.fields && typeof sheet.fields === 'object' && !Array.isArray(sheet.fields)
    && Object.entries(sheet.fields).every(([key, value]) => key.length <= 100 && (typeof value === 'string' || (Array.isArray(value) && value.every((item) => typeof item === 'string'))))
    && Number.isSafeInteger(sheet.createdAt) && sheet.createdAt >= 0 && Number.isSafeInteger(sheet.updatedAt) && sheet.updatedAt >= 0;
}
function decode(row: any) {
  if (!row) return null;
  const { owner, ...sheet } = row;
  return { ...sheet, fields: JSON.parse(sheet.fields) };
}

export function createApp({ databasePath, users, publicOrigin }: { databasePath: string; users: Record<string, string>; publicOrigin?: string }) {
  if (!users || !Object.keys(users).length || Object.entries(users).some(([name, hash]) => !name || typeof hash !== 'string' || !hash.startsWith('$argon2id$'))) {
    throw new Error('Configure INTERVIEWER_USERS_FILE with a JSON object of named users and Argon2id password hashes.');
  }
  if (publicOrigin && new URL(publicOrigin).origin !== publicOrigin) throw new Error('APP_ORIGIN must be an origin without a trailing slash.');
  if (databasePath !== ':memory:') mkdirSync(dirname(resolve(databasePath)), { recursive: true, mode: 0o700 });
  const db = new Database(databasePath, { create: true });
  db.exec(`PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS sheets (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, fields TEXT NOT NULL,
      createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS sheets_owner ON sheets(owner);`);
  const app = new Hono<{ Variables: { owner: string } }>();
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    await next();
  });
  app.use('*', basicAuth({
    realm: 'Agentic mapping',
    verifyUser: async (username, password, c) => {
      const hash = Object.hasOwn(users, username) ? users[username] : users[Object.keys(users)[0]];
      const matches = await Bun.password.verify(password, hash);
      if (!matches || !Object.hasOwn(users, username)) return false;
      c.set('owner', username);
      return true;
    },
  }));
  app.use('/api/*', bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: 'Sheet exceeds 1 MB.' }, 413) }));
  app.use('/api/*', async (c, next) => {
    if (!['GET', 'HEAD'].includes(c.req.method)) {
      if (c.req.header('Origin') !== (publicOrigin ?? new URL(c.req.url).origin) || c.req.header('Sec-Fetch-Site') === 'cross-site') {
        return c.json({ error: 'Cross-site writes are not allowed.' }, 403);
      }
      if (c.req.header('Content-Type')?.split(';')[0] !== 'application/json') return c.json({ error: 'JSON required.' }, 415);
    }
    await next();
  });
  app.get('/api/sheets', (c) => c.json(db.query('SELECT * FROM sheets WHERE owner = ?').all(c.get('owner')).map(decode)));
  app.get('/api/sheets/:id', (c) => {
    const sheet = decode(db.query('SELECT * FROM sheets WHERE id = ? AND owner = ?').get(c.req.param('id'), c.get('owner')));
    return sheet ? c.json(sheet) : c.json({ error: 'Sheet unavailable.' }, 404);
  });
  app.post('/api/sheets', async (c) => {
    const sheet = await c.req.json().catch(() => null);
    if (!validSheet(sheet)) return c.json({ error: 'Invalid sheet.' }, 400);
    const owner = c.get('owner');
    // Identical create/import retries are safe; an ID collision never overwrites data.
    const result = db.transaction(() => {
      const existing = db.query('SELECT * FROM sheets WHERE id = ?').get(sheet.id) as any;
      if (existing) {
        const saved = decode(existing);
        const sameFields = Object.keys(saved.fields).length === Object.keys(sheet.fields).length
          && Object.entries(sheet.fields).every(([key, value]) => JSON.stringify(value) === JSON.stringify(saved.fields[key]));
        return existing.owner === owner && sameFields && saved.createdAt === sheet.createdAt && saved.updatedAt === sheet.updatedAt ? { sheet: saved, created: false } : null;
      }
      db.query('INSERT INTO sheets (id, owner, fields, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)').run(sheet.id, owner, JSON.stringify(sheet.fields), sheet.createdAt, sheet.updatedAt);
      return { sheet: { id: sheet.id, fields: sheet.fields, createdAt: sheet.createdAt, updatedAt: sheet.updatedAt, revision: 1 }, created: true };
    }).immediate();
    if (!result) return c.json({ error: 'Sheet ID already exists; nothing was overwritten.' }, 409);
    return c.json(result.sheet, result.created ? 201 : 200);
  });
  app.put('/api/sheets/:id', async (c) => {
    const sheet = await c.req.json().catch(() => null);
    if (!validSheet(sheet) || sheet.id !== c.req.param('id') || !validRevision(sheet.revision)) return c.json({ error: 'Invalid sheet or revision.' }, 400);
    const owner = c.get('owner');
    const result = db.query('UPDATE sheets SET fields = ?, updatedAt = ?, revision = revision + 1 WHERE id = ? AND owner = ? AND revision = ? RETURNING *')
      .get(JSON.stringify(sheet.fields), Date.now(), sheet.id, owner, sheet.revision);
    if (result) return c.json(decode(result));
    const exists = db.query('SELECT id FROM sheets WHERE id = ? AND owner = ?').get(sheet.id, owner);
    return c.json({ error: exists ? 'Another device changed this sheet. Download your draft, then reload and merge your notes.' : 'Sheet unavailable.' }, exists ? 409 : 404);
  });
  app.delete('/api/sheets/:id', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!validRevision(body?.revision)) return c.json({ error: 'Revision required.' }, 400);
    const owner = c.get('owner');
    const result = db.query('DELETE FROM sheets WHERE id = ? AND owner = ? AND revision = ? RETURNING id').get(c.req.param('id'), owner, body.revision);
    if (result) return c.body(null, 204);
    const exists = db.query('SELECT id FROM sheets WHERE id = ? AND owner = ?').get(c.req.param('id'), owner);
    return c.json({ error: exists ? 'Sheet changed; reload before deleting.' : 'Sheet unavailable.' }, exists ? 409 : 404);
  });
  app.all('/api/*', (c) => c.json({ error: 'Endpoint unavailable.' }, 404));
  app.get('*', async (c) => {
    const file = PUBLIC_FILES.get(c.req.path);
    if (!file) return c.notFound();
    return new Response(Bun.file(resolve(root, file)));
  });
  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse();
    console.error('Storage request failed:', error.name);
    return c.json({ error: 'Storage unavailable. Keep your draft and retry.' }, 503);
  });
  return { app, db };
}
