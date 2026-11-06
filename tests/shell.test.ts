import { expect, test } from 'bun:test';
import { createApp } from '../server/app';
import { asset } from '../server/framework/assets';
import { memoryStore } from '../server/store';

const origin = 'https://mapping.example';
const app = () => createApp({ store: memoryStore(), adminKey: 'shell-test-admin-key-0123456789-abcd' }).app;

test('hashed assets are immutable; unknown or unhashed paths are not served', async () => {
  const url = asset('styles.css');
  expect(url).toMatch(/^\/assets\/styles\.[a-z0-9]+\.css$/);
  const response = await app().request(`${origin}${url}`);
  expect(response.status).toBe(200);
  expect(response.headers.get('Content-Type')).toContain('text/css');
  expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
  for (const path of ['/assets/styles.css', '/assets/styles.0000000000.css', '/assets/../server/app.tsx', '/assets/img/variant-logo-dark.svg']) {
    expect((await app().request(`${origin}${path}`)).status).toBe(404);
  }
});

test('pages send a strict CSP, same-origin referrers and no caching; 404s render a page', async () => {
  // One segment could be a group id (the join page answers that); two can't.
  const response = await app().request(`${origin}/no/such-page`, { headers: { Accept: 'text/html' } });
  expect(response.status).toBe(404);
  expect(response.headers.get('Content-Type')).toContain('text/html');
  expect(await response.text()).toContain('Page not found');
  const csp = response.headers.get('Content-Security-Policy') ?? '';
  for (const directive of ["script-src 'self'", "style-src 'self'", "form-action 'self'", "frame-ancestors 'none'", "object-src 'none'"]) expect(csp).toContain(directive);
  expect(csp).not.toContain('unsafe-inline');
  expect(response.headers.get('Referrer-Policy')).toBe('same-origin');
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(response.headers.get('X-Frame-Options')).toBe('DENY');
});

test('cross-site form posts are refused with a page', async () => {
  const response = await app().request(`${origin}/sign-in`, { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'key=x' });
  expect(response.status).toBe(403);
  expect(response.headers.get('Set-Cookie')).toBeNull();
});

test('the interviewer guide is a server-rendered page; the old file name redirects', async () => {
  const guide = await app().request(`${origin}/guide`);
  expect(guide.status).toBe(200);
  expect(await guide.text()).toContain('A 15-minute mapping');
  const old = await app().request(`${origin}/guide.html`);
  expect(old.status).toBe(301);
  expect(old.headers.get('Location')).toBe('/guide');
});
