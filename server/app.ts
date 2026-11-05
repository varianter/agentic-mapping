import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const PUBLIC_FILES = new Map([
  ['/', 'index.html'],
  ['/participant', 'index.html'],
  ...['index.html', 'guide.html', 'styles.css', 'client/boot.js', 'client/form.js', 'client/participant.js', 'client/app.js', 'client/db.js', 'client/local-db.js', 'img/variant-logo-dark.svg', 'img/variant-logo-light.svg'].map((path) => [`/${path}`, path]),
]);
const PUBLIC_ASSETS = new Set([...PUBLIC_FILES.keys()].filter((path) => /\.(js|css|svg)$/.test(path)));
const PARTICIPANT_FIELDS = new Set([
  ...['ind', 'team', 'org'].flatMap((dimension) => ['learn', 'why', 'found'].flatMap((question) => ['start', 'good', 'next'].map((level) => `${dimension}_${question}_${level}`))),
  'good', 'surprised', 'missing', 'advice',
]);
const hashCredential = (credential: string) => createHash('sha256').update(credential).digest('hex');
const localHost = (hostname: string) => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
function participantView(row: any) {
  const fields = JSON.parse(row.fields);
  return { fields: Object.fromEntries(Object.entries(fields).filter(([key, value]) => PARTICIPANT_FIELDS.has(key) && typeof value === 'string')), revision: row.revision };
}
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
  return { ...row, fields: JSON.parse(row.fields) };
}

