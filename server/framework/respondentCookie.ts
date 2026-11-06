import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv } from './env';

// A random browser token (only its hash is stored) that finds this browser's own map or connected interview.
const RESPONDENT_COOKIE = 'am_respondent';
const RESPONDENT_MAX_AGE = 400 * 24 * 60 * 60;

export const respondentToken = (c: Context<AppEnv>) => getCookie(c, RESPONDENT_COOKIE);
export const setRespondentToken = (c: Context<AppEnv>, token: string) => setCookie(c, RESPONDENT_COOKIE, token, {
  httpOnly: true, sameSite: 'Strict', path: '/', maxAge: RESPONDENT_MAX_AGE, secure: c.get('secure'),
});
export const clearRespondentToken = (c: Context<AppEnv>) => deleteCookie(c, RESPONDENT_COOKIE, { path: '/', secure: c.get('secure') });
