import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { resolve } from 'node:path';
import type { Store } from './store';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const PUBLIC_FILES = new Map([
  ['/', 'index.html'],
  ['/participant', 'index.html'],
  ...['index.html', 'guide.html', 'styles.css', 'legacy.html', 'client/boot.js', 'client/form.js', 'client/participant.js', 'client/app.js', 'client/db.js', 'client/local-db.js', 'client/legacy.js', 'img/variant-logo-dark.svg', 'img/variant-logo-light.svg'].map((path) => [`/${path}`, path]),
]);
const PUBLIC_ASSETS = new Set([...PUBLIC_FILES.keys()].filter((path) => /\.(js|css|svg)$/.test(path)));
const PARTICIPANT_FIELDS = new Set([
  ...['ind', 'team', 'org'].flatMap((dimension) => ['learn', 'why', 'found'].flatMap((question) => ['start', 'good', 'next'].map((level) => `${dimension}_${question}_${level}`))),
  'good', 'surprised', 'missing', 'advice',
]);
const hashCredential = (credential: string) => createHash('sha256').update(credential).digest('hex');
const localHost = (hostname: string) => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
function participantView(row: any) {
  return { fields: Object.fromEntries(Object.entries(row.fields).filter(([key, value]) => PARTICIPANT_FIELDS.has(key) && typeof value === 'string')), revision: row.revision };
}
const root = resolve(import.meta.dir, '..');
const validId = (id: unknown) => typeof id === 'string' && /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id);
const validRevision = (revision: unknown) => Number.isSafeInteger(revision) && Number(revision) > 0;
function validSheet(sheet: any) {
  return sheet && validId(sheet.id) && sheet.fields && typeof sheet.fields === 'object' && !Array.isArray(sheet.fields)
    && Object.entries(sheet.fields).every(([key, value]) => key.length <= 100 && (typeof value === 'string' || (Array.isArray(value) && value.every((item) => typeof item === 'string'))))
    && Number.isSafeInteger(sheet.createdAt) && sheet.createdAt >= 0 && Number.isSafeInteger(sheet.updatedAt) && sheet.updatedAt >= 0;
}
export function createApp({ store, adminKey, publicOrigin }: { store: Store; adminKey?: string; publicOrigin?: string }) {
  if (typeof adminKey !== 'string' || adminKey.length < 32) throw new Error('Set ADMIN_KEY to a secret of at least 32 characters.');
  const adminDigest = hashCredential(adminKey);
  if (publicOrigin && new URL(publicOrigin).origin !== publicOrigin) throw new Error('APP_ORIGIN must be an origin without a trailing slash.');
  if (publicOrigin && new URL(publicOrigin).protocol !== 'https:' && !(new URL(publicOrigin).protocol === 'http:' && localHost(new URL(publicOrigin).hostname))) {
    throw new Error('APP_ORIGIN must use HTTPS outside localhost.');
  }
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
  const publicSheet = ({ linkHash: _linkHash, ...sheet }: any) => sheet;
  const linkedSheet = async (authorization?: string) => {
    const credential = /^Bearer ([a-f0-9]{64})$/i.exec(authorization ?? '')?.[1];
    if (!credential) return null;
    const hash = hashCredential(credential);
    const link = await store.get(`link:${hash}`);
    const sheet = link && await store.get(`sheet:${link.sheetId}`);
    return sheet?.linkHash === hash ? sheet : null;
  };
  app.get('/api/participant', async (c) => {
    const sheet = await linkedSheet(c.req.header('Authorization'));
    return sheet ? c.json(participantView(sheet)) : c.json({ error: 'Link unavailable.' }, 404);
  });
  app.put('/api/participant', async (c) => {
    const authorization = c.req.header('Authorization');
    if (!await linkedSheet(authorization)) return c.json({ error: 'Link unavailable.' }, 404);
    const body = await c.req.json().catch(() => null);
    if (!body || Object.keys(body).some((key) => !['fields', 'revision'].includes(key)) || !validRevision(body.revision)
      || !body.fields || typeof body.fields !== 'object' || Array.isArray(body.fields)
      || Object.entries(body.fields).some(([key, value]) => !PARTICIPANT_FIELDS.has(key) || typeof value !== 'string')) {
      return c.json({ error: 'Only approved answer fields and a revision are allowed.' }, 400);
    }
    // Recheck after reading the body, immediately before the write.
    const stored = await linkedSheet(authorization);
    if (!stored) return c.json({ error: 'Link unavailable.' }, 404);
    if (stored.revision !== body.revision) return c.json({ error: 'Newer answers are stored. Keep your draft, then reload and merge your answers.' }, 409);
    const saved = { ...stored, fields: { ...stored.fields, ...body.fields }, updatedAt: Date.now(), revision: stored.revision + 1 };
    await store.set(`sheet:${saved.id}`, saved);
    return c.json(participantView(saved));
  });
  app.all('/api/participant/*', (c) => c.json({ error: 'Link unavailable.' }, 404));
  app.all('/api/participant', (c) => c.json({ error: 'Link unavailable.' }, 404));

  app.post('/api/sheets/:id/access', async (c) => {
    const sheet = await store.get(`sheet:${c.req.param('id')}`);
    if (!sheet) return c.json({ error: 'Sheet unavailable.' }, 404);
    const credential = randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
    const linkHash = hashCredential(credential);
    await store.set(`link:${linkHash}`, { sheetId: sheet.id }, expiresAt);
    await store.set(`sheet:${sheet.id}`, { ...sheet, linkHash });
    if (sheet.linkHash) await store.del(`link:${sheet.linkHash}`);
    return c.json({ credential, expiresAt }, 201);
  });
  app.delete('/api/sheets/:id/access', async (c) => {
    const sheet = await store.get(`sheet:${c.req.param('id')}`);
    if (!sheet) return c.json({ error: 'Sheet unavailable.' }, 404);
    if (sheet.linkHash) {
      const { linkHash, ...rest } = sheet;
      await store.set(`sheet:${sheet.id}`, rest);
      await store.del(`link:${linkHash}`);
    }
    return c.body(null, 204);
  });
  app.get('/api/sheets', async (c) => {
    const sheets = await Promise.all((await store.keys('sheet:')).map((key) => store.get(key)));
    return c.json(sheets.filter(Boolean).map(publicSheet));
  });
  app.get('/api/sheets/:id', async (c) => {
    const sheet = await store.get(`sheet:${c.req.param('id')}`);
    return sheet ? c.json(publicSheet(sheet)) : c.json({ error: 'Sheet unavailable.' }, 404);
  });
  app.post('/api/sheets', async (c) => {
    const sheet = await c.req.json().catch(() => null);
    if (!validSheet(sheet)) return c.json({ error: 'Invalid sheet.' }, 400);
    // Identical create/import retries are safe; an ID collision never overwrites data.
    const existing = await store.get(`sheet:${sheet.id}`);
    if (existing) {
      const sameFields = Object.keys(existing.fields).length === Object.keys(sheet.fields).length
        && Object.entries(sheet.fields).every(([key, value]) => JSON.stringify(value) === JSON.stringify(existing.fields[key]));
      return sameFields && existing.createdAt === sheet.createdAt && existing.updatedAt === sheet.updatedAt
        ? c.json(publicSheet(existing), 200)
        : c.json({ error: 'Sheet ID already exists; nothing was overwritten.' }, 409);
    }
    const created = { id: sheet.id, fields: sheet.fields, createdAt: sheet.createdAt, updatedAt: sheet.updatedAt, revision: 1 };
    await store.set(`sheet:${sheet.id}`, created);
    return c.json(created, 201);
  });
  app.put('/api/sheets/:id', async (c) => {
    const sheet = await c.req.json().catch(() => null);
    if (!validSheet(sheet) || sheet.id !== c.req.param('id') || !validRevision(sheet.revision)) return c.json({ error: 'Invalid sheet or revision.' }, 400);
    const stored = await store.get(`sheet:${sheet.id}`);
    if (!stored) return c.json({ error: 'Sheet unavailable.' }, 404);
    if (stored.revision !== sheet.revision) return c.json({ error: 'Another device changed this sheet. Download your draft, then reload and merge your notes.' }, 409);
    const saved = { ...stored, fields: sheet.fields, updatedAt: Date.now(), revision: stored.revision + 1 };
    await store.set(`sheet:${sheet.id}`, saved);
    return c.json(publicSheet(saved));
  });
  app.delete('/api/sheets/:id', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!validRevision(body?.revision)) return c.json({ error: 'Revision required.' }, 400);
    const stored = await store.get(`sheet:${c.req.param('id')}`);
    if (!stored) return c.json({ error: 'Sheet unavailable.' }, 404);
    if (stored.revision !== body.revision) return c.json({ error: 'Sheet changed; reload before deleting.' }, 409);
    await store.del(`sheet:${stored.id}`, ...(stored.linkHash ? [`link:${stored.linkHash}`] : []));
    return c.body(null, 204);
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
  return { app };
}