export function createApp({ databasePath, adminKey, publicOrigin }: { databasePath: string; adminKey?: string; publicOrigin?: string }) {
  if (typeof adminKey !== 'string' || adminKey.length < 32) throw new Error('Set ADMIN_KEY to a secret of at least 32 characters.');
  const adminDigest = hashCredential(adminKey);
  if (publicOrigin && new URL(publicOrigin).origin !== publicOrigin) throw new Error('APP_ORIGIN must be an origin without a trailing slash.');
  if (publicOrigin && new URL(publicOrigin).protocol !== 'https:' && !(new URL(publicOrigin).protocol === 'http:' && localHost(new URL(publicOrigin).hostname))) {
    throw new Error('APP_ORIGIN must use HTTPS outside localhost.');
  }
  if (databasePath !== ':memory:') mkdirSync(dirname(resolve(databasePath)), { recursive: true, mode: 0o700 });
  const db = new Database(databasePath, { create: true });
  db.exec(`PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS sheets (
      id TEXT PRIMARY KEY, fields TEXT NOT NULL,
      createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS participant_links (
      sheetId TEXT PRIMARY KEY, credentialHash TEXT NOT NULL UNIQUE, expiresAt INTEGER NOT NULL
    );`);
  const app = new Hono();
  app.use('*', async (c, next) => {
    const url = new URL(c.req.url);
    if (url.protocol !== 'https:' && !localHost(url.hostname) && !publicOrigin?.startsWith('https:')) {
      c.res = c.json({ error: 'HTTPS required.' }, 403);
    } else {
      await next();
    }
    // Set headers on the final response, including files and authentication errors.
    c.header('Cache-Control', 'no-store');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    if (publicOrigin?.startsWith('https:')) c.header('Strict-Transport-Security', 'max-age=31536000');
  });
  // The Basic password is the admin key; the username is ignored.
  const interviewerAuth = basicAuth({
    realm: 'Agentic mapping',
    verifyUser: (_username, password) => timingSafeEqual(Buffer.from(hashCredential(password), 'hex'), Buffer.from(adminDigest, 'hex')),
  });
  app.use('*', async (c, next) => {
    if (c.req.path === '/participant' || PUBLIC_ASSETS.has(c.req.path) || c.req.path === '/api/participant' || c.req.path.startsWith('/api/participant/')) return next();
    // A participant credential never falls through to interviewer authentication,
    // even when the browser also has a cached interviewer login.
    if (/^Bearer(?:\s|$)/i.test(c.req.header('Authorization') ?? '')) return c.json({ error: 'Access denied.' }, 403);
    if (['/', '/index.html'].includes(c.req.path) && !c.req.header('Authorization')) return next();
    return interviewerAuth(c, async () => {
      c.set('admin', true);
      await next();
    });
  });
  // An explicit challenge establishes Basic auth for this origin, then returns home.
  app.get('/sign-in', (c) => c.redirect('/', 303));
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
  const linkedSheet = (authorization?: string) => {
    const credential = /^Bearer ([a-f0-9]{64})$/i.exec(authorization ?? '')?.[1];
    if (!credential) return null;
    return db.query(`SELECT sheets.* FROM sheets JOIN participant_links ON participant_links.sheetId = sheets.id
      WHERE credentialHash = ? AND expiresAt > ?`).get(hashCredential(credential), Date.now()) as any;
  };
  app.get('/api/participant', (c) => {
    const sheet = linkedSheet(c.req.header('Authorization'));
    return sheet ? c.json(participantView(sheet)) : c.json({ error: 'Link unavailable.' }, 404);
  });
  app.put('/api/participant', async (c) => {
    const authorization = c.req.header('Authorization');
    if (!linkedSheet(authorization)) return c.json({ error: 'Link unavailable.' }, 404);
    const body = await c.req.json().catch(() => null);
    if (!body || Object.keys(body).some((key) => !['fields', 'revision'].includes(key)) || !validRevision(body.revision)
      || !body.fields || typeof body.fields !== 'object' || Array.isArray(body.fields)
      || Object.entries(body.fields).some(([key, value]) => !PARTICIPANT_FIELDS.has(key) || typeof value !== 'string')) {
      return c.json({ error: 'Only approved answer fields and a revision are allowed.' }, 400);
    }
    const result = db.transaction(() => {
      // Recheck after reading the body and under the same lock as the write.
      const stored = linkedSheet(authorization);
      if (!stored) return { status: 404 as const, error: 'Link unavailable.' };
      if (stored.revision !== body.revision) return { status: 409 as const, error: 'Newer answers are stored. Keep your draft, then reload and merge your answers.' };
      const fields = { ...JSON.parse(stored.fields), ...body.fields };
      const saved = db.query('UPDATE sheets SET fields = ?, updatedAt = ?, revision = revision + 1 WHERE id = ? AND revision = ? RETURNING *')
        .get(JSON.stringify(fields), Date.now(), stored.id, body.revision);
      return { sheet: participantView(saved) };
    }).immediate();
    return result.sheet ? c.json(result.sheet) : c.json({ error: result.error }, result.status!);
  });
  app.all('/api/participant/*', (c) => c.json({ error: 'Link unavailable.' }, 404));
  app.all('/api/participant', (c) => c.json({ error: 'Link unavailable.' }, 404));

  app.post('/api/sheets/:id/access', (c) => {
    const result = db.transaction(() => {
      const sheet = db.query('SELECT id FROM sheets WHERE id = ?').get(c.req.param('id'));
      if (!sheet) return null;
      const credential = randomBytes(32).toString('hex');
      const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
      db.query(`INSERT INTO participant_links (sheetId, credentialHash, expiresAt) VALUES (?, ?, ?)
        ON CONFLICT(sheetId) DO UPDATE SET credentialHash = excluded.credentialHash, expiresAt = excluded.expiresAt`)
        .run(c.req.param('id'), hashCredential(credential), expiresAt);
      return { credential, expiresAt };
    }).immediate();
    return result ? c.json(result, 201) : c.json({ error: 'Sheet unavailable.' }, 404);
  });
  app.delete('/api/sheets/:id/access', (c) => {
    const result = db.transaction(() => {
      const sheet = db.query('SELECT id FROM sheets WHERE id = ?').get(c.req.param('id'));
      if (!sheet) return false;
      db.query('DELETE FROM participant_links WHERE sheetId = ?').run(c.req.param('id'));
      return true;
    }).immediate();
    return result ? c.body(null, 204) : c.json({ error: 'Sheet unavailable.' }, 404);
  });
  app.get('/api/sheets', (c) => c.json(db.query('SELECT * FROM sheets').all().map(decode)));
  app.get('/api/sheets/:id', (c) => {
    const sheet = decode(db.query('SELECT * FROM sheets WHERE id = ?').get(c.req.param('id')));
    return sheet ? c.json(sheet) : c.json({ error: 'Sheet unavailable.' }, 404);
  });
  app.post('/api/sheets', async (c) => {
    const sheet = await c.req.json().catch(() => null);
    if (!validSheet(sheet)) return c.json({ error: 'Invalid sheet.' }, 400);
    // Identical create/import retries are safe; an ID collision never overwrites data.
    const result = db.transaction(() => {
      const existing = db.query('SELECT * FROM sheets WHERE id = ?').get(sheet.id) as any;
      if (existing) {
        const saved = decode(existing);
        const sameFields = Object.keys(saved.fields).length === Object.keys(sheet.fields).length
          && Object.entries(sheet.fields).every(([key, value]) => JSON.stringify(value) === JSON.stringify(saved.fields[key]));
        return sameFields && saved.createdAt === sheet.createdAt && saved.updatedAt === sheet.updatedAt ? { sheet: saved, created: false } : null;
      }
      db.query('INSERT INTO sheets (id, fields, createdAt, updatedAt) VALUES (?, ?, ?, ?)').run(sheet.id, JSON.stringify(sheet.fields), sheet.createdAt, sheet.updatedAt);
      return { sheet: { id: sheet.id, fields: sheet.fields, createdAt: sheet.createdAt, updatedAt: sheet.updatedAt, revision: 1 }, created: true };
    }).immediate();
    if (!result) return c.json({ error: 'Sheet ID already exists; nothing was overwritten.' }, 409);
    return c.json(result.sheet, result.created ? 201 : 200);
  });
  app.put('/api/sheets/:id', async (c) => {
    const sheet = await c.req.json().catch(() => null);
    if (!validSheet(sheet) || sheet.id !== c.req.param('id') || !validRevision(sheet.revision)) return c.json({ error: 'Invalid sheet or revision.' }, 400);
    const result = db.query('UPDATE sheets SET fields = ?, updatedAt = ?, revision = revision + 1 WHERE id = ? AND revision = ? RETURNING *')
      .get(JSON.stringify(sheet.fields), Date.now(), sheet.id, sheet.revision);
    if (result) return c.json(decode(result));
    const exists = db.query('SELECT id FROM sheets WHERE id = ?').get(sheet.id);
    return c.json({ error: exists ? 'Another device changed this sheet. Download your draft, then reload and merge your notes.' : 'Sheet unavailable.' }, exists ? 409 : 404);
  });
  app.delete('/api/sheets/:id', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!validRevision(body?.revision)) return c.json({ error: 'Revision required.' }, 400);
    const result = db.transaction(() => {
      const deleted = db.query('DELETE FROM sheets WHERE id = ? AND revision = ? RETURNING id').get(c.req.param('id'), body.revision);
      if (deleted) db.query('DELETE FROM participant_links WHERE sheetId = ?').run(c.req.param('id'));
      return deleted;
    }).immediate();
    if (result) return c.body(null, 204);
    const exists = db.query('SELECT id FROM sheets WHERE id = ?').get(c.req.param('id'));
    return c.json({ error: exists ? 'Sheet changed; reload before deleting.' : 'Sheet unavailable.' }, exists ? 409 : 404);
  });
  app.all('/api/*', (c) => c.json({ error: 'Endpoint unavailable.' }, 404));
  app.get('*', async (c) => {
    const file = PUBLIC_FILES.get(c.req.path);
    if (!file) return c.notFound();
    const asset = Bun.file(resolve(root, file));
    if (file === 'index.html') {
      const mode = c.req.path === '/participant' ? 'participant' : c.get('admin') ? 'server' : 'local';
      return c.html((await asset.text()).replace('data-storage-mode=""', `data-storage-mode="${mode}"`));
    }
    return new Response(asset, { headers: { 'Content-Type': asset.type } });
  });
  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse();
    console.error('Storage request failed.');
    return c.json({ error: 'Storage unavailable. Keep your draft and retry.' }, 503);
  });
  return { app, db };
}
