import { createHmac } from 'node:crypto';
import { createMiddleware } from 'hono/factory';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Context } from 'hono';
import { sameDigest } from '../domain/credentials';
import type { AppEnv } from './env';

export const SESSION_COOKIE = 'am_admin';
const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

// The admin cookie holds a key-derived token, never the key; rotating ADMIN_KEY signs everyone out.
export const sessionToken = (adminKey: string) => createHmac('sha256', adminKey).update('agentic-mapping-session-v1').digest('hex');

export const isAdmin = (c: Context<AppEnv>) => {
  const adminKey = c.get('adminKey');
  const cookie = getCookie(c, SESSION_COOKIE);
  return Boolean(adminKey && cookie && sameDigest(cookie, sessionToken(adminKey)));
};

export const signIn = (c: Context<AppEnv>) => setCookie(c, SESSION_COOKIE, sessionToken(c.get('adminKey')!), {
  httpOnly: true, sameSite: 'Strict', path: '/', maxAge: SESSION_MAX_AGE, secure: c.get('secure'),
});
export const signOut = (c: Context<AppEnv>) => deleteCookie(c, SESSION_COOKIE, { path: '/', secure: c.get('secure') });

// Interviewer pages: unknown without ADMIN_KEY, sign-in first otherwise.
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get('adminKey')) return c.notFound();
  if (!c.get('admin')) return c.req.method === 'GET' ? c.redirect('/sign-in', 303) : c.text('Sign in as interviewer.', 401);
  await next();
});

// Pages that exist only when interviewers are enabled.
export const requireAdminEnabled = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get('adminKey')) return c.notFound();
  await next();
});
