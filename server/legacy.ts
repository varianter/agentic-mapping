// The pre-rework single-page app and its JSON API, mounted behind app.tsx until each slice replaces it.
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { resolve } from 'node:path';
import type { Store } from './store';
import { sessionToken } from './framework/auth';
import { RESPONDENT_FIELDS as RESPONDENT_FIELD_LIST, isRespondentField, mergeAnswers, storedAnswers } from './domain/fields';
import { hashCredential, newToken, sameDigest } from './domain/credentials';
import { createSheet, deleteSheet, getSheet, listSheets, publicSheet, removeSheet, saveFields, sourceOf, validRevision, validSheet } from './domain/sheets';
import { findBinding } from './domain/respondents';
import { issueLink, linkedSheet as findLinkedSheet } from './domain/links';

const PUBLIC_FILES = new Map([
  ['/participant', 'index.html'],
  ...['styles.css', 'client/boot.js', 'client/participant.js'].map((path) => [`/${path}`, path]),
  ...['img/variant-logo-dark.svg', 'img/variant-logo-light.svg'].map((path) => [`/${path}`, `public/${path}`]),
]);
const PUBLIC_ASSETS = new Set([...PUBLIC_FILES.keys()].filter((path) => /\.(js|css|svg)$/.test(path)));
const SESSION_COOKIE = 'am_admin';
// A random browser token (only its hash is stored) that finds this browser's own map or connected interview.
const RESPONDENT_COOKIE = 'am_respondent';
const RESPONDENT_MAX_AGE = 400 * 24 * 60 * 60;
// The admin cookie holds a key-derived token, never the key; rotating ADMIN_KEY signs everyone out.
const localHost = (hostname: string) => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
const participantView = (row: any) => ({ fields: storedAnswers(row.fields), revision: row.revision });
const validAnswers = (body: any) => Boolean(body) && typeof body === 'object' && Object.keys(body).every((key) => ['fields', 'revision'].includes(key))
  && body.fields && typeof body.fields === 'object' && !Array.isArray(body.fields)
  && Object.entries(body.fields).every(([key, value]) => isRespondentField(key) && typeof value === 'string');
const root = resolve(import.meta.dir, '..');
export function createLegacyApp({ store, adminKey, publicOrigin, allowedOrigins = [] }: { store?: Store; adminKey?: string; publicOrigin?: string; allowedOrigins?: string[] }) {
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
  // Respondent routes never use interviewer authentication.
  const respondentPath = (path: string) => path === '/participant' || path === '/api/participant' || path.startsWith('/api/participant/');
  const serveFiles = () => {
    app.get('*', async (c) => {
      const file = PUBLIC_FILES.get(c.req.path);
      if (!file || (!session && c.req.path === '/participant')) return c.notFound();
      const asset = Bun.file(resolve(root, file));
      if (file === 'index.html') {
        return c.html((await asset.text()).replace('data-mode=""', 'data-mode="participant"'));
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
    if (respondentPath(c.req.path) || !c.req.path.startsWith('/api/')) return next();
    // A participant credential never falls through to interviewer authentication,
    // even when the browser also has an admin cookie.
    if (/^Bearer(?:\s|$)/i.test(c.req.header('Authorization') ?? '')) return c.json({ error: 'Access denied.' }, 403);
    if (!c.get('admin')) return c.json({ error: 'Sign in as interviewer.' }, 401);
    await next();
  });
  const secureCookie = (c: Context) => new URL(c.req.url).protocol === 'https:' || httpsOrigins;
  const setRespondent = (c: Context, token: string) => setCookie(c, RESPONDENT_COOKIE, token, {
    httpOnly: true, sameSite: 'Strict', path: '/', maxAge: RESPONDENT_MAX_AGE, secure: secureCookie(c),
  });
  app.use('/api/*', bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: 'Sheet exceeds 1 MB.' }, 413) }));
  app.use('/api/*', async (c, next) => {
    if (!['GET', 'HEAD'].includes(c.req.method)) {
      if (!sameOrigin(c)) return c.json({ error: 'Cross-site writes are not allowed.' }, 403);
      if (c.req.header('Content-Type')?.split(';')[0] !== 'application/json') return c.json({ error: 'JSON required.' }, 415);
    }
    await next();
  });
  // A binding counts only while its sheet exists and, for interviews, the link that connected it is still current.
  const respondentBinding = (c: Context) => findBinding(store, getCookie(c, RESPONDENT_COOKIE));
  const linkedSheet = (authorization?: string) => findLinkedSheet(store, /^Bearer ([a-f0-9]{64})$/i.exec(authorization ?? '')?.[1]);

  // Each interview has one stable link, derived from the admin key and its ID, so the interviewer can always show it.
  // Only its hash is stored; deleting the interview turns it off, and rotating ADMIN_KEY turns off every link.
  app.post('/api/sheets/:id/access', async (c) => {
    const sheet = await getSheet(store, c.req.param('id'));
    const credential = sheet && await issueLink(store, adminKey, sheet);
    return credential ? c.json({ credential }) : c.json({ error: 'Sheet unavailable.' }, 404);
  });
  app.get('/api/sheets', async (c) => c.json((await listSheets(store, c.req.query('source') as any)).map(publicSheet)));
  app.get('/api/sheets/:id', async (c) => {
    const sheet = await getSheet(store, c.req.param('id'));
    return sheet ? c.json(publicSheet(sheet)) : c.json({ error: 'Sheet unavailable.' }, 404);
  });
  app.post('/api/sheets', async (c) => {
    const sheet = await c.req.json().catch(() => null);
    if (!validSheet(sheet)) return c.json({ error: 'Invalid sheet.' }, 400);
    const { status, sheet: saved } = await createSheet(store, sheet);
    if (status === 'conflict') return c.json({ error: 'Sheet ID already exists; nothing was overwritten.' }, 409);
    return c.json(publicSheet(saved), status === 'created' ? 201 : 200);
  });
  app.put('/api/sheets/:id', async (c) => {
    const sheet = await c.req.json().catch(() => null);
    if (!validSheet(sheet) || sheet.id !== c.req.param('id') || !validRevision(sheet.revision)) return c.json({ error: 'Invalid sheet or revision.' }, 400);
    const saved = await saveFields(store, sheet.id, (sheet as any).revision, sheet.fields, { replace: true });
    if (!saved.ok) return saved.reason === 'missing' ? c.json({ error: 'Sheet unavailable.' }, 404) : c.json({ error: 'Another device changed this sheet. Download your draft, then reload and merge your notes.' }, 409);
    return c.json(publicSheet(saved.sheet));
  });
  app.delete('/api/sheets/:id', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!validRevision(body?.revision)) return c.json({ error: 'Revision required.' }, 400);
    const deleted = await deleteSheet(store, c.req.param('id'), body.revision);
    if (!deleted.ok) return deleted.reason === 'missing' ? c.json({ error: 'Sheet unavailable.' }, 404) : c.json({ error: 'Sheet changed; reload before deleting.' }, 409);
    return c.body(null, 204);
  });
  app.all('/api/*', (c) => c.json({ error: 'Endpoint unavailable.' }, 404));
  return serveFiles();
}
