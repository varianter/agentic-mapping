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
  ['/', 'index.html'],
  ['/participant', 'index.html'],
  ['/submissions', 'index.html'],
  ...['index.html', 'guide.html', 'styles.css', 'client/boot.js', 'client/fields.js', 'client/form.js', 'client/self.js', 'client/self-db.js', 'client/me-db.js', 'client/participant.js', 'client/app.js', 'client/db.js', 'client/import.js', ].map((path) => [`/${path}`, path]),
  ...['img/variant-logo-dark.svg', 'img/variant-logo-light.svg'].map((path) => [`/${path}`, `public/${path}`]),
]);
const PUBLIC_ASSETS = new Set([...PUBLIC_FILES.keys()].filter((path) => /\.(js|css|svg)$/.test(path)));
const SESSION_COOKIE = 'am_admin';
const SESSION_MAX_AGE = 30 * 24 * 60 * 60;
// A random browser token (only its hash is stored) that finds this browser's own map or connected interview.
const RESPONDENT_COOKIE = 'am_respondent';
const RESPONDENT_MAX_AGE = 400 * 24 * 60 * 60;
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
const signInPage = (error = '') => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>Sign in · Agentic mapping</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:28rem;margin:15vh auto;padding:0 1rem}label,input,button{display:block;font:inherit}input{width:100%;box-sizing:border-box;margin:.25rem 0 1rem;padding:.5rem}button{padding:.5rem 1rem}[role=alert]{color:#b00020}a{display:inline-block;margin-top:1.5rem}</style></head>
<body><h1>Interviewer sign-in</h1><p>Sign in with the admin key to create and manage interviews.</p>
${error ? `<p role="alert">${escapeHtml(error)}</p>` : ''}<form method="post" action="/sign-in"><label for="key">Admin key</label><input type="password" id="key" name="key" autocomplete="current-password" required autofocus><button type="submit">Sign in</button></form>
<a href="/">Fill in your own map instead</a></body></html>`;
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
  // Respondent routes never use interviewer authentication.
  const respondentPath = (path: string) => path === '/participant' || path === '/api/me' || path === '/api/participant' || path.startsWith('/api/participant/');
  const serveFiles = () => {
    app.get('*', async (c) => {
      const file = PUBLIC_FILES.get(c.req.path);
      if (!file || (!session && ['/participant', '/submissions'].includes(c.req.path))) return c.notFound();
      if (c.req.path === '/submissions' && !c.get('admin')) return c.redirect('/sign-in', 303);
      const asset = Bun.file(resolve(root, file));
      if (file === 'index.html') {
        const mode = c.req.path === '/participant' ? 'participant' : c.get('admin') ? 'interviewer' : 'self';
        const view = c.req.path === '/submissions' ? ' data-view="submissions"' : '';
        return c.html((await asset.text()).replace('data-mode=""', `data-mode="${mode}"${view}${session ? ' data-admin-enabled' : ''}`));
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
  const setSession = (c: Context, value: string, maxAge: number) => setCookie(c, SESSION_COOKIE, value, {
    httpOnly: true, sameSite: 'Strict', path: '/', maxAge, secure: secureCookie(c),
  });
  const setRespondent = (c: Context, token: string) => setCookie(c, RESPONDENT_COOKIE, token, {
    httpOnly: true, sameSite: 'Strict', path: '/', maxAge: RESPONDENT_MAX_AGE, secure: secureCookie(c),
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
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: secureCookie(c) });
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
  // A binding counts only while its sheet exists and, for interviews, the link that connected it is still current.
  const respondentBinding = (c: Context) => findBinding(store, getCookie(c, RESPONDENT_COOKIE));
  const linkedSheet = (authorization?: string) => findLinkedSheet(store, /^Bearer ([a-f0-9]{64})$/i.exec(authorization ?? '')?.[1]);
  app.get('/api/participant', async (c) => {
    const sheet = await linkedSheet(c.req.header('Authorization'));
    return sheet ? c.json(participantView(sheet)) : c.json({ error: 'Link unavailable.' }, 404);
  });
  app.put('/api/participant', async (c) => {
    const authorization = c.req.header('Authorization');
    if (!await linkedSheet(authorization)) return c.json({ error: 'Link unavailable.' }, 404);
    const body = await c.req.json().catch(() => null);
    if (!validAnswers(body) || !validRevision(body.revision)) return c.json({ error: 'Only approved answer fields and a revision are allowed.' }, 400);
    // Recheck after reading the body, immediately before the write.
    const stored = await linkedSheet(authorization);
    if (!stored) return c.json({ error: 'Link unavailable.' }, 404);
    if (stored.revision !== body.revision) return c.json({ error: 'Newer answers are stored. Keep your draft, then reload and merge your answers.' }, 409);
    const saved = { ...stored, fields: { ...stored.fields, ...body.fields }, updatedAt: Date.now(), revision: stored.revision + 1 };
    await store.set(`sheet:${saved.id}`, saved);
    return c.json(participantView(saved));
  });
  // A link connects this browser to its interview. A browser's own map with answers needs an explicit choice first:
  // merge both, keep the interview's answers or replace them with the browser's. The own map is then deleted.
  app.post('/api/participant/connect', async (c) => {
    const authorization = c.req.header('Authorization');
    if (!await linkedSheet(authorization)) return c.json({ error: 'Link unavailable.' }, 404);
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Object.keys(body).some((key) => key !== 'choice')
      || (body.choice !== undefined && !['merge', 'interview', 'mine'].includes(body.choice))) return c.json({ error: 'Choose merge, interview or mine.' }, 400);
    // Recheck after reading the body, immediately before any write.
    const stored = await linkedSheet(authorization);
    if (!stored) return c.json({ error: 'Link unavailable.' }, 404);
    const binding = await respondentBinding(c);
    const own = binding?.sheet && sourceOf(binding.sheet) === 'self' && binding.sheet.id !== stored.id ? binding.sheet : null;
    const mine: Record<string, string> = own ? participantView(own).fields : {};
    const hasAnswers = Object.values(mine).some((value) => value.trim());
    if (hasAnswers && !body.choice) return c.json({ needsChoice: true, mine, interview: participantView(stored).fields });
    if (hasAnswers && body.choice !== 'interview') {
      const answers = body.choice === 'merge' ? mergeAnswers(participantView(stored).fields, mine) : Object.fromEntries(RESPONDENT_FIELD_LIST.map((key) => [key, mine[key] ?? '']));
      await store.set(`sheet:${stored.id}`, { ...stored, fields: { ...stored.fields, ...answers }, updatedAt: Date.now(), revision: stored.revision + 1 });
    }
    const token = binding?.token ?? newToken();
    await store.set(`respondent:${hashCredential(token)}`, { sheetId: stored.id, linkHash: stored.linkHash });
    if (own) await removeSheet(store, own);
    setRespondent(c, token);
    return c.json({ connected: true });
  });
  app.all('/api/participant/*', (c) => c.json({ error: 'Link unavailable.' }, 404));
  app.all('/api/participant', (c) => c.json({ error: 'Link unavailable.' }, 404));

  // ---------- My map: the browser's own answers, or the interview a link connected it to ----------
  const meView = (sheet: any) => ({ ...participantView(sheet), source: sourceOf(sheet) });
  const noMap = { fields: {}, revision: 0, source: 'self' };
  app.use('/api/me', async (c, next) => {
    if (c.req.header('Authorization')) return c.json({ error: 'Access denied.' }, 403);
    await next();
  });
  app.get('/api/me', async (c) => {
    const binding = await respondentBinding(c);
    return c.json(binding?.sheet ? meView(binding.sheet) : noMap);
  });
  app.put('/api/me', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!validAnswers(body) || !(body.revision === 0 || validRevision(body.revision))) return c.json({ error: 'Only approved answer fields and a revision are allowed.' }, 400);
    const binding = await respondentBinding(c);
    const stored = binding?.sheet;
    if ((stored?.revision ?? 0) !== body.revision) return c.json({ error: 'Your map changed elsewhere or is no longer available. Download JSON to keep this draft, then reload.' }, 409);
    if (!stored) {
      // The first save creates the map and the browser token; empty visits store nothing.
      const now = Date.now();
      const created = { id: crypto.randomUUID(), source: 'self', fields: body.fields, createdAt: now, updatedAt: now, revision: 1 };
      const token = binding?.token ?? newToken();
      await store.set(`sheet:${created.id}`, created);
      await store.set(`respondent:${hashCredential(token)}`, { sheetId: created.id });
      setRespondent(c, token);
      return c.json(meView(created), 201);
    }
    // Only answer fields change; interviewer notes on the same sheet are kept.
    const saved = { ...stored, fields: { ...stored.fields, ...body.fields }, updatedAt: Date.now(), revision: stored.revision + 1 };
    await store.set(`sheet:${saved.id}`, saved);
    setRespondent(c, binding.token);
    return c.json(meView(saved));
  });
  app.delete('/api/me', async (c) => {
    const binding = await respondentBinding(c);
    if (binding?.sheet && sourceOf(binding.sheet) !== 'self') return c.json({ error: 'Interview answers can’t be cleared here.' }, 409);
    if (binding?.sheet) await removeSheet(store, binding.sheet);
    if (binding) await store.del(binding.key);
    deleteCookie(c, RESPONDENT_COOKIE, { path: '/', secure: secureCookie(c) });
    return c.body(null, 204);
  });

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
