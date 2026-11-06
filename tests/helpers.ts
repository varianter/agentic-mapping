import { createApp, sessionToken } from '../server/app';
import { memoryStore } from '../server/store';

export const origin = 'https://mapping.example';
export const adminKey = 'test-admin-key-0123456789-abcdefghij';
export const adminCookie = `am_admin=${sessionToken(adminKey)}`;

type Body = Record<string, string | string[]> | undefined;
export type Send = (path: string, init?: { method?: string; form?: Body; json?: unknown; headers?: Record<string, string> }) => Promise<Response>;

// Form-encoded like a browser form post; repeated names become repeated pairs.
export function encode(form: Record<string, string | string[]>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(form)) for (const item of [value].flat()) params.append(key, item);
  return params;
}

export function setup({ admin = true } = {}) {
  const store = memoryStore();
  const { app } = createApp({ store, adminKey: admin ? adminKey : undefined, publicOrigin: origin });
  const send: Send = (path, { method = 'GET', form, json, headers = {} } = {}) => app.request(`${origin}${path}`, {
    method,
    headers: {
      Origin: origin,
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: form ? encode(form) : json !== undefined ? JSON.stringify(json) : undefined,
  });
  // One browser: keeps the respondent cookie the server sets, like a real cookie jar.
  const browser = (): Send => {
    let cookie = '';
    return async (path, init = {}) => {
      const response = await send(path, { ...init, headers: { ...(cookie ? { Cookie: cookie } : {}), ...init.headers } });
      const set = response.headers.get('Set-Cookie');
      if (set?.startsWith('am_respondent=')) cookie = /Max-Age=0/.test(set) ? '' : set.split(';')[0];
      return response;
    };
  };
  const owner: Send = (path, init = {}) => send(path, { ...init, headers: { Cookie: adminCookie, ...init.headers } });
  return { app, store, send, browser, owner };
}

export const json = { Accept: 'application/json' };

// What a rendered sheet form holds: its revision and every named field's value.
export function sheetForm(html: string) {
  const decode = (text: string) => text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code))).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const fields: Record<string, string> = {};
  for (const [, name, value] of html.matchAll(/<textarea[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g)) fields[name] = decode(value);
  for (const [, tag] of html.matchAll(/<input([^>]*)>/g)) {
    const name = /name="([^"]+)"/.exec(tag)?.[1];
    if (!name || /type="(checkbox|hidden|password|file)"/.test(tag)) continue;
    fields[name] = decode(/value="([^"]*)"/.exec(tag)?.[1] ?? '');
  }
  const revision = Number(/name="revision" value="(\d+)"/.exec(html)?.[1]);
  return { revision, fields, names: Object.keys(fields) };
}
