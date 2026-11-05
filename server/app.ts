import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { resolve } from 'node:path';
import type { Store } from './store';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { RESPONDENT_FIELDS as RESPONDENT_FIELD_LIST } from '../client/fields.js';

const PUBLIC_FILES = new Map([
  ['/', 'index.html'],
  ['/participant', 'index.html'],
  ...['index.html', 'guide.html', 'styles.css', 'client/boot.js', 'client/fields.js', 'client/form.js', 'client/self.js', 'client/self-db.js', 'client/participant.js', 'client/app.js', 'client/db.js', 'img/variant-logo-dark.svg', 'img/variant-logo-light.svg'].map((path) => [`/${path}`, path]),
]);
const PUBLIC_ASSETS = new Set([...PUBLIC_FILES.keys()].filter((path) => /\.(js|css|svg)$/.test(path)));
const RESPONDENT_FIELDS = new Set<string>(RESPONDENT_FIELD_LIST);
const SESSION_COOKIE = 'am_admin';
const SESSION_MAX_AGE = 30 * 24 * 60 * 60;
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
const signInPage = (error = '') => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>Sign in · Agentic mapping</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:28rem;margin:15vh auto;padding:0 1rem}label,input,button{display:block;font:inherit}input{width:100%;box-sizing:border-box;margin:.25rem 0 1rem;padding:.5rem}button{padding:.5rem 1rem}[role=alert]{color:#b00020}a{display:inline-block;margin-top:1.5rem}</style></head>
<body><h1>Interviewer sign-in</h1><p>Sign in with the admin key to create and manage interviews.</p>
${error ? `<p role="alert">${escapeHtml(error)}</p>` : ''}<form method="post" action="/sign-in"><label for="key">Admin key</label><input type="password" id="key" name="key" autocomplete="current-password" required autofocus><button type="submit">Sign in</button></form>
<a href="/">Fill in your own map instead</a></body></html>`;
const hashCredential = (credential: string) => createHash('sha256').update(credential).digest('hex');
// The admin cookie holds a key-derived token, never the key; rotating ADMIN_KEY signs everyone out.
export const sessionToken = (adminKey: string) => createHmac('sha256', adminKey).update('agentic-mapping-session-v1').digest('hex');
const sameDigest = (a: string, b: string) => timingSafeEqual(Buffer.from(hashCredential(a), 'hex'), Buffer.from(hashCredential(b), 'hex'));
const localHost = (hostname: string) => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
function participantView(row: any) {
  return { fields: Object.fromEntries(Object.entries(row.fields).filter(([key, value]) => RESPONDENT_FIELDS.has(key) && typeof value === 'string')), revision: row.revision };
}
const root = resolve(import.meta.dir, '..');
const validId = (id: unknown) => typeof id === 'string' && /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id);
const validRevision = (revision: unknown) => Number.isSafeInteger(revision) && Number(revision) > 0;
function validSheet(sheet: any) {
  return sheet && validId(sheet.id) && sheet.fields && typeof sheet.fields === 'object' && !Array.isArray(sheet.fields)
    && Object.entries(sheet.fields).every(([key, value]) => key.length <= 100 && (typeof value === 'string' || (Array.isArray(value) && value.every((item) => typeof item === 'string'))))
    && Number.isSafeInteger(sheet.createdAt) && sheet.createdAt >= 0 && Number.isSafeInteger(sheet.updatedAt) && sheet.updatedAt >= 0;
}
export function createApp({ store, adminKey, publicOrigin, allowedOrigins = [] }: { store?: Store; adminKey?: string; publicOrigin?: string; allowedOrigins?: string[] }) {
  if (adminKey !== undefined && (typeof adminKey !== 'string' || adminKey.length < 32)) throw new Error('Set ADMIN_KEY to a secret of at least 32 characters, or leave it unset for self-only mode.');
  if (adminKey !== undefined && !store) throw new Error('Interviewer mode needs a store.');
  const session = adminKey === undefined ? null : sessionToken(adminKey);
  if (publicOrigin && new URL(publicOrigin).origin !== publicOrigin) throw new Error('APP_ORIGIN must be an origin without a trailing slash.');
  if (publicOrigin && new URL(publicOrigin).protocol !== 'https:' && !(new URL(publicOrigin).protocol === 'http:' && localHost(new URL(publicOrigin).hostname))) {
    throw new Error('APP_ORIGIN must use HTTPS outside localhost.');
  }
  const origins = new Set([...(publicOrigin ? [publicOrigin] : []), ...allowedOrigins]);
  const httpsOrigins = [...origins].some((origin) => origin.startsWith('https:'));
  const sameOrigin = (c: Context) => (origins.size ? origins : new Set([new URL(c.req.url).origin])).has(c.req.header('Origin') ?? '') && c.req.header('Sec-Fetch-Site') !== 'cross-site';
  // With Referrer-Policy: no-referrer, browsers send `Origin: null` on form posts; Fetch Metadata still proves same-origin.
  const sameOriginForm = (c: Context) => sameOrigin(c) || c.req.header('Sec-Fetch-Site') === 'same-origin';
  const app = new Hono<{ Variables: { admin: boolean } }>();
  app.use('*', async (c, next) => {
    const url = new URL(c.req.url);
    if (url.protocol !== 'https:' && !localHost(url.hostname) && !httpsOrigins) {
      c.res = c.json({ error: 'HTTPS required.' }, 403);
    } else {
      await next();
    }
    // Set headers on the final response, including files and authentication errors.
    c.header('Cache-Control', 'no-store');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    if (httpsOrigins) c.header('Strict-Transport-Security', 'max-age=31536000');
  });
  const participantPath = (path: string) => path === '/participant' || path === '/api/participant' || path.startsWith('/api/participant/');
  const serveFiles = () => {
    app.get('*', async (c) => {
      const file = PUBLIC_FILES.get(c.req.path);
      if (!file || (!session && c.req.path === '/participant')) return c.notFound();
      const asset = Bun.file(resolve(root, file));
      if (file === 'index.html') {
        const mode = c.req.path === '/participant' ? 'participant' : c.get('admin') ? 'interviewer' : 'self';
        return c.html((await asset.text()).replace('data-mode=""', `data-mode="${mode}"${session ? ' data-admin-enabled' : ''}`));
      }
      return new Response(asset, { headers: { 'Content-Type': asset.type } });
    });
    app.onError((error, c) => {
      console.error('Storage request failed.');
      return c.json({ error: 'Storage unavailable. Keep your draft and retry.' }, 503);
    });
    return { app };
  };
  // Self-only mode: no admin key means no sign-in, interviews or private links.
  if (!session || !adminKey || !store) return serveFiles();
  app.use('*', async (c, next) => {
    const cookie = getCookie(c, SESSION_COOKIE);
    c.set('admin', Boolean(cookie && sameDigest(cookie, session)));
    if (participantPath(c.req.path) || !c.req.path.startsWith('/api/')) return next();
    // A participant credential never falls through to interviewer authentication,
    // even when the browser also has an admin cookie.
    if (/^Bearer(?:\s|$)/i.test(c.req.header('Authorization') ?? '')) return c.json({ error: 'Access denied.' }, 403);
    if (!c.get('admin')) return c.json({ error: 'Sign in as interviewer.' }, 401);
    await next();
  });
  const setSession = (c: Context, value: string, maxAge: number) => setCookie(c, SESSION_COOKIE, value, {
    httpOnly: true, sameSite: 'Strict', path: '/', maxAge,
    secure: new URL(c.req.url).protocol === 'https:' || httpsOrigins,
  });
  app.get('/sign-in', (c) => (c.get('admin') ? c.redirect('/', 303) : c.html(signInPage())));
  app.post('/sign-in', async (c) => {
    if (!sameOriginForm(c)) return c.html(signInPage('Sign in from this site.'), 403);
    const key = (await c.req.parseBody().catch(() => ({} as Record<string, unknown>))).key;
    if (typeof key !== 'string' || !sameDigest(key, adminKey)) return c.html(signInPage('That admin key is not right.'), 401);
    setSession(c, session, SESSION_MAX_AGE);
    return c.redirect('/', 303);
  });
  app.post('/sign-out', (c) => {
    if (!sameOriginForm(c)) return c.json({ error: 'Cross-site sign-out is not allowed.' }, 403);
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: new URL(c.req.url).protocol === 'https:' || httpsOrigins });
    return c.redirect('/', 303);
  });
  app.use('/api/*', bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: 'Sheet exceeds 1 MB.' }, 413) }));
  app.use('/api/*', async (c, next) => {
    if (!['GET', 'HEAD'].includes(c.req.method)) {
      if (!sameOrigin(c)) return c.json({ error: 'Cross-site writes are not allowed.' }, 403);
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
      || Object.entries(body.fields).some(([key, value]) => !RESPONDENT_FIELDS.has(key) || typeof value !== 'string')) {
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
    const linkHash = hashCredential(credential);
    // Links last until the interviewer replaces or revokes them.
    await store.set(`link:${linkHash}`, { sheetId: sheet.id });
    await store.set(`sheet:${sheet.id}`, { ...sheet, linkHash });
    if (sheet.linkHash) await store.del(`link:${sheet.linkHash}`);
    return c.json({ credential }, 201);
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
  return serveFiles();
}
